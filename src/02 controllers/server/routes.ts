/**
 * Tabla de rutas: lo que cada host registra (Azure `app.http`, Workers, `Deno.serve`...).
 * Mismo modelo que `registrarEntidad` de ISS: cada acción del controller es una ruta propia con parámetros
 * `{pk}`, id estable `METHOD:/ruta`, sin duplicados ni ambigüedades.
 */
import type { ServerController } from "./controller.ts";
import type { ActionRouteSpec, ExposedName, RouteSecurity } from "./schemas.ts";
import type { HttpMethod } from "../../00 common/schemas.ts";

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

/**
 * Compara una plantilla (`producto/{iproducto}`) con los segmentos del request.
 * Retorna los parámetros decodificados o `null` si no coincide.
 */
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

/** Rutas de las acciones de un controller, derivadas de su entidad y filtradas por `expose`. */
export function controllerRouteSpecs(ctrl: ServerController<any>): ActionRouteSpec[] {
  const e = ctrl.entity;
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
  add("query", "POST", `${L}/query`, false);
  add("query", "GET", `${L}/query`, false);
  add("post", "POST", S, false);
  add("get", "GET", `${S}/${P}`, true);
  add("put", "PUT", `${S}/${P}`, true);
  add("delete", "DELETE", `${S}/${P}`, true);
  for (const [name, ep] of Object.entries(e.endpoints)) {
    const seg = ep.path ?? name;
    if (ep.scope === "one") add(name, ep.method, `${S}/${P}/${seg}`, true, name);
    else add(name, ep.method, `${L}/${seg}`, false, name);
  }
  if (e.def.cfg) {
    add("getCfg", "GET", `${S}/${P}/cfg`, true);
    add("putCfg", "PUT", `${S}/${P}/cfg`, true);
  }
  specs.push({ name: "doc", method: "GET", path: `${L}/doc`, pkParams: [], sse: false });
  const expose = ctrl.config.expose;
  if (!expose) return specs;
  const allowed = new Set<ExposedName>(expose);
  return specs.filter((s) => allowed.has(s.name));
}

const PUBLIC: RouteSecurity = { protected: false, permissions: false };

/** Seguridad de una acción según `config.security` del controller. */
export function controllerSecurity(ctrl: ServerController<any>, name: string): RouteSecurity {
  const sec = ctrl.config.security;
  if (!sec) return PUBLIC;
  if (sec === true) return name === "doc" ? PUBLIC : { protected: true, permissions: true };
  if (sec.public?.includes(name)) return PUBLIC;
  // la documentación es pública salvo que se proteja explícitamente (sirve para contextualizar a los agentes)
  if (name === "doc" && !(Array.isArray(sec.protected) && sec.protected.includes("doc"))) return PUBLIC;
  const isProtected = sec.protected === undefined || sec.protected === true || sec.protected.includes(name);
  if (!isProtected) return PUBLIC;
  const action = sec.actions?.[name];
  return { protected: true, permissions: sec.permissions ?? true, ...(action ? { action } : {}) };
}

/** Seguridad de una ruta irregular. */
export function routeSecurity(sec: boolean | RouteSecurity | undefined): RouteSecurity {
  if (!sec) return PUBLIC;
  if (sec === true) return { protected: true, permissions: true };
  return {
    protected: sec.protected,
    permissions: sec.protected && sec.permissions,
    ...(sec.action ? { action: sec.action } : {}),
  };
}
