/**
 * Controllers en bases y motores DISTINTOS que se relacionan por POJOs:
 *   SQLite  → pedidos, pedido_lineas, categorias
 *   PGlite  → productos (PostgreSQL)
 * Lectura: lo de la misma base en un SQL anidado; lo de otra base por join de aplicación (IN en lote).
 * Filtros por relación cross-db, escritura propagada en la base de cada controller y seed propagado.
 */
import { assert, assertEquals } from "@std/assert";
import { createRouter, ServerController, sql } from "../src/02 controllers/server/mod.ts";
import { sqliteDatabase } from "../src/02 controllers/server/sqlite/mod.ts";
import { pgliteDatabase } from "../src/02 controllers/server/pglite/mod.ts";
import { Categoria, Linea, Pedido, Producto, type TLinea, type TProducto } from "../examples/domain.ts";

function setup() {
  const lite = sqliteDatabase();
  const pg = pgliteDatabase();
  const productos = new ServerController(Producto, {
    db: pg,
    table: "productos",
    identifierCase: "lower",
    computed: { total: "{precio} * {stock}" },
  });
  const categorias = new ServerController(Categoria, {
    db: lite,
    table: "categorias",
    setPropagation: () => ({ productos: true }), // escribe sus productos en la OTRA base
  });
  const lineas = new ServerController(Linea, { db: lite, table: "pedido_lineas" });
  const pedidos = new ServerController(Pedido, {
    db: lite,
    table: "pedidos",
    getPropagation: () => ({ lineas: { producto: { categoria: true } } }), // SQLite → PG → SQLite
    setPropagation: () => ({ lineas: true }),
  });
  return { lite, pg, productos, categorias, lineas, pedidos };
}

Deno.test("multi-db: seed propagado crea cada tabla en SU base y motor", async () => {
  const { lite, pg, pedidos } = setup();
  try {
    await lite.seed(); // pedidos → lineas → producto (PG) → categoria (SQLite)
    const liteTables = (await sql<{ name: string }>`select name from sqlite_master where type = 'table' order by name`
      .execute(lite.kysely)).rows.map((r) => r.name).filter((n) => !n.startsWith("sqlite_"));
    assertEquals(liteTables, ["categorias", "pedido_lineas", "pedidos"]);
    const pgTables = (await sql<{ tablename: string }>`select tablename from pg_tables where schemaname = 'public'`
      .execute(pg.kysely)).rows.map((r) => r.tablename);
    assertEquals(pgTables, ["productos"]);
    assert(pedidos.propagationControllers().some((c) => c.db === pg));
  } finally {
    await lite.destroy();
    await pg.destroy();
  }
});

Deno.test("multi-db: escritura propagada a otra base, lectura anidada mixta y filtros cross-db", async () => {
  const { lite, pg, productos, categorias, lineas, pedidos } = setup();
  try {
    await lite.seed();
    // categoría (SQLite) con sus productos (PG) en un solo post
    const beb = await categorias.post({
      nombre: "Bebidas",
      productos: [{ nombre: "Café", precio: 3.5, stock: 10 }, { nombre: "Té", precio: 2 }],
    });
    const [cafe, te] = beb.productos as TProducto[];
    assertEquals([cafe?.icategoria, te?.icategoria], [beb.icategoria, beb.icategoria]);
    assertEquals((await productos.list()).length, 2);

    const p = await pedidos.post({
      cliente: "Ana",
      lineas: [{ ilinea: 1, iproducto: cafe?.iproducto, cantidad: 2 }, { ilinea: 2, iproducto: te?.iproducto, cantidad: 1 }],
    });
    // get: lineas (SQL anidado en SQLite) → producto (join en PG) → categoria (join de vuelta en SQLite)
    const got = (await pedidos.get({ ipedido: p.ipedido }))!;
    assertEquals(got.lineas.map((l: TLinea) => l.producto?.nombre), ["Café", "Té"]);
    assertEquals(got.lineas[0]?.producto?.categoria?.nombre, "Bebidas");
    assertEquals(got.lineas[0]?.producto?.total, 35); // la columna calculada sale del SQL de PG

    // filtros por relación que cruzan bases (en ambos sentidos)
    await pedidos.post({ cliente: "Beto", lineas: [{ ilinea: 1, iproducto: te?.iproducto, cantidad: 5 }] });
    const conCafe = await pedidos.query({ where: { lineas: { producto: { nombre: { contains: "caf" } } } } });
    assertEquals(conCafe.map((x) => x.cliente), ["Ana"]);
    const deBebidas = await productos.query({ where: { categoria: { nombre: "Bebidas" } }, orderBy: "nombre" });
    assertEquals(deBebidas.map((x) => x.nombre), ["Café", "Té"]);
    assertEquals((await productos.query({ where: { categoria: { nombre: "Nada" } } })).length, 0);
    // include cross-db en query (no sólo en get)
    const ls = await lineas.query({ include: { producto: true }, orderBy: ["ipedido", "ilinea"] });
    assertEquals(ls.map((l) => l.producto?.nombre), ["Café", "Té", "Té"]);

    // delete propagado: borra los productos en PG
    await categorias.delete({ icategoria: beb.icategoria });
    assertEquals((await productos.list()).length, 0);
  } finally {
    await lite.destroy();
    await pg.destroy();
  }
});

Deno.test("multi-db: un mismo Router sirve controllers de bases distintas", async () => {
  const { lite, pg, productos, categorias, lineas, pedidos } = setup();
  try {
    const router = createRouter([categorias, productos, lineas, pedidos], { basePath: "/api" });
    await router.seed();
    const post = (path: string, body: unknown) =>
      router.fetch(new Request(`http://t/api/${path}`, { method: "POST", body: JSON.stringify(body) }));
    const cat = await (await post("categoria", { nombre: "Comidas", productos: [{ nombre: "Arepa", precio: 1 }] })).json();
    const prod = cat.productos[0];
    const ped = await (await post("pedido", { cliente: "Caro", lineas: [{ ilinea: 1, iproducto: prod.iproducto, cantidad: 3 }] }))
      .json();
    const got = await (await router.fetch(new Request(`http://t/api/pedido/${ped.ipedido}`))).json();
    assertEquals(got.lineas[0].producto.categoria.nombre, "Comidas");
  } finally {
    await lite.destroy();
    await pg.destroy();
  }
});
