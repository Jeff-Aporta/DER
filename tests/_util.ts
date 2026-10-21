/** Utilidades de los tests: acceso tipado a listas y arranque de un API con los plugins de seguridad. */
import { assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer, type Database, type Router, type ServerController, type ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { identityServer, type IdentityConfig, type LoginResult, permissionsServer, type PermissionsConfig } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";

/** Elemento `i` de un arreglo, o falla el test si no existe (tipado sin `undefined`). */
export function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`Se esperaba un elemento en la posición ${i} (hay ${list.length})`);
  return v;
}

export const SECRET = "una-secret-key-de-pruebas-con-mas-de-32-caracteres";
export const ADMIN = { usuario: "admin", password: "admin-12345" };

/** Config de identidad rápida para pruebas (10k iteraciones, admin). */
export function identityCfg(extra: Partial<IdentityConfig> = {}): IdentityConfig {
  return { secret: SECRET, iterations: 10_000, admin: ADMIN, ...extra };
}

/**
 * API de prueba con los plugins JSON: `identity` (si `cfg.identity`) y `permissions` (si `cfg.permissions`). Las puertas
 * del registro global se limpian antes (son un singleton compartido por todos los tests): `cerrar()` las limpia de nuevo.
 */
export async function apiConPlugins(db: Database, controllers: ServerController<any>[], cfg: { identity?: IdentityConfig | undefined; permissions?: PermissionsConfig | undefined; env?: Record<string, string> | undefined }, basePath = "/api") {
  registry.secure(null);
  const plugins: ServerPlugin[] = [];
  const auth = cfg.identity ? createServer(identityServer, { db, cfg: cfg.identity, env: cfg.env }) : null;
  const permisos = cfg.permissions ? createServer(permissionsServer, { db, cfg: cfg.permissions, env: cfg.env }) : null;
  if (auth) plugins.push(auth);
  if (permisos) plugins.push(permisos);
  const router = createRouter(controllers, { basePath, plugins });
  await router.seed();
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { db, router, auth: auth as ServerPlugin, permisos: permisos as ServerPlugin, plugins, cerrar };
}

/** Llamada JSON al router (token Bearer opcional, cabeceras extra). */
export async function call(router: Router, method: string, path: string, opts: { token?: string | undefined; body?: unknown; headers?: Record<string, string> } = {}, base = "http://t/api/") {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  const res = await router.fetch(new Request(`${base}${path}`, { method, headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) }));
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : undefined };
}

/** Token de un login correcto (falla el test si no lo es). */
export async function login(router: Router, usuario: string, password: string, headers?: Record<string, string>): Promise<string> {
  const r = await call(router, "POST", "usuarios/login", { body: { usuario, password }, headers: headers ?? {} });
  assertEquals(r.status, 200, JSON.stringify(r.data));
  return (r.data as LoginResult).token;
}
