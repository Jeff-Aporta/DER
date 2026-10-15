/**
 * getPropagation (detalles que se extraen en get) y setPropagation (detalles que se escriben en
 * post/put/delete, en transacción y en cascada), más el seed propagado a las tablas de los detalles.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { createRouter, ServerController, sql, ValidationError } from "@Jeff-Aporta/DER/src/02 controllers/server/mod.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02 controllers/server/sqlite/mod.ts";
import { CategoriaEntity, LineaEntity, PedidoEntity, ProductoEntity, type Linea } from "@Jeff-Aporta/DER/examples/domain.ts";

function setup() {
  const db = sqliteDatabase();
  const categorias = new ServerController(CategoriaEntity, { db, table: "categorias" });
  const productos = new ServerController(ProductoEntity, { db, table: "productos" });
  const lineas = new ServerController(LineaEntity, { db, table: "pedido_lineas" });
  const pedidos = new ServerController(PedidoEntity, {
    db,
    table: "pedidos",
    getPropagation: () => ({ lineas: { producto: true } }), // se lee más de lo que se escribe
    setPropagation: () => ({ lineas: true }), // sólo las líneas son detalle de pertenencia
  });
  return { db, categorias, productos, lineas, pedidos };
}

const tablas = async (db: ReturnType<typeof sqliteDatabase>) =>
  (await sql<{ name: string }>`select name from sqlite_master where type = 'table' order by name`.execute(db.kysely))
    .rows.map((r) => r.name).filter((n) => !n.startsWith("sqlite_"));

Deno.test("propagación: seed del controller crea también las tablas de sus detalles (sin ciclos)", async () => {
  const { db, pedidos } = setup();
  try {
    await pedidos.seed();
    // set de get∪setPropagation anidados: pedidos → lineas → producto → (getInclude de producto) categoria
    assertEquals(await tablas(db), ["categorias", "pedido_lineas", "pedidos", "productos"]);
    // el set directo de pedidos (su árbol); categorias llega por la propagación propia de productos
    assertEquals(pedidos.propagationControllers().map((c) => c.table).sort(), ["pedido_lineas", "productos"]);
    await pedidos.seed({ propagate: false }); // idempotente
  } finally {
    await db.destroy();
  }
});

Deno.test("propagación: post inserta padre + detalles con la FK, get los extrae anidados", async () => {
  const { db, productos, lineas, pedidos } = setup();
  await db.seed();
  try {
    const [a, b] = await productos.postList([{ nombre: "A", precio: 1 }, { nombre: "B", precio: 2 }]);
    const p = await pedidos.post({
      cliente: "Ana",
      lineas: [
        { ilinea: 1, iproducto: a?.iproducto, cantidad: 2 },
        { ilinea: 2, iproducto: b?.iproducto, cantidad: 3 },
      ],
    });
    assertEquals(p.lineas.map((l: Linea) => [l.ipedido, l.ilinea, l.cantidad]), [[p.ipedido, 1, 2], [p.ipedido, 2, 3]]);
    const got = (await pedidos.get({ ipedido: p.ipedido }))!;
    assertEquals(got.lineas.map((l) => l.producto?.nombre), ["A", "B"]);
    assertEquals((await lineas.list()).length, 2);
  } finally {
    await db.destroy();
  }
});

Deno.test("propagación: un detalle inválido revierte todo (pre* del detalle con su ruta)", async () => {
  const { db, lineas, pedidos } = setup();
  await db.seed();
  try {
    await assertRejects(
      () =>
        pedidos.post({
          cliente: "Beto",
          lineas: [{ ilinea: 1, iproducto: 1, cantidad: 1 }, { ilinea: 2, iproducto: 1, cantidad: 0 }],
        }),
      ValidationError,
      "lineas[1]: La cantidad debe ser mayor a 0",
    );
    assertEquals([(await pedidos.list()).length, (await lineas.list()).length], [0, 0]);
  } finally {
    await db.destroy();
  }
});

Deno.test("propagación: put reemplaza los detalles enviados (delete + post); sin la llave no los toca", async () => {
  const { db, lineas, pedidos } = setup();
  await db.seed();
  try {
    const p = await pedidos.post({ cliente: "Caro", lineas: [{ ilinea: 1, iproducto: 1, cantidad: 1 }] });
    await pedidos.put({ ipedido: p.ipedido, cliente: "Caro M." }); // sin `lineas`
    assertEquals((await lineas.list()).length, 1);
    const upd = (await pedidos.put({
      ipedido: p.ipedido,
      lineas: [{ ilinea: 5, iproducto: 1, cantidad: 9 }, { ilinea: 6, iproducto: 1, cantidad: 8 }],
    }))!;
    assertEquals(upd.cliente, "Caro M.");
    assertEquals((await lineas.list()).map((l) => l.ilinea), [5, 6]);
    await pedidos.put({ ipedido: p.ipedido, lineas: [] }); // vaciar
    assertEquals((await lineas.list()).length, 0);
  } finally {
    await db.destroy();
  }
});

Deno.test("propagación: delete borra los detalles antes que el padre; listas y HTTP también propagan", async () => {
  const { db, lineas, pedidos, categorias, productos } = setup();
  await db.seed();
  try {
    const router = createRouter([categorias, productos, lineas, pedidos], { basePath: "/api" });
    const res = await router.fetch(
      new Request("http://t/api/pedido", {
        method: "POST",
        body: JSON.stringify({ cliente: "Dani", lineas: [{ ilinea: 1, iproducto: 1, cantidad: 4 }] }),
      }),
    );
    const creado = await res.json();
    assertEquals([res.status, creado.lineas[0].ipedido], [201, creado.ipedido]);
    await pedidos.postList([{ cliente: "Eva", lineas: [{ ilinea: 1, iproducto: 1, cantidad: 1 }] }]);
    assertEquals((await lineas.list()).length, 2);
    const borrado = await router.fetch(new Request(`http://t/api/pedido/${creado.ipedido}`, { method: "DELETE" }));
    assertEquals(borrado.status, 200);
    assertEquals((await lineas.list()).map((l) => l.ipedido), [creado.ipedido + 1]);
    await pedidos.deleteList([{ ipedido: creado.ipedido + 1 }]);
    assertEquals([(await lineas.list()).length, (await pedidos.list()).length], [0, 0]);
    assert(pedidos.detailRelations().includes("lineas"));
  } finally {
    await db.destroy();
  }
});
