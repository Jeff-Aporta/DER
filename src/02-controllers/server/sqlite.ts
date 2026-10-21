/**
 * Dimensión SQLite. Dependencias: `kysely` + `zod` (las del core). Tres formas de conectar:
 *   sqliteDatabase("app.db")                    node:sqlite (nativo en Deno 2 y Node 22+: nada que instalar)
 *   sqliteDatabase(new BetterSqlite3("app.db"))  better-sqlite3 (o cualquier driver síncrono con `prepare()`)
 *   sqliteDatabase(new sqlite3.Database("app.db")) sqlite3 asíncrono (`all`/`run` con callback)
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import { CompiledQuery, type DatabaseConnection, type Dialect, type Driver, type QueryResult, SqliteAdapter, SqliteDialect, SqliteIntrospector, SqliteQueryCompiler, type SqliteDatabase } from "kysely";
import { DatabaseSync } from "node:sqlite";
import { Database } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import type { AsyncSqlite, DbFactoryOptions } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { sqlite } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

export * from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
export { sqlite } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

/** Adaptador de `node:sqlite` a la interfaz que espera el SqliteDialect de Kysely (la de better-sqlite3). */
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

/** Driver de Kysely sobre un `sqlite3` asíncrono: una sola conexión serializada (las transacciones no se mezclan). */
class AsyncSqliteDriver implements Driver {
  #chain: Promise<void> = Promise.resolve();
  constructor(readonly db: AsyncSqlite) {}
  /** Nada que inicializar: el driver ya está abierto. */
  init(): Promise<void> {
    return Promise.resolve();
  }
  /** Toma la única conexión (en serie: espera a que la anterior se libere). */
  async acquireConnection(): Promise<DatabaseConnection> {
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const prev = this.#chain;
    this.#chain = prev.then(() => mine);
    await prev;
    const db = this.db;
    const conn: DatabaseConnection & { release: () => void } = {
      release,
      executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
        const params = [...compiled.parameters];
        if (/^\s*(select|with|pragma)\b/i.test(compiled.sql) || /\breturning\b/i.test(compiled.sql)) {
          return new Promise((res, rej) => db.all(compiled.sql, params, (err, rows) => (err ? rej(err) : res({ rows: rows as R[] }))));
        }
        return new Promise((res, rej) => db.run(compiled.sql, params, function (err) {
          if (err) return rej(err);
          res({ rows: [], numAffectedRows: BigInt(this.changes ?? 0), ...(this.lastID === undefined ? {} : { insertId: BigInt(this.lastID) }) });
        }));
      },
      streamQuery(): AsyncIterableIterator<QueryResult<any>> {
        throw new Error("sqlite3: streaming no soportado");
      },
    };
    return conn;
  }
  /** `begin`. */
  beginTransaction(conn: DatabaseConnection): Promise<void> {
    return conn.executeQuery(CompiledQuery.raw("begin")).then(() => undefined);
  }
  /** `commit`. */
  commitTransaction(conn: DatabaseConnection): Promise<void> {
    return conn.executeQuery(CompiledQuery.raw("commit")).then(() => undefined);
  }
  /** `rollback`. */
  rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    return conn.executeQuery(CompiledQuery.raw("rollback")).then(() => undefined);
  }
  /** Libera la conexión para el siguiente en la fila. */
  releaseConnection(conn: DatabaseConnection): Promise<void> {
    (conn as { release?: () => void }).release?.();
    return Promise.resolve();
  }
  /** Cierra el driver si expone `close`. */
  destroy(): Promise<void> {
    return new Promise((res, rej) => (this.db.close ? this.db.close((e) => (e ? rej(e) : res())) : res()));
  }
}

/** Dialecto de Kysely para un driver `sqlite3` asíncrono. */
export function asyncSqliteDialect(db: AsyncSqlite): Dialect {
  return { createDriver: () => new AsyncSqliteDriver(db), createQueryCompiler: () => new SqliteQueryCompiler(), createAdapter: () => new SqliteAdapter(), createIntrospector: (k) => new SqliteIntrospector(k) };
}

/** SQLite en archivo o `":memory:"` (node:sqlite), o un driver síncrono (`prepare`) o asíncrono (`all`/`run`) del consumidor. */
export function sqliteDatabase(source: string | SqliteDatabase | AsyncSqlite = ":memory:", opts: DbFactoryOptions = {}): Database {
  if (typeof source === "string") return new Database({ engine: sqlite, dialect: new SqliteDialect({ database: nodeSqliteAdapter(new DatabaseSync(source)) }), ...opts });
  if ("prepare" in source) return new Database({ engine: sqlite, dialect: new SqliteDialect({ database: source }), ...opts });
  return new Database({ engine: sqlite, dialect: asyncSqliteDialect(source), ...opts });
}
