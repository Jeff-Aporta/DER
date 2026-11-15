/**
 * Motor SQLite por HTTP de punta a punta sin red: el cliente (`sqliteHttpDatabase`, lo que corre en el Worker) habla con el
 * anfitrión (`sqliteHttpHost`, lo que corre en el VPS) por un `fetch` inyectado. Verifica seed, autoincrement, relación,
 * transacción real con rollback, lote atómico, firma obligatoria, ventana de la firma, nombre de base y vencimiento.
 */
import { assert } from "@std/assert";
import { assertEquals } from "@std/assert";
import { assertRejects } from "@std/assert";
import { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { SqliteHttpClient } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite-http.ts";
import { sqliteHttpDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite-http.ts";
import { sqliteHttpFirma } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite-http.ts";
import { sqliteHttpHost } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite-http-host.ts";
import type { SqliteHttpHost } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { CategoriaEntity } from "@Jeff-Aporta/DER/examples/domain.ts";
import { ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";

const SECRETO = "secreto-de-prueba-con-mas-de-32-caracteres";
const ENDPOINT = "http://anfitrion.test/sql";

/** Anfitrión en una carpeta temporal y el `fetch` que lo alcanza sin red. */
async function montar(extra: { txTimeoutMs?: number } = {}): Promise<{ host: SqliteHttpHost; fetch: typeof fetch; dir: string }> {
  const dir = await Deno.makeTempDir({ prefix: "der-sqlite-http-" });
  const host = sqliteHttpHost({ dir, secreto: SECRETO, ...extra });
  const fetchLocal: typeof fetch = (input, init) => host.fetch(new Request(input, init));
  return { host, fetch: fetchLocal, dir };
}

/** Cierra el anfitrión y borra su carpeta. */
async function desmontar(m: { host: SqliteHttpHost; dir: string }): Promise<void> {
  m.host.close();
  await Deno.remove(m.dir, { recursive: true });
}

Deno.test("sqlite http: seed, autoincrement, relación y transacción real con rollback", async () => {
  const m = await montar();
  const db = sqliteHttpDatabase({ endpoint: ENDPOINT, db: "central", secreto: SECRETO, fetch: m.fetch });
  assertEquals(db.engine.name, "sqlite");
  const categorias = new ServerController(CategoriaEntity, { db, table: "h_categorias", register: false });
  const productos = new ServerController(ProductoEntity, { db, table: "h_productos", register: false, relations: { categoria: { controller: () => categorias } } });
  await categorias.seed();
  await productos.seed();
  const cat = await categorias.post(categorias.pojo({ nombre: "Bebidas" }));
  const cafe = await productos.post(productos.pojo({ nombre: "Café", precio: 3.5, stock: 10, icategoria: cat.icategoria }));
  assert(typeof cafe.iproducto === "number" && cafe.iproducto > 0, "autoincrement");
  const filas = await productos.query({ include: { categoria: true }, where: { nombre: { contains: "caf" } } });
  assertEquals(filas[0]?.categoria?.nombre, "Bebidas");
  await db.transaction(async (tx) => {
    await productos.post(productos.pojo({ nombre: "Té", precio: 2, stock: 1, icategoria: cat.icategoria }), tx);
  });
  assertEquals((await productos.list()).length, 2);
  await assertRejects(() =>
    db.transaction(async (tx) => {
      await productos.post(productos.pojo({ nombre: "Jugo", precio: 4, stock: 1, icategoria: cat.icategoria }), tx);
      throw new Error("falla a propósito");
    })
  );
  assertEquals((await productos.list()).length, 2, "el rollback deshizo el alta");
  await db.destroy();
  await desmontar(m);
});

Deno.test("sqlite http: el lote es atómico y cada base es un archivo aparte", async () => {
  const m = await montar();
  const a = new SqliteHttpClient({ endpoint: ENDPOINT, db: "empresa-a", secreto: SECRETO, fetch: m.fetch });
  const b = new SqliteHttpClient({ endpoint: ENDPOINT, db: "empresa-b", secreto: SECRETO, fetch: m.fetch });
  await a.batch([{ sql: "create table t (id integer primary key, v text not null)" }, { sql: "insert into t (v) values (?)", params: ["uno"] }]);
  await assertRejects(() => a.batch([{ sql: "insert into t (v) values (?)", params: ["dos"] }, { sql: "insert into t (v) values (?)", params: [null] }]));
  const filas = await a.send({ op: "exec", sql: "select v from t order by id" });
  assertEquals(filas.rows, [{ v: "uno" }], "el lote fallido no dejó nada");
  await assertRejects(() => b.send({ op: "exec", sql: "select v from t" }), Error, "no such table");
  const bin = await a.send({ op: "exec", sql: "select ? as b", params: [{ $b64: btoa("hola") }] });
  assertEquals(bin.rows?.[0]?.["b"], { $b64: btoa("hola") }, "los binarios viajan como $b64");
  await desmontar(m);
});

Deno.test("sqlite http: sin firma válida, fuera de la ventana o con nombre de base inválido no se ejecuta nada", async () => {
  const m = await montar();
  const cuerpo = JSON.stringify({ op: "exec", db: "central", sql: "select 1 as n" });
  const pedir = async (headers: Record<string, string>, body = cuerpo): Promise<Response> => await m.host.fetch(new Request(ENDPOINT, { method: "POST", headers, body }));
  const ahora = String(Date.now());
  assertEquals((await pedir({})).status, 401, "sin firma");
  assertEquals((await pedir({ "x-der-ts": ahora, "x-der-firma": "00" })).status, 401, "firma inválida");
  const viejo = String(Date.now() - 10 * 60_000);
  assertEquals((await pedir({ "x-der-ts": viejo, "x-der-firma": await sqliteHttpFirma(SECRETO, viejo, cuerpo) })).status, 401, "firma vencida");
  assertEquals((await pedir({ "x-der-ts": ahora, "x-der-firma": await sqliteHttpFirma(SECRETO, ahora, cuerpo) })).status, 200, "firma correcta");
  const ruta = JSON.stringify({ op: "exec", db: "../etc/passwd", sql: "select 1" });
  assertEquals((await pedir({ "x-der-ts": ahora, "x-der-firma": await sqliteHttpFirma(SECRETO, ahora, ruta) }, ruta)).status, 400, "nombre de base");
  await assertRejects(async () => await Promise.resolve(new SqliteHttpClient({ endpoint: ENDPOINT, db: "x", secreto: "corto" })), Error, "32");
  await desmontar(m);
});

Deno.test("sqlite http: una transacción abandonada se revierte sola y no bloquea a la siguiente", async () => {
  const m = await montar({ txTimeoutMs: 60 });
  const c = new SqliteHttpClient({ endpoint: ENDPOINT, db: "central", secreto: SECRETO, fetch: m.fetch });
  await c.send({ op: "exec", sql: "create table t (id integer primary key, v text)" });
  const abierta = await c.send({ op: "begin" });
  await c.send({ op: "exec", sql: "insert into t (v) values ('huérfana')", tx: abierta.tx! });
  const siguiente = await c.send({ op: "begin" });
  await assertRejects(() => c.send({ op: "commit", tx: abierta.tx! }), Error, "vencida");
  await c.send({ op: "exec", sql: "insert into t (v) values ('buena')", tx: siguiente.tx! });
  await c.send({ op: "commit", tx: siguiente.tx! });
  const filas = await c.send({ op: "exec", sql: "select v from t" });
  assertEquals(filas.rows, [{ v: "buena" }]);
  await desmontar(m);
});
