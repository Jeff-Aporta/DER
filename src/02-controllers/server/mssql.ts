/**
 * Dimensión Microsoft SQL Server. Dependencias: `kysely` + `zod` (las del core). Los paquetes `tedious` y `tarn` los
 * trae el consumidor (así los pide el MssqlDialect de Kysely): este módulo no los importa.
 *
 * ```ts
 * import * as Tarn from "npm:tarn";
 * import * as Tedious from "npm:tedious";
 * import { mssqlDatabase } from ".../server/mssql.ts";
 * const db = mssqlDatabase({
 *   tarn: { ...Tarn, options: { min: 0, max: 10 } },
 *   tedious: { ...Tedious, connectionFactory: () => new Tedious.Connection({ server, authentication, options }) },
 * });
 * ```
 * Escrituras con `OUTPUT inserted.* / deleted.*`; paginación con `OFFSET ... FETCH`; JSON con `FOR JSON PATH`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import { MssqlDialect, type MssqlDialectConfig } from "kysely";
import { Database } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import type { DbFactoryOptions } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { mssql } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

export * from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
export { mssql } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

/** Base SQL Server con el `MssqlDialect` de Kysely (`tarn` + `tedious` del consumidor). */
export function mssqlDatabase(config: MssqlDialectConfig, opts: DbFactoryOptions = {}): Database {
  return new Database({ engine: mssql, dialect: new MssqlDialect(config), ...opts });
}
