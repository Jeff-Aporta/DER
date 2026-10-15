/**
 * Dimensión SQLite. Dependencias: `kysely` + `zod` (las del core). El driver es `node:sqlite`,
 * nativo en Deno 2 y Node 22+: no hay que instalar nada más.
 *
 * ```ts
 * import { sqliteDatabase, ServerController, createRouter } from ".../server/sqlite/mod.ts";
 * const db = sqliteDatabase("app.db");
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
import { SqliteDialect, type SqliteDatabase } from "kysely";
import { DatabaseSync } from "node:sqlite";
import { Database } from "@Jeff-Aporta/DER/src/02 controllers/server/database.ts";
import type { IdentifierCase } from "@Jeff-Aporta/DER/src/02 controllers/server/schemas.ts";
import { sqlite } from "@Jeff-Aporta/DER/src/02 controllers/server/sqlite/engine.ts";

export * from "@Jeff-Aporta/DER/src/02 controllers/server/mod.ts";
export { sqlite } from "@Jeff-Aporta/DER/src/02 controllers/server/sqlite/engine.ts";

/** Adaptador de `node:sqlite` a la interfaz que espera el SqliteDialect de Kysely. */
export function nodeSqliteAdapter(db: DatabaseSync): SqliteDatabase {
  return {
    close: () => db.close(),
    prepare(query) {
      const st = db.prepare(query);
      const args = (p: ReadonlyArray<unknown>) => p as any[];
      return {
        reader: st.columns().length > 0,
        all: (p) => st.all(...args(p)),
        run: (p) => {
          const r = st.run(...args(p));
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
        iterate: (p) => st.iterate(...args(p)) as IterableIterator<unknown>,
      };
    },
  };
}

/** SQLite en archivo o `":memory:"`. */
export function sqliteDatabase(path = ":memory:", opts: { identifierCase?: IdentifierCase } = {}): Database {
  return new Database({
    engine: sqlite,
    dialect: new SqliteDialect({ database: nodeSqliteAdapter(new DatabaseSync(path)) }),
    ...opts,
  });
}
