/**
 * `createServer(json, { db, cfg, env })`: arma el lado servidor de un plugin JSON. El JSON del server es el transversal
 * con las particularidades inyectadas (`Obj.insert`): por cada entidad un `ServerController` en `db` (lo transversal va a
 * la entidad, el resto a la config del controller: hidden, actions, expose, sse, handlers de endpoints y de `paths`...),
 * los `irregularPaths` con su `handler`/`sse` (`this` = el plugin), las puertas de seguridad enlazadas (`plugin.security`),
 * la configuración validada con `cfg` (Zod) y con `"env:NOMBRE"` resuelto, `seed()` y las `ops` de los paths como métodos.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import { ENTITY_KEYS, pluginEntity, routePath } from "@Jeff-Aporta/DER/src/02-controllers/plugin.ts";
import { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { ExtraRoute, PathImpl, ServerControllerConfig, ServerEndpoint, ServerPath, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";

/** Lee `"env:NOMBRE"` del `env` dado o del entorno del proceso (Deno / Node); otro texto se devuelve tal cual. */
export function resolveEnv(value: string, env?: Record<string, string | undefined>): string {
  if (!value.startsWith("env:")) return value;
  const name = value.slice(4);
  const g = globalThis as { Deno?: { env: { get(n: string): string | undefined } }; process?: { env: Record<string, string | undefined> } };
  const found = env?.[name] ?? g.Deno?.env.get(name) ?? g.process?.env[name];
  if (found === undefined) throw new Error(`Variable de entorno no definida: ${name}`);
  return found;
}

/** Resuelve todo `"env:NOMBRE"` dentro de un JSON (en profundidad). */
function resolveEnvDeep(v: unknown, env?: Record<string, string | undefined>): unknown {
  if (typeof v === "string") return resolveEnv(v, env);
  if (Array.isArray(v)) return v.map((x) => resolveEnvDeep(x, env));
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveEnvDeep(x, env)]));
  return v;
}

/** `handler`/`sse` de un path con `this` fijado al plugin (los paths de entidad corren desde el controller). */
function bound(p: ServerPath, plugin: ServerPlugin): PathImpl<any> {
  const impl: PathImpl<any> = {};
  if (p.handler) impl.handler = p.handler.bind(plugin);
  if (p.sse) impl.sse = p.sse.bind(plugin);
  return impl;
}

/** Arma el lado servidor de un plugin JSON: controllers por entidad, rutas de los paths, puertas enlazadas, `ops` y `seed()`. */
export function createServer(def: ServerPluginDef, runtime: ServerPluginRuntime): ServerPlugin {
  const raw = runtime.cfg ?? {};
  const parsed = def.cfg ? def.cfg.safeParse(raw) : { success: true as const, data: raw };
  if (!parsed.success) throw new Error(`Configuración de "${def.name}" inválida: ${zodMessage(parsed.error)}`);
  const cfg = resolveEnvDeep(parsed.data, runtime.env) as Record<string, unknown>;
  const plugin = {
    name: def.name,
    def,
    db: runtime.db,
    cfg,
    env: runtime.env,
    controllers: {} as Record<string, ServerController<any>>,
    list: [] as ServerController<any>[],
    routes: [] as ExtraRoute<ServerPlugin>[],
    security: {},
    state: {} as Record<string, unknown>,
    router: null,
    async seed() {
      await def.seed?.call(plugin);
    },
  } as ServerPlugin;
  const entities = new Map<string, Entity<any>>();
  for (const [key, e] of Object.entries(def.entities ?? {})) {
    const entity = pluginEntity(def.name, key, e as never);
    entities.set(key, entity);
    const config: Record<string, unknown> = { db: runtime.db };
    for (const k of Object.keys(e)) if (!ENTITY_KEYS.has(k)) config[k] = (e as Record<string, unknown>)[k];
    const endpoints: Record<string, ServerEndpoint<any>> = {};
    for (const [n, ep] of Object.entries(e.endpoints ?? {})) {
      const impl: ServerEndpoint<any> = {};
      if (ep.handler) impl.handler = ep.handler;
      if (ep.sse) impl.sse = ep.sse;
      if (ep.handler || ep.sse) endpoints[n] = impl;
    }
    if (Object.keys(endpoints).length) config["endpoints"] = endpoints;
    const paths: Record<string, PathImpl<any>> = {};
    for (const [n, p] of Object.entries(e.paths ?? {})) {
      if (!p.handler && !p.sse) throw new Error(`El path "${n}" de "${key}" en el plugin "${def.name}" no tiene handler ni sse en el server`);
      paths[n] = bound(p, plugin);
    }
    if (Object.keys(paths).length) config["paths"] = paths;
    if (e.exposed === false) config["expose"] = [];
    const ctrl = new ServerController(entity, config as ServerControllerConfig<any>);
    plugin.controllers[key] = ctrl;
    plugin.list.push(ctrl);
  }
  for (const [name, p] of Object.entries(def.irregularPaths ?? {})) {
    if (!p.handler && !p.sse) throw new Error(`El path irregular "${name}" del plugin "${def.name}" no tiene handler ni sse en el server`);
    plugin.routes.push({ method: p.method, path: routePath(p), security: p.security, id: p.id ?? undefined, prefix: "none", ...bound(p, plugin) });
  }
  const sec = def.security ?? {};
  if (sec.extract) plugin.security.extract = sec.extract.bind(plugin);
  if (sec.protected) plugin.security.protected = sec.protected.bind(plugin);
  if (sec.permissions) plugin.security.permissions = sec.permissions.bind(plugin);
  const allPaths = [...Object.values(def.irregularPaths ?? {}), ...Object.values(def.entities ?? {}).flatMap((e) => Object.values(e.paths ?? {}))];
  for (const p of allPaths) for (const [name, fn] of Object.entries(p.ops ?? {})) plugin[name] = fn.bind(plugin);
  def.setup?.call(plugin);
  return plugin;
}
