/**
 * 03 plugins — seguridad como plugins del Router, integrados por un JSON de configuración global:
 *
 * ```ts
 * const plugins = pluginsFromConfig({
 *   identity: { secret: "env:JWT_SECRET", admin: { usuario: "admin", password: "env:ADMIN_PASSWORD" } },
 *   permissions: { grupo: "API" },
 * }, { db });
 * const router = createRouter(ctrls, { basePath: "/api", plugins });
 * await router.seed();          // tablas de todos (incl. plugins) + admin, grupo, rol base y rol administrador
 * ```
 * Sin la sección `identity` no hay seguridad (las rutas protegidas se sirven sin JWT); sin `permissions`
 * sólo se exige JWT. Dependencias: `zod` + `kysely` (las del server).
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/Controllers@main/docs/README.md
 */
import { zodMessage } from "../01 objects/zod.ts";
import type { Plugin } from "../02 controllers/server/schemas.ts";
import { type PluginsConfig, type PluginsRuntime, ZPluginsConfig } from "./schemas.ts";
import { identityPlugin } from "./identity/Controladores/server.ts";
import { permissionsPlugin } from "./permissions/Controladores/server.ts";

export * from "./schemas.ts";
export * from "./identity/mod.ts";
export * from "./permissions/mod.ts";

/** Lee `"env:NOMBRE"` del `env` dado o del entorno del proceso (Deno / Node). */
export function resolveEnv(value: string, env?: Record<string, string | undefined>): string {
  if (!value.startsWith("env:")) return value;
  const name = value.slice(4);
  const g = globalThis as {
    Deno?: { env: { get(n: string): string | undefined } };
    process?: { env: Record<string, string | undefined> };
  };
  const found = env?.[name] ?? g.Deno?.env.get(name) ?? g.process?.env[name];
  if (found === undefined) throw new Error(`Variable de entorno no definida: ${name}`);
  return found;
}

/** Construye los plugins habilitados en el JSON global (validado con Zod). */
export function pluginsFromConfig(config: unknown, runtime: PluginsRuntime): Plugin[] {
  const parsed = ZPluginsConfig.safeParse(config);
  if (!parsed.success) throw new Error(`Configuración de plugins inválida: ${zodMessage(parsed.error)}`);
  const cfg: PluginsConfig = parsed.data;
  const { db, env } = runtime;
  const plugins: Plugin[] = [];
  const identity = cfg.identity;
  if (identity && identity.enabled !== false) {
    plugins.push(identityPlugin({
      ...identity,
      db,
      secret: resolveEnv(identity.secret, env),
      admin: identity.admin
        ? { ...identity.admin, password: resolveEnv(identity.admin.password, env) }
        : undefined,
    }));
  }
  const permissions = cfg.permissions;
  if (permissions && permissions.enabled !== false) {
    const admins = [...(permissions.admins ?? []), ...(identity?.admin ? [identity.admin.usuario] : [])];
    plugins.push(permissionsPlugin({ ...permissions, db, admins: [...new Set(admins)] }));
  }
  return plugins;
}
