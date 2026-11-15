/**
 * Dimensión SQLite por HTTP: el motor `sqlite` de un Worker (o de cualquier runtime sin disco) sobre una SQLite que vive
 * en otra máquina (el VPS), atendida por `sqliteHttpHost` (`server/sqlite-http-host.ts`). Dependencias: `kysely` + `zod`
 * (las del core). Sin `node:`: carga en Workers tal cual.
 *
 * ```ts
 * const db = sqliteHttpDatabase({ endpoint: env.DB_URL, db: "central", secreto: env.DB_SECRETO });
 * export default defineWorker(() => createRouter(buildControllers(db), { basePath: "/api", cors: true }));
 * ```
 * A diferencia de D1, las transacciones son REALES e interactivas: `begin` abre una transacción en el anfitrión y devuelve
 * su id; cada sentencia la nombra; `commit`/`rollback` la cierran. Si el Worker muere a mitad, el anfitrión la revierte al
 * vencer `txTimeoutMs`. Cada petición va firmada: `x-der-ts` (epoch ms) y `x-der-firma` = HMAC-SHA256(`ts.cuerpo`).
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import type { CompiledQuery } from "kysely";
import type { DatabaseConnection } from "kysely";
import type { Dialect } from "kysely";
import type { Driver } from "kysely";
import type { QueryResult } from "kysely";
import { SqliteAdapter } from "kysely";
import { SqliteIntrospector } from "kysely";
import { SqliteQueryCompiler } from "kysely";
import { Database } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import type { DbFactoryOptions } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { SqliteHttpOptions } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { SqliteHttpRequest } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { SqliteHttpResponse } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { SqliteHttpResult } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { SqliteHttpStmt } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { SqliteHttpValue } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { sqlite } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

export * from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
export { sqlite } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";

/** Base64 estándar de unos bytes (binarios del protocolo). */
function aBase64(bytes: Uint8Array): string {
  let texto = "";
  for (const b of bytes) texto += String.fromCharCode(b);
  return btoa(texto);
}

/** Bytes de un base64 estándar. */
function deBase64(texto: string): Uint8Array {
  const bin = atob(texto);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Valor de JS al protocolo: binarios como `{ $b64 }`, `bigint` como número, `undefined` como `null`, booleanos como 0/1. */
export function sqliteHttpEncode(valor: unknown): SqliteHttpValue {
  if (valor === undefined || valor === null) return null;
  if (valor instanceof Uint8Array) return { $b64: aBase64(valor) };
  if (typeof valor === "bigint") return Number(valor);
  if (typeof valor === "boolean") return valor ? 1 : 0;
  if (typeof valor === "string" || typeof valor === "number") return valor;
  return JSON.stringify(valor);
}

/** Valor del protocolo a JS: `{ $b64 }` vuelve a ser `Uint8Array`. */
export function sqliteHttpDecode(valor: SqliteHttpValue): unknown {
  if (valor !== null && typeof valor === "object") return deBase64(valor.$b64);
  return valor;
}

/** Firma del protocolo: HMAC-SHA256 de `ts.cuerpo` en hexadecimal (WebCrypto: igual en Workers y en Deno). */
export async function sqliteHttpFirma(secreto: string, ts: string, cuerpo: string): Promise<string> {
  const enc = new TextEncoder();
  const llave = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", llave, enc.encode(`${ts}.${cuerpo}`)));
  return [...firma].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cliente del protocolo: firma y envía una petición; un `error` del anfitrión se lanza con su mensaje (nunca el secreto). */
export class SqliteHttpClient {
  readonly #opts: SqliteHttpOptions;
  constructor(opts: SqliteHttpOptions) {
    if (!opts.endpoint) throw new Error("SQLite HTTP: falta el endpoint");
    if (!opts.db) throw new Error("SQLite HTTP: falta el nombre de la base");
    if (!opts.secreto || opts.secreto.length < 32) throw new Error("SQLite HTTP: el secreto debe tener al menos 32 caracteres");
    this.#opts = opts;
  }
  /** Nombre lógico de la base en el anfitrión. */
  get db(): string {
    return this.#opts.db;
  }
  /** Envía una operación del protocolo y devuelve su respuesta; un fallo del anfitrión se lanza con su mensaje. */
  async send(peticion: Omit<SqliteHttpRequest, "db">): Promise<SqliteHttpResponse> {
    const doFetch = this.#opts.fetch ?? fetch;
    const endpoint = typeof this.#opts.endpoint === "function" ? await this.#opts.endpoint() : this.#opts.endpoint;
    const token = typeof this.#opts.token === "function" ? await this.#opts.token() : this.#opts.token;
    const cuerpo = JSON.stringify({ ...peticion, db: this.#opts.db });
    const ts = String(Date.now());
    const headers = new Headers();
    headers.set("content-type", "application/json");
    headers.set("x-der-ts", ts);
    headers.set("x-der-firma", await sqliteHttpFirma(this.#opts.secreto, ts, cuerpo));
    if (token) headers.set("authorization", `Bearer ${token}`);
    const res = await doFetch(endpoint, { method: "POST", headers, body: cuerpo });
    const texto = await res.text();
    let datos: SqliteHttpResponse;
    try {
      datos = JSON.parse(texto) as SqliteHttpResponse;
    } catch {
      throw new Error(`SQLite HTTP: respuesta no válida (HTTP ${res.status})`);
    }
    if (!res.ok || datos.error) throw new Error(`SQLite HTTP: ${datos.error ?? `HTTP ${res.status}`}`);
    return datos;
  }
  /** Lista de sentencias en UNA transacción del anfitrión (un solo viaje): o todas o ninguna. */
  async batch(stmts: { sql: string; params?: unknown[] }[]): Promise<SqliteHttpResult[]> {
    const lista: SqliteHttpStmt[] = stmts.map((s) => ({ sql: s.sql, params: (s.params ?? []).map(sqliteHttpEncode) }));
    const r = await this.send({ op: "batch", stmts: lista });
    return r.results ?? [];
  }
}

/** Conexión lógica: recuerda el id de su transacción abierta y lo manda con cada sentencia. */
class SqliteHttpConnection implements DatabaseConnection {
  /** Id de la transacción abierta en el anfitrión (o nada si no hay). */
  tx: string | undefined;
  constructor(readonly client: SqliteHttpClient) {}
  /** Ejecuta la sentencia compilada en el anfitrión (dentro de la transacción de esta conexión, si la hay). */
  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const params = compiled.parameters.map(sqliteHttpEncode);
    const r = await this.client.send({ op: "exec", sql: compiled.sql, params, ...(this.tx ? { tx: this.tx } : {}) });
    const rows = (r.rows ?? []).map((fila) => Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, sqliteHttpDecode(v)]))) as R[];
    const changes = r.changes ?? 0;
    const affected = { numAffectedRows: BigInt(changes) };
    const inserted = r.lastId === undefined || r.lastId === null || !changes ? {} : { insertId: BigInt(r.lastId) };
    return { rows, ...affected, ...inserted };
  }
  /** El protocolo no transmite por filas. */
  streamQuery(): AsyncIterableIterator<QueryResult<any>> {
    throw new Error("SQLite HTTP: streaming no soportado");
  }
}

/** Driver de Kysely sobre el protocolo: una conexión lógica por adquisición y transacciones reales en el anfitrión. */
class SqliteHttpDriver implements Driver {
  readonly #client: SqliteHttpClient;
  constructor(client: SqliteHttpClient) {
    this.#client = client;
  }
  /** Nada que abrir: cada petición es independiente. */
  init(): Promise<void> {
    return Promise.resolve();
  }
  /** Conexión nueva (sin estado compartido: dos transacciones concurrentes no se mezclan). */
  acquireConnection(): Promise<DatabaseConnection> {
    return Promise.resolve(new SqliteHttpConnection(this.#client));
  }
  /** Abre la transacción en el anfitrión y guarda su id en la conexión. */
  async beginTransaction(conn: DatabaseConnection): Promise<void> {
    const c = conn as SqliteHttpConnection;
    const r = await this.#client.send({ op: "begin" });
    if (!r.tx) throw new Error("SQLite HTTP: el anfitrión no devolvió la transacción");
    c.tx = r.tx;
  }
  /** Confirma la transacción de la conexión. */
  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    const c = conn as SqliteHttpConnection;
    const tx = c.tx;
    c.tx = undefined;
    if (tx) await this.#client.send({ op: "commit", tx });
  }
  /** Revierte la transacción de la conexión (si el anfitrión ya la venció, no es un error). */
  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    const c = conn as SqliteHttpConnection;
    const tx = c.tx;
    c.tx = undefined;
    if (tx) await this.#client.send({ op: "rollback", tx }).catch(() => undefined);
  }
  /** Nada que liberar. */
  releaseConnection(): Promise<void> {
    return Promise.resolve();
  }
  /** Nada que cerrar: las bases son del anfitrión. */
  destroy(): Promise<void> {
    return Promise.resolve();
  }
}

/** Dialecto de Kysely para una SQLite remota (compilador, adaptador e introspector de SQLite). */
export function sqliteHttpDialect(client: SqliteHttpClient): Dialect {
  return {
    createDriver: () => new SqliteHttpDriver(client),
    createQueryCompiler: () => new SqliteQueryCompiler(),
    createAdapter: () => new SqliteAdapter(),
    createIntrospector: (k) => new SqliteIntrospector(k),
  };
}

/** Base DER sobre una SQLite remota atendida por `sqliteHttpHost`: motor `sqlite` con transacciones reales. */
export function sqliteHttpDatabase(options: SqliteHttpOptions, opts: DbFactoryOptions = {}): Database {
  return new Database({ engine: sqlite, dialect: sqliteHttpDialect(new SqliteHttpClient(options)), ...opts });
}
