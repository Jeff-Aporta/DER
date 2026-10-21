/**
 * `createClient(json, config)`: arma el lado cliente de un plugin JSON. Por cada entidad del JSON un `ClientController`
 * (`plugin.controllers.<clave>`), `plugin.call("path", body?, params?)` para cualquier path irregular (del plugin o de una
 * entidad; prefijo singular/plural/ninguno, Zod del body en el cliente), el token de sesión (`token`, `setToken`, `headers()`)
 * y las `ops` de cada path como métodos con `this` = el plugin. Nunca se exponen clases: los pojos salen de
 * `plugin.controllers.x.pojo(content?)`.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/controllers.md
 */
import { ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ClientPlugin, ClientPluginConfig, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import { Pojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import { ClientController, clientRequest, errorMessage } from "@Jeff-Aporta/DER/src/02-controllers/client/controller.ts";
import { findPath, pluginEntity, routePath } from "@Jeff-Aporta/DER/src/02-controllers/plugin.ts";

/** Arma el lado cliente de un plugin JSON: controllers por entidad, `call()` de paths, token y `ops` como métodos. */
export function createClient(def: PluginDef, config: ClientPluginConfig): ClientPlugin {
  let token: string | null = config.token ?? null;
  const entities = new Map<string, Entity<any>>();
  const headers = async (): Promise<HeadersInit> => {
    const base = new Headers(typeof config.headers === "function" ? await config.headers() : config.headers);
    if (token) base.set("authorization", `Bearer ${token}`);
    return base;
  };
  const plugin = {
    name: def.name,
    def,
    config,
    controllers: {} as Record<string, ClientController<any>>,
    state: {} as Record<string, unknown>,
    get token(): string | null {
      return token;
    },
    setToken(t: string | null): void {
      token = t;
      config.onToken?.(t);
    },
    headers,
    request(method: string, path: string, body?: unknown, ctx?: Parameters<typeof clientRequest>[4]): Promise<Response> {
      return clientRequest({ baseUrl: config.baseUrl, fetch: config.fetch, headers }, method, path, body, ctx);
    },
    async call<R = unknown>(name: string, body?: unknown, keys: Record<string, string> | Pojo = {}): Promise<R> {
      const found = findPath(def, name, entities);
      if (!found) throw new Error(`El plugin "${def.name}" no define el path "${name}"`);
      const { path: r, entity } = found;
      // con `pks`, las llaves vienen como `{ pk: valor }` o como un pojo de la entidad
      const params: Record<string, string> = keys instanceof Pojo ? Object.fromEntries((entity?.meta.pks ?? []).map((k, i) => [k, String(keys.pkValues()[i] ?? "")])) : keys;
      if (r.zod) {
        const parsed = r.zod.safeParse(body);
        if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
        body = parsed.data;
      }
      const path = routePath(r, entity).replace(/\{(\w+)\}/g, (_m, k: string) => encodeURIComponent(params[k] ?? ""));
      const query = r.method === "GET" && body !== undefined ? `?${new URLSearchParams(body as Record<string, string>)}` : "";
      const res = await plugin.request(r.method, path + query, r.method === "GET" ? undefined : body);
      if (res.status === 404) throw new ValidationError(await errorMessage(res));
      if (res.status === 204 || r.returns === "void") return undefined as R;
      const data = await res.json();
      if (r.returns === "pojo") return (entity && data != null ? entity.toPojo(data) : data) as R;
      if (r.returns === "list") return (entity ? entity.toPojos(data) : data) as R;
      return data as R;
    },
  } as unknown as ClientPlugin;
  for (const [key, e] of Object.entries(def.entities ?? {})) {
    const entity = pluginEntity(def.name, key, e);
    entities.set(key, entity);
    plugin.controllers[key] = new ClientController(entity, { baseUrl: config.baseUrl, headers, ...(config.fetch ? { fetch: config.fetch } : {}) });
  }
  const allPaths = [...Object.values(def.irregularPaths ?? {}), ...Object.values(def.entities ?? {}).flatMap((e) => Object.values(e.paths ?? {}))];
  for (const p of allPaths) for (const [name, fn] of Object.entries(p.ops ?? {})) plugin[name] = fn.bind(plugin);
  return plugin;
}
