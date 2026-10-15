/**
 * Tabla de rutas común y hosts: Azure Functions (una función por ruta) y Cloudflare Workers.
 * Misma norma en todos: las acciones del controller + rutas irregulares, con id `METHOD:/ruta`.
 */
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  type AzureApp,
  type AzureHttpRequest,
  type AzureHttpResponseInit,
  createRouter,
  type Database,
  HttpError,
  ServerController,
} from "@Jeff-Aporta/DER/src/02 controllers/server/mod.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02 controllers/server/sqlite/mod.ts";
import { registerAzure } from "@Jeff-Aporta/DER/src/02 controllers/server/hosts/azure/mod.ts";
import { defineWorker } from "@Jeff-Aporta/DER/src/02 controllers/server/hosts/cloudflare/mod.ts";
import { buildControllers } from "@Jeff-Aporta/DER/examples/backend.ts";
import { CategoriaEntity, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";

async function setup() {
  const db = sqliteDatabase();
  const ctrls = buildControllers(db);
  await db.seed();
  return { db, ctrls };
}

Deno.test("rutas: la tabla expone cada acción del controller con id METHOD:/ruta", async () => {
  const { db, ctrls } = await setup();
  try {
    const router = createRouter(Object.values(ctrls), { basePath: "/api" });
    const ids = router.routes.map((r) => r.id);
    for (
      const id of [
        "GET:/doc",
        "GET:/productos",
        "POST:/productos",
        "PUT:/productos",
        "DELETE:/productos",
        "POST:/productos/query",
        "GET:/productos/query",
        "POST:/producto",
        "GET:/producto/{iproducto}",
        "PUT:/producto/{iproducto}",
        "DELETE:/producto/{iproducto}",
        "POST:/producto/{iproducto}/ajustarStock",
        "POST:/producto/{iproducto}/ajustarStock/sse",
        "POST:/productos/importar",
        "GET:/producto/{iproducto}/cfg",
        "PUT:/producto/{iproducto}/cfg",
        "GET:/productos/doc",
        "POST:/producto/sse",
        "GET:/productos/sse",
        "GET:/pedido/linea/{ipedido}/{ilinea}",
        "GET:/crisis/s",
        "GET:/crisis/{codigo}",
      ]
    ) assert(ids.includes(id), `falta ${id}`);
    assert(!ids.includes("GET:/categorias/sse"), "sin handler SSE no se registra la variante /sse");
    assert(!ids.includes("GET:/categoria/{icategoria}/cfg"), "sin cfg no se registra /cfg");
    // literal gana a parámetro: crisis/s es el plural, no el get de la pk "s"
    assertEquals(router.match("GET", "/api/crisis/s")?.route.name, "list");
    assertEquals(router.match("GET", "/api/crisis/x1")?.params, { codigo: "x1" });
  } finally {
    await db.destroy();
  }
});

Deno.test("rutas: expose (como `aplicar`) limita lo registrado y las duplicadas/ambiguas fallan", async () => {
  const db: Database = sqliteDatabase();
  try {
    const cats = new ServerController(CategoriaEntity, { db, table: "categorias", expose: ["get", "list", "doc"] });
    const router = createRouter([cats]);
    assertEquals(router.routes.map((r) => r.id).sort(), [
      "GET:/categoria/{icategoria}",
      "GET:/categorias",
      "GET:/categorias/doc",
      "GET:/doc",
    ]);
    assertEquals((await router.fetch(new Request("http://t/categoria", { method: "POST", body: "{}" }))).status, 404);
    assertThrows(
      () => createRouter([cats], { routes: [{ method: "GET", path: "categoria/{otro}", handler: () => 1 }] }),
      Error,
      "ambigua",
    );
  } finally {
    await db.destroy();
  }
});

Deno.test("rutas irregulares: del controller (this = controller) y del router, con params, body y SSE", async () => {
  const db = sqliteDatabase();
  try {
    const productos = new ServerController(ProductoEntity, {
      db,
      table: "productos",
      routes: [
        {
          method: "GET",
          path: "reportes/productos/{tipo}",
          handler({ params, query }) {
            return this.query({ where: { tipo: params["tipo"] }, pageSize: Number(query.get("n") ?? 10) });
          },
        },
        {
          method: "POST",
          path: "procesos/importar",
          async sse({ body }, send) {
            const lista = body as { nombre: string; precio: number }[];
            for (const p of lista) send(`importando ${p.nombre}`);
            await this.postList(lista);
            send("fin");
          },
        },
      ],
    });
    new ServerController(CategoriaEntity, { db, table: "categorias" });
    await db.seed();
    const router = createRouter(productos.db.controllers, {
      basePath: "/api",
      routes: [
        { method: "GET", path: "salud", handler: () => ({ ok: true }) },
        { method: "GET", path: "crudo/{x}", handler: ({ params }) => new Response(`x=${params["x"]}`) },
        { method: "DELETE", path: "nada", handler: () => undefined },
      ],
    });
    const sse = await router.fetch(
      new Request("http://t/api/procesos/importar/sse", {
        method: "POST",
        body: JSON.stringify([{ nombre: "A", precio: 1, tipo: "digital" }, { nombre: "B", precio: 2 }]),
      }),
    );
    assertEquals(await sse.text(), "data: importando A\n\ndata: importando B\n\ndata: fin\n\n");
    const rep = await router.fetch(new Request("http://t/api/reportes/productos/digital?n=5"));
    assertEquals((await rep.json()).map((p: { nombre: string }) => p.nombre), ["A"]);
    assertEquals(await (await router.fetch(new Request("http://t/api/salud"))).json(), { ok: true });
    assertEquals(await (await router.fetch(new Request("http://t/api/crudo/a%20b"))).text(), "x=a b");
    assertEquals((await router.fetch(new Request("http://t/api/nada", { method: "DELETE" }))).status, 204);
    const ids = router.routes.filter((r) => r.kind === "extra").map((r) => r.id);
    assertEquals(ids, [
      "GET:/reportes/productos/{tipo}",
      "POST:/procesos/importar/sse",
      "GET:/salud",
      "GET:/crudo/{x}",
      "DELETE:/nada",
    ]);
  } finally {
    await db.destroy();
  }
});

Deno.test("rutas: CORS (preflight + cabeceras) y guard por id de ruta", async () => {
  const { db, ctrls } = await setup();
  try {
    const router = createRouter(Object.values(ctrls), {
      basePath: "/api",
      cors: { origin: "https://app.x" },
      guard(route, req) {
        if (route.id === "DELETE:/producto/{iproducto}" && req.headers.get("x-rol") !== "admin") {
          throw new HttpError(403, "Sin permiso para eliminar");
        }
        if (route.id === "GET:/productos" && req.headers.get("x-bloqueo")) return new Response("bloqueado", { status: 423 });
        return undefined;
      },
    });
    const pre = await router.fetch(new Request("http://t/api/producto/1", { method: "OPTIONS" }));
    assertEquals(pre.status, 204);
    assertEquals(pre.headers.get("access-control-allow-origin"), "https://app.x");
    assertEquals((await router.fetch(new Request("http://t/api/nada", { method: "OPTIONS" }))).status, 404);
    const del = await router.fetch(new Request("http://t/api/producto/1", { method: "DELETE" }));
    assertEquals([del.status, (await del.json()).error], [403, "Sin permiso para eliminar"]);
    assertEquals(del.headers.get("access-control-allow-origin"), "https://app.x");
    const lst = await router.fetch(new Request("http://t/api/productos", { headers: { "x-bloqueo": "1" } }));
    assertEquals(lst.status, 423);
    assertEquals((await router.fetch(new Request("http://t/api/productos"))).status, 200);
  } finally {
    await db.destroy();
  }
});

/** `app` de Azure simulado: guarda las funciones y permite invocarlas como lo haría el host. */
function fakeAzure() {
  const fns: { name: string; methods: string[]; route: string; handler: (r: AzureHttpRequest, c: unknown) => Promise<AzureHttpResponseInit> }[] = [];
  const app: AzureApp = { http: (name, o) => void fns.push({ name, ...o }) };
  const invoke = (method: string, route: string, url: string, params: Record<string, string>, body?: unknown) => {
    const fn = fns.find((f) => f.route === route && f.methods.includes(method));
    if (!fn) throw new Error(`sin función ${method} ${route}`);
    const bytes = new TextEncoder().encode(body === undefined ? "" : JSON.stringify(body));
    return fn.handler({
      method,
      url,
      params,
      headers: new Headers(body === undefined ? {} : { "content-type": "application/json" }),
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    }, {});
  };
  return { app, fns, invoke };
}

const text = async (r: AzureHttpResponseInit): Promise<string> => {
  const body = r.body;
  if (body === undefined) return "";
  if (typeof body === "string") return body;
  if (body instanceof ReadableStream) return await new Response(body).text();
  return new TextDecoder().decode(body);
};

Deno.test("azure: una función por ruta (nombres válidos y únicos) que atiende con la tabla común", async () => {
  const { db, ctrls } = await setup();
  try {
    const router = createRouter(Object.values(ctrls), { basePath: "/api", cors: true });
    const az = fakeAzure();
    const registered = registerAzure(az.app, router);
    assertEquals(registered.length, router.routes.length);
    const names = az.fns.map((f) => f.name);
    assertEquals(new Set(names.map((n) => n.toLowerCase())).size, names.length);
    assert(names.every((n) => /^[A-Za-z0-9_]+$/.test(n)));
    assert(az.fns.some((f) => f.route === "producto/{iproducto}" && f.methods[0] === "OPTIONS"));

    const created = await az.invoke("POST", "producto", "http://h/api/producto", {}, { nombre: "Café", precio: 3 });
    assertEquals(created.status, 201);
    assertEquals(created.headers["access-control-allow-origin"], "*");
    const got = await az.invoke("GET", "producto/{iproducto}", "http://h/api/producto/1", { iproducto: "1" });
    assertEquals(JSON.parse(await text(got)).nombre, "Café");
    const sse = await az.invoke("GET", "productos/sse", "http://h/api/productos/sse", {});
    assertEquals(sse.headers["content-type"], "text/event-stream; charset=utf-8");
    assert(sse.body instanceof ReadableStream, "con stream=true el body pasa como stream (SSE en vivo)");
    assertEquals(await text(sse), "data: Hola\n\ndata: mundo\ndata: multilínea\n\n");
    const bad = await az.invoke("POST", "producto", "http://h/api/producto", {}, { nombre: "x", precio: -1 });
    assertEquals(bad.status, 400);
  } finally {
    await db.destroy();
  }
});

Deno.test("azure: prefijos reservados del host fallan al registrar", async () => {
  const db = sqliteDatabase();
  try {
    const cats = new ServerController(CategoriaEntity, { db, table: "categorias", expose: ["list"] });
    const router = createRouter([cats], { routes: [{ method: "GET", path: "admin/x", handler: () => 1 }] });
    assertThrows(() => registerAzure(fakeAzure().app, router), Error, "reservada");
  } finally {
    await db.destroy();
  }
});

Deno.test("cloudflare: defineWorker crea el router una vez por isolate y lo reintenta si el setup falla", async () => {
  const { db, ctrls } = await setup();
  try {
    let calls = 0;
    let fail = true;
    const worker = defineWorker((env: { PREFIX: string }) => {
      calls++;
      if (fail) throw new Error("binding no listo");
      return createRouter(Object.values(ctrls), { basePath: env.PREFIX });
    });
    const ctx = { waitUntil: () => {} };
    await assertRejects(() => worker.fetch(new Request("http://w/api/productos"), { PREFIX: "/api" }, ctx));
    fail = false;
    const r1 = await worker.fetch(new Request("http://w/api/productos"), { PREFIX: "/api" }, ctx);
    const r2 = await worker.fetch(new Request("http://w/api/doc"), { PREFIX: "/api" }, ctx);
    assertEquals([r1.status, r2.status, calls], [200, 200, 2]);
    assertEquals((await worker.fetch(new Request("http://w/otra"), { PREFIX: "/api" }, ctx)).status, 404);
  } finally {
    await db.destroy();
  }
});
