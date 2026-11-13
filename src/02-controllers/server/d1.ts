/**
 * Dimensión Cloudflare D1: el motor `sqlite` sobre el binding `D1Database` de un Worker. Dependencias: `kysely` + `zod`
 * (las del core); el binding lo aporta el Worker (`env.DB`). Sin `node:`: carga en Workers tal cual.
 *
 * ```ts
 * export default defineWorker((env: Env) => createRouter(buildControllers(d1Database(env.DB)), { basePath: "/api", cors: true }));
 * ```
 * D1 no tiene transacciones interactivas (`BEGIN`/`COMMIT` fallan): el driver las acepta como no-op, así que una lista de
 * escrituras o un `db.transaction()` NO es atómico en D1 (cada sentencia se confirma sola). La introspección (que usa
 * `syncSchema()` para agregar columnas a tablas existentes) ignora las tablas internas `_cf_*` de D1, cuyo
 * `pragma_table_info` responde `SQLITE_AUTH`. Lo demás es idéntico a SQLite.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import { type CompiledQuery, type DatabaseConnection, type DatabaseIntrospector, type DatabaseMetadata, type Dialect, type Driver, type Kysely, type QueryResult, type SchemaMetadata, sql, SqliteAdapter, SqliteQueryCompiler, type TableMetadata } from "kysely";
import { Database } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import type { D1ColumnRow, D1HttpEnv, D1HttpOptions, D1Like, D1RunResult, D1StatementLike, DbFactoryOptions } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
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

/**
 * Introspector de SQLite para D1: igual al de Kysely pero sin las tablas internas `_cf_*` (D1 niega su `pragma_table_info`
 * con `SQLITE_AUTH` y la consulta entera falla). Sin esto `syncSchema()` no puede agregar columnas en D1.
 */
class D1Introspector implements DatabaseIntrospector {
  readonly #db: Kysely<any>;
  constructor(db: Kysely<any>) {
    this.#db = db;
  }
  /** SQLite no tiene esquemas. */
  getSchemas(): Promise<SchemaMetadata[]> {
    return Promise.resolve([]);
  }
  /** Tablas y vistas del usuario (sin `sqlite_*` ni `_cf_*`) con sus columnas. */
  async getTables(): Promise<TableMetadata[]> {
    const tablas = await sql<
      { name: string; sql: string | null; type: string }
    >`select name, sql, type from sqlite_master where type in ('table', 'view') and substr(name, 1, 7) != 'sqlite_' and substr(name, 1, 4) != '_cf_' order by name`
      .execute(this.#db);
    const columnas = await sql<
      D1ColumnRow
    >`select tl.name as tabla, p.name, p.type, p."notnull", p.dflt_value, p.pk from sqlite_master tl, pragma_table_info(tl.name) p where tl.type in ('table', 'view') and substr(tl.name, 1, 7) != 'sqlite_' and substr(tl.name, 1, 4) != '_cf_' order by tl.name, p.cid`
      .execute(this.#db);
    const porTabla = new Map<string, D1ColumnRow[]>();
    for (const c of columnas.rows) porTabla.set(c.tabla, [...(porTabla.get(c.tabla) ?? []), c]);
    return tablas.rows.map((t) => {
      const cols = porTabla.get(t.name) ?? [];
      const pks = cols.filter((c) => c.pk > 0);
      const auto =
        /autoincrement/i.test(t.sql ?? "") || (pks.length === 1 && pks[0]!.type.toLowerCase() === "integer")
          ? pks[0]?.name
          : undefined;
      return {
        name: t.name,
        isView: t.type === "view",
        columns: cols.map((c) => ({
          name: c.name,
          dataType: c.type,
          isNullable: !c.notnull,
          isAutoIncrementing: c.name === auto,
          hasDefaultValue: c.dflt_value != null,
        })),
      };
    });
  }
  /** Metadatos completos (sólo tablas). */
  async getMetadata(): Promise<DatabaseMetadata> {
    return { tables: await this.getTables() };
  }
}

/** Dialecto de Kysely para un binding D1 (compilador y adaptador de SQLite; introspector que ignora `_cf_*`). */
export function d1Dialect(d1: D1Like): Dialect {
  return {
    createDriver: () => new D1Driver(d1),
    createQueryCompiler: () => new SqliteQueryCompiler(),
    createAdapter: () => new SqliteAdapter(),
    createIntrospector: (k) => new D1Introspector(k),
  };
}

/** Base DER sobre el binding D1 del Worker (`env.DB`): motor `sqlite`. */
export function d1Database(d1: D1Like, opts: DbFactoryOptions = {}): Database {
  return new Database({ engine: sqlite, dialect: d1Dialect(d1), ...opts });
}

/** Endpoint REST de Cloudflare para consultar una base D1. */
export function d1HttpEndpoint(
  accountId: string,
  databaseId: string,
  base = "https://api.cloudflare.com/client/v4",
): string {
  return `${base.replace(/\/+$/, "")}/accounts/${encodeURIComponent(accountId)}/d1/database/${
    encodeURIComponent(databaseId)
  }/query`;
}

/**
 * Sentencia D1 sobre la API HTTP: emula `prepare().bind()` con un POST JSON `{ sql, params }`.
 * `all()` y `run()` devuelven el mismo `D1Result`; `first()` devuelve la primera fila.
 */
class D1HttpStatement implements D1StatementLike {
  #params: unknown[] = [];
  constructor(readonly sql: string, readonly options: D1HttpOptions) {}
  /** Fija los parámetros de la sentencia (la API REST los viaja en `params`). */
  bind(...values: unknown[]): D1StatementLike {
    this.#params = values;
    return this;
  }
  /** Ejecuta la sentencia y devuelve filas y metadatos. */
  async all(): Promise<D1RunResult> {
    const doFetch = this.options.fetch ?? fetch;
    const headers = new Headers();
    headers.set("authorization", `Bearer ${this.options.token}`);
    headers.set("content-type", "application/json");
    const res = await doFetch(this.options.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ sql: this.sql, params: this.#params }),
    });
    const envelope = await res.json() as {
      success?: boolean;
      result?: D1RunResult[];
      errors?: { message?: string }[];
      messages?: { message?: string }[];
    };
    if (!res.ok || envelope.success === false) {
      const detalle = envelope.errors?.[0]?.message ?? envelope.messages?.[0]?.message ??
        `HTTP ${res.status}`;
      throw new Error(`D1 HTTP: ${detalle}`);
    }
    const result = envelope.result?.[0];
    if (!result) throw new Error("D1 HTTP: la respuesta no trae resultado");
    if ((result as { success?: boolean }).success === false) throw new Error("D1 HTTP: la consulta falló");
    return result;
  }
  /** Alias de `all()`, igual que en el binding D1. */
  run(): Promise<D1RunResult> {
    return this.all();
  }
  /** Primera fila; con `columnName`, el valor de esa columna. */
  async first(columnName?: string): Promise<unknown | null> {
    const result = await this.all();
    const row = result.results?.[0];
    if (!row) return null;
    if (!columnName) return row;
    const value = (row as Record<string, unknown>)[columnName];
    return value === undefined ? null : value;
  }
}

/**
 * Adaptador D1 por HTTP: el mismo contrato `prepare/bind/all/run/first` del binding, sobre
 * `POST {endpoint}` con `{ sql, params }` y token Bearer. No imprime ni incluye el token en los errores.
 */
export function d1HttpD1(options: D1HttpOptions): D1Like {
  if (!options.endpoint) throw new Error("D1 HTTP: falta el endpoint");
  if (!options.token) throw new Error("D1 HTTP: falta el token");
  return {
    prepare(sql: string): D1StatementLike {
      return new D1HttpStatement(sql, options);
    },
  };
}

/** Base DER sobre la API HTTP de D1 (mismo motor SQLite que el binding). */
export function d1HttpDatabase(options: D1HttpOptions, opts: DbFactoryOptions = {}): Database {
  return d1Database(d1HttpD1(options), opts);
}

/** Base DER sobre D1 HTTP con `D1_HTTP_ENDPOINT` y `D1_HTTP_TOKEN` del entorno. */
export function d1HttpDatabaseFromEnv(env: D1HttpEnv, opts: DbFactoryOptions = {}): Database {
  const endpoint = env.D1_HTTP_ENDPOINT;
  const token = env.D1_HTTP_TOKEN;
  if (!endpoint) throw new Error("D1 HTTP: falta D1_HTTP_ENDPOINT");
  if (!token) throw new Error("D1 HTTP: falta D1_HTTP_TOKEN");
  return d1HttpDatabase({ endpoint, token }, opts);
}
