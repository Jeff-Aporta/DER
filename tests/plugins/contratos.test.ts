/**
 * Pruebas de caja negra del plugin de contratos: el contrato que sirve el servidor (las entidades montadas, su esquema,
 * sus rutas y su versión) y el cliente que lo consume (valida lo que llega y manda siempre la cabecera `x-app`).
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Obj } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ColumnDef, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { clienteContratos } from "@Jeff-Aporta/DER/src/03-plugins/contratos/index.ts";
import { contratosServer } from "@Jeff-Aporta/DER/src/03-plugins/contratos/server.ts";
import type { ContratoEntidad, Contratos } from "@Jeff-Aporta/DER/src/03-plugins/contratos/schemas.ts";
import { call } from "@Jeff-Aporta/DER/tests/_util.ts";

/** Las columnas de la entidad de prueba (la que tiene la columna oculta `secreto`). */
const COLUMNAS: Record<string, ColumnDef> = {
  id: { type: "int", pk: true, autoincrement: true },
  nombre: { type: "string", length: 60, nullable: false },
  iapp: { type: "string", length: 40, nullable: true },
  secreto: { type: "string", length: 60, nullable: true },
};

/** Plugin de prueba: una entidad publicada (con columna oculta), otra que no se publica y una ruta irregular. */
function pluginDemo(columnas: Record<string, ColumnDef>): PluginDef {
  return {
    name: "demo",
    entities: {
      cosas: {
        name: "demo.cosa",
        singular: "demo_cosa",
        plural: "demo_cosas",
        exposed: true,
        administrable: true,
        security: false,
        schema: { columns: columnas },
      },
      ocultas: {
        name: "demo.oculta",
        singular: "demo_oculta",
        plural: "demo_ocultas",
        exposed: false,
        administrable: false,
        security: false,
        schema: { columns: { id: { type: "int", pk: true } } },
      },
    },
    irregularPaths: {
      salud: { method: "GET", path: "demo/salud", security: "public", returns: "json" },
    },
  };
}

/** Un segundo plugin (para el filtro `?plugins=`). */
const otroPlugin: PluginDef = {
  name: "otro",
  entities: {
    cosas: {
      name: "otro.cosa",
      singular: "otro_cosa",
      plural: "otro_cosas",
      exposed: true,
      administrable: true,
      security: false,
      schema: { columns: { id: { type: "int", pk: true, autoincrement: true } } },
    },
  },
};

/** API de prueba: los dos plugins de datos y el de contratos, sobre SQLite en memoria. */
async function montar(columnas: Record<string, ColumnDef> = COLUMNAS, sufijo = "") {
  registry.secure(null);
  const db = sqliteDatabase();
  const base = pluginDemo(columnas);
  const demo = createServer(Obj.insert({
    ...base,
    entities: {
      ...base.entities,
      cosas: { ...base.entities!["cosas"]!, name: `demo${sufijo}.cosa`, singular: `demo${sufijo}_cosa`, plural: `demo${sufijo}_cosas` },
    },
  }, {
    entities: { cosas: { hidden: ["secreto"] } },
    irregularPaths: { salud: { handler() { return { ok: true }; } } },
  }) as unknown as ServerPluginDef, { db, cfg: {} });
  const otro = createServer(otroPlugin as unknown as ServerPluginDef, { db, cfg: {} });
  const contratos = createServer(contratosServer, { db, cfg: {} });
  const router = createRouter([], { basePath: "/api", plugins: [demo, otro, contratos] });
  await router.seed();
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { router, cerrar };
}

/** Lo que el servidor responde: el contrato del API. */
async function contratoDe(router: Parameters<typeof call>[0], filtro = ""): Promise<Contratos> {
  const res = await call(router, "GET", `contratos${filtro}`);
  assertEquals(res.status, 200, JSON.stringify(res.data));
  return res.data as Contratos;
}

Deno.test("contratos: el contrato lista las entidades montadas con su esquema y sus rutas", async () => {
  const { router, cerrar } = await montar();
  const contrato = await contratoDe(router);
  const cosas = contrato.entidades.find((e) => e.nombre === "demo.cosa");
  assert(cosas, "la entidad montada está en el contrato");
  assertEquals(cosas.singular, "demo_cosa");
  assertEquals(cosas.plural, "demo_cosas");
  assertEquals(cosas.pk, ["id"]);
  assertEquals(cosas.iapp, true, "la entidad tiene la columna iapp");
  assertEquals(cosas.publica, { list: true, get: true });
  assertEquals(cosas.rutas, {
    list: "demo_cosas",
    get: "demo_cosa/{id}",
    post: "demo_cosa",
    put: "demo_cosa/{id}",
    delete: "demo_cosa/{id}",
  });
  const props = Object.keys(cosas.esquema.properties ?? {});
  assertEquals(props.sort(), ["iapp", "id", "nombre"]);
  assert(JSON.stringify(cosas.esquema.properties?.["nombre"]).includes("string"), "el esquema dice el tipo de la columna");
  await cerrar();
});

Deno.test("contratos: no expone los campos ocultos ni las entidades que el servidor no publica", async () => {
  const { router, cerrar } = await montar();
  const contrato = await contratoDe(router);
  const cosas = contrato.entidades.find((e) => e.nombre === "demo.cosa");
  assert(cosas);
  assertEquals(Object.keys(cosas.esquema.properties ?? {}).includes("secreto"), false, "la columna oculta no sale");
  assertEquals(contrato.entidades.some((e) => e.nombre === "demo.oculta"), false, "la entidad no publicada no sale");
  await cerrar();
});

Deno.test("contratos: la versión cambia si cambia un esquema y no cambia si nada cambia", async () => {
  const uno = await montar();
  const contrato = await contratoDe(uno.router);
  const otra = await contratoDe(uno.router);
  assertEquals(contrato.version, otra.version, "el mismo servidor da la misma versión");
  assertEquals(contrato.version.length, 64, "sha256 en hexadecimal");
  await uno.cerrar();

  const dos = await montar({ ...COLUMNAS, extra: { type: "string", length: 10, nullable: true } }, "2");
  const otroContrato = await contratoDe(dos.router);
  assert(otroContrato.version !== contrato.version, "un esquema distinto da otra versión");
  await dos.cerrar();
});

Deno.test("contratos: el filtro ?plugins= acota el contrato a los plugins pedidos", async () => {
  const { router, cerrar } = await montar();
  const todo = await contratoDe(router);
  assertEquals(todo.entidades.map((e) => e.nombre).sort(), ["demo.cosa", "otro.cosa"]);
  const solo = await contratoDe(router, "?plugins=demo");
  assertEquals(solo.entidades.map((e) => e.nombre), ["demo.cosa"]);
  await cerrar();
});

/** Lo que el cliente pide: una petición registrada (con sus cabeceras). */
type Pedida = { url: string; metodo: string; cabeceras: Record<string, string> };

/** Fetch de mentira: responde por camino y deja registrado lo que se pidió. */
function fetchDe(respuestas: Record<string, unknown>): { fetch: typeof fetch; pedidas: Pedida[] } {
  const pedidas: Pedida[] = [];
  const fake = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    const cabeceras: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      cabeceras[k] = v;
    });
    pedidas.push({ url: u, metodo: init?.method ?? "GET", cabeceras });
    const camino = new URL(u).pathname;
    const cuerpo = respuestas[camino] ?? respuestas[u];
    if (cuerpo === undefined) return Promise.resolve(Response.json({ error: "sin respuesta para " + camino }, { status: 404 }));
    return Promise.resolve(Response.json(cuerpo));
  };
  return { fetch: fake as typeof fetch, pedidas };
}

/** El contrato que el cliente se descarga (a mano: aquí no hay servidor). */
function contratoFalso(): Contratos {
  const entidad: ContratoEntidad = {
    nombre: "demo.cosa",
    singular: "demo_cosa",
    plural: "demo_cosas",
    pk: ["id"],
    iapp: true,
    publica: { list: true, get: true },
    esquema: { type: "object", properties: { id: { type: "number" }, nombre: { type: "string" } } },
    rutas: { list: "demo_cosas", get: "demo_cosa/{id}", post: "demo_cosa", put: "demo_cosa/{id}", delete: "demo_cosa/{id}" },
  };
  return {
    version: "v1",
    generado: "2026-12-01T00:00:00.000Z",
    entidades: [entidad],
    rutasExtra: [{ metodo: "GET", path: "demo/salud", publica: true }],
  };
}

/** El servidor de mentira del cliente (las respuestas por camino). */
function respuestasDelCliente(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "/api/contratos": contratoFalso(),
    "/api/demo_cosas": [{ id: 1, nombre: "casa" }],
    "/api/demo_cosa/1": { id: 1, nombre: "casa" },
    ...extra,
  };
}

Deno.test("contratos: el cliente valida lo que llega y rechaza una respuesta que no cumple", async () => {
  const { fetch: fake } = fetchDe(respuestasDelCliente({ "/api/demo_cosas": [{ id: 1, nombre: 42 }] }));
  const api = clienteContratos({ servidor: "https://api.ejemplo.com/api", iapp: "riogo24", fetch: fake });
  const error = await assertRejects(() => api.listar("demo.cosa"));
  assert(error instanceof Error, "el cliente lanza un error");
  assert(error.message.includes("no cumple el contrato"), error.message);
});

Deno.test("contratos: el cliente manda siempre x-app y cachea el contrato por versión", async () => {
  const { fetch: fake, pedidas } = fetchDe(respuestasDelCliente());
  const api = clienteContratos({ servidor: "https://api.ejemplo.com/api", iapp: "riogo24", fetch: fake });
  await api.listar("demo.cosa");
  await api.ver("demo.cosa", "1");
  await api.listar("demo.cosa", { q: "casa", pagina: 1, tamano: 10 });
  assert(pedidas.length >= 3);
  for (const p of pedidas) assertEquals(p.cabeceras["x-app"], "riogo24", `x-app viaja siempre (${p.url})`);
  assertEquals(pedidas.filter((p) => p.url.endsWith("/contratos")).length, 1, "el contrato se descarga una vez");
  assert(pedidas.at(-1)?.url.includes("?q="), "la lista con filtros va en el q de DER");
});

Deno.test("contratos: el cliente hace el CRUD genérico por las rutas del contrato", async () => {
  const { fetch: fake, pedidas } = fetchDe(respuestasDelCliente({
    "/api/demo_cosa": { id: 2, nombre: "casa" },
  }));
  const api = clienteContratos({ servidor: "https://api.ejemplo.com/api", iapp: "riogo24", fetch: fake });
  const creado = await api.crear("demo.cosa", { nombre: "casa" });
  assertEquals((creado as { nombre: string }).nombre, "casa");
  await api.editar("demo.cosa", "1", { nombre: "casa nueva" });
  await api.borrar("demo.cosa", "1");
  const rutas = pedidas.map((p) => `${p.metodo} ${p.url.replace("https://api.ejemplo.com/api", "")}`);
  assertEquals(rutas, [
    "GET /contratos",
    "POST /demo_cosa",
    "PUT /demo_cosa/1",
    "DELETE /demo_cosa/1",
  ]);
});

Deno.test("contratos: el cliente llama a una ruta irregular del contrato", async () => {
  const { fetch: fake, pedidas } = fetchDe(respuestasDelCliente({ "/api/demo/salud": { ok: true } }));
  const api = clienteContratos({ servidor: "https://api.ejemplo.com/api", iapp: "riogo24", fetch: fake });
  const salud = await api.llamar("demo/salud");
  assertEquals(salud, { ok: true });
  assertEquals(pedidas[1]?.metodo, "GET", "el método sale del contrato");
});
