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
 */
import type { z } from "zod";
import type { Entity } from "@Jeff-Aporta/DER/src/01 objects/entity.ts";
import { ValidationError } from "@Jeff-Aporta/DER/src/00 common/errors.ts";
import { Obj } from "@Jeff-Aporta/DER/src/00 common/obj.ts";
import { isRequiredOnInsert } from "@Jeff-Aporta/DER/src/01 objects/meta.ts";
import type { Pojo } from "@Jeff-Aporta/DER/src/01 objects/pojo.ts";
import { validateQuery } from "@Jeff-Aporta/DER/src/01 objects/query.ts";
import {
  type Action,
  type ActionArgs,
  type ActionOverride,
  type ActionResults,
  ACTIONS,
  type BaseCtx,
  type CfgAction,
  type Check,
  type ConfirmInput,
  type ControllerOptions,
  type EndpointDef,
  type Hooks,
  type PojoInit,
  type QuerySpec,
} from "@Jeff-Aporta/DER/src/00 common/schemas.ts";
import { pojoValues, zodMessage } from "@Jeff-Aporta/DER/src/01 objects/zod.ts";

const ITEM_ACTION: Partial<Record<Action, Action>> = {
  postList: "post",
  putList: "put",
  deleteList: "delete",
};

const hookName = (a: string): string => `pre${a.charAt(0).toUpperCase()}${a.slice(1)}`;

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

export abstract class BaseController<P extends Pojo, Ctx extends BaseCtx = BaseCtx> {
  constructor(
    readonly entity: Entity<P>,
    protected readonly options: ControllerOptions<P, any, Ctx> = {},
  ) {}

  // ------------------------------------------------------------------ CRUD

  get(pojo: P | PojoInit, ctx?: Partial<Ctx>): Promise<P | null> {
    return this.dispatch("get", this.entity.toPojo(pojo), ctx);
  }

  post(pojo: P | PojoInit, ctx?: Partial<Ctx>): Promise<P> {
    return this.dispatch("post", this.entity.toPojo(pojo), ctx);
  }

  put(pojo: P | PojoInit, ctx?: Partial<Ctx>): Promise<P | null> {
    return this.dispatch("put", this.entity.toPojo(pojo), ctx);
  }

  delete(pojo: P | PojoInit, ctx?: Partial<Ctx>): Promise<P | null> {
    return this.dispatch("delete", this.entity.toPojo(pojo), ctx);
  }

  /** Listado básico y aplanado (sin relaciones) de toda la colección. */
  list(ctx?: Partial<Ctx>): Promise<P[]> {
    return this.dispatch("list", undefined, ctx);
  }

  /** Filtrado + paginación + selección de columnas + relaciones. Siempre retorna un arreglo. */
  query(q: QuerySpec<P> = {}, ctx?: Partial<Ctx>): Promise<P[]> {
    return this.dispatch("query", q, ctx);
  }

  postList(list: (P | PojoInit)[], ctx?: Partial<Ctx>): Promise<P[]> {
    return this.dispatch("postList", this.entity.toPojos(list), ctx);
  }

  putList(list: (P | PojoInit)[], ctx?: Partial<Ctx>): Promise<P[]> {
    return this.dispatch("putList", this.entity.toPojos(list), ctx);
  }

  deleteList(list: (P | PojoInit)[], ctx?: Partial<Ctx>): Promise<P[]> {
    return this.dispatch("deleteList", this.entity.toPojos(list), ctx);
  }

  // ------------------------------------------------------------------ configuración JSON (/cfg)

  /** JSON de configuración de la entidad (`GET singular/pks.../cfg`). `null` si la entidad no existe. */
  async getCfg<T = Record<string, unknown>>(pojo: P | PojoInit, ctx?: Partial<Ctx>): Promise<T | null> {
    const c = this.makeCtx(ctx);
    const p = this.entity.toPojo(pojo);
    const e = this.cfgCheck(p) ??
      await this.runConfirm({ action: "getCfg", arg: p }, c) ??
      await this.runCfgHook("preGetCfg", [p, c]);
    if (e) throw new ValidationError(e);
    return await this.executeCfg("getCfg", p, undefined, c) as T | null;
  }

  /**
   * Aplica un JSON PARCIAL a la configuración (`PUT singular/pks.../cfg`) y retorna la config completa.
   * Una sola llave basta para ajustar un pedazo; `null` quita (según el molde Zod si lo hay).
   */
  async putCfg<T = Record<string, unknown>>(
    pojo: P | PojoInit,
    cambios: Record<string, unknown>,
    ctx?: Partial<Ctx>,
  ): Promise<T | null> {
    const c = this.makeCtx(ctx);
    const p = this.entity.toPojo(pojo);
    let e = this.cfgCheck(p);
    if (!e && !Obj.esPlano(cambios)) e = "La configuración debe ser un objeto JSON";
    if (!e && this.entity.cfgPatchZod) {
      const r = this.entity.cfgPatchZod.safeParse(cambios);
      if (!r.success) e = zodMessage(r.error);
    }
    e ??= await this.runConfirm({ action: "putCfg", arg: p, cambios }, c);
    e ??= await this.runCfgHook("prePutCfg", [p, cambios, c]);
    if (e) throw new ValidationError(e);
    return await this.executeCfg("putCfg", p, cambios, c) as T | null;
  }

  private cfgCheck(p: P): string | null {
    if (!this.entity.def.cfg) return `"${this.entity.singular}" no define configuración (cfg)`;
    return this.builtinCheck("get", p);
  }

  private async runCfgHook(name: "preGetCfg" | "prePutCfg", args: unknown[]): Promise<string | null> {
    for (const hooks of [this.entity.hooks, this.options.hooks]) {
      const fn = hooks?.[name] as ((this: unknown, ...a: unknown[]) => Check | Promise<Check>) | undefined;
      const msg = fn ? toMessage(await fn.apply(this, args)) : null;
      if (msg) return msg;
    }
    return null;
  }

  // ------------------------------------------------------------------ documentación (/doc)

  /**
   * Markdown de la documentación del controller: el md AUTOGENERADO de la entidad con las fuentes `doc`
   * concatenadas como secciones. Es lo que entrega `GET plural/doc`.
   */
  doc(ctx?: Partial<Ctx>): Promise<string> {
    return this.executeDoc(this.makeCtx(ctx));
  }

  // ------------------------------------------------------------------ endpoints y SSE

  /** Ejecuta un endpoint especial definido en la entidad. */
  async call<R = unknown>(name: string, arg?: unknown, ctx?: Partial<Ctx>): Promise<R> {
    const ep = this.endpointDef(name);
    const c = this.makeCtx(ctx);
    const a = this.normalizeArg(name, arg);
    await this.check(name, a, c);
    return await this.executeEndpoint(name, ep, a, c) as R;
  }

  /**
   * Variante Server-Sent Events de una acción o endpoint: itera los textos emitidos.
   * La verificación pre* corre antes de abrir el stream.
   */
  async *stream(name: Action | string, arg?: unknown, ctx?: Partial<Ctx>): AsyncGenerator<string> {
    yield* await this.openStream(name, arg, ctx);
  }

  /** Como `stream()` pero verifica de inmediato (lanza antes de devolver el iterable). */
  async openStream(name: Action | string, arg?: unknown, ctx?: Partial<Ctx>): Promise<AsyncIterable<string>> {
    const c = this.makeCtx(ctx);
    const a = this.normalizeArg(name, arg);
    await this.check(name, a, c);
    return this.executeStream(name, a, c);
  }

  // ------------------------------------------------------------------ verificación

  /** Ejecuta las verificaciones y retorna el mensaje de error o `null`. */
  async verify(name: Action | string, arg: unknown, ctx: Ctx): Promise<string | null> {
    const itemAction = ITEM_ACTION[name as Action];
    if (itemAction) {
      const list = arg as P[];
      if (!list.length) return "La lista está vacía";
      for (const [i, item] of list.entries()) {
        const e = this.builtinCheck(itemAction, item);
        if (e) return `[${i}] ${e}`;
      }
      const confirm = await this.runConfirm({ action: name as "postList" | "putList" | "deleteList", arg: list }, ctx);
      if (confirm) return confirm;
      if (this.entity.itemHooksOnLists) {
        for (const [i, item] of list.entries()) {
          const e = await this.runHooks(itemAction, item, ctx);
          if (e) return `[${i}] ${e}`;
        }
      }
      return await this.runHooks(name, list, ctx);
    }
    const e = this.builtinCheck(name, arg);
    if (e) return e;
    if (!(ACTIONS as readonly string[]).includes(name)) {
      const ep = this.endpointDef(name);
      const confirm = await this.runConfirm({ action: "endpoint", name, arg: arg as P | P[] }, ctx);
      if (confirm) return confirm;
      return ep.pre ? toMessage(await ep.pre.call(this, arg as P, ctx)) : null;
    }
    const confirm = await this.runConfirm(this.confirmInput(name as Action, arg), ctx);
    if (confirm) return confirm;
    return await this.runHooks(name, arg, ctx);
  }

  protected async check(name: string, arg: unknown, ctx: Ctx): Promise<void> {
    const e = await this.verify(name, arg, ctx);
    if (e) throw new ValidationError(e);
  }

  /** Arma la entrada tipada de `preConfirm` para una acción CRUD/list/query. */
  private confirmInput(action: Action, arg: unknown): ConfirmInput<P> {
    switch (action) {
      case "list":
        return { action, arg: undefined };
      case "query":
        return { action, arg: arg as QuerySpec<P> };
      case "postList":
      case "putList":
      case "deleteList":
        return { action, arg: arg as P[] };
      default:
        return { action, arg: arg as P };
    }
  }

  /** `preConfirm` de la entidad y luego el del controller; el primer mensaje corta. */
  private async runConfirm(input: ConfirmInput<P>, ctx: Ctx): Promise<string | null> {
    for (const hooks of [this.entity.hooks, this.options.hooks]) {
      const fn = hooks?.preConfirm;
      const msg = fn ? toMessage(await fn.call(this, input, ctx)) : null;
      if (msg) return msg;
    }
    return null;
  }

  private async runHooks(action: string, arg: unknown, ctx: Ctx): Promise<string | null> {
    const hn = hookName(action) as keyof Hooks<P>;
    for (const hooks of [this.entity.hooks, this.options.hooks]) {
      const fn = hooks?.[hn] as ((this: unknown, ...a: unknown[]) => Check | Promise<Check>) | undefined;
      if (!fn) continue;
      const r = action === "list" ? await fn.call(this, ctx) : await fn.call(this, arg, ctx);
      const msg = toMessage(r);
      if (msg) return msg;
    }
    return null;
  }

  /** Reglas automáticas derivadas del schema (pks presentes, requeridos y luego el Zod de la acción). */
  protected builtinCheck(name: string, arg: unknown): string | null {
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
    switch (name) {
      case "get":
      case "delete":
        return pksPresent() ?? zcheck(zod.pk);
      case "put":
        return pksPresent() ?? zcheck(zod.update);
      case "post": {
        const miss = meta.persisted.filter((k) => isRequiredOnInsert(meta.column(k), meta.pks.includes(k)))
          .filter((k) => isEmpty(p[k]));
        if (miss.length) return `Faltan campos requeridos: ${miss.join(", ")}`;
        return zcheck(zod.insert);
      }
      case "list":
        return null;
      case "query":
        return validateQuery(meta, arg as QuerySpec, this.entity);
      default: {
        const ep = this.entity.endpoints[name];
        if (ep?.scope === "one") return pksPresent() ?? zcheck(zod.pk);
        if (ep?.scope === "many" && !Array.isArray(arg)) return "Se esperaba un arreglo";
        return null;
      }
    }
  }

  // ------------------------------------------------------------------ internos

  protected async dispatch<A extends Action>(
    action: A,
    arg: ActionArgs<P>[A],
    partial?: Partial<Ctx>,
  ): Promise<ActionResults<P>[A]> {
    const ctx = this.makeCtx(partial);
    await this.check(action, arg, ctx);
    const impl = (a: ActionArgs<P>[A]) => this.execute(action, a, ctx) as Promise<ActionResults<P>[A]>;
    const ov = this.options.actions?.[action] as ActionOverride<P, this, Ctx, A> | undefined;
    if (!ov) return impl(arg);
    return await ov.call(this, arg, ctx, (a) => impl(a === undefined ? arg : a));
  }

  protected normalizeArg(name: string, arg: unknown): unknown {
    switch (name) {
      case "get":
      case "post":
      case "put":
      case "delete":
        return this.entity.toPojo(arg);
      case "postList":
      case "putList":
      case "deleteList":
        return this.entity.toPojos(arg ?? []);
      case "list":
        return undefined;
      case "query":
        return arg ?? {};
      default: {
        const ep = this.endpointDef(name);
        return ep.scope === "one" ? this.entity.toPojo(arg) : this.entity.toPojos(arg ?? []);
      }
    }
  }

  protected endpointDef(name: string): EndpointDef<P> {
    const ep = this.entity.endpoints[name];
    if (!ep) throw new Error(`"${this.entity.singular}" no define el endpoint "${name}"`);
    return ep;
  }

  protected abstract makeCtx(partial?: Partial<Ctx>): Ctx;
  protected abstract execute(action: Action, arg: unknown, ctx: Ctx): Promise<unknown>;
  protected abstract executeEndpoint(name: string, ep: EndpointDef<P>, arg: unknown, ctx: Ctx): Promise<unknown>;
  protected abstract executeStream(name: string, arg: unknown, ctx: Ctx): AsyncIterable<string>;
  protected abstract executeDoc(ctx: Ctx): Promise<string>;
  protected abstract executeCfg(
    action: CfgAction,
    pojo: P,
    cambios: Record<string, unknown> | undefined,
    ctx: Ctx,
  ): Promise<unknown>;
}

function toMessage(r: Check): string | null {
  if (!r) return null;
  return r === true ? "Datos inválidos" : String(r);
}
