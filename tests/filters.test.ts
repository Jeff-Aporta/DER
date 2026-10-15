/**
 * Prioridad alta, en ambos motores: nombres de columna distintos al POJO (`columnNames`), todos los operadores de
 * filtro, columnas calculadas por motor y por función, fechas/horas de punta a punta y columnas ocultas que no
 * pueden filtrarse ni siquiera a través de una relación.
 */
import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { type Database, ServerController, sql, ValidationError } from "@Jeff-Aporta/DER/src/02 controllers/server/mod.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02 controllers/server/sqlite/mod.ts";
import { pgliteDatabase } from "@Jeff-Aporta/DER/src/02 controllers/server/pglite/mod.ts";
import { defineEntity, defineSchema, pojoOf } from "@Jeff-Aporta/DER/mod.ts";

const ItemSchema = defineSchema({
  columns: {
    id: { type: "int", pk: true, autoincrement: true },
    nombre: { type: "string", length: 60, nullable: false },
    codigo: { type: "string", length: 20 },
    precio: { type: "decimal", nullable: false },
    fecha: { type: "date" },
    hora: { type: "time" },
    momento: { type: "datetime" },
    activo: { type: "bool", default: true },
    doble: { type: "float", virtual: true },
    triple: { type: "float", virtual: true },
  },
  relations: { notas: { kind: "many", target: "filtros.nota", on: { id: "iditem" } } },
});
class Item extends pojoOf(ItemSchema) {
  declare notas: Nota[];
}
const ItemEntity = defineEntity({ pojo: Item, name: "filtros.item", singular: "item", plural: "items" });

const NotaSchema = defineSchema({
  columns: {
    idnota: { type: "int", pk: true, autoincrement: true },
    iditem: { type: "int", nullable: false },
    texto: { type: "string" },
    secreto: { type: "string" },
  },
});
class Nota extends pojoOf(NotaSchema) {}
const NotaEntity = defineEntity({ pojo: Nota, name: "filtros.nota", singular: "nota", plural: "notas" });

const ENGINES: [string, () => Database][] = [["sqlite", () => sqliteDatabase()], ["pg", () => pgliteDatabase()]];

async function setup(make: () => Database) {
  const db = make();
  const items = new ServerController(ItemEntity, {
    db,
    table: "items",
    columnNames: { nombre: "NOM_PROD", precio: "PRECIO_UNIT" },
    computed: {
      doble: { pg: "{precio} * 2", sqlite: "{precio} * 2" }, // por motor
      triple: ({ col }) => col("precio"), // función → sql (Raw)
    },
  });
  const notas = new ServerController(NotaEntity, { db, table: "notas", hidden: ["secreto"] });
  await db.seed();
  const creados = await items.postList([
    { nombre: "Café 100%", codigo: "A-1", precio: 3.5, fecha: "2024-02-29", hora: "8:05", momento: "2024-02-29T10:00:00Z" },
    { nombre: "Té verde", codigo: null, precio: 2, fecha: "2024-03-01", hora: "17:30:15", activo: false },
    { nombre: "Agua_mineral", codigo: "B-2", precio: 1, fecha: "2024-03-02" },
  ]);
  await notas.postList([{ iditem: creados[0]?.id, texto: "rica", secreto: "s1" }]);
  return { db, items, notas, creados };
}

const nombres = (xs: Item[]) => xs.map((x) => x.nombre);

for (const [name, make] of ENGINES) {
  Deno.test(`[${name}] columnNames: la tabla usa otros nombres y el POJO no se entera (leer, filtrar, ordenar, actualizar)`, async () => {
    const { db, items, creados } = await setup(make);
    try {
      const { rows } = await sql<Record<string, unknown>>`select ${sql.ref("NOM_PROD")} as n from items order by id`
        .execute(db.kysely);
      assertEquals(rows.map((r) => r["n"]), ["Café 100%", "Té verde", "Agua_mineral"]);
      assertEquals(nombres(await items.query({ where: { precio: { gte: 2 } }, orderBy: "-precio" })), ["Café 100%", "Té verde"]);
      const sel = await items.query({ select: ["nombre"], orderBy: "nombre" });
      assertEquals(Object.keys(sel[0]?.toJSON() ?? {}), ["nombre"]);
      await items.put({ id: creados[1]?.id, precio: 2.25 });
      assertEquals((await items.get({ id: creados[1]?.id }))?.precio, 2.25);
    } finally {
      await db.destroy();
    }
  });

  Deno.test(`[${name}] operadores: eq/ne/lt/lte/nin/like/ilike/endsWith/isNull/between y lógicos`, async () => {
    const { db, items } = await setup(make);
    try {
      const q = async (where: Record<string, unknown>) => nombres(await items.query({ where: where as never }));
      assertEquals(await q({ precio: { eq: 2 } }), ["Té verde"]);
      assertEquals(await q({ precio: { ne: 2 } }), ["Café 100%", "Agua_mineral"]);
      assertEquals(await q({ codigo: { ne: null } }), ["Café 100%", "Agua_mineral"]);
      assertEquals(await q({ codigo: { eq: null } }), ["Té verde"]);
      assertEquals(await q({ precio: { lt: 2 } }), ["Agua_mineral"]);
      assertEquals(await q({ precio: { lte: 2 } }), ["Té verde", "Agua_mineral"]);
      assertEquals(await q({ precio: { nin: [1, 2] } }), ["Café 100%"]);
      assertEquals(await q({ precio: { nin: [] } }), ["Café 100%", "Té verde", "Agua_mineral"]);
      assertEquals(await q({ nombre: { like: "T%" } }), ["Té verde"]);
      assertEquals(await q({ nombre: { ilike: "t%" } }), ["Té verde"]);
      assertEquals(await q({ nombre: { endsWith: "_MINERAL" } }), ["Agua_mineral"]); // `_` escapado, sin mayúsculas
      assertEquals(await q({ nombre: { endsWith: "xmineral" } }), []);
      assertEquals(await q({ codigo: { isNull: true } }), ["Té verde"]);
      assertEquals(await q({ codigo: { isNull: false } }), ["Café 100%", "Agua_mineral"]);
      assertEquals(await q({ fecha: { between: ["2024-02-29", "2024-03-01"] } }), ["Café 100%", "Té verde"]);
      assertEquals(await q({ activo: false }), ["Té verde"]);
      assertEquals(await q({ $or: [] }), ["Café 100%", "Té verde", "Agua_mineral"]);
      assertEquals(await q({ $and: [{ precio: { gt: 1 } }, { $not: { nombre: "Té verde" } }] }), ["Café 100%"]);
      await assertRejects(() => items.query({ where: { precio: { casi: 1 } } as never }), ValidationError, "operador desconocido");
    } finally {
      await db.destroy();
    }
  });

  Deno.test(`[${name}] columnas calculadas por motor y por función; fechas y horas de punta a punta`, async () => {
    const { db, items, creados } = await setup(make);
    try {
      const cafe = (await items.get({ id: creados[0]?.id }))!;
      assertEquals([cafe.doble, cafe.triple], [7, 3.5]);
      assertEquals(nombres(await items.query({ where: { doble: { gte: 4 } }, orderBy: "-doble" })), ["Café 100%", "Té verde"]);
      assertEquals([cafe.fecha, cafe.hora], ["2024-02-29", "08:05:00"]);
      assertInstanceOf(cafe.momento, Date);
      assertEquals(cafe.momento?.toISOString(), "2024-02-29T10:00:00.000Z");
      const te = (await items.get({ id: creados[1]?.id }))!;
      assertEquals([te.hora, te.momento, te.activo], ["17:30:15", null, false]);
    } finally {
      await db.destroy();
    }
  });

  Deno.test(`[${name}] columnas ocultas: no se seleccionan, no se filtran (tampoco por relación) y no salen anidadas`, async () => {
    const { db, items, notas, creados } = await setup(make);
    try {
      const [n] = await notas.list();
      assertEquals(n?.secreto, undefined);
      await assertRejects(() => notas.query({ where: { secreto: "s1" } }), ValidationError, "no es consultable");
      await assertRejects(
        () => items.query({ where: { notas: { secreto: "s1" } } as never }),
        ValidationError,
        "no es consultable",
      );
      const [conNotas] = await items.query({ where: { id: creados[0]?.id }, include: { notas: true } });
      assertEquals(conNotas?.notas.map((x: Nota) => [x.texto, x.secreto]), [["rica", undefined]]);
    } finally {
      await db.destroy();
    }
  });
}
