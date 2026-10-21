/**
 * Integración del ServerController contra motores REALES: SQLite (node:sqlite) y PostgreSQL (PGlite, WASM).
 * Cada caso corre igual en ambos motores: misma definición, mismo resultado.
 */
import { assert, assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { type Database, NotFoundError, sql, ValidationError } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { pgliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/pglite.ts";
import { PGlite } from "@electric-sql/pglite";
import { at } from "@Jeff-Aporta/DER/tests/_util.ts";
import { buildControllers, CFG_TABLA } from "@Jeff-Aporta/DER/examples/backend.ts";
import { Categoria, Linea, Pedido, Producto } from "@Jeff-Aporta/DER/examples/domain.ts";

// Una sola instancia PGlite (arrancarla es lo costoso); cada test recrea el schema `public`.
let sharedPg: PGlite | undefined;
const ENGINES: [string, () => Promise<Database>][] = [
  ["sqlite", () => Promise.resolve(sqliteDatabase(":memory:", { cfg: CFG_TABLA }))],
  ["pg", async () => {
    sharedPg ??= new PGlite();
    await sharedPg.exec("drop schema public cascade; create schema public;");
    const db = pgliteDatabase(sharedPg, { cfg: CFG_TABLA });
    // no cerrar la instancia compartida
    Object.defineProperty(db, "destroy", { value: () => Promise.resolve() });
    return db;
  }],
];

async function setup(make: () => Promise<Database>) {
  const db = await make();
  const c = buildControllers(db);
  await db.seed();
  const cats = await c.categorias.postList([{ nombre: "Bebidas" }, { nombre: "Comidas", bactivo: false }]);
  const beb = at(cats, 0);
  const com = at(cats, 1);
  const prods = await c.productos.postList([
    { nombre: "Café", precio: 3.5, stock: 10, icategoria: beb.icategoria, tipo: "fisico", meta: { origen: "CO" } },
    { nombre: "Té 100%_verde", precio: 2, stock: 0, icategoria: beb.icategoria },
    { nombre: "Arepa", precio: 1.25, stock: 40, icategoria: com.icategoria, lanzamiento: "2024-05-01" },
    { nombre: "Ebook", precio: 9.99, tipo: "digital", creado: new Date("2024-01-02T03:04:05Z") },
  ]);
  const ped = await c.pedidos.post({ cliente: "Ana", fecha: "2024-06-01" });
  await c.lineas.postList([
    { ipedido: ped.ipedido, ilinea: 1, iproducto: at(prods, 0).iproducto, cantidad: 2 },
    { ipedido: ped.ipedido, ilinea: 2, iproducto: at(prods, 2).iproducto, cantidad: 5 },
  ]);
  return { db, c, beb, com, prods, ped };
}

for (const [name, make] of ENGINES) {
  Deno.test(`[${name}] seed + post/get/put/delete con casteos`, async () => {
    const { db, c, beb, prods } = await setup(make);
    try {
      const cafe = at(prods, 0);
      assertInstanceOf(cafe, Producto);
      assertEquals(typeof cafe.iproducto, "number");
      assertEquals(cafe.precio, 3.5);
      assertEquals(cafe.meta, { origen: "CO" });

      const got = (await c.productos.get({ iproducto: cafe.iproducto }))!;
      assertEquals(got.nombre, "Café");
      assertEquals(got.total, 35); // computed "{precio} * {stock}"
      assertInstanceOf(got.categoria, Categoria); // getInclude por defecto
      assertEquals(got.categoria!.nombre, "Bebidas");
      assertEquals(got.categoria!.bactivo, true); // bool desde 1/true según motor

      const ebook = (await c.productos.get({ iproducto: at(prods, 3).iproducto }, { include: {} }))!;
      assertInstanceOf(ebook.creado, Date);
      assertEquals(ebook.creado!.toISOString(), "2024-01-02T03:04:05.000Z");
      assertEquals(ebook.categoria, undefined);
      const arepa = (await c.productos.get({ iproducto: at(prods, 2).iproducto }))!;
      assertEquals(arepa.lanzamiento, "2024-05-01");

      const upd = (await c.productos.put({ iproducto: cafe.iproducto, precio: "4.25" }))!;
      assertEquals(upd.precio, 4.25);
      assertEquals(upd.nombre, "Café"); // PUT parcial: lo no enviado se conserva

      assertEquals(await c.productos.put({ iproducto: 9999, precio: 1 }), null);
      const del = await c.productos.delete({ iproducto: at(prods, 1).iproducto });
      assertEquals(del!.nombre, "Té 100%_verde");
      assertEquals(await c.productos.get({ iproducto: at(prods, 1).iproducto }), null);
      assertEquals(beb.bactivo, true); // default de la columna
    } finally {
      await db.destroy();
    }
  });

  Deno.test(`[${name}] list() aplanado y query() con filtros, orden, paginación y select`, async () => {
    const { db, c, com } = await setup(make);
    try {
      const list = await c.productos.list();
      assertEquals(list.length, 4);
      assertEquals(Object.keys(at(list, 0).toJSON()).sort(), ["iproducto", "nombre"]);

      const caros = await c.productos.query({ where: { precio: { gte: 3 } }, orderBy: "-precio", select: ["nombre", "precio"] });
      assertEquals(caros.map((p) => p.nombre), ["Ebook", "Café"]);
      assertEquals(at(caros, 0).iproducto, undefined);

      assertEquals((await c.productos.query({ where: { nombre: { contains: "100%_" } } })).length, 1); // escapado
      assertEquals((await c.productos.query({ where: { nombre: { contains: "CAF" } } })).length, 1); // sin mayúsculas
      assertEquals((await c.productos.query({ where: { icategoria: null } })).map((p) => p.nombre), ["Ebook"]);
      assertEquals((await c.productos.query({ where: { tipo: ["digital"] } })).length, 1);
      assertEquals((await c.productos.query({ where: { precio: { between: [2, 4] } } })).length, 2);
      assertEquals((await c.productos.query({ where: { stock: { in: [] } } })).length, 0);
      assertEquals(
        (await c.productos.query({ where: { $or: [{ stock: 0 }, { tipo: "digital" }], $not: { nombre: "Ebook" } } }))
          .map((p) => p.nombre),
        ["Té 100%_verde"],
      );
      // filtro por relación (EXISTS) y por columna calculada
      const deComidas = await c.productos.query({ where: { categoria: { bactivo: false } } });
      assertEquals(deComidas.map((p) => p.icategoria), [com.icategoria]);
      assertEquals((await c.productos.query({ where: { total: { gt: 40 } } })).map((p) => p.nombre), ["Arepa"]);
      // paginación estable por pk
      const p1 = await c.productos.query({ page: 1, pageSize: 3 });
      const p2 = await c.productos.query({ page: 2, pageSize: 3 });
      assertEquals([p1.length, p2.length], [3, 1]);
      assertEquals(at(p2, 0).nombre, "Ebook");
    } finally {
      await db.destroy();
    }
  });

  Deno.test(`[${name}] relaciones anidadas 1:N y 1:1 con pks compuestas`, async () => {
    const { db, c, ped, beb } = await setup(make);
    try {
      const p = at(await c.pedidos.query({
        where: { ipedido: ped.ipedido },
        include: { lineas: { producto: { categoria: true } } },
      }), 0);
      assertInstanceOf(p, Pedido);
      assertEquals(p.fecha, "2024-06-01");
      assertEquals(p.lineas.length, 2);
      assertInstanceOf(at(p.lineas, 0), Linea);
      assertEquals(at(p.lineas, 0).producto!.nombre, "Café");
      assertEquals(at(p.lineas, 0).producto!.categoria!.icategoria, beb.icategoria);
      assertEquals(at(p.lineas, 1).producto!.categoria!.nombre, "Comidas");

      const cats = await c.categorias.query({ include: { "*": true }, orderBy: "icategoria" });
      assertEquals(at(cats, 0).productos.map((x) => x.nombre), ["Café", "Té 100%_verde"]);

      const l = (await c.lineas.get({ ipedido: ped.ipedido, ilinea: 2 }, { include: { pedido: true } }))!;
      assertEquals(l.cantidad, 5);
      assertEquals(l.pedido!.cliente, "Ana");
      const vacio = await c.pedidos.post({ cliente: "Sin líneas" });
      const sin = at(await c.pedidos.query({ where: { ipedido: vacio.ipedido }, include: { lineas: true } }), 0);
      assertEquals(sin.lineas, []);
    } finally {
      await db.destroy();
    }
  });

  Deno.test(`[${name}] pre*: Zod automático, hooks compartidos y de server, listas transaccionales`, async () => {
    const { db, c } = await setup(make);
    try {
      await assertRejects(() => c.productos.post({ precio: 1 }), ValidationError, "Faltan campos requeridos: nombre");
      await assertRejects(() => c.productos.post({ nombre: "x", precio: -1 }), ValidationError, "negativo");
      await assertRejects(() => c.productos.post({ nombre: "x", precio: 1, tipo: "otro" }), ValidationError, "uno de");
      await assertRejects(() => c.productos.post({ nombre: "x".repeat(101), precio: 1 }), ValidationError, "supera");
      await assertRejects(() => c.productos.post({ nombre: "x", precio: 1, icategoria: 77 }), ValidationError, "77");
      await assertRejects(() => c.productos.get({}), ValidationError, "llaves primarias");
      await assertRejects(() => c.productos.query({ where: { nada: 1 } as never }), ValidationError, "nada");
      await assertRejects(() => c.productos.query({ pageSize: 5000 }), ValidationError, "pageSize");
      await assertRejects(() => c.productos.query({ include: { foo: true } }), ValidationError, "relación");

      // postList: el ítem 1 falla en el pre → nada se inserta
      await assertRejects(
        () => c.productos.postList([{ nombre: "ok", precio: 1 }, { nombre: "mal", precio: -5 }]),
        ValidationError,
        "[1]",
      );
      assertEquals((await c.productos.list()).length, 4);
      // putList: un registro inexistente revierte toda la transacción
      const a = at(await c.productos.list(), 0);
      await assertRejects(
        () => c.productos.putList([{ iproducto: a.iproducto, nombre: "CAMBIADO" }, { iproducto: 999, nombre: "x" }]),
        NotFoundError,
      );
      assertEquals((await c.productos.get({ iproducto: a.iproducto }))!.nombre, a.nombre);
      // transacción compartida entre controllers
      await assertRejects(() =>
        db.transaction(async (tx) => {
          await c.categorias.post({ nombre: "Temporal" }, tx);
          throw new Error("rollback");
        })
      );
      assertEquals((await c.categorias.list()).length, 2);
    } finally {
      await db.destroy();
    }
  });

  Deno.test(`[${name}] endpoints especiales, overrides y SSE en proceso`, async () => {
    const { db, c, prods } = await setup(make);
    try {
      const r = await c.productos.call<Producto>("ajustarStock", { iproducto: at(prods, 0).iproducto, stock: 5 });
      assertEquals(r.stock, 15);
      const textos: string[] = [];
      for await (const t of c.productos.stream("post", { nombre: "Nuevo", precio: 1 })) textos.push(t);
      assertEquals(JSON.parse(at(textos, 0)), { paso: "validado" });
      assertEquals(JSON.parse(at(textos, 1)).paso, "creado");
      const lista: string[] = [];
      for await (const t of c.productos.stream("list")) lista.push(t);
      assertEquals(lista, ["Hola", "mundo\nmultilínea"]);
      // el pre corre antes del stream
      await assertRejects(async () => {
        for await (const _ of c.productos.stream("post", { nombre: "x", precio: -1 })) { /* nada */ }
      }, ValidationError);
    } finally {
      await db.destroy();
    }
  });

  Deno.test(`[${name}] /cfg de la entidad (tabla de cfg) y PUT singular en modo insert sobre el json del registro`, async () => {
    const { db, c, prods } = await setup(make);
    try {
      // configuración de la ENTIDAD: defaults del molde, PUT sólo update (llaves del molde), una fila por entidad
      const defaults = { moneda: "COP", stockMinimo: 5, catalogo: { porPagina: 24, mostrarAgotados: false } };
      assertEquals(await c.productos.getCfg(), defaults);
      const conAgotados = { ...defaults, catalogo: { porPagina: 24, mostrarAgotados: true } };
      assertEquals(await c.productos.putCfg({ catalogo: { mostrarAgotados: true } }), conAgotados); // una llave ajusta un pedazo
      assertEquals(await c.productos.putCfg({ moneda: "USD" }), { ...conAgotados, moneda: "USD" });
      await assertRejects(() => c.productos.putCfg({ stockMinimo: "x" }), ValidationError);
      await assertRejects(() => c.productos.putCfg({ otra: 1 }), ValidationError); // fuera del molde
      assertEquals(await c.productos.getCfg(), { ...conAgotados, moneda: "USD" });
      await assertRejects(() => c.categorias.getCfg(), ValidationError, "cfg");

      // PUT singular (modo insert por defecto): el json propio del registro se ajusta en parcial
      const id = { iproducto: at(prods, 0).iproducto };
      await c.productos.put({ ...id, jconfig: { visible: true, ui: { color: "rojo" } } });
      await c.productos.put({ ...id, jconfig: { ui: { orden: 2 } } });
      const got = (await c.productos.get(id))!;
      assertEquals(got.jconfig, { visible: true, ui: { color: "rojo", orden: 2 } });
      assertEquals(got.nombre, "Café"); // lo no enviado se conserva
    } finally {
      await db.destroy();
    }
  });

  Deno.test(`[${name}] identifierCase upper + singular === plural`, async () => {
    const { db, c } = await setup(make);
    try {
      await c.crisis.postList([{ codigo: "A1", descripcion: "uno" }, { codigo: "B2" }]);
      assertEquals((await c.crisis.get({ codigo: "A1" }))!.descripcion, "uno");
      assertEquals((await c.crisis.query({ where: { codigo: { startsWith: "b" } } })).length, 1);
      const { rows } = await sql`select ${sql.id("CODIGO")} as c from ${sql.table("CRISIS")}`.execute(db.kysely);
      assertEquals(rows.length, 2);
      assert(true);
    } finally {
      await db.destroy();
    }
  });
}
