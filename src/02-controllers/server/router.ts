/**
 * Router HTTP sobre Request/Response estándar (Web API). Construye la TABLA DE RUTAS (una por acción del controller)
 * que luego registra cada host:
 *
 * ```ts
 * const router = createRouter([productos, categorias], { basePath: "/api", cors: true, plugins: [auth, permisos] });
 * Deno.serve(router.fetch);                          // Deno / Bun / Node (matcher genérico)
 * registerAzure(app, router);                        // Azure Functions: una función por ruta
 * export default defineWorker((env) => router);      // Cloudflare Workers
 * ```
 *
 * Seguridad: las puertas del registro global (`registry.security`). Sin `extract` no hay seguridad (skip). Con ella, cada
 * request saca su sesión (`ctx.session`, `ctx.state.session`); una ruta `protected` exige sesión válida y, si además
 * evalúa `permissions`, consulta `permissions(sesión, acción, entidad)`; el valor efectivo viaja en `ctx.state.permiso`.
 * Los plugins (`createServer`) aportan sus puertas; entran al registro sólo donde el consumidor no definió la suya.
 */
import { encodeEvent, TextChannel } from "@Jeff-Aporta/DER/src/00-common/sse.ts";
import { HttpError, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { CanFn, Include, RouteMatch, SessionInfo } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import { apiIndexMd, composeFromSources, vaultHtml } from "@Jeff-Aporta/DER/src/02-controllers/server/doc.ts";
import { controllerRouteSpecs, controllerSecurity, joinPath, literalCount, matchTemplate, routeId, routeKey, routeSecurity } from "@Jeff-Aporta/DER/src/02-controllers/server/routes.ts";
import type { CorsOptions, DocSheet, ExtraRoute, ExtraRouteInput, RouteDef, RouteInfo, RouterOptions, ServerCtx, ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";

/** `?v=1` (o cualquier valor salvo `0`/`false`) pide la vista HTML del mismo endpoint `/doc`. `?v=` vacío cuenta como truthy. */
function wantsView(url: URL): boolean {
  const v = url.searchParams.get("v");
  return v !== null && v !== "0" && v.toLowerCase() !== "false";
}

function markdown(text: string): Response {
  return new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}

function html(text: string): Response {
  return new Response(text, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function json(status: number, body: unknown): Response {
  return body === undefined ? new Response(null, { status: 204 }) : Response.json(body, { status });
}

export class Router {
  readonly basePath: string[];
  /** Tabla de rutas (relativas al basePath): lo que registra cada host. */
  readonly routes: RouteDef[];
  readonly #cors: Required<CorsOptions> | null;
  /** Controllers propios + los que aportan los plugins. */
  readonly controllers: ServerController<any>[];
  readonly plugins: ServerPlugin[];

  constructor(controllers: ServerController<any>[], readonly options: RouterOptions = {}) {
    this.plugins = options.plugins ?? [];
    this.controllers = [...controllers, ...this.plugins.flatMap((p) => p.list)];
    this.basePath = (options.basePath ?? "").split("/").filter(Boolean);
    const cors = options.cors;
    this.#cors = cors ? { origin: "*", methods: "GET, POST, PUT, DELETE, PATCH, OPTIONS", headers: "content-type, authorization, accept", maxAge: 86400, ...(cors === true ? {} : cors) } : null;
    for (const plugin of this.plugins) {
      plugin.router = this;
      // las puertas del plugin entran al registro sólo donde el consumidor no definió la suya
      const hooks = registry.security;
      registry.secure({ ...(hooks.extract ? {} : { extract: plugin.security.extract }), ...(hooks.protected ? {} : { protected: plugin.security.protected }), ...(hooks.permissions ? {} : { permissions: plugin.security.permissions }) });
    }
    this.routes = this.#buildRoutes();
  }

  /** basePath normalizado (`/api` o ""). */
  get basePathStr(): string {
    return this.basePath.length ? `/${this.basePath.join("/")}` : "";
  }

  // ================================================================ tabla de rutas

  #buildRoutes(): RouteDef[] {
    const routes: RouteDef[] = [];
    const seen = new Map<string, string>();
    const push = (def: RouteDef, origen: string) => {
      const key = routeKey(def.method, def.path);
      const previa = seen.get(key);
      if (previa) throw new Error(`Ruta duplicada o ambigua: ${def.method} /${def.path} (${origen}) ya la registró ${previa}`);
      seen.set(key, origen);
      routes.push(def);
    };
    const docInfo: RouteInfo = { id: routeId("GET", "doc"), method: "GET", path: "doc", kind: "doc", name: "doc", sse: false, security: routeSecurity(false) };
    push({ ...docInfo, handle: (req) => this.#run(docInfo, req, () => this.#docResponse(req)) }, "router");
    for (const ctrl of this.controllers) {
      for (const spec of controllerRouteSpecs(ctrl)) {
        const info: RouteInfo = { id: routeId(spec.method, spec.path), method: spec.method, path: joinPath(spec.path), kind: spec.name === "doc" ? "doc" : "action", name: spec.name, entity: ctrl.entity.name, sse: spec.sse, security: controllerSecurity(ctrl, spec.name) };
        const handle = (req: Request, params: Record<string, string>) => {
          const m: RouteMatch = { name: spec.name, pks: spec.pkParams.map((k) => params[k] ?? ""), sse: spec.sse };
          if (spec.endpoint) m.endpoint = spec.endpoint;
          return this.#run(info, req, (ctx) => this.#dispatch(ctrl, m, req, ctx));
        };
        push({ ...info, handle }, ctrl.entity.name);
      }
      for (const extra of ctrl.config.routes ?? []) {
        for (const def of this.#extraDefs(extra, ctrl, ctrl.entity.name)) push(def, ctrl.entity.name);
      }
    }
    for (const extra of this.options.routes ?? []) {
      for (const def of this.#extraDefs(extra, this, "router")) push(def, "router");
    }
    for (const plugin of this.plugins) {
      for (const extra of plugin.routes) {
        for (const def of this.#extraDefs(extra, plugin, "router")) push(def, `plugin ${plugin.name}`);
      }
    }
    return routes;
  }

  /** Ruta irregular (y su `/sse`) como RouteDef. */
  #extraDefs<Ctl>(extra: ExtraRoute<Ctl>, self: Ctl, entity: string): RouteDef[] {
    const path = joinPath(extra.path);
    const defs: RouteDef[] = [];
    const make = (sse: boolean): RouteDef => {
      const p = sse ? joinPath(path, "sse") : path;
      const info: RouteInfo = { id: extra.id ?? routeId(extra.method, p), method: extra.method, path: p, kind: "extra", name: extra.id ?? routeId(extra.method, p), sse, security: routeSecurity(extra.security) };
      if (entity !== "router") info.entity = entity;
      return { ...info, handle: (req, params) => this.#run(info, req, (ctx) => this.#runExtra(extra, self, sse, req, params, ctx)) };
    };
    if (extra.handler) defs.push(make(false));
    if (extra.sse) defs.push(make(true));
    if (!defs.length) throw new Error(`Ruta irregular ${extra.method} /${path}: falta handler o sse`);
    return defs;
  }

  /** Busca la ruta del request: los segmentos literales ganan sobre los parámetros. */
  match(method: string, pathname: string): { route: RouteDef; params: Record<string, string> } | null {
    let segs = pathname.split("/").filter(Boolean);
    if (!this.basePath.every((b, i) => segs[i] === b)) return null;
    segs = segs.slice(this.basePath.length);
    let best: { route: RouteDef; params: Record<string, string>; score: number } | null = null;
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      const params = matchTemplate(route.path, segs);
      if (!params) continue;
      const score = literalCount(route.path);
      if (!best || score > best.score) best = { route, params, score };
    }
    return best ? { route: best.route, params: best.params } : null;
  }

  /** ¿Alguna ruta (de cualquier método) atiende este path? (para los preflight `OPTIONS`). */
  #pathExists(pathname: string): boolean {
    return ["GET", "POST", "PUT", "DELETE", "PATCH"].some((m) => this.match(m, pathname));
  }

  /** Respuesta para el request, o `null` si ninguna ruta lo atiende. */
  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS" && this.#cors) return this.#pathExists(url.pathname) ? this.preflight() : null;
    const found = this.match(req.method, url.pathname);
    return found ? await found.route.handle(req, found.params) : null;
  }

  /** Handler listo para `Deno.serve` / Workers: 404 si no hay ruta. */
  fetch = async (req: Request): Promise<Response> => (await this.handle(req)) ?? this.#withCors(json(404, { error: "Ruta no encontrada" }));

  /** Respuesta del preflight CORS. */
  preflight(): Response {
    return this.#withCors(new Response(null, { status: 204 }));
  }

  // ================================================================ ejecución común

  /** Contexto, seguridad, guard, CORS y errores: igual para toda ruta y todo host. */
  async #run(info: RouteInfo, req: Request, inner: (ctx: Partial<ServerCtx>) => Promise<Response>): Promise<Response> {
    try {
      // la señal sólo en SSE (detectar desconexión): leer req.signal en cada request dispara un aviso en Deno 2.9+
      const ctx: Partial<ServerCtx> = { request: req, ...(info.sse ? { signal: req.signal } : {}), ...(await this.options.context?.(req)) };
      ctx.state = { ...ctx.state, route: info, basePath: this.basePathStr };
      await this.#security(info, req, ctx);
      const blocked = await this.options.guard?.(info, req, ctx);
      if (blocked) return this.#withCors(blocked);
      return this.#withCors(await inner(ctx));
    } catch (err) {
      return this.#withCors(this.#errorResponse(err, req));
    }
  }

  /** Puertas del registro: `extract` → sesión; ruta protegida → sesión válida; `permissions` → decisión (valor en `state.permiso`). */
  async #security(info: RouteInfo, req: Request, ctx: Partial<ServerCtx>): Promise<void> {
    const state = ctx.state ?? {};
    ctx.state = state;
    let session: SessionInfo | null = null;
    const can: CanFn = (action, entity = null) => registry.decide(session, action, entity, { method: info.method, route: info });
    state["can"] = can;
    ctx.session = null;
    state["session"] = null;
    if (!registry.secured) return;
    try {
      session = await registry.security.extract!(req);
    } catch (err) {
      if (info.security.protected) throw err;
    }
    ctx.session = session;
    state["session"] = session;
    if (!info.security.protected) return;
    if (!(await registry.isLogged(session))) throw new HttpError(401, `Requiere autenticación: ${info.id}`);
    if (!info.security.permissions) return;
    const decision = await registry.decide(session, info.security.action ?? info.id, info.entity ?? null, { method: info.method, route: info });
    if (!decision.allowed) throw new HttpError(403, decision.reason ?? `Sin permiso: ${info.id}`);
    state["permiso"] = decision.value;
  }

  /** Seed completo: tablas de todos los controllers (también los de los plugins, en cada base usada) y el seed de datos de cada plugin. Idempotente. */
  async seed(): Promise<void> {
    const visited = new Set<ServerController<any>>();
    for (const c of this.controllers) await c.seed({}, visited);
    for (const plugin of this.plugins) await plugin.seed();
  }

  #withCors(res: Response): Response {
    const cors = this.#cors;
    if (!cors) return res;
    const headers = new Headers(res.headers);
    headers.set("access-control-allow-origin", cors.origin);
    headers.set("access-control-allow-methods", cors.methods);
    headers.set("access-control-allow-headers", cors.headers);
    headers.set("access-control-max-age", String(cors.maxAge));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  async #runExtra<Ctl>(extra: ExtraRoute<Ctl>, self: Ctl, sse: boolean, req: Request, params: Record<string, string>, ctx: Partial<ServerCtx>): Promise<Response> {
    const url = new URL(req.url);
    const input: ExtraRouteInput = { request: req, params, query: url.searchParams, body: await readBody(req) };
    const full = this.#fullCtx(ctx);
    if (sse && extra.sse) {
      const handler = extra.sse;
      const ch = new TextChannel();
      queueMicrotask(async () => {
        try {
          await handler.call(self, input, (t) => ch.push(t), full);
          ch.close();
        } catch (e) {
          ch.close(e);
        }
      });
      return sseResponse(ch);
    }
    const result = await extra.handler?.call(self, input, full);
    return result instanceof Response ? result : json(200, result);
  }

  /** ctx completo para handlers propios (el de los controllers lo completa cada controller). */
  #fullCtx(ctx: Partial<ServerCtx>): ServerCtx {
    const exec = ctx.exec ?? this.controllers[0]?.db.kysely;
    if (!exec) throw new Error("Router sin controllers: no hay conexión para el ctx");
    return { state: {}, ...ctx, exec };
  }

  // ================================================================ documentación

  /** Doc general: el índice autogenerado del API + las fuentes de `options.doc` concatenadas como secciones. */
  async doc(): Promise<string> {
    const index = apiIndexMd(this.controllers.map((c) => c.entity), this.basePathStr);
    return composeFromSources(index, await this.#docSources(), this.options.docBase);
  }

  /** Hojas del libro del API: el índice general y la doc compuesta de cada controller. */
  async docSheets(): Promise<DocSheet[]> {
    const per = await Promise.all(this.controllers.map((c) => c.docSheet(this.basePathStr)));
    return [{ path: "README.md", content: await this.doc() }, ...per];
  }

  /** `{base}/doc?v=1`: HTML del libro completo del API. */
  async docView(): Promise<string> {
    return vaultHtml(await this.docSheets(), this.options.docView?.title ?? "API · Documentación", this.options.docView);
  }

  async #docSources(): Promise<string[]> {
    const d = this.options.doc ?? [];
    return typeof d === "function" ? await d.call(this) : d;
  }

  async #docResponse(req: Request): Promise<Response> {
    return wantsView(new URL(req.url)) ? html(await this.docView()) : markdown(await this.doc());
  }

  // ================================================================ acciones del controller

  async #dispatch(ctrl: ServerController<any>, m: RouteMatch, req: Request, ctx: Partial<ServerCtx>): Promise<Response> {
    const url = new URL(req.url);
    const inc = url.searchParams.get("include");
    if (inc) ctx.include = parseJson(inc, "include") as Include;
    const e = ctrl.entity;
    if (m.name === "doc" && wantsView(url)) return html(await ctrl.docView(this.basePathStr, this.options.docView));
    if (m.name === "doc") return markdown(await ctrl.doc(ctx));
    const body = await readBody(req);
    const q = url.searchParams.get("q");
    const qArg = q ? parseJson(q, "q") : undefined;
    if (m.name === "getCfg") return json(200, await ctrl.getCfg(ctx));
    if (m.name === "putCfg") return json(200, await ctrl.putCfg(requireObject(body), ctx));
    let arg: unknown;
    if (m.name === "get" || m.name === "delete") arg = e.pojoFromPks(m.pks);
    else if (m.name === "put") arg = e.pojoFromPks(m.pks, body);
    else if (m.name === "post") arg = requireObject(body);
    else if (m.name === "query") arg = (req.method === "GET" ? qArg : body) ?? {};
    else if (m.name === "postList" || m.name === "putList" || m.name === "deleteList") arg = requireArray(body);
    else if (m.name !== "list") arg = m.endpoint?.scope === "one" ? e.pojoFromPks(m.pks, body ?? qArg) : requireArray(body ?? qArg ?? []);
    if (m.sse) return sseResponse(await ctrl.openStream(m.name, arg, ctx));
    if (m.name === "post") return json(201, await ctrl.post(arg as never, ctx));
    if (m.name === "postList") return json(201, await ctrl.postList(arg as never, ctx));
    let result: unknown;
    if (m.name === "get") result = await ctrl.get(arg as never, ctx);
    else if (m.name === "put") result = await ctrl.put(arg as never, ctx);
    else if (m.name === "delete") result = await ctrl.delete(arg as never, ctx);
    else if (m.name === "list") result = await ctrl.list(ctx);
    else if (m.name === "query") result = await ctrl.query(arg as never, ctx);
    else if (m.name === "putList") result = await ctrl.putList(arg as never, ctx);
    else if (m.name === "deleteList") result = await ctrl.deleteList(arg as never, ctx);
    else return json(200, await ctrl.call(m.name, arg, ctx));
    return result === null ? json(404, { error: "No encontrado" }) : json(200, result);
  }

  #errorResponse(err: unknown, req: Request): Response {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    if (err instanceof TypeError && /arreglo|JSON/.test(err.message)) return json(400, { error: err.message });
    if (this.options.onError) this.options.onError(err, req);
    else console.error(err);
    const msg = this.options.exposeErrors && err instanceof Error ? err.message : "Error interno";
    return json(500, { error: msg });
  }
}

export function createRouter(controllers: ServerController<any>[], options?: RouterOptions): Router {
  return new Router(controllers, options);
}

/** Respuesta `text/event-stream`: un evento `message` por cada texto; `event: error` si el handler falla. */
export function sseResponse(it: AsyncIterable<string>): Response {
  const enc = new TextEncoder();
  const iter = it[Symbol.asyncIterator]();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const r = await iter.next();
        if (r.done) controller.close();
        else controller.enqueue(enc.encode(encodeEvent(r.value)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(enc.encode(encodeEvent(msg, "error")));
        controller.close();
      }
    },
    async cancel() {
      await iter.return?.();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" } });
}

async function readBody(req: Request): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD" || !req.body) return undefined;
  const text = await req.text();
  return text.trim() ? parseJson(text, "body") : undefined;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError(`${what}: JSON inválido`);
  }
}

function requireObject(v: unknown): Record<string, unknown> {
  if (v == null || typeof v !== "object" || Array.isArray(v)) throw new ValidationError("Se esperaba un objeto");
  return v as Record<string, unknown>;
}

function requireArray(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new ValidationError("Se esperaba un arreglo");
  return v;
}
