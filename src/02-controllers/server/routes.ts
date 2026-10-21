/**
 * Tabla de rutas: lo que cada host registra (Azure `app.http`, Workers, `Deno.serve`...).
 * Cada acción del controller es una ruta propia con parámetros `{pk}`, id estable `METHOD:/ruta`, sin duplicados ni ambigüedades.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { ActionRouteSpec, ExtraRoute, ExtraRouteInput } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { ExposedName, HttpMethod, RouteSecurity, SecurityDef, SecurityInput } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { routePath } from "@Jeff-Aporta/DER/src/02-controllers/plugin.ts";

/** Acciones que escriben: una entidad `administrable: false` no las publica (solo lectura por API). */
const WRITES: ReadonlySet<string> = new Set(["post", "put", "delete", "postList", "putList", "deleteList", "putCfg"]);

/** Une segmentos de ruta sin barras repetidas (`["a/", "/b"]` → `a/b`). */
export function joinPath(...parts: string[]): string {
  return parts.flatMap((p) => p.split("/")).filter(Boolean).join("/");
}

/** Id estable de una ruta: `GET:/producto/{iproducto}`. */
export function routeId(method: HttpMethod, path: string): string {
  return `${method}:/${joinPath(path)}`;
}

/** Clave para detectar duplicados y ambigüedades (`{a}` y `{b}` en el mismo lugar son la misma ruta). */
export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${joinPath(path).toLowerCase().replace(/\{[^}]+\}/g, "{}")}`;
}

/** Compara una plantilla (`producto/{iproducto}`) con los segmentos del request. Retorna los parámetros decodificados o `null`. */
export function matchTemplate(template: string, segs: readonly string[]): Record<string, string> | null {
  const parts = joinPath(template).split("/").filter(Boolean);
  if (parts.length !== segs.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of parts.entries()) {
    const seg = segs[i] ?? "";
    const param = /^\{(\w+)\}$/.exec(part)?.[1];
    if (param) params[param] = decodeURIComponent(seg);
    else if (part !== seg) return null;
  }
  return params;
}

/** Segmentos literales de una plantilla: a más literales, más específica (gana sobre los parámetros). */
export function literalCount(template: string): number {
  return joinPath(template).split("/").filter((p) => p && !/^\{\w+\}$/.test(p)).length;
}

/** Rutas de las acciones de un controller, derivadas de su entidad y filtradas por `exposed`, `administrable` y `expose`. */
export function controllerRouteSpecs(ctrl: ServerController<any>): ActionRouteSpec[] {
  const e = ctrl.entity;
  if (e.def.exposed === false) return [];
  const S = e.singularPath.join("/");
  const L = e.pluralPath.join("/");
  const pks = e.meta.pks;
  const P = pks.map((k) => `{${k}}`).join("/");
  const specs: ActionRouteSpec[] = [];
  const add = (name: string, method: HttpMethod, path: string, withPks: boolean, endpointName?: string) => {
    const endpoint = endpointName ? e.endpoints[endpointName] : undefined;
    const base = { name, method, path, pkParams: withPks ? [...pks] : [], endpoint };
    specs.push({ ...base, sse: false });
    if (ctrl.hasStream(name)) specs.push({ ...base, path: `${path}/sse`, sse: true });
  };
  add("list", "GET", L, false);
  add("postList", "POST", L, false);
  add("putList", "PUT", L, false);
  add("deleteList", "DELETE", L, false);
  add("post", "POST", S, false);
  add("get", "GET", `${S}/${P}`, true);
  add("put", "PUT", `${S}/${P}`, true);
  add("delete", "DELETE", `${S}/${P}`, true);
  for (const [name, ep] of Object.entries(e.endpoints)) {
    const seg = ep.path ?? name;
    if (ep.scope === "one") add(name, ep.method, `${S}/${P}/${seg}`, true, name);
    else add(name, ep.method, `${L}/${seg}`, false, name);
  }
  // configuración y documentación: sólo en el plural; /cfg sólo si el server define la tabla de cfg
  if (ctrl.hasCfg()) add("getCfg", "GET", `${L}/cfg`, false);
  if (ctrl.hasCfg()) add("putCfg", "PUT", `${L}/cfg`, false);
  specs.push({ name: "doc", method: "GET", path: `${L}/doc`, pkParams: [], sse: false });
  const readOnly = e.def.administrable === false ? specs.filter((s) => !WRITES.has(s.name)) : specs;
  const expose = ctrl.config.expose;
  if (!expose) return readOnly;
  const allowed = new Set<ExposedName>(expose);
  return readOnly.filter((s) => allowed.has(s.name));
}

/** Los `paths` declarados en la entidad, ya colgados de su singular/plural, con la implementación de `config.paths` (`this` = el controller). */
export function entityPathRoutes(ctrl: ServerController<any>): ExtraRoute<ServerController<any>>[] {
  if (ctrl.entity.def.exposed === false) return [];
  const out: ExtraRoute<ServerController<any>>[] = [];
  for (const [name, p] of Object.entries(ctrl.entity.def.paths ?? {})) {
    const impl = ctrl.config.paths?.[name];
    if (!impl?.handler && !impl?.sse) throw new Error(`"${ctrl.entity.name}": el path "${name}" no tiene handler ni sse en el server (config.paths)`);
    const pks = ctrl.entity.meta.pks;
    const withPks = (input: ExtraRouteInput): ExtraRouteInput => (p.pks ? { ...input, pks: pks.map((k) => input.params[k] ?? "") } : input);
    const route: ExtraRoute<ServerController<any>> = { method: p.method, path: routePath(p, ctrl.entity), security: p.security, id: p.id ?? undefined, prefix: "none" };
    const handler = impl.handler;
    const sse = impl.sse;
    if (handler) route.handler = function (input, ctx) { return handler.call(this, withPks(input), ctx); };
    if (sse) route.sse = function (input, send, ctx) { return sse.call(this, withPks(input), send, ctx); };
    out.push(route);
  }
  return out;
}

const PUBLIC: RouteSecurity = { protected: false, permissions: false };

/** Acción de seguridad de `/cfg`: una sola para GET y PUT (`CFG:/plural`), salvo que el registro la personalice. */
export function cfgAction(ctrl: ServerController<any>): string {
  return `CFG:/${ctrl.entity.pluralPath.join("/")}`;
}

/** Seguridad de una acción según `config.security` del controller (default: la `security` de la entidad). */
export function controllerSecurity(ctrl: ServerController<any>, name: string): RouteSecurity {
  const sec: boolean | SecurityDef | undefined = ctrl.config.security ?? ctrl.entity.def.security;
  if (!sec) return PUBLIC;
  const cfg = name === "getCfg" || name === "putCfg" ? { action: cfgAction(ctrl) } : {};
  if (sec === true) return name === "doc" ? PUBLIC : { protected: true, permissions: true, ...cfg };
  if (sec.public?.includes(name)) return PUBLIC;
  // la documentación es pública salvo que se proteja explícitamente (sirve para contextualizar a los agentes)
  if (name === "doc" && !(Array.isArray(sec.protected) && sec.protected.includes("doc"))) return PUBLIC;
  const isProtected = sec.protected === undefined || sec.protected === true || sec.protected.includes(name);
  if (!isProtected) return PUBLIC;
  const action = sec.actions?.[name];
  return { protected: true, permissions: sec.permissions ?? true, ...cfg, ...(action ? { action } : {}) };
}

/** Seguridad de una ruta irregular: `"protected"` sólo sesión; `true` sesión + permisos; detalle con `{ protected, permissions, action }`. */
export function routeSecurity(sec: SecurityInput | undefined): RouteSecurity {
  if (!sec || sec === "public") return PUBLIC;
  if (sec === true) return { protected: true, permissions: true };
  if (sec === "protected") return { protected: true, permissions: false };
  return { protected: sec.protected, permissions: sec.protected && sec.permissions, ...(sec.action ? { action: sec.action } : {}) };
}
