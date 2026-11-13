/**
 * Motor D1 sin Cloudflare: un binding D1 falso (`prepare().bind().all()` con `results` y `meta`) sobre `node:sqlite`.
 * Verifica seed, autoincrement (`insertId` desde `meta.last_row_id`), query con relación, que las transacciones son no-op y
 * que `syncSchema()` agrega columnas aunque exista la tabla interna `_cf_KV` (D1 niega su `pragma_table_info`).
 */
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ServerController, sql } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import {
  d1Database,
  d1HttpD1,
  d1HttpDatabase,
  d1HttpEndpoint,
  type D1Like,
  type D1StatementLike,
} from "@Jeff-Aporta/DER/src/02-controllers/server/d1.ts";
import { CategoriaEntity, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";

/** D1 de mentira: misma superficie que `D1Database` (lo que usa el driver), ejecutando en `node:sqlite`. */
function fakeD1(db: DatabaseSync, log: string[]): D1Like {
  return {
    prepare(sql: string): D1StatementLike {
      let params: unknown[] = [];
      const st: D1StatementLike = {
        bind(...values: unknown[]) {
          params = values;
          return st;
        },
        all() {
          log.push(sql);
          const prep = db.prepare(sql);
          if (prep.columns().length > 0) {
            const results = prep.all(...(params as never[])) as Record<string, unknown>[];
            // como D1: leer columnas de una tabla interna `_cf_*` es SQLITE_AUTH
            if (
              /pragma_table_info/i.test(sql) &&
              results.some((r) => Object.values(r).some((v) => typeof v === "string" && v.startsWith("_cf_")))
            ) return Promise.reject(new Error("not authorized: SQLITE_AUTH"));
            return Promise.resolve({ results, meta: { changes: 0, last_row_id: null } });
          }
          const r = prep.run(...(params as never[]));
          return Promise.resolve({
            results: [],
            meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
          });
        },
      };
      return st;
    },
  };
}

Deno.test("d1: seed, autoincrement, relación anidada y transacciones no-op", async () => {
  const log: string[] = [];
  const db = d1Database(fakeD1(new DatabaseSync(":memory:"), log));
  assertEquals(db.engine.name, "sqlite");
  const categorias = new ServerController(CategoriaEntity, { db, table: "d1_categorias", register: false });
  const productos = new ServerController(ProductoEntity, {
    db,
    table: "d1_productos",
    register: false,
    relations: { categoria: { controller: () => categorias } },
  });
  await categorias.seed();
  await productos.seed();
  const cat = await categorias.post(categorias.pojo({ nombre: "Bebidas" }));
  const p = await productos.post(
    productos.pojo({ nombre: "Café", precio: 3.5, stock: 10, icategoria: cat.icategoria }),
  );
  assert(typeof p.iproducto === "number" && p.iproducto > 0, "autoincrement desde RETURNING");
  const rows = await productos.query({
    include: { categoria: true },
    where: { nombre: { contains: "caf" } },
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0]?.categoria?.nombre, "Bebidas");
  // una transacción Kysely pasa por el driver sin emitir BEGIN/COMMIT (D1 los rechazaría)
  await db.transaction(async (tx) => {
    await productos.post(
      productos.pojo({ nombre: "Té", precio: 2, stock: 1, icategoria: cat.icategoria }),
      tx,
    );
  });
  assertEquals((await productos.list()).length, 2);
  assert(!log.some((s) => /^\s*(begin|commit|rollback)\b/i.test(s)), "sin BEGIN/COMMIT/ROLLBACK en D1");
  await db.destroy();
});

Deno.test("d1: syncSchema agrega columnas con la tabla interna _cf_KV presente", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("create table _cf_KV (key text primary key, value blob)");
  raw.exec(
    "create table d1_sync (iproducto integer primary key autoincrement, nombre text not null, precio numeric not null)",
  );
  raw.exec("insert into d1_sync (nombre, precio) values ('Café', 3.5)");
  const db = d1Database(fakeD1(raw, []));
  const productos = new ServerController(ProductoEntity, { db, table: "d1_sync", register: false });
  const tablas = await db.kysely.introspection.getTables();
  assert(!tablas.some((t) => t.name.startsWith("_cf_")), "el introspector ignora _cf_*");
  assert(
    tablas.find((t) => t.name === "d1_sync")?.columns.find((c) => c.name === "iproducto")?.isAutoIncrementing,
    "detecta el autoincrement",
  );
  const r = await productos.syncSchema({ keepExtra: true });
  assert(r.added.includes("stock") && r.added.includes("creado"), `agregó columnas: ${r.added.join(", ")}`);
  const cafe = await productos.get({ iproducto: 1 }, { include: {} });
  assertEquals([cafe?.nombre, cafe?.stock], ["Café", 0]);
  const otra = await productos.syncSchema({ keepExtra: true });
  assertEquals(otra.added, [], "idempotente");
  assertEquals((await sql<{ n: number }>`select count(*) as n from _cf_KV`.execute(db.kysely)).rows[0]?.n, 0);
  await db.destroy();
});

Deno.test("d1 HTTP: emulate prepare/bind/run/all/first sobre un endpoint mock", async () => {
  const peticiones: { url: string; auth: string; body: { sql: string; params: unknown[] } }[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const body = await req.json() as { sql: string; params: unknown[] };
    peticiones.push({ url: req.url, auth: req.headers.get("authorization") ?? "", body });
    return Response.json({
      success: true,
      result: [{ success: true, results: [{ n: 2, texto: "ok" }], meta: { changes: 1, last_row_id: 7 } }],
    });
  };
  const endpoint = d1HttpEndpoint("cuenta", "base-d1");
  assertEquals(endpoint, "https://api.cloudflare.com/client/v4/accounts/cuenta/d1/database/base-d1/query");
  const d1 = d1HttpD1({ endpoint, token: "token-de-prueba", fetch: fakeFetch });
  const stmt = d1.prepare("select ? as n").bind(2);
  const all = await stmt.all();
  assertEquals((all.results?.[0] as { n: number } | undefined)?.n, 2);
  assertEquals(all.meta?.last_row_id, 7);
  assertEquals(await stmt.first?.("n"), 2);
  assertEquals((await stmt.run?.())?.meta?.changes, 1);
  assertEquals(peticiones.length, 3);
  assertEquals(peticiones[0]?.auth, "Bearer token-de-prueba");
  assertEquals(peticiones[0]?.body, { sql: "select ? as n", params: [2] });
});

Deno.test("d1 HTTP: el mismo controller SQLite funciona contra el endpoint mock", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(
    "create table d1_http_categorias (icategoria integer primary key autoincrement, nombre text not null, bactivo integer default 1)",
  );
  const peticiones: { auth: string; body: { sql: string; params: unknown[] } }[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const body = await req.json() as { sql: string; params: unknown[] };
    peticiones.push({ auth: req.headers.get("authorization") ?? "", body });
    const prep = raw.prepare(body.sql);
    if (prep.columns().length > 0) {
      const results = prep.all(...(body.params as never[])) as Record<string, unknown>[];
      return Response.json({
        success: true,
        result: [{ success: true, results, meta: { changes: 1, last_row_id: 1 } }],
      });
    }
    const result = prep.run(...(body.params as never[]));
    return Response.json({
      success: true,
      result: [{
        success: true,
        results: [],
        meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
      }],
    });
  };
  const db = d1HttpDatabase({ endpoint: "https://d1.test/query", token: "secreto", fetch: fakeFetch });
  const categorias = new ServerController(CategoriaEntity, {
    db,
    table: "d1_http_categorias",
    register: false,
  });
  const creada = await categorias.post(categorias.pojo({ nombre: "Bebidas" }));
  assertEquals(creada.nombre, "Bebidas");
  assertEquals(peticiones[0]?.auth, "Bearer secreto");
  assert(
    peticiones[0]?.body.sql.includes("insert into"),
    "el controller sigue usando el contrato normal de DER",
  );
  await db.destroy();
});
