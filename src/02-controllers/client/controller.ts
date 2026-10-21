/**
 * ClientController: misma entidad, mismas verificaciones (corren antes del fetch), pero las acciones son fetch a la API.
 *
 * ```ts
 * const productos = new ClientController(ProductoEntity, { baseUrl: "https://api.x.com/api", headers: () => ({ authorization }) });
 * const p = await productos.get({ iproducto: 1 });
 * for await (const t of productos.stream("post", nuevo)) console.log(t);   // POST producto/sse
 * ```
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/controllers.md
 */
import { BaseController } from "@Jeff-Aporta/DER/src/02-controllers/controller.ts";
import type { Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import type { Action, CfgAction, ClientConfig, ClientCtx, EndpointDef, HeadersSource } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { HttpError, NotFoundError, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { Pojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { encodeQuery } from "@Jeff-Aporta/DER/src/01-objects/query.ts";
import { parseEvents } from "@Jeff-Aporta/DER/src/00-common/sse.ts";

const SINGULAR: ReadonlySet<string> = new Set(["get", "put", "delete"]);

/** Mensaje de error de una respuesta: `{ error }` JSON, el texto plano o `status statusText`. */
export async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    if (j && typeof j.error === "string") return j.error;
  } catch { /* texto plano */ }
  return text || `${res.status} ${res.statusText}`;
}

/**
 * fetch con headers y manejo de errores, común al ClientController y a los plugins: 400 → ValidationError, otros ≥400 → HttpError.
 * 404 se devuelve como respuesta para que cada acción decida (null o error).
 */
export async function clientRequest(config: { baseUrl: string; fetch?: typeof fetch | undefined; headers?: HeadersSource | undefined }, method: string, path: string, body?: unknown, ctx?: ClientCtx, accept = "application/json"): Promise<Response> {
  const headers = new Headers(typeof config.headers === "function" ? await config.headers() : config.headers);
  for (const [k, v] of new Headers(ctx?.headers)) headers.set(k, v);
  headers.set("accept", accept);
  if (body !== undefined) headers.set("content-type", "application/json");
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (ctx?.signal) init.signal = ctx.signal;
  const res = await (config.fetch ?? fetch)(`${config.baseUrl.replace(/\/+$/, "")}/${path}`, init);
  if (res.ok || res.status === 404) return res;
  const msg = await errorMessage(res);
  throw res.status === 400 ? new ValidationError(msg) : new HttpError(res.status, msg);
}

/** Controller del lado cliente: las mismas verificaciones que el server, ejecutadas antes de un `fetch` a la API. */
export class ClientController<P extends Pojo> extends BaseController<P, ClientCtx> {
  constructor(entity: Entity<P>, readonly config: ClientConfig<P, ClientController<P>>) {
    super(entity, config);
  }

  /** URL absoluta de una ruta relativa al `baseUrl` (normaliza la barra final). */
  url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/${path}`;
  }

  /** fetch de bajo nivel con las cabeceras de la config: 400 → `ValidationError`, ≥400 → `HttpError`, 404 se devuelve. */
  request(method: string, path: string, body?: unknown, ctx?: ClientCtx, accept = "application/json"): Promise<Response> {
    return clientRequest(this.config, method, path, body, ctx, accept);
  }

  protected makeCtx(partial?: Partial<ClientCtx>): ClientCtx {
    return { session: registry.session, ...partial };
  }

  #routeFor(name: string, arg: unknown, sse = false) {
    const ep = this.entity.endpoints[name];
    const needsPojo = SINGULAR.has(name) || ep?.scope === "one";
    return this.entity.route(name, needsPojo ? arg as P : undefined, sse);
  }

  /** Body/query string según método: GET no lleva body, va como `?q=`. */
  #payload(name: string, method: string, path: string, arg: unknown, ctx: ClientCtx) {
    const params = new URLSearchParams();
    let body: unknown;
    const inc = ctx.include ?? this.entity.def.getInclude;
    if (name === "get" && inc) params.set("include", encodeQuery(inc));
    else if (name === "delete" || name === "list" || name === "get") body = undefined;
    else if (name === "query") params.set("q", encodeQuery(arg ?? {}));
    else if (method === "GET" && arg !== undefined) params.set("q", encodeQuery(arg));
    else if (method !== "GET") body = arg;
    const qs = params.toString();
    return { path: qs ? `${path}?${qs}` : path, body };
  }

  protected async execute(action: Action, arg: unknown, ctx: ClientCtx): Promise<unknown> {
    const r = this.#routeFor(action, arg);
    const { path, body } = this.#payload(action, r.method, r.path, arg, ctx);
    const res = await this.request(r.method, path, body, ctx);
    if (res.status === 404 && SINGULAR.has(action)) {
      await res.body?.cancel();
      return null;
    }
    if (res.status === 404) throw new NotFoundError(await errorMessage(res));
    const data = await res.json();
    return Array.isArray(data) ? this.entity.toPojos(data) : this.entity.toPojo(data);
  }

  protected async executeEndpoint(name: string, ep: EndpointDef<P>, arg: unknown, ctx: ClientCtx): Promise<unknown> {
    const r = this.#routeFor(name, arg);
    const { path, body } = this.#payload(name, r.method, r.path, arg, ctx);
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

  /** `plural/cfg`: 404 = el server no expone la configuración de esta entidad (no definió tabla de cfg). */
  protected async executeCfg(action: CfgAction, cambios: Record<string, unknown> | undefined, ctx: ClientCtx): Promise<unknown> {
    const r = this.entity.route(action);
    const res = await this.request(r.method, r.path, action === "putCfg" ? cambios : undefined, ctx);
    if (res.status === 404) throw new NotFoundError(await errorMessage(res));
    return await res.json();
  }

  protected async *executeStream(name: string, arg: unknown, ctx: ClientCtx): AsyncIterable<string> {
    const r = this.#routeFor(name, arg, true);
    const { path, body } = this.#payload(name, r.method, r.path, arg, ctx);
    const res = await this.request(r.method, path, body, ctx, "text/event-stream");
    if (res.status === 404) throw new NotFoundError(await errorMessage(res));
    if (!res.body) return;
    for await (const ev of parseEvents(res.body)) {
      if (ev.event === "error") throw new HttpError(500, ev.data);
      if (ev.event === "message") yield ev.data;
    }
  }
}
