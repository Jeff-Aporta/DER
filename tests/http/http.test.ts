/**
 * Punta a punta: ClientController (fetch) ↔ Router (Request/Response) ↔ ServerController (SQLite).
 * Mismas entidades en ambos lados; el fetch del client va directo al handler (sin red).
 */
import { assertEquals, assertInstanceOf, assertMatch, assertRejects } from "@std/assert";
import { ClientController, encodeQuery, HttpError, ValidationError } from "@Jeff-Aporta/DER/src/02-controllers/client/index.ts";
import { createRouter } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { at } from "@Jeff-Aporta/DER/tests/_util.ts";
import { buildControllers, CFG_TABLA } from "@Jeff-Aporta/DER/examples/backend.ts";
import { CategoriaEntity, CrisisEntity, LineaEntity, PedidoEntity, ProductoEntity, Categoria, Producto } from "@Jeff-Aporta/DER/examples/domain.ts";

async function setup() {
  const db = sqliteDatabase(":memory:", { cfg: CFG_TABLA });
  const srv = buildControllers(db);
  await db.seed();
  const router = createRouter(Object.values(srv), { basePath: "/api", onError: () => {} });
  const calls: string[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    const req = new Request(input, init);
    calls.push(`${req.method} ${new URL(req.url).pathname}`);
    return router.fetch(req);
  };
  const cfg = { baseUrl: "http://test/api", fetch: fetchFn };
  const cli = {
    categorias: new ClientController(CategoriaEntity, cfg),
    productos: new ClientController(ProductoEntity, cfg),
    pedidos: new ClientController(PedidoEntity, cfg),
    lineas: new ClientController(LineaEntity, cfg),
    crisis: new ClientController(CrisisEntity, cfg),
  };
  return { db, router, cli, calls };
}

Deno.test("http: CRUD + listas con las rutas RESTful", async () => {
  const { db, cli, calls } = await setup();
  try {
    const [cat] = await cli.categorias.postList([{ nombre: "Bebidas" }]);
    assertInstanceOf(cat, Categoria);
    const p = await cli.productos.post({ nombre: "Café", precio: 3, stock: 2, icategoria: cat.icategoria });
    assertInstanceOf(p, Producto);
    const got = (await cli.productos.get(p))!;
    assertEquals(got.categoria!.nombre, "Bebidas");
    assertEquals(got.total, 6);
    assertEquals((await cli.productos.put({ iproducto: p.iproducto, stock: 5 }))!.stock, 5);
    assertEquals(await cli.productos.get({ iproducto: 404 }), null);
    assertEquals((await cli.productos.list()).length, 1);
    const q = await cli.productos.query({ where: { categoria: { nombre: "Bebidas" } }, include: { categoria: true } });
    assertEquals(at(q, 0).categoria!.icategoria, cat.icategoria);
    await cli.productos.putList([{ iproducto: p.iproducto, precio: 4 }]);
    assertEquals((await cli.productos.deleteList([{ iproducto: p.iproducto }])).length, 1);
    assertEquals(await cli.productos.delete({ iproducto: p.iproducto }), null);
    const ped = await cli.pedidos.post({ cliente: "Ana" });
    await cli.lineas.post({ ipedido: ped.ipedido, ilinea: 1, iproducto: 1, cantidad: 1 });
    assertEquals((await cli.lineas.get({ ipedido: ped.ipedido, ilinea: 1 }))!.cantidad, 1);
    await cli.crisis.post({ codigo: "a/b c" });
    assertEquals((await cli.crisis.get({ codigo: "a/b c" }))!.codigo, "a/b c");
    assertEquals((await cli.crisis.list()).length, 1);

    assertEquals(calls, [
      "POST /api/categorias",
      "POST /api/producto",
      "GET /api/producto/1",
      "PUT /api/producto/1",
      "GET /api/producto/404",
      "GET /api/productos",
      "GET /api/productos",
      "PUT /api/productos",
      "DELETE /api/productos",
      "DELETE /api/producto/1",
      "POST /api/pedido",
      "POST /api/pedido/linea",
      "GET /api/pedido/linea/1/1",
      "POST /api/crisis",
      "GET /api/crisis/a%2Fb%20c",
      "GET /api/crisis/s",
    ]);
  } finally {
    await db.destroy();
  }
});

Deno.test("http: los pre* compartidos frenan en el client ANTES del fetch; el server también valida", async () => {
  const { db, cli, calls, router } = await setup();
  try {
    await assertRejects(() => cli.productos.post({ nombre: "x", precio: -1 }), ValidationError, "negativo");
    await assertRejects(() => cli.productos.post({ precio: 1 }), ValidationError, "nombre");
    assertEquals(calls, []); // nunca salió
    // un client sin validar (fetch crudo) igual recibe 400 del server
    const res = await router.fetch(
      new Request("http://test/api/producto", { method: "POST", body: JSON.stringify({ nombre: "x", precio: -1 }) }),
    );
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, "El precio no puede ser negativo");
    // hook sólo de server (categoría inexistente) → 400 traducido a ValidationError en el client
    await assertRejects(() => cli.productos.post({ nombre: "x", precio: 1, icategoria: 9 }), ValidationError, "9");
    assertEquals((await router.fetch(new Request("http://test/api/nada"))).status, 404);
    const bad = await router.fetch(new Request("http://test/api/producto", { method: "POST", body: "{mal" }));
    assertEquals(bad.status, 400);
  } finally {
    await db.destroy();
  }
});

Deno.test("http: query por GET ?q=, include en get y endpoints especiales", async () => {
  const { db, cli, router } = await setup();
  try {
    await cli.productos.postList([{ nombre: "A", precio: 1, stock: 1 }, { nombre: "B", precio: 2 }]);
    const q = encodeQuery({ where: { precio: { gt: 1 } } });
    const res = await router.fetch(new Request(`http://test/api/productos?q=${q}`));
    assertMatch(q, /^[A-Za-z0-9_-]+$/); // base64url: pegable en la barra del navegador
    const plano = await router.fetch(new Request(`http://test/api/productos?q=${encodeURIComponent(JSON.stringify({ where: { precio: { gt: 1 } } }))}`));
    assertEquals((await plano.json()).length, 1); // JSON plano también se acepta
    assertEquals((await router.fetch(new Request("http://test/api/productos?q=%%%"))).status, 400);
    assertEquals((await (await router.fetch(new Request("http://test/api/productos"))).json()).length, 2); // sin q es list
    assertEquals((await res.json()).map((p: { nombre: string }) => p.nombre), ["B"]);
    const r = await cli.productos.call<Producto>("ajustarStock", { iproducto: 1, stock: 4 });
    assertInstanceOf(r, Producto);
    assertEquals(r.stock, 5);
    const nuevos = await cli.productos.call<Producto[]>("importar", [{ nombre: "C", precio: 3 }]);
    assertInstanceOf(at(nuevos, 0), Producto);
    assertEquals((await cli.productos.list()).length, 3);
  } finally {
    await db.destroy();
  }
});

Deno.test("http: SSE (texto plano por evento, multilínea, errores y verbos con body)", async () => {
  const { db, cli, router } = await setup();
  try {
    const textos: string[] = [];
    for await (const t of cli.productos.stream("post", { nombre: "Nuevo", precio: 1 })) textos.push(t);
    assertEquals(textos.map((t) => JSON.parse(t).paso), ["validado", "creado"]);
    const lista: string[] = [];
    for await (const t of cli.productos.stream("list")) lista.push(t);
    assertEquals(lista, ["Hola", "mundo\nmultilínea"]);
    const ep: string[] = [];
    for await (const t of cli.productos.stream("ajustarStock", { iproducto: 1, stock: 1 })) ep.push(t);
    assertEquals(ep, ["ajustando 1", "listo"]);
    // formato en el cable
    const raw = await router.fetch(new Request("http://test/api/productos/sse"));
    assertEquals(raw.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assertEquals(await raw.text(), "data: Hola\n\ndata: mundo\ndata: multilínea\n\n");
    // pre antes del stream (400, no stream) y acción sin SSE (404)
    await assertRejects(async () => {
      for await (const _ of cli.productos.stream("post", { nombre: "x", precio: -1 })) { /* */ }
    }, ValidationError);
    const sinSse = await router.fetch(new Request("http://test/api/categorias/sse"));
    assertEquals(sinSse.status, 404);
    await assertRejects(async () => {
      for await (const _ of cli.categorias.stream("list")) { /* */ }
    }, HttpError);
  } finally {
    await db.destroy();
  }
});

Deno.test("http: /cfg de la entidad en el plural (defaults del molde, PUT parcial sólo update)", async () => {
  const { db, cli, calls } = await setup();
  try {
    const defaults = { moneda: "COP", stockMinimo: 5, catalogo: { porPagina: 24, mostrarAgotados: false } };
    assertEquals(await cli.productos.getCfg(), defaults);
    assertEquals(calls.slice(-1), ["GET /api/productos/cfg"]);
    // una llave anidada ajusta un pedazo sin tocar el resto
    assertEquals(await cli.productos.putCfg({ catalogo: { porPagina: 12 } }), { ...defaults, catalogo: { porPagina: 12, mostrarAgotados: false } });
    assertEquals(calls.slice(-1), ["PUT /api/productos/cfg"]);
    // el fragmento se valida con Zod en el client: no sale
    const antes = calls.length;
    await assertRejects(() => cli.productos.putCfg({ stockMinimo: -1 }), ValidationError);
    assertEquals(calls.length, antes);
    // las entidades sin cfg no la exponen
    await assertRejects(() => cli.categorias.getCfg(), ValidationError, "cfg");
  } finally {
    await db.destroy();
  }
});
