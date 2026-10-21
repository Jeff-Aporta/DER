/**
 * Prioridad media: /cfg de la entidad (plural, tabla de cfg, defaults del molde, sólo update, regla del objeto
 * completo), modos del PUT singular (`schema.put`), SSE que falla a mitad del stream (en proceso, en el cable y en el
 * client), propagación de escritura de 2 niveles con secuencias por ámbito, 501 y computed sin motor.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { sql } from "kysely";
import { controllerRouteSpecs } from "@Jeff-Aporta/DER/src/02-controllers/server/routes.ts";
import { NotFoundError } from "@Jeff-Aporta/DER/src/00-common/errors.ts";
import type { PutMode } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { ClientController } from "@Jeff-Aporta/DER/src/02-controllers/client/index.ts";
import { createRouter, HttpError, ServerController, ValidationError } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { defineEntity, defineSchema, pojoOf, z } from "@Jeff-Aporta/DER/index.ts";

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
class Impuesto extends pojoOf(ImpuestoSchema) {}
class Renglon extends pojoOf(RenglonSchema) {
  declare impuestos: Impuesto[];
}
class Factura extends pojoOf(FacturaSchema) {
  declare renglones: Renglon[];
}

// molde de la config de la entidad: defaults (punto de partida del PUT, que sólo ajusta llaves que el molde define)
// y una regla sobre el objeto completo (el fragmento parcial no la ve; el resultado final sí)
const ZRango = z.object({ min: z.number().default(0), max: z.number().default(10) })
  .refine((v) => v.min <= v.max, "min no puede superar max");

const FacturaEntity = defineEntity({
  pojo: Factura,
  name: "ctl.factura",
  singular: "factura",
  plural: "facturas",
  cfg: { zod: ZRango },
  endpoints: { anular: { method: "POST", scope: "one" } },
});
const CFG_TABLA = { table: "cfg_entidades", columns: { pk: "entidad", json: "jcfg", fecha: "fhultact" } };
const RenglonEntity = defineEntity({ pojo: Renglon, name: "ctl.renglon", singular: "factura/renglon", plural: "factura/renglones" });
const ImpuestoEntity = defineEntity({ pojo: Impuesto, name: "ctl.impuesto", singular: "factura/impuesto", plural: "factura/impuestos" });

function setup() {
  const db = sqliteDatabase(":memory:", { cfg: CFG_TABLA });
  const facturas = new ServerController(FacturaEntity, {
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
  const renglones = new ServerController(RenglonEntity, { db, table: "renglones" });
  const impuestos = new ServerController(ImpuestoEntity, { db, table: "impuestos" });
  return { db, facturas, renglones, impuestos };
}

// ------------------------------------------------------------------ PUT singular: un schema por modo
const ZDatos = z.object({ a: z.number().optional(), b: z.object({ c: z.number().optional(), d: z.number().optional() }).optional() });
function notas(modo: PutMode | undefined) {
  const Schema = defineSchema({
    columns: {
      inota: { type: "int", pk: true, autoincrement: true },
      titulo: { type: "string" },
      jdatos: { type: "json", zod: ZDatos },
    },
    ...(modo ? { put: modo } : {}),
  });
  class Nota extends pojoOf(Schema) {}
  const entity = defineEntity({ pojo: Nota, name: `ctl.nota-${modo ?? "default"}`, singular: "nota", plural: "notas" });
  const db = sqliteDatabase();
  return { db, ctrl: new ServerController(entity, { db, table: "notas" }) };
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
    await assertRejects(() => renglones.nextSequence("irenglon", new Renglon({})), ValidationError, "idfactura");
  } finally {
    await db.destroy();
  }
});

Deno.test("cfg de la entidad: sólo en plural, defaults del molde, PUT sólo update, regla final y fecha de actualización", async () => {
  const { db, facturas } = setup();
  await db.seed();
  try {
    // rutas: plural/cfg; los singulares no tienen /cfg
    assertEquals(FacturaEntity.route("getCfg").path, "facturas/cfg");
    assertEquals(FacturaEntity.match("PUT", ["facturas", "cfg"])?.name, "putCfg");
    assertEquals(FacturaEntity.match("GET", ["factura", "1", "cfg"]), null);
    assert(controllerRouteSpecs(facturas).some((s) => s.name === "getCfg" && s.path === "facturas/cfg" && !s.pkParams.length));

    assertEquals(await facturas.getCfg(), { min: 0, max: 10 }); // sin fila aún: los defaults del molde
    assertEquals(await facturas.putCfg({ max: 5 }), { min: 0, max: 5 });
    // el fragmento es válido por sí solo, pero el resultado (min 9 > max 5) no cumple el molde completo
    await assertRejects(() => facturas.putCfg({ min: 9 }), ValidationError, "min no puede superar max");
    assertEquals(await facturas.getCfg(), { min: 0, max: 5 }); // no quedó nada a medias
    // el alcance de las llaves lo da el molde: una llave que no define se rechaza
    await assertRejects(() => facturas.putCfg({ otra: 1 }), ValidationError);
    // una fila por entidad (pk = plural) con la fecha de la última actualización
    const { rows } = await sql<Record<string, unknown>>`select entidad, fhultact from cfg_entidades`.execute(db.kysely);
    assertEquals(rows.map((r) => r["entidad"]), ["facturas"]);
    assert(rows[0]?.["fhultact"]);
  } finally {
    await db.destroy();
  }
});

Deno.test("cfg: sin tabla de cfg en el servidor no se expone (ni rutas ni acciones)", async () => {
  const db = sqliteDatabase();
  const ctrl = new ServerController(FacturaEntity, { db, table: "facturas", register: false });
  await db.seed();
  try {
    assertEquals(ctrl.hasCfg(), false);
    assert(!controllerRouteSpecs(ctrl).some((s) => s.name === "getCfg" || s.name === "putCfg"));
    await assertRejects(() => ctrl.getCfg(), NotFoundError, "no expone configuración");
  } finally {
    await db.destroy();
  }
});

Deno.test("PUT singular según schema.put: insert (default), insertIgnore, update y replace", async () => {
  const casos: [PutMode | undefined, Record<string, unknown>, Record<string, unknown>][] = [
    // insert: ajuste parcial; dentro del json con molde fusiona en profundidad; lo no enviado se conserva
    [undefined, { jdatos: { b: { d: 3 } } }, { titulo: "A", jdatos: { a: 1, b: { c: 2, d: 3 } } }],
    // insertIgnore: sólo completa lo que no está definido (no pisa el título ni a)
    ["insertIgnore", { titulo: "B", jdatos: { a: 9, b: { d: 3 } } }, { titulo: "A", jdatos: { a: 1, b: { c: 2, d: 3 } } }],
    // update: sólo cambia lo ya definido (b.d no existía: no se crea)
    ["update", { titulo: "B", jdatos: { a: 9, b: { d: 3 } } }, { titulo: "B", jdatos: { a: 9, b: { c: 2 } } }],
    // replace: reemplazo directo de todo el registro (lo no enviado queda vacío)
    ["replace", { jdatos: { a: 5 } }, { titulo: null, jdatos: { a: 5 } }],
  ];
  for (const [modo, cuerpo, esperado] of casos) {
    const { db, ctrl } = notas(modo);
    await db.seed();
    try {
      const n = await ctrl.post({ titulo: "A", jdatos: { a: 1, b: { c: 2 } } });
      await ctrl.put({ inota: n.inota, ...cuerpo });
      const got = (await ctrl.get({ inota: n.inota }))!.toJSON();
      assertEquals({ titulo: got["titulo"] ?? null, jdatos: got["jdatos"] }, esperado, `modo ${modo ?? "insert"}`);
    } finally {
      await db.destroy();
    }
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

    const cli = new ClientController(FacturaEntity, {
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
