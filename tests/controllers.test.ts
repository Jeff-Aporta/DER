/**
 * Prioridad media: /cfg con load/save propios y molde final, SSE que falla a mitad del stream (en proceso, en el
 * cable y en el client), propagación de escritura de 2 niveles con secuencias por ámbito, 501 y computed sin motor.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { ClientController } from "../src/02 controllers/client/mod.ts";
import { createRouter, HttpError, ServerController, ValidationError } from "../src/02 controllers/server/mod.ts";
import { sqliteDatabase } from "../src/02 controllers/server/sqlite/mod.ts";
import { defineEntity, defineSchema, pojoOf, z } from "../mod.ts";

// ------------------------------------------------------------------ dominio de prueba (3 niveles)

const FacturaSchema = defineSchema({
  columns: {
    idfactura: { type: "int", pk: true, autoincrement: true },
    cliente: { type: "string", nullable: false },
    jcfg: { type: "json" },
  },
  relations: { renglones: { kind: "many", target: "ctl.renglon", on: { idfactura: "idfactura" } } },
});
const RenglonSchema = defineSchema({
  columns: {
    idfactura: { type: "int", pk: true },
    irenglon: { type: "int", pk: true, sequence: { scope: ["idfactura"] } },
    detalle: { type: "string" },
  },
  relations: {
    impuestos: { kind: "many", target: "ctl.impuesto", on: { idfactura: "idfactura", irenglon: "irenglon" } },
  },
});
const ImpuestoSchema = defineSchema({
  columns: {
    idfactura: { type: "int", pk: true },
    irenglon: { type: "int", pk: true },
    iimpuesto: { type: "int", pk: true, sequence: { scope: ["idfactura", "irenglon"] } },
    tasa: { type: "float", nullable: false },
  },
});
class TImpuesto extends pojoOf(ImpuestoSchema) {}
class TRenglon extends pojoOf(RenglonSchema) {
  declare impuestos: TImpuesto[];
}
class TFactura extends pojoOf(FacturaSchema) {
  declare renglones: TRenglon[];
}

// molde con una regla sobre el objeto completo (el fragmento parcial no la ve; el resultado final sí)
const ZRango = z.object({ min: z.number().optional(), max: z.number().optional() })
  .refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max, "min no puede superar max");

const Factura = defineEntity({
  pojo: TFactura,
  name: "ctl.factura",
  singular: "factura",
  plural: "facturas",
  cfg: { column: "jcfg", zod: ZRango },
  endpoints: { anular: { method: "POST", scope: "one" } },
});
const Renglon = defineEntity({ pojo: TRenglon, name: "ctl.renglon", singular: "factura/renglon", plural: "factura/renglones" });
const Impuesto = defineEntity({ pojo: TImpuesto, name: "ctl.impuesto", singular: "factura/impuesto", plural: "factura/impuestos" });

function setup() {
  const db = sqliteDatabase();
  const memoria = new Map<number, unknown>();
  const facturas = new ServerController(Factura, {
    db,
    table: "facturas",
    setPropagation: () => ({ renglones: { impuestos: true } }),
    getPropagation: () => ({ renglones: { impuestos: true } }),
    sse: {
      list(_arg, send) {
        send("uno");
        throw new Error("se cayó el proceso");
      },
    },
  });
  const renglones = new ServerController(Renglon, { db, table: "renglones" });
  const impuestos = new ServerController(Impuesto, { db, table: "impuestos" });
  // otra entidad con cfg de libre definición en memoria (load/save propios)
  const conCfgLibre = new ServerController(
    defineEntity({ pojo: TFactura, name: "ctl.factura2", singular: "factura2", plural: "facturas2", cfg: {} }),
    {
      db,
      table: "facturas",
      register: false,
      cfg: {
        load(p) {
          return p.idfactura === 999 ? undefined : memoria.get(Number(p.idfactura)) ?? {};
        },
        save(p, value) {
          memoria.set(Number(p.idfactura), value);
        },
      },
    },
  );
  return { db, facturas, renglones, impuestos, conCfgLibre, memoria };
}

Deno.test("propagación de 2 niveles con secuencias por ámbito: post, get, put (reemplazo) y delete en cascada", async () => {
  const { db, facturas, renglones, impuestos } = setup();
  await db.seed();
  try {
    const f = await facturas.post({
      cliente: "Ana",
      renglones: [
        { detalle: "A", impuestos: [{ tasa: 0.19 }, { tasa: 0.04 }] },
        { detalle: "B", impuestos: [{ tasa: 0.19 }] },
      ],
    });
    const got = (await facturas.get({ idfactura: f.idfactura }))!;
    assertEquals(got.renglones.map((r) => [r.irenglon, r.detalle, r.impuestos.map((i) => i.iimpuesto)]), [
      [1, "A", [1, 2]],
      [2, "B", [1]],
    ]);
    await facturas.put({ idfactura: f.idfactura, renglones: [{ detalle: "C", impuestos: [{ tasa: 0.05 }] }] });
    assertEquals((await renglones.list()).map((r) => r.detalle), ["C"]);
    assertEquals((await impuestos.list()).map((i) => i.tasa), [0.05]);
    await facturas.delete({ idfactura: f.idfactura });
    assertEquals([(await renglones.list()).length, (await impuestos.list()).length], [0, 0]);
    // la secuencia por ámbito exige el ámbito
    await assertRejects(() => renglones.nextSequence("irenglon", new TRenglon({})), ValidationError, "idfactura");
  } finally {
    await db.destroy();
  }
});

Deno.test("cfg: molde final con regla de objeto completo, load/save propios y entidad inexistente", async () => {
  const { db, facturas, conCfgLibre, memoria } = setup();
  await db.seed();
  try {
    const f = await facturas.post({ cliente: "Beto" });
    await facturas.putCfg(f, { min: 1, max: 5 });
    // el fragmento es válido por sí solo, pero el resultado (min 9 > max 5) no cumple el molde completo
    await assertRejects(() => facturas.putCfg(f, { min: 9 }), ValidationError, "min no puede superar max");
    assertEquals(await facturas.getCfg(f), { min: 1, max: 5 }); // no quedó nada a medias
    assertEquals(await facturas.putCfg({ idfactura: 404 }, { min: 1 }), null);

    assertEquals(await conCfgLibre.putCfg({ idfactura: 7 }, { tema: { color: "rojo" } }), { tema: { color: "rojo" } });
    assertEquals(await conCfgLibre.putCfg({ idfactura: 7 }, { tema: { fuente: 12 } }), { tema: { color: "rojo", fuente: 12 } });
    assertEquals(memoria.get(7), { tema: { color: "rojo", fuente: 12 } });
    assertEquals(await conCfgLibre.getCfg({ idfactura: 999 }), null); // load → undefined = no existe
  } finally {
    await db.destroy();
  }
});

Deno.test("SSE que falla a mitad: en proceso lanza tras lo emitido; en el cable `event: error`; el client lanza", async () => {
  const { db, facturas, renglones, impuestos } = setup();
  await db.seed();
  try {
    const recibidos: string[] = [];
    await assertRejects(async () => {
      for await (const t of facturas.stream("list")) recibidos.push(t);
    }, Error, "se cayó el proceso");
    assertEquals(recibidos, ["uno"]);

    const router = createRouter([facturas, renglones, impuestos], { basePath: "/api", onError: () => {} });
    const raw = await router.fetch(new Request("http://t/api/facturas/sse"));
    assertEquals(await raw.text(), "data: uno\n\nevent: error\ndata: se cayó el proceso\n\n");

    const cli = new ClientController(Factura, {
      baseUrl: "http://t/api",
      fetch: (i, init) => router.fetch(new Request(i, init)),
    });
    const delCliente: string[] = [];
    await assertRejects(async () => {
      for await (const t of cli.stream("list")) delCliente.push(t);
    }, HttpError, "se cayó el proceso");
    assertEquals(delCliente, ["uno"]);
    // endpoint declarado sin implementación en el server → 501
    const f = await facturas.post({ cliente: "Caro" });
    await assertRejects(() => cli.call("anular", { idfactura: f.idfactura }), HttpError, "no tiene implementación");
  } finally {
    await db.destroy();
  }
});

Deno.test("computed sin expresión para el motor actual: error claro al consultar", async () => {
  const db = sqliteDatabase();
  try {
    const S = defineSchema({ columns: { id: { type: "int", pk: true }, x: { type: "int" }, y: { type: "int", virtual: true } } });
    class T extends pojoOf(S) {}
    const ctl = new ServerController(defineEntity({ pojo: T, name: "ctl.t", singular: "t", plural: "ts" }), {
      db,
      table: "ts",
      computed: { y: { pg: "{x} * 2" } },
    });
    await db.seed();
    await assertRejects(() => ctl.query({}), Error, "computed sin expresión para el motor sqlite"); // list() es aplanado: no evalúa calculadas
  } finally {
    await db.destroy();
  }
});
