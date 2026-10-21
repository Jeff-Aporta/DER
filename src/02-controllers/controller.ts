/**
 * Clase común de la que heredan ClientController y ServerController.
 *
 * Flujo de cada acción:  normalizar a pojo → verify (pre*) → override de `actions` (opcional) → execute
 *
 * Verificación (en orden, el primer truthy corta y se lanza ValidationError → HTTP 400):
 *   1. reglas automáticas del schema: pks presentes, requeridos y el Zod de la acción (tipos, enums, largo, no-null)
 *   2. hooks de la entidad (compartidos client/server)
 *   3. hooks propios del controller
 * En las acciones de lista se ejecuta además el pre singular sobre cada ítem (prefijo `[i]`).
 *
 * `pojo(content?)` instancia el POJO de la entidad sin tocar su clase; `permissions(action)` consulta la puerta
 * `permissions()` del registro global con la sesión del ctx (o la sesión singleton).
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/controllers.md
 */
import type { z } from "zod";
import type { Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import { HttpError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { isRequiredOnInsert } from "@Jeff-Aporta/DER/src/01-objects/meta.ts";
import type { Pojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { validateQuery } from "@Jeff-Aporta/DER/src/01-objects/query.ts";
import { type Action, type ActionArgs, type ActionOverride, type ActionResults, ACTIONS, type AuthDecision, type BaseCtx, type CfgAction, type Check, type ConfirmInput, type ControllerOptions, type EndpointDef, type Hooks, type PermissionContext, type PojoInit, type QuerySpec } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { pojoValues, zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";

const ITEM_ACTION: Partial<Record<Action, Action>> = { postList: "post", putList: "put", deleteList: "delete" };

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

function toMessage(r: Check): string | null {
  if (!r) return null;
  return r === true ? "Datos inválidos" : String(r);
}

/** Flujo común de toda acción (normalizar → verificar → override → ejecutar); client y server solo implementan `execute*`. */
export abstract class BaseController<P extends Pojo, Ctx extends BaseCtx = BaseCtx> {
  readonly #options: ControllerOptions<P, any, Ctx>;

  constructor(readonly entity: Entity<P>, options: ControllerOptions<P, any, Ctx> = {}) {
    this.#options = options;
  }

  // ------------------------------------------------------------------ pojos (siempre indirectos)

  /** Instancia del POJO de la entidad con el contenido dado (o vacía). */
  pojo(content?: unknown): P {
    return this.entity.toPojo(content ?? {});
  }

  /** Lista de POJOs de la entidad a partir de objetos planos. */
  pojos(list?: unknown): P[] {
    return this.entity.toPojos(list ?? []);
  }

  // ------------------------------------------------------------------ CRUD

  /** Un registro por sus pks (`null` si no existe); `ctx.include` fija las relaciones. */
  get(pojo: P | PojoInit, ctx?: Partial<Ctx>): Promise<P | null> {
    return this.#dispatch("get", this.entity.toPojo(pojo), ctx);
  }

  /** Crea un registro (secuencias y defaults se completan en el server) y devuelve la fila guardada. */
  post(pojo: P | PojoInit, ctx?: Partial<Ctx>): Promise<P> {
    return this.#dispatch("post", this.entity.toPojo(pojo), ctx);
  }

  /** PUT singular parcial según `schema.put`; `null` si no existe. */
  put(pojo: P | PojoInit, ctx?: Partial<Ctx>): Promise<P | null> {
    return this.#dispatch("put", this.entity.toPojo(pojo), ctx);
  }

  /** Borra por pks y devuelve la fila borrada (`null` si no existía). */
  delete(pojo: P | PojoInit, ctx?: Partial<Ctx>): Promise<P | null> {
    return this.#dispatch("delete", this.entity.toPojo(pojo), ctx);
  }

  /** Listado básico y aplanado (sin relaciones) de toda la colección. */
  list(ctx?: Partial<Ctx>): Promise<P[]> {
    return this.#dispatch("list", undefined, ctx);
  }

  /** Filtrado + paginación + selección de columnas + relaciones. Siempre retorna un arreglo. */
  query(q: QuerySpec<P> = {}, ctx?: Partial<Ctx>): Promise<P[]> {
    return this.#dispatch("query", q, ctx);
  }

  /** Crea varios en una transacción (en el server); un ítem inválido revierte todo. */
  postList(list: (P | PojoInit)[], ctx?: Partial<Ctx>): Promise<P[]> {
    return this.#dispatch("postList", this.entity.toPojos(list), ctx);
  }

  /** Actualiza varios en una transacción; un inexistente revierte todo (404). */
  putList(list: (P | PojoInit)[], ctx?: Partial<Ctx>): Promise<P[]> {
    return this.#dispatch("putList", this.entity.toPojos(list), ctx);
  }

  /** Borra varios en una transacción; un inexistente revierte todo (404). */
  deleteList(list: (P | PojoInit)[], ctx?: Partial<Ctx>): Promise<P[]> {
    return this.#dispatch("deleteList", this.entity.toPojos(list), ctx);
  }

  // ------------------------------------------------------------------ configuración JSON (/cfg)

  /** Configuración de la ENTIDAD (`GET plural/cfg`): el JSON guardado con los valores por defecto del molde Zod. */
  async getCfg<T = Record<string, unknown>>(ctx?: Partial<Ctx>): Promise<T> {
    const c = this.makeCtx(ctx);
    const e = this.#cfgCheck() ?? await this.#runConfirm({ action: "getCfg", arg: undefined }, c) ?? await this.#runCfgHook("preGetCfg", [c]);
    if (e) throw new ValidationError(e);
    return await this.executeCfg("getCfg", undefined, c) as T;
  }

  /** Ajusta la configuración de la entidad (`PUT plural/cfg`) con un JSON PARCIAL (`Obj.update`: sólo llaves del molde) y retorna la config completa. */
  async putCfg<T = Record<string, unknown>>(cambios: Record<string, unknown>, ctx?: Partial<Ctx>): Promise<T> {
    const c = this.makeCtx(ctx);
    let e = this.#cfgCheck();
    if (!e && !Obj.esPlano(cambios)) e = "La configuración debe ser un objeto JSON";
    const patch = this.entity.cfgPatchZod?.safeParse(cambios);
    if (!e && patch && !patch.success) e = zodMessage(patch.error);
    e ??= await this.#runConfirm({ action: "putCfg", arg: undefined, cambios }, c);
    e ??= await this.#runCfgHook("prePutCfg", [cambios, c]);
    if (e) throw new ValidationError(e);
    return await this.executeCfg("putCfg", cambios, c) as T;
  }

  #cfgCheck(): string | null {
    return this.entity.def.cfg ? null : `"${this.entity.plural}" no define configuración (cfg)`;
  }

  async #runCfgHook(name: "preGetCfg" | "prePutCfg", args: unknown[]): Promise<string | null> {
    for (const hooks of [this.entity.hooks, this.#options.hooks]) {
      const fn = hooks?.[name] as ((this: unknown, ...a: unknown[]) => Check | Promise<Check>) | undefined;
      const msg = fn ? toMessage(await fn.apply(this, args)) : null;
      if (msg) return msg;
    }
    return null;
  }

  // ------------------------------------------------------------------ documentación (/doc)

  /** Markdown de la documentación del controller (md autogenerado + fuentes `doc` como secciones): `GET plural/doc`. */
  doc(ctx?: Partial<Ctx>): Promise<string> {
    return this.executeDoc(this.makeCtx(ctx));
  }

  // ------------------------------------------------------------------ endpoints y SSE

  /** Ejecuta un endpoint especial definido en la entidad. */
  async call<R = unknown>(name: string, arg?: unknown, ctx?: Partial<Ctx>): Promise<R> {
    const ep = this.#endpointDef(name);
    const c = this.makeCtx(ctx);
    const a = this.normalizeArg(name, arg);
    await this.#check(name, a, c);
    return await this.executeEndpoint(name, ep, a, c) as R;
  }

  /** Variante Server-Sent Events de una acción o endpoint: itera los textos emitidos. La verificación pre* corre antes de abrir el stream. */
  async *stream(name: Action | string, arg?: unknown, ctx?: Partial<Ctx>): AsyncGenerator<string> {
    yield* await this.openStream(name, arg, ctx);
  }

  /** Como `stream()` pero verifica de inmediato (lanza antes de devolver el iterable). */
  async openStream(name: Action | string, arg?: unknown, ctx?: Partial<Ctx>): Promise<AsyncIterable<string>> {
    const c = this.makeCtx(ctx);
    const a = this.normalizeArg(name, arg);
    await this.#check(name, a, c);
    return this.executeStream(name, a, c);
  }

  // ------------------------------------------------------------------ permisos (puerta del registro)

  /** Decisión de `permissions()` del registro para `action` sobre esta entidad, con la sesión del ctx o la singleton. */
  permissions(action: string, ctx?: Partial<Ctx>, extra: PermissionContext = {}): Promise<AuthDecision> {
    const session = ctx?.session === undefined ? registry.session : ctx.session;
    return registry.decide(session, action, this.entity.name, extra);
  }

  /** Como `permissions()` pero lanza `HttpError(403)` si se niega. Devuelve el valor efectivo del permiso. */
  async assertPermission(action: string, ctx?: Partial<Ctx>, extra: PermissionContext = {}): Promise<unknown> {
    const d = await this.permissions(action, ctx, extra);
    if (!d.allowed) throw new HttpError(403, d.reason ?? `Sin permiso: ${action}`);
    return d.value;
  }

  // ------------------------------------------------------------------ verificación

  /** Ejecuta las verificaciones y retorna el mensaje de error o `null`. */
  async verify(name: Action | string, arg: unknown, ctx: Ctx): Promise<string | null> {
    const itemAction = ITEM_ACTION[name as Action];
    if (itemAction) {
      const list = arg as P[];
      if (!list.length) return "La lista está vacía";
      for (const [i, item] of list.entries()) {
        const e = this.#builtinCheck(itemAction, item);
        if (e) return `[${i}] ${e}`;
      }
      const confirm = await this.#runConfirm({ action: name as "postList" | "putList" | "deleteList", arg: list }, ctx);
      if (confirm) return confirm;
      if (!this.entity.itemHooksOnLists) return await this.#runHooks(name, list, ctx);
      for (const [i, item] of list.entries()) {
        const e = await this.#runHooks(itemAction, item, ctx);
        if (e) return `[${i}] ${e}`;
      }
      return await this.#runHooks(name, list, ctx);
    }
    const e = this.#builtinCheck(name, arg);
    if (e) return e;
    if (!(ACTIONS as readonly string[]).includes(name)) {
      const ep = this.#endpointDef(name);
      const confirm = await this.#runConfirm({ action: "endpoint", name, arg: arg as P | P[] }, ctx);
      if (confirm) return confirm;
      return ep.pre ? toMessage(await ep.pre.call(this, arg as P, ctx)) : null;
    }
    const confirm = await this.#runConfirm(this.#confirmInput(name as Action, arg), ctx);
    if (confirm) return confirm;
    return await this.#runHooks(name, arg, ctx);
  }

  async #check(name: string, arg: unknown, ctx: Ctx): Promise<void> {
    const e = await this.verify(name, arg, ctx);
    if (e) throw new ValidationError(e);
  }

  /** Arma la entrada tipada de `preConfirm` para una acción CRUD/list/query. */
  #confirmInput(action: Action, arg: unknown): ConfirmInput<P> {
    if (action === "list") return { action, arg: undefined };
    if (action === "query") return { action, arg: arg as QuerySpec<P> };
    if (action === "postList" || action === "putList" || action === "deleteList") return { action, arg: arg as P[] };
    return { action, arg: arg as P };
  }

  /** `preConfirm` de la entidad y luego el del controller; el primer mensaje corta. */
  async #runConfirm(input: ConfirmInput<P>, ctx: Ctx): Promise<string | null> {
    for (const hooks of [this.entity.hooks, this.#options.hooks]) {
      const fn = hooks?.preConfirm;
      const msg = fn ? toMessage(await fn.call(this, input, ctx)) : null;
      if (msg) return msg;
    }
    return null;
  }

  async #runHooks(action: string, arg: unknown, ctx: Ctx): Promise<string | null> {
    const hn = `pre${action.charAt(0).toUpperCase()}${action.slice(1)}` as keyof Hooks<P>;
    for (const hooks of [this.entity.hooks, this.#options.hooks]) {
      const fn = hooks?.[hn] as ((this: unknown, ...a: unknown[]) => Check | Promise<Check>) | undefined;
      if (!fn) continue;
      const r = action === "list" ? await fn.call(this, ctx) : await fn.call(this, arg, ctx);
      const msg = toMessage(r);
      if (msg) return msg;
    }
    return null;
  }

  /** Reglas automáticas derivadas del schema (pks presentes, requeridos y luego el Zod de la acción). */
  #builtinCheck(name: string, arg: unknown): string | null {
    const meta = this.entity.meta;
    const p = arg as Record<string, unknown>;
    const pksPresent = () => {
      const miss = meta.pks.filter((k) => isEmpty(p[k]));
      return miss.length ? `Faltan las llaves primarias: ${miss.join(", ")}` : null;
    };
    const zcheck = (s: z.ZodObject) => {
      const r = s.safeParse(pojoValues(arg as Pojo));
      return r.success ? null : zodMessage(r.error);
    };
    const zod = this.entity.zod;
    if (name === "get" || name === "delete") return pksPresent() ?? zcheck(zod.pk);
    if (name === "put") return pksPresent() ?? zcheck(zod.update);
    if (name === "post") {
      const miss = meta.persisted.filter((k) => isRequiredOnInsert(meta.column(k), meta.pks.includes(k))).filter((k) => isEmpty(p[k]));
      if (miss.length) return `Faltan campos requeridos: ${miss.join(", ")}`;
      return zcheck(zod.insert);
    }
    if (name === "list") return null;
    if (name === "query") return validateQuery(meta, arg as QuerySpec, this.entity);
    const ep = this.entity.endpoints[name];
    if (ep?.scope === "one") return pksPresent() ?? zcheck(zod.pk);
    if (ep?.scope === "many" && !Array.isArray(arg)) return "Se esperaba un arreglo";
    return null;
  }

  // ------------------------------------------------------------------ internos

  async #dispatch<A extends Action>(action: A, arg: ActionArgs<P>[A], partial?: Partial<Ctx>): Promise<ActionResults<P>[A]> {
    const ctx = this.makeCtx(partial);
    await this.#check(action, arg, ctx);
    const impl = (a: ActionArgs<P>[A]) => this.execute(action, a, ctx) as Promise<ActionResults<P>[A]>;
    const ov = this.#options.actions?.[action] as ActionOverride<P, this, Ctx, A> | undefined;
    if (!ov) return impl(arg);
    return await ov.call(this, arg, ctx, (a) => impl(a === undefined ? arg : a));
  }

  /** Argumento de una acción/endpoint normalizado a pojo(s) o QuerySpec. */
  normalizeArg(name: string, arg: unknown): unknown {
    if (name === "get" || name === "post" || name === "put" || name === "delete") return this.entity.toPojo(arg);
    if (name === "postList" || name === "putList" || name === "deleteList") return this.entity.toPojos(arg ?? []);
    if (name === "list") return undefined;
    if (name === "query") return arg ?? {};
    return this.#endpointDef(name).scope === "one" ? this.entity.toPojo(arg) : this.entity.toPojos(arg ?? []);
  }

  #endpointDef(name: string): EndpointDef<P> {
    const ep = this.entity.endpoints[name];
    if (!ep) throw new Error(`"${this.entity.singular}" no define el endpoint "${name}"`);
    return ep;
  }

  protected abstract makeCtx(partial?: Partial<Ctx>): Ctx;
  protected abstract execute(action: Action, arg: unknown, ctx: Ctx): Promise<unknown>;
  protected abstract executeEndpoint(name: string, ep: EndpointDef<P>, arg: unknown, ctx: Ctx): Promise<unknown>;
  protected abstract executeStream(name: string, arg: unknown, ctx: Ctx): AsyncIterable<string>;
  protected abstract executeDoc(ctx: Ctx): Promise<string>;
  protected abstract executeCfg(action: CfgAction, cambios: Record<string, unknown> | undefined, ctx: Ctx): Promise<unknown>;
}
