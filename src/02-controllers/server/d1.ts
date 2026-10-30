/**
 * Dimensión Cloudflare D1: el motor `sqlite` sobre el binding `D1Database` de un Worker. Dependencias: `kysely` + `zod`
 * (las del core); el binding lo aporta el Worker (`env.DB`). Sin `node:`: carga en Workers tal cual.
 *
 * ```ts
 * export default defineWorker((env: Env) => createRouter(buildControllers(d1Database(env.DB)), { basePath: "/api", cors: true }));
 * ```
 * D1 no tiene transacciones interactivas (`BEGIN`/`COMMIT` fallan): el driver las acepta como no-op, así que una lista de
 * escrituras o un `db.transaction()` NO es atómico en D1 (cada sentencia se confirma sola). Lo demás es idéntico a SQLite.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import { type CompiledQuery, type DatabaseConnection, type Dialect, type Driver, type QueryResult, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from "kysely";
import { Database } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import type { D1Like, D1RunResult, DbFactoryOptions } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { sqlite } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

export * from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
export { sqlite } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

/** Una sola conexión lógica: cada sentencia va a `prepare().bind().all()` (D1 devuelve filas y `meta` para todo). */
class D1Connection implements DatabaseConnection {
  constructor(readonly d1: D1Like) {}
  /** Ejecuta la sentencia compilada; `meta.changes` y `meta.last_row_id` alimentan `numAffectedRows` e `insertId`. */
  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const r: D1RunResult = await this.d1.prepare(compiled.sql).bind(...compiled.parameters).all();
    const rows = (r.results ?? []) as R[];
    const changes = r.meta?.changes;
    const last = r.meta?.last_row_id;
    const affected = changes === undefined || changes === null ? {} : { numAffectedRows: BigInt(changes) };
    const inserted = last === undefined || last === null || !changes ? {} : { insertId: BigInt(last) };
    return { rows, ...affected, ...inserted };
  }
  /** D1 no transmite por filas. */
  streamQuery(): AsyncIterableIterator<QueryResult<any>> {
    throw new Error("D1: streaming no soportado");
  }
}

/** Driver de Kysely sobre D1: transacciones como no-op (D1 no las tiene interactivas), sin pool. */
class D1Driver implements Driver {
  readonly #conn: D1Connection;
  constructor(d1: D1Like) {
    this.#conn = new D1Connection(d1);
  }
  /** Nada que abrir: el binding ya está listo. */
  init(): Promise<void> {
    return Promise.resolve();
  }
  /** La misma conexión para todos: D1 serializa en su extremo. */
  acquireConnection(): Promise<DatabaseConnection> {
    return Promise.resolve(this.#conn);
  }
  /** No-op: D1 rechaza `BEGIN` (las sentencias se confirman una a una). */
  beginTransaction(): Promise<void> {
    return Promise.resolve();
  }
  /** No-op (ver `beginTransaction`). */
  commitTransaction(): Promise<void> {
    return Promise.resolve();
  }
  /** No-op: no hay nada que revertir en D1. */
  rollbackTransaction(): Promise<void> {
    return Promise.resolve();
  }
  /** Nada que liberar. */
  releaseConnection(): Promise<void> {
    return Promise.resolve();
  }
  /** Nada que cerrar: el binding es del Worker. */
  destroy(): Promise<void> {
    return Promise.resolve();
  }
}

/** Dialecto de Kysely para un binding D1 (compilador, adaptador e introspector de SQLite). */
export function d1Dialect(d1: D1Like): Dialect {
  return { createDriver: () => new D1Driver(d1), createQueryCompiler: () => new SqliteQueryCompiler(), createAdapter: () => new SqliteAdapter(), createIntrospector: (k) => new SqliteIntrospector(k) };
}

/** Base DER sobre el binding D1 del Worker (`env.DB`): motor `sqlite`. */
export function d1Database(d1: D1Like, opts: DbFactoryOptions = {}): Database {
  return new Database({ engine: sqlite, dialect: d1Dialect(d1), ...opts });
}
