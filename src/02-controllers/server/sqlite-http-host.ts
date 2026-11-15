/**
 * Anfitrión del protocolo SQLite HTTP: el lado del VPS. Atiende las peticiones firmadas de `sqliteHttpDatabase`
 * (`server/sqlite-http.ts`) sobre archivos SQLite locales con `node:sqlite`. Dependencias: `node:sqlite`, `node:fs` y
 * `node:path`. NO se importa desde un Worker.
 *
 * ```ts
 * const host = sqliteHttpHost({ dir: "/var/lib/mi-app/db", secreto: Deno.env.get("DB_SECRETO")! });
 * Deno.serve({ hostname: "127.0.0.1", port: 8098 }, host.fetch);
 * ```
 * Cada base (`db`) es un archivo `<dir>/<db>.sqlite` (nombre `[a-z0-9][a-z0-9_-]*`, sin rutas) en modo WAL, con dos
 * conexiones: una de lectura y una de escritura. Las escrituras y las transacciones pasan en fila por la de escritura; las
 * lecturas sueltas no esperan. Una transacción que no se cierra en `txTimeoutMs` se revierte sola. Sin firma válida dentro
 * de `ventanaMs` no se ejecuta nada.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SqliteHttpHost } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { SqliteHttpHostOptions } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { SqliteHttpRequest } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { SqliteHttpResponse } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { SqliteHttpResult } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { SqliteHttpValue } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { sqliteHttpDecode } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite-http.ts";
import { sqliteHttpEncode } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite-http.ts";
import { sqliteHttpFirma } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite-http.ts";

/** Nombre válido de una base: minúsculas, dígitos, guion y guion bajo; nunca una ruta. */
const NOMBRE_DB = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Sentencia de solo lectura (no espera la fila de escritura). `returning` y `with … insert` cuentan como escritura. */
const SOLO_LECTURA = /^\s*(select|pragma|explain)\b/i;

/** Error del protocolo con su estado HTTP. */
class ErrorProtocolo extends Error {
  constructor(readonly estado: number, mensaje: string) {
    super(mensaje);
  }
}

/** Una base abierta: conexión de lectura, conexión de escritura, la fila de escritores y la transacción abierta. */
class BaseAbierta {
  /** Conexión de las lecturas sueltas (no espera a los escritores). */
  readonly lectura: DatabaseSync;
  /** Conexión de las escrituras y de la transacción abierta (una a la vez). */
  readonly escritura: DatabaseSync;
  #fila: Promise<void> = Promise.resolve();
  /** Transacción abierta en la conexión de escritura (su id, quién suelta el turno y su reloj de vencimiento). */
  tx: { id: string; soltar: () => void; reloj: ReturnType<typeof setTimeout> } | undefined;
  constructor(ruta: string) {
    this.escritura = new DatabaseSync(ruta);
    this.escritura.exec("pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on; pragma busy_timeout = 5000;");
    this.lectura = new DatabaseSync(ruta);
    this.lectura.exec("pragma foreign_keys = on; pragma busy_timeout = 5000;");
  }
  /** Toma el turno de escritura: resuelve con la función que lo suelta cuando el anterior terminó. */
  async turno(): Promise<() => void> {
    let soltar!: () => void;
    const mio = new Promise<void>((r) => (soltar = r));
    const previo = this.#fila;
    this.#fila = previo.then(() => mio);
    await previo;
    return soltar;
  }
  /** Cierra las dos conexiones (revierte la transacción abierta, si la hay). */
  close(): void {
    if (this.tx) {
      clearTimeout(this.tx.reloj);
      this.escritura.exec("rollback");
      this.tx.soltar();
      this.tx = undefined;
    }
    this.lectura.close();
    this.escritura.close();
  }
}

/** Ejecuta una sentencia en una conexión y arma el resultado del protocolo. */
function ejecutar(conn: DatabaseSync, sql: string, params: SqliteHttpValue[] = []): SqliteHttpResult {
  const st = conn.prepare(sql);
  const args = params.map(sqliteHttpDecode) as never[];
  if (st.columns().length > 0) {
    const filas = st.all(...args) as Record<string, unknown>[];
    const rows = filas.map((fila) => Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, sqliteHttpEncode(v)])));
    const leyo = SOLO_LECTURA.test(sql);
    const cambios = leyo ? 0 : rows.length;
    const ultimo = leyo ? null : Number((conn.prepare("select last_insert_rowid() as id").get() as { id: number | bigint }).id);
    return { rows, changes: cambios, lastId: ultimo };
  }
  const r = st.run(...args);
  return { rows: [], changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

/** Compara dos textos en tiempo constante (firmas). */
function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/**
 * Arma el anfitrión: `fetch(req)` valida la firma y la ventana, abre (o reusa) la base y ejecuta la operación.
 * Estados: 400 petición inválida · 401 firma · 403 base no permitida · 409 transacción desconocida o vencida · 500 SQL.
 */
export function sqliteHttpHost(opts: SqliteHttpHostOptions): SqliteHttpHost {
  if (!opts.secreto || opts.secreto.length < 32) throw new Error("SQLite HTTP: el secreto debe tener al menos 32 caracteres");
  const ventanaMs = opts.ventanaMs ?? 60_000;
  const txTimeoutMs = opts.txTimeoutMs ?? 15_000;
  const bases = new Map<string, BaseAbierta>();
  mkdirSync(opts.dir, { recursive: true });

  /** La base abierta para un nombre (la crea al primer uso). */
  const abrir = (db: string): BaseAbierta => {
    if (!NOMBRE_DB.test(db)) throw new ErrorProtocolo(400, "nombre de base inválido");
    if (opts.permitir && !opts.permitir(db)) throw new ErrorProtocolo(403, "base no permitida");
    let base = bases.get(db);
    if (!base) {
      base = new BaseAbierta(join(opts.dir, `${db}.sqlite`));
      bases.set(db, base);
    }
    return base;
  };

  /** Cierra la transacción abierta de una base con `commit` o `rollback` y suelta el turno. */
  const cerrarTx = (base: BaseAbierta, orden: "commit" | "rollback"): void => {
    const tx = base.tx;
    if (!tx) return;
    clearTimeout(tx.reloj);
    base.tx = undefined;
    try {
      base.escritura.exec(orden);
    } finally {
      tx.soltar();
    }
  };

  /** Atiende una petición ya autenticada. */
  const atender = async (p: SqliteHttpRequest): Promise<SqliteHttpResponse> => {
    const base = abrir(p.db);
    if (p.op === "begin") {
      const soltar = await base.turno();
      try {
        base.escritura.exec("begin immediate");
      } catch (err) {
        soltar();
        throw err;
      }
      const id = crypto.randomUUID();
      const reloj = setTimeout(() => base.tx?.id === id && cerrarTx(base, "rollback"), txTimeoutMs);
      base.tx = { id, soltar, reloj };
      return { tx: id };
    }
    if (p.op === "commit" || p.op === "rollback") {
      if (!p.tx || base.tx?.id !== p.tx) throw new ErrorProtocolo(409, "transacción desconocida o vencida");
      cerrarTx(base, p.op);
      return {};
    }
    if (p.op === "batch") {
      const soltar = await base.turno();
      try {
        base.escritura.exec("begin immediate");
        try {
          const results = (p.stmts ?? []).map((s) => ejecutar(base.escritura, s.sql, s.params));
          base.escritura.exec("commit");
          return { results };
        } catch (err) {
          base.escritura.exec("rollback");
          throw err;
        }
      } finally {
        soltar();
      }
    }
    if (p.op !== "exec" || typeof p.sql !== "string") throw new ErrorProtocolo(400, "operación inválida");
    if (p.tx) {
      if (base.tx?.id !== p.tx) throw new ErrorProtocolo(409, "transacción desconocida o vencida");
      return ejecutar(base.escritura, p.sql, p.params);
    }
    if (SOLO_LECTURA.test(p.sql)) return ejecutar(base.lectura, p.sql, p.params);
    const soltar = await base.turno();
    try {
      return ejecutar(base.escritura, p.sql, p.params);
    } finally {
      soltar();
    }
  };

  return {
    async fetch(req: Request): Promise<Response> {
      try {
        if (req.method !== "POST") throw new ErrorProtocolo(400, "solo POST");
        const cuerpo = await req.text();
        const ts = req.headers.get("x-der-ts") ?? "";
        const firma = req.headers.get("x-der-firma") ?? "";
        const edad = Math.abs(Date.now() - Number(ts));
        if (!ts || !firma || !Number.isFinite(edad) || edad > ventanaMs) throw new ErrorProtocolo(401, "firma ausente o vencida");
        if (!igualSeguro(firma, await sqliteHttpFirma(opts.secreto, ts, cuerpo))) throw new ErrorProtocolo(401, "firma inválida");
        if (opts.autorizar && !(await opts.autorizar(req))) throw new ErrorProtocolo(401, "no autorizado");
        let peticion: SqliteHttpRequest;
        try {
          peticion = JSON.parse(cuerpo) as SqliteHttpRequest;
        } catch {
          throw new ErrorProtocolo(400, "cuerpo no es JSON");
        }
        if (!peticion || typeof peticion.db !== "string" || typeof peticion.op !== "string") throw new ErrorProtocolo(400, "petición inválida");
        return Response.json(await atender(peticion));
      } catch (err) {
        const estado = err instanceof ErrorProtocolo ? err.estado : 500;
        const mensaje = err instanceof Error ? err.message : String(err);
        return Response.json({ error: mensaje }, { status: estado });
      }
    },
    close(): void {
      for (const base of bases.values()) base.close();
      bases.clear();
    },
  };
}
