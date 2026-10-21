/**
 * Lo común de los plugins JSON para ambos lados: la entidad de cada clave (definida una sola vez en el registro, así el
 * client y el server del mismo proceso comparten la misma `Entity`) y la ruta de una irregular según su prefijo.
 */
import { defineEntity, type Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import type { EntityDef, IrregularRoute, PluginEntity } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";

/** Llaves de `EntityDef` (lo transversal); todo lo demás que traiga la entidad de un plugin es configuración de servidor. */
export const ENTITY_KEYS: ReadonlySet<string> = new Set(["schema", "name", "singular", "plural", "table", "singularSuffix", "pluralSuffix", "listColumns", "getInclude", "pageSize", "maxPageSize", "hooks", "endpoints", "cfg", "doc", "itemHooksOnLists", "security"]);

/** Entidad registrada de la clave `key` del plugin: la reusa si ya existe con ese plural (mismo nombre); si no, la define. */
export function pluginEntity(pluginName: string, key: string, e: PluginEntity): Entity<any> {
  const name = e.name ?? `${pluginName}.${key}`;
  const def: Record<string, unknown> = { name };
  for (const k of Object.keys(e)) if (ENTITY_KEYS.has(k)) def[k] = (e as Record<string, unknown>)[k];
  const endpoints = e.endpoints ? Object.fromEntries(Object.entries(e.endpoints).map(([n, ep]) => [n, { method: ep.method, scope: ep.scope, ...(ep.returns ? { returns: ep.returns } : {}), ...(ep.path ? { path: ep.path } : {}), ...(ep.pre ? { pre: ep.pre } : {}) }])) : undefined;
  if (endpoints) def["endpoints"] = endpoints;
  const pluralSuffix = e.pluralSuffix ?? (e.singular === e.plural ? "s" : undefined);
  const pluralKey = [e.plural, pluralSuffix].filter(Boolean).join("/");
  if (registry.has(pluralKey)) {
    const existing = registry.entity(pluralKey);
    if (existing.name === name) return existing;
  }
  return defineEntity(def as EntityDef<any> & { schema: never });
}

/** Ruta (sin basePath) de una irregular: `prefix` `singular`/`plural` la cuelga de la entidad; `none` (default) la deja tal cual. */
export function routePath(r: IrregularRoute, entity?: Entity<any>): string {
  const prefix = r.prefix ?? "none";
  if (prefix === "none") return r.path;
  if (!entity) throw new Error(`La ruta "${r.method} ${r.path}" tiene prefix "${prefix}" pero no indica entity`);
  const base = prefix === "singular" ? entity.singularPath : entity.pluralPath;
  return [...base, ...r.path.split("/").filter(Boolean)].join("/");
}
