/** Utilidades de las pruebas: app en SQLite en memoria con semilla completa y llamadas HTTP al router con la cabecera de usuario del lab. */
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { buildApp } from "../src/app.ts";
import { CABECERA_USUARIO } from "../src/security.ts";
import type { App, AppOptions } from "../src/schemas.ts";

/** App completa en memoria (tablas, permisos, usuarios y datos de muestra). */
export async function appDePrueba(opts: AppOptions = {}): Promise<App> {
  const app = buildApp(sqliteDatabase(":memory:"), opts);
  await app.seed();
  await app.seedDatos();
  return app;
}

/** Llamada JSON al router como un usuario del lab (`usuario: null` = anónimo). */
export async function call(app: App, method: string, path: string, opts: { usuario?: string | null; body?: unknown; raw?: boolean } = {}): Promise<{ status: number; data: any; res: Response }> {
  const headers: Record<string, string> = {};
  const usuario = opts.usuario === undefined ? "admin" : opts.usuario;
  if (usuario) headers[CABECERA_USUARIO] = usuario;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await app.router.fetch(new Request(`http://t/api/${path}`, { method, headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }), redirect: "manual" }));
  if (opts.raw) return { status: res.status, data: undefined, res };
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { status: res.status, data, res };
}

/** Elemento `i` de una lista o falla. */
export function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`Se esperaba un elemento en ${i} (hay ${list.length})`);
  return v;
}
