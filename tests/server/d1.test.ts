/**
 * Motor D1 sin Cloudflare: un binding D1 falso (`prepare().bind().all()` con `results` y `meta`) sobre `node:sqlite`.
 * Verifica seed, autoincrement (`insertId` desde `meta.last_row_id`), query con relación y que las transacciones son no-op.
 */
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { type D1Like, type D1StatementLike, d1Database } from "@Jeff-Aporta/DER/src/02-controllers/server/d1.ts";
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
          if (prep.columns().length > 0) return Promise.resolve({ results: prep.all(...(params as never[])), meta: { changes: 0, last_row_id: null } });
          const r = prep.run(...(params as never[]));
          return Promise.resolve({ results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } });
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
  const productos = new ServerController(ProductoEntity, { db, table: "d1_productos", register: false, relations: { categoria: { controller: () => categorias } } });
  await categorias.seed();
  await productos.seed();
  const cat = await categorias.post(categorias.pojo({ nombre: "Bebidas" }));
  const p = await productos.post(productos.pojo({ nombre: "Café", precio: 3.5, stock: 10, icategoria: cat.icategoria }));
  assert(typeof p.iproducto === "number" && p.iproducto > 0, "autoincrement desde RETURNING");
  const rows = await productos.query({ include: { categoria: true }, where: { nombre: { contains: "caf" } } });
  assertEquals(rows.length, 1);
  assertEquals(rows[0]?.categoria?.nombre, "Bebidas");
  // una transacción Kysely pasa por el driver sin emitir BEGIN/COMMIT (D1 los rechazaría)
  await db.transaction(async (tx) => {
    await productos.post(productos.pojo({ nombre: "Té", precio: 2, stock: 1, icategoria: cat.icategoria }), tx);
  });
  assertEquals((await productos.list()).length, 2);
  assert(!log.some((s) => /^\s*(begin|commit|rollback)\b/i.test(s)), "sin BEGIN/COMMIT/ROLLBACK en D1");
  await db.destroy();
});
