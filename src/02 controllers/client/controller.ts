/**
 * ClientController: misma entidad, mismas verificaciones (corren antes del fetch), pero las acciones son fetch a la API.
 *
 * ```ts
 * const productos = new ClientController(ProductoEntity, { baseUrl: "https://api.x.com/api", headers: () => ({ authorization }) });
 * const p = await productos.get({ iproducto: 1 });
 * for await (const t of productos.stream("post", nuevo)) console.log(t);   // POST producto/sse
 * ```
 */
import { BaseController } from "@Jeff-Aporta/DER/src/02 controllers/controller.ts";
import type { Entity } from "@Jeff-Aporta/DER/src/01 objects/entity.ts";
import type { Action, CfgAction, ClientConfig as Config, ClientCtx, EndpointDef } from "@Jeff-Aporta/DER/src/00 common/schemas.ts";
import { HttpError, NotFoundError, ValidationError } from "@Jeff-Aporta/DER/src/00 common/errors.ts";
import type { Pojo } from "@Jeff-Aporta/DER/src/01 objects/pojo.ts";
import { parseEvents } from "@Jeff-Aporta/DER/src/00 common/sse.ts";

const SINGULAR: ReadonlySet<string> = new Set(["get", "put", "delete", "getCfg", "putCfg"]);

export class ClientController<P extends Pojo> extends BaseController<P, ClientCtx> {
  constructor(entity: Entity<P>, readonly config: Config<P, ClientController<P>>) {
    super(entity, config);
  }

  url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/${path}`;
  }

  /**
   * fetch con headers y manejo de errores: 400 → ValidationError, otros ≥400 → HttpError.
   * 404 se devuelve como respuesta para que cada acción decida (null o error).
   */
  async request(
    method: string,
    path: string,
    body?: unknown,
    ctx?: ClientCtx,
    accept = "application/json",
  ): Promise<Response> {
    const headers = new Headers(
      typeof this.config.headers === "function" ? await this.config.headers() : this.config.headers,
    );
    for (const [k, v] of new Headers(ctx?.headers)) headers.set(k, v);
    headers.set("accept", accept);
    if (body !== undefined) headers.set("content-type", "application/json");
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (ctx?.signal) init.signal = ctx.signal;
    const res = await (this.config.fetch ?? fetch)(this.url(path), init);
    if (res.ok || res.status === 404) return res;
    const msg = await errorMessage(res);
    throw res.status === 400 ? new ValidationError(msg) : new HttpError(res.status, msg);
  }

  protected makeCtx(partial?: Partial<ClientCtx>): ClientCtx {
    return { ...partial };
  }

  private routeFor(name: string, arg: unknown, sse = false) {
    const ep = this.entity.endpoints[name];
    const needsPojo = SINGULAR.has(name) || ep?.scope === "one";
    return this.entity.route(name, needsPojo ? arg as P : undefined, sse);
  }

  /** Body/query string según método: GET no lleva body, va como `?q=`. */
  private payload(name: string, method: string, path: string, arg: unknown, ctx: ClientCtx) {
    const params = new URLSearchParams();
    let body: unknown;
    if (name === "get") {
      const inc = ctx.include ?? this.entity.def.getInclude;
      if (inc) params.set("include", JSON.stringify(inc));
    } else if (name === "delete" || name === "list") {
      body = undefined;
    } else if (method === "GET") {
      if (arg !== undefined) params.set("q", JSON.stringify(arg));
    } else body = arg;
    const qs = params.toString();
    return { path: qs ? `${path}?${qs}` : path, body };
  }

  protected async execute(action: Action, arg: unknown, ctx: ClientCtx): Promise<unknown> {
    const r = this.routeFor(action, arg);
    const { path, body } = this.payload(action, r.method, r.path, arg, ctx);
    const res = await this.request(r.method, path, body, ctx);
    if (res.status === 404) {
      if (SINGULAR.has(action)) {
        await res.body?.cancel();
        return null;
      }
      throw new NotFoundError(await errorMessage(res));
    }
    const data = await res.json();
    return Array.isArray(data) ? this.entity.toPojos(data) : this.entity.toPojo(data);
  }

  protected async executeEndpoint(name: string, ep: EndpointDef<P>, arg: unknown, ctx: ClientCtx): Promise<unknown> {
    const r = this.routeFor(name, arg);
    const { path, body } = this.payload(name, r.method, r.path, arg, ctx);
    const res = await this.request(r.method, path, body, ctx);
    if (res.status === 404) throw new NotFoundError(await errorMessage(res));
    if (res.status === 204) return undefined;
    const data = await res.json();
    if (ep.returns === "pojo") return data == null ? null : this.entity.toPojo(data);
    if (ep.returns === "list") return this.entity.toPojos(data);
    return data;
  }

  protected async executeDoc(ctx: ClientCtx): Promise<string> {
    const r = this.entity.route("doc");
    const res = await this.request(r.method, r.path, undefined, ctx, "text/markdown");
    if (res.status === 404) throw new NotFoundError(await errorMessage(res));
    return await res.text();
  }

  protected async executeCfg(
    action: CfgAction,
    pojo: P,
    cambios: Record<string, unknown> | undefined,
    ctx: ClientCtx,
  ): Promise<unknown> {
    const r = this.entity.route(action, pojo);
    const res = await this.request(r.method, r.path, action === "putCfg" ? cambios : undefined, ctx);
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    return await res.json();
  }

  protected async *executeStream(name: string, arg: unknown, ctx: ClientCtx): AsyncIterable<string> {
    const r = this.routeFor(name, arg, true);
    const { path, body } = this.payload(name, r.method, r.path, arg, ctx);
    const res = await this.request(r.method, path, body, ctx, "text/event-stream");
    if (res.status === 404) throw new NotFoundError(await errorMessage(res));
    if (!res.body) return;
    for await (const ev of parseEvents(res.body)) {
      if (ev.event === "error") throw new HttpError(500, ev.data);
      if (ev.event === "message") yield ev.data;
    }
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    if (j && typeof j.error === "string") return j.error;
  } catch { /* texto plano */ }
  return text || `${res.status} ${res.statusText}`;
}
