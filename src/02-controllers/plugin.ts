/**
 * Lo común de los plugins JSON para ambos lados: la entidad de cada clave (definida una sola vez en el registro, así el
 * client y el server del mismo proceso comparten la misma `Entity`), la ruta de un path irregular según su prefijo y la
 * búsqueda de un path por nombre (del plugin o de alguna de sus entidades).
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/controllers.md
 */
import { defineEntity, type Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import type { EntityDef, IrregularPath, PluginDef, PluginEntity } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";

/** Llaves de `EntityDef` (lo transversal); todo lo demás que traiga la entidad de un plugin es configuración de servidor. */
export const ENTITY_KEYS: ReadonlySet<string> = new Set(["schema", "name", "singular", "plural", "table", "singularSuffix", "pluralSuffix", "listColumns", "getInclude", "pageSize", "maxPageSize", "hooks", "endpoints", "paths", "cfg", "doc", "itemHooksOnLists", "security", "exposed", "administrable"]);

/** La parte transversal de un path (sin handler/sse/ops del server). */
function pathDef(p: IrregularPath): IrregularPath {
  const out: IrregularPath = { method: p.method, path: p.path };
  if (p.prefix !== undefined) out.prefix = p.prefix;
  if (p.security !== undefined) out.security = p.security;
  if (p.zod !== undefined) out.zod = p.zod;
  if (p.returns !== undefined) out.returns = p.returns;
  if (p.id !== undefined) out.id = p.id;
  if (p.ops !== undefined) out.ops = p.ops;
  return out;
}

/** Entidad registrada de la clave `key` del plugin: la reusa si ya existe con ese plural (mismo nombre); si no, la define. */
export function pluginEntity(pluginName: string, key: string, e: PluginEntity): Entity<any> {
  const name = e.name ?? `${pluginName}.${key}`;
  const def: Record<string, unknown> = { name };
  for (const k of Object.keys(e)) if (ENTITY_KEYS.has(k)) def[k] = (e as Record<string, unknown>)[k];
  if (e.endpoints) def["endpoints"] = Object.fromEntries(Object.entries(e.endpoints).map(([n, ep]) => [n, { method: ep.method, scope: ep.scope, ...(ep.returns ? { returns: ep.returns } : {}), ...(ep.path ? { path: ep.path } : {}), ...(ep.pre ? { pre: ep.pre } : {}) }]));
  if (e.paths) def["paths"] = Object.fromEntries(Object.entries(e.paths).map(([n, p]) => [n, pathDef(p)]));
  const pluralSuffix = e.pluralSuffix ?? (e.singular === e.plural ? "s" : undefined);
  const pluralKey = [e.plural, pluralSuffix].filter(Boolean).join("/");
  if (registry.has(pluralKey)) {
    const existing = registry.entity(pluralKey);
    if (existing.name === name) return existing;
  }
  return defineEntity(def as EntityDef<any> & { schema: never });
}

/** Ruta (sin basePath) de un path: con entidad cuelga de su `plural` (default) o `singular` (y con `pks` lleva `{pk}`); sin entidad (`irregularPaths`) va tal cual. */
export function routePath(r: IrregularPath, entity?: Entity<any>): string {
  const prefix = r.prefix ?? (entity ? "plural" : "none");
  if (prefix === "none" || !entity) return r.path;
  if (r.pks && prefix !== "singular") throw new Error(`El path "${r.method} ${r.path}" de "${entity.name}" lleva pks: su prefix debe ser "singular"`);
  const base = prefix === "singular" ? entity.singularPath : entity.pluralPath;
  const pks = r.pks ? entity.meta.pks.map((k) => `{${k}}`) : [];
  return [...base, ...pks, ...r.path.split("/").filter(Boolean)].join("/");
}

/** Path por nombre: primero los irregulares del plugin, luego los `paths` de cada entidad (devuelve la entidad dueña si la hay). */
export function findPath(def: PluginDef, name: string, entities: Map<string, Entity<any>>): { path: IrregularPath; entity?: Entity<any> } | null {
  const irregular = def.irregularPaths?.[name];
  if (irregular) return { path: irregular };
  for (const [key, e] of Object.entries(def.entities ?? {})) {
    const p = e.paths?.[name];
    const entity = entities.get(key);
    if (p && entity) return { path: p, entity };
    if (p) return { path: p };
  }
  return null;
}
