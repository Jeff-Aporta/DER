/**
 * syncSchema: sincroniza la tabla con el POJO (inventario de getters/setters) en ambos motores:
 * agrega columnas, conserva valores, migra con la fila anterior y elimina lo que sobra.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { type Database, ServerController, sql } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { pgliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/pglite.ts";
import { defineEntity, defineSchema, Pojo } from "@Jeff-Aporta/DER/index.ts";
import { ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";

const ENGINES: [string, () => Database][] = [["sqlite", () => sqliteDatabase()], ["pg", () => pgliteDatabase()]];

for (const [name, make] of ENGINES) {
  Deno.test(`[${name}] syncSchema: agrega, conserva, migra con la fila anterior y elimina lo que sobra`, async () => {
    const db = make();
    try {
      // tabla "vieja": tiene `viejo` (ya no está en el POJO) y le faltan varias columnas del POJO
      await sql`create table productos (iproducto integer primary key, nombre text not null, precio numeric not null, viejo text)`
        .execute(db.kysely);
      await sql`insert into productos (iproducto, nombre, precio, viejo) values (1, 'Café', 3.5, 'CO'), (2, 'Té', 2, null)`
        .execute(db.kysely);
      const productos = new ServerController(ProductoEntity, { db, table: "productos" });

      const plan = await productos.syncSchema({ dryRun: true });
      assertEquals(plan.dropped, ["viejo"]);
      assertEquals(plan.added.sort(), ["creado", "icategoria", "jconfig", "lanzamiento", "meta", "stock", "tipo"]);
      assertEquals((await productos.list()).length, 2); // dryRun no tocó nada

      const r = await productos.syncSchema({
        migrate: (prev) => (prev["viejo"] ? { meta: { origen: prev["viejo"] } } : undefined),
      });
      assertEquals([r.created, r.migrated, r.dropped], [false, 1, ["viejo"]]);
      const cafe = (await productos.get({ iproducto: 1 }, { include: {} }))!;
      assertEquals([cafe.nombre, cafe.precio, cafe.meta], ["Café", 3.5, { origen: "CO" }]); // valores conservados + migrados
      assertEquals(cafe.stock, 0); // default de la columna nueva
      const again = await productos.syncSchema();
      assertEquals([again.added, again.dropped, again.migrated], [[], [], 0]); // idempotente
      // keepExtra conserva columnas que el POJO no tiene
      await sql`alter table productos add column otra text`.execute(db.kysely);
      assertEquals((await productos.syncSchema({ keepExtra: true })).dropped, []);
    } finally {
      await db.destroy();
    }
  });
}

Deno.test("syncSchema: tabla inexistente se crea; columna del schema sin getter/setter falla", async () => {
  const db = sqliteDatabase();
  try {
    const productos = new ServerController(ProductoEntity, { db, table: "productos_nuevos" });
    const r = await productos.syncSchema();
    assertEquals(r.created, true);
    // POJO manual al que le falta el accessor de `nombre`
    class Mal extends Pojo {
      static override schema = defineSchema({ columns: { id: { type: "int", pk: true }, nombre: { type: "string" } } });
      get id(): unknown {
        return this.f["id"];
      }
      set id(v: unknown) {
        this.f["id"] = v;
      }
    }
    const mal = new ServerController(defineEntity({ pojo: Mal, singular: "mal", plural: "males" }), { db, table: "males" });
    await assertRejects(() => mal.syncSchema(), Error, "nombre");
  } finally {
    await db.destroy();
  }
});
