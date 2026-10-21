/**
 * Host Azure Functions (v4, modelo de programación Node): registra CADA ruta de la tabla del Router como una
 * función HTTP propia (`app.http`), igual que `registrarEntidad` de ISS. Sin dependencias: el `app` de
 * `@azure/functions` lo pasa el consumidor.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 *
 * ```ts
 * import { app } from "@azure/functions";
 * app.setup({ enableHttpStream: true });                 // SSE en vivo
 * const router = createRouter(ctrls, { basePath: "/api", cors: true });   // basePath = routePrefix de host.json
 * registerAzure(app, router);
 * ```
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import type { Router } from "@Jeff-Aporta/DER/src/02-controllers/server/router.ts";
import { joinPath } from "@Jeff-Aporta/DER/src/02-controllers/server/routes.ts";
import type { AzureApp, AzureHttpRequest, AzureHttpResponseInit, AzureOptions, RouteInfo } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";

/** Primeros segmentos que reserva el host de Functions: una función ahí queda "in error" y responde 404. */
export const AZURE_RESERVED_PREFIXES: ReadonlySet<string> = new Set(["runtime", "admin"]);

/** Nombre de función válido y único (`GET_producto_iproducto`). */
export function azureFunctionName(prefix: string, method: string, path: string, used: Set<string>): string {
  const base = `${prefix}${method}_${path}`.replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/_$/, "");
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
  used.add(name.toLowerCase());
  return name;
}

/** `HttpRequest` de Azure → `Request` Web estándar. */
export async function azureToRequest(req: AzureHttpRequest): Promise<Request> {
  const method = req.method.toUpperCase();
  const init: RequestInit = { method, headers: new Headers([...req.headers]) };
  if (method !== "GET" && method !== "HEAD") {
    const buf = await req.arrayBuffer();
    if (buf.byteLength) init.body = buf;
  }
  return new Request(req.url, init);
}

/** `Response` Web estándar → `HttpResponseInit` de Azure. */
export async function responseToAzure(res: Response, stream: boolean): Promise<AzureHttpResponseInit> {
  const out: AzureHttpResponseInit = { status: res.status, headers: Object.fromEntries(res.headers) };
  if (res.body) out.body = stream ? res.body : new Uint8Array(await res.arrayBuffer());
  return out;
}

/**
 * Registra en Azure todas las rutas del router (acciones, `/sse`, `/cfg`, `/doc`, irregulares) y, si el
 * router tiene CORS, un `OPTIONS` por ruta. Retorna lo registrado.
 */
export function registerAzure(app: AzureApp, router: Router, opts: AzureOptions = {}): RouteInfo[] {
  const authLevel = opts.authLevel ?? "anonymous";
  const stream = opts.stream ?? true;
  const used = new Set<string>();
  const preflight = new Set<string>();
  const registered: RouteInfo[] = [];
  for (const def of router.routes) {
    const route = joinPath(def.path);
    const first = (route.split("/")[0] ?? "").toLowerCase();
    if (AZURE_RESERVED_PREFIXES.has(first)) {
      throw new Error(`Ruta reservada del host de Functions: /${route} (${def.id}); \`${first}/\` no se puede usar`);
    }
    app.http(azureFunctionName(opts.functionPrefix ?? "", def.method, route, used), {
      methods: [def.method],
      route,
      authLevel,
      handler: async (req) => responseToAzure(await def.handle(await azureToRequest(req), { ...req.params }), stream),
    });
    registered.push({ id: def.id, method: def.method, path: def.path, kind: def.kind, name: def.name, sse: def.sse, security: def.security, ...(def.entity ? { entity: def.entity } : {}) });
    if (router.options.cors && !preflight.has(route.toLowerCase())) {
      preflight.add(route.toLowerCase());
      app.http(azureFunctionName(opts.functionPrefix ?? "", "OPTIONS", route, used), {
        methods: ["OPTIONS"],
        route,
        authLevel,
        handler: () => responseToAzure(router.preflight(), false),
      });
    }
  }
  return registered;
}
