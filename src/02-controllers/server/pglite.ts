/**
 * Dimensión PGlite: PostgreSQL real embebido (WASM), sin servidor. Ideal para tests y apps locales.
 * Dependencias: `kysely` + `zod` + `@electric-sql/pglite`. Reusa el motor de `server/pg`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
import { PGlite } from "@electric-sql/pglite";
import { PostgresDialect, type PostgresPool, type PostgresPoolClient } from "kysely";
import { Database } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import type { CfgTableDef, IdentifierCase } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { postgres } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

export * from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
export { postgres } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

/** Pool de una sola conexión: serializa el acceso (necesario para que las transacciones no se mezclen). */
export function pglitePool(pg: PGlite): PostgresPool {
  let chain: Promise<void> = Promise.resolve();
  return {
    async connect() {
      let release!: () => void;
      const mine = new Promise<void>((r) => (release = r));
      const prev = chain;
      chain = prev.then(() => mine);
      await prev;
      const client = {
        async query(text: string, params: ReadonlyArray<unknown>) {
          const r = await pg.query(text, params as any[]);
          const command = (/^\s*(\w+)/.exec(text)?.[1] ?? "SELECT").toUpperCase();
          return { command, rowCount: r.affectedRows ?? r.rows.length, rows: r.rows };
        },
        release,
      };
      return client as unknown as PostgresPoolClient;
    },
    end: () => pg.close(),
  };
}

/** `pg` puede ser una instancia de PGlite o su `dataDir` (por defecto en memoria). */
export function pgliteDatabase(
  pg: PGlite | string = new PGlite(),
  opts: { identifierCase?: IdentifierCase; cfg?: CfgTableDef } = {},
): Database {
  const inst = typeof pg === "string" ? new PGlite(pg) : pg;
  return new Database({ engine: postgres, dialect: new PostgresDialect({ pool: pglitePool(inst) }), ...opts });
}
