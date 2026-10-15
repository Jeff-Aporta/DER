/**
 * Dimensión PostgreSQL. Dependencias: `kysely` + `zod` (las del core). El pool lo trae el consumidor
 * (`pg`, `@neondatabase/serverless`, ... cualquier pool compatible con `pg`): este módulo no lo importa.
 *
 * ```ts
 * import pg from "npm:pg";
 * import { pgDatabase } from ".../server/pg/mod.ts";
 * const db = pgDatabase(new pg.Pool({ connectionString }), { identifierCase: "lower" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/Controllers@main/docs/README.md
 */
import { PostgresDialect, type PostgresPool } from "kysely";
import { Database } from "../database.ts";
import type { IdentifierCase } from "../schemas.ts";
import { postgres } from "./engine.ts";

export * from "../mod.ts";
export { postgres } from "./engine.ts";

export function pgDatabase(
  pool: PostgresPool | (() => Promise<PostgresPool>),
  opts: { identifierCase?: IdentifierCase } = {},
): Database {
  return new Database({ engine: postgres, dialect: new PostgresDialect({ pool }), ...opts });
}
