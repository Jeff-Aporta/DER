/**
 * Dimensión MySQL / MariaDB. Dependencias: `kysely` + `zod` (las del core). El pool lo trae el consumidor (`mysql2`):
 * este módulo no lo importa.
 *
 * ```ts
 * import { createPool } from "npm:mysql2";
 * import { mysqlDatabase } from ".../server/mysql.ts";
 * const db = mysqlDatabase(createPool({ uri }), { identifierCase: "lower" });
 * ```
 * Sin `RETURNING`: las escrituras releen la fila por su pk (la autoincrement sale de `insertId`).
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import { MysqlDialect, type MysqlPool } from "kysely";
import { Database } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import type { DbFactoryOptions } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { mysql } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

export * from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
export { mysql } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

/** Base MySQL/MariaDB con un pool `mysql2` del consumidor. */
export function mysqlDatabase(pool: MysqlPool | (() => Promise<MysqlPool>), opts: DbFactoryOptions = {}): Database {
  return new Database({ engine: mysql, dialect: new MysqlDialect({ pool }), ...opts });
}
