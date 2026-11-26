/**
 * Conexión PROPIA del plugin de embeddings. La caché, las proyecciones, los contadores y los cursores NO viven en la base
 * principal: se abren en una SQLite aparte (`cfg.db` o `cfg.ruta`, p. ej. `datos/embeddings.sqlite`) con su propia conexión
 * `node:sqlite` (`sqliteDatabase`); sin ruta se usa `:memory:` (tests). Los perfiles de usuario (`embeddings_usuarios`) siguen
 * en la base principal. Aquí se montan los controllers sobre la base nueva y se sustituyen los que `createServer` armó sobre
 * la principal, cuyo `seed` queda inerte para que no cree tablas de embeddings allí.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md
 */
import { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { Database } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import type { ServerControllerConfig, ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { ENTITY_KEYS, pluginEntity } from "@Jeff-Aporta/DER/src/02-controllers/plugin.ts";
import type { PluginEntity } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { EmbeddingsConfig } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";

/** Claves del plugin que viven en la base de embeddings; `usuarios` se queda en la base principal. */
export const CLAVES_EMBEDDINGS: readonly string[] = ["cache", "proyecciones", "contadores", "cursores"];

/** Configuración del plugin en crudo (la tipada). */
function cfgDeConexion(p: ServerPlugin): EmbeddingsConfig {
  return p.cfg as unknown as EmbeddingsConfig;
}

/** Ruta del archivo SQLite de embeddings, o `null` para memoria (también si la ruta es `":memory:"`). */
function rutaDe(c: EmbeddingsConfig): string | null {
  const ruta = c.db ?? c.ruta ?? null;
  return ruta && ruta !== ":memory:" ? ruta : null;
}

/** Abre (o reutiliza) la base de embeddings: una inyectada en `services.embeddingsDb`, el archivo de `cfg.db`/`cfg.ruta`, o memoria. */
export function abrirDbEmbeddings(p: ServerPlugin): Database {
  const inyectada = p.services?.["embeddingsDb"] as Database | undefined;
  if (inyectada) {
    p.state["embeddingsDb"] = inyectada;
    p.state["embeddingsPropia"] = false;
    return inyectada;
  }
  const ruta = rutaDe(cfgDeConexion(p));
  // la carpeta del archivo debe existir (node:fs/node:path no se importan en un plugin: el server es hermético)
  const db = sqliteDatabase(ruta ?? ":memory:");
  p.state["embeddingsDb"] = db;
  p.state["embeddingsPropia"] = true;
  return db;
}

/** Arma la base de embeddings y sustituye los controllers de `cache`, `proyecciones`, `contadores` y `cursores` por los de esa base. */
export function montarDbEmbeddings(p: ServerPlugin): Database {
  const db = abrirDbEmbeddings(p);
  const viejos = new Map(Object.entries(p.controllers));
  const nuevos = new Map<string, ServerController<any>>();
  for (const clave of CLAVES_EMBEDDINGS) {
    const e = p.def.entities?.[clave];
    if (!e) continue;
    const entity = pluginEntity(p.def.name, clave, e as unknown as PluginEntity);
    const config: Record<string, unknown> = { db };
    for (const k of Object.keys(e)) if (!ENTITY_KEYS.has(k)) config[k] = (e as Record<string, unknown>)[k];
    nuevos.set(clave, new ServerController(entity, config as unknown as ServerControllerConfig<any>));
  }
  // el controller viejo (base principal) no debe crear sus tablas allí: su seed queda inerte
  for (const clave of nuevos.keys()) {
    const viejo = viejos.get(clave);
    if (viejo) (viejo as unknown as Record<string, unknown>)["seed"] = () => Promise.resolve();
  }
  for (const [clave, ctrl] of nuevos) p.controllers[clave] = ctrl;
  const porViejo = new Map([...viejos].map(([clave, ctrl]) => [ctrl, clave] as const));
  p.list = p.list.map((ctrl) => {
    const clave = porViejo.get(ctrl);
    return clave ? nuevos.get(clave) ?? ctrl : ctrl;
  });
  return db;
}

/** Base de embeddings ya abierta por `montarDbEmbeddings` (la de la caché y sus tablas). */
export function dbEmbeddingsDe(p: ServerPlugin): Database {
  const db = p.state["embeddingsDb"] as Database | undefined;
  if (!db) throw new Error("embeddings: la base de embeddings no está montada (falta el setup del plugin)");
  return db;
}

/** Conexión Kysely de la base de embeddings: la que usan la caché, la purga y las estadísticas. */
export function kyselyDe(p: ServerPlugin): Database["kysely"] {
  return dbEmbeddingsDe(p).kysely;
}

/** Cierra la base de embeddings si la abrió el plugin (una inyectada en `services` la cierra su dueño). */
export async function cerrarDbEmbeddings(p: ServerPlugin): Promise<void> {
  const db = p.state["embeddingsDb"] as Database | undefined;
  const propia = p.state["embeddingsPropia"] === true;
  delete p.state["embeddingsDb"];
  delete p.state["embeddingsPropia"];
  if (db && propia) await db.destroy();
}