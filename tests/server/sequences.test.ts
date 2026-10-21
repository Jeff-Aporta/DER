/** Secuencias (globales, por ámbito, con formato) e índices (explícitos y automáticos) en ambos motores. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { type Database, ServerController, sql } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { pgliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/pglite.ts";
import { defineEntity, defineSchema, pojoOf, zodOf } from "@Jeff-Aporta/DER/index.ts";
import { CategoriaEntity, LineaEntity, PedidoEntity, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";

const FacturaSchema = defineSchema({
  columns: {
    ifactura: { type: "int", pk: true, sequence: { name: "seq_factura", start: 1000 } },
    numero: { type: "string", length: 20, sequence: { name: "seq_factura_numero", pattern: "FAC-{n:5}" } },
    iempresa: { type: "string", length: 20, nullable: false },
    consecutivo: { type: "int", sequence: { scope: ["iempresa"] } },
    codigo: { type: "string", length: 10, sequence: { scope: ["iempresa"], pattern: "E-{n:3}", start: 1 } },
    total: { type: "decimal" },
  },
});
class Factura extends pojoOf(FacturaSchema) {}
const FacturaEntity = defineEntity({ pojo: Factura, name: "seq.factura", singular: "seq/factura", plural: "seq/facturas" });

async function indexNames(db: Database, table: string): Promise<string[]> {
  if (db.engine.name === "pg") {
    const { rows } = await sql<{ n: string }>`select indexname as n from pg_indexes where tablename = ${table}`
      .execute(db.kysely);
    return rows.map((r) => r.n).filter((n) => !n.endsWith("_pkey") && !n.endsWith("_pk")).sort();
  }
  const { rows } = await sql<{ n: string }>`select name as n from sqlite_master where type = 'index' and tbl_name = ${table}`
    .execute(db.kysely);
  return rows.map((r) => r.n).filter((n) => !n.startsWith("sqlite_autoindex")).sort();
}

const ENGINES: [string, () => Database][] = [["sqlite", () => sqliteDatabase()], ["pg", () => pgliteDatabase()]];

for (const [name, make] of ENGINES) {
  Deno.test(`[${name}] secuencias: global con inicio, con formato y por ámbito (numérica y con formato)`, async () => {
    const db = make();
    try {
      const facturas = new ServerController(FacturaEntity, {
        db,
        table: "facturas",
        indexes: [{ columns: ["iempresa", "consecutivo"], unique: true }],
      });
      await db.seed();
      // el client no exige la pk con secuencia
      assertEquals(zodOf(Factura).insert.safeParse({ iempresa: "A" }).success, true);
      const [a1, a2, b1] = await facturas.postList([{ iempresa: "A", total: 10 }, { iempresa: "A" }, { iempresa: "B" }]);
      assertEquals([a1?.ifactura, a2?.ifactura, b1?.ifactura], [1000, 1001, 1002]);
      assertEquals([a1?.numero, a2?.numero, b1?.numero], ["FAC-00001", "FAC-00002", "FAC-00003"]);
      assertEquals([a1?.consecutivo, a2?.consecutivo, b1?.consecutivo], [1, 2, 1]);
      assertEquals([a1?.codigo, a2?.codigo, b1?.codigo], ["E-001", "E-002", "E-001"]);
      // un valor explícito se respeta; la secuencia sigue su curso
      const manual = await facturas.post({ ifactura: 5000, iempresa: "B", consecutivo: 7 });
      assertEquals([manual.ifactura, manual.consecutivo], [5000, 7]);
      assertEquals((await facturas.post({ iempresa: "B" })).consecutivo, 8); // máximo del ámbito + 1
      assertEquals((await facturas.post({ iempresa: "C" })).ifactura, 1004); // 1003 lo tomó el post anterior
      // el índice único explícito se cumple
      await assertRejects(() => facturas.post({ iempresa: "A", consecutivo: 1 }));
      assert((await indexNames(db, "facturas")).includes("ux_facturas_iempresa_consecutivo"));
    } finally {
      await db.destroy();
    }
  });

  Deno.test(`[${name}] índices automáticos (FK 1:1 y llaves de detalles 1:N) sin depender del orden del seed`, async () => {
    const db = make();
    try {
      new ServerController(CategoriaEntity, { db, table: "categorias" });
      const productos = new ServerController(ProductoEntity, { db, table: "productos" });
      new ServerController(PedidoEntity, { db, table: "pedidos" });
      new ServerController(LineaEntity, { db, table: "pedido_lineas" });
      await db.seed();
      assertEquals(await indexNames(db, "productos"), ["ix_productos_icategoria"]);
      // linea.producto (1:1) → iproducto; pedido.lineas (1:N) sobre ipedido no se indexa: es prefijo de la pk
      assertEquals(await indexNames(db, "pedido_lineas"), ["ix_pedido_lineas_iproducto"]);
      // syncSchema recrea un índice faltante
      await sql`drop index ix_productos_icategoria`.execute(db.kysely);
      await productos.syncSchema();
      assertEquals(await indexNames(db, "productos"), ["ix_productos_icategoria"]);
    } finally {
      await db.destroy();
    }
  });
}

const CodigoSchema = defineSchema({
  columns: {
    codigo: { type: "string", pk: true, length: 20, sequence: { base: 36, start: 35 } },
    iempresa: { type: "string", length: 20, nullable: false },
    folio: { type: "string", length: 20, sequence: { scope: ["iempresa"], base: 16, pattern: "F-{n:3}" } },
    numero: { type: "string", length: 20, sequence: { as: "string", start: 7 } },
  },
});
class Codigo extends pojoOf(CodigoSchema) {}
const CodigoEntity = defineEntity({ pojo: Codigo, name: "seq.codigo", singular: "seq/codigo", plural: "seq/codigos" });

for (const [name, make] of ENGINES) {
  Deno.test(`[${name}] secuencias en base 2..36: pk string en base 36, por ámbito en base 16 con patrón, numérica quemada como texto`, async () => {
    const db = make();
    try {
      const codigos = new ServerController(CodigoEntity, { db, table: "codigos" });
      await db.seed();
      const [a, b, c] = await codigos.postList([{ iempresa: "A" }, { iempresa: "A" }, { iempresa: "B" }]);
      assertEquals([a?.codigo, b?.codigo, c?.codigo], ["z", "10", "11"]); // 35, 36, 37 en base 36
      assertEquals([a?.folio, b?.folio, c?.folio], ["F-001", "F-002", "F-001"]);
      assertEquals([a?.numero, b?.numero, typeof c?.numero], ["7", "8", "string"]);
      // el máximo del ámbito se lee en su base: tras F-00f (15) sigue F-010 (16)
      for (let i = 0; i < 13; i++) await codigos.post({ iempresa: "A" });
      assertEquals((await codigos.post({ iempresa: "A" })).folio, "F-010");
    } finally {
      await db.destroy();
    }
  });
}
