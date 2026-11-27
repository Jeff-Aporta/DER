/**
 * Pruebas de caja negra del plugin de apps sobre el router real: el aislamiento por `iapp` (la cabecera `X-App`), la vista
 * publica (sin datos internos), el permiso `apps.administrar` y la purga en cascada de una app demo.
 */
import { assert, assertEquals } from "@std/assert";
import { HttpError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { defineEntity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer, ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { ambitoApp, crearApps } from "@Jeff-Aporta/DER/src/03-plugins/apps/server.ts";
import type { App, AppPublica } from "@Jeff-Aporta/DER/src/03-plugins/apps/schemas.ts";
import { identityServer } from "@Jeff-Aporta/DER/src/03-plugins/identity/server.ts";
import { permissionsServer } from "@Jeff-Aporta/DER/src/03-plugins/permissions/server.ts";
import { call, identityCfg, login } from "@Jeff-Aporta/DER/tests/_util.ts";

/** Una entidad de datos con `iapp` (como las de catalogo o pagos) para probar la purga en cascada. */
const entidadDatos = defineEntity({
  name: "prueba.dato",
  singular: "prueba_dato",
  plural: "prueba_datos",
  schema: {
    columns: {
      id: { type: "string", pk: true, length: 40 },
      iapp: { type: "string", length: 40, nullable: false },
      dato: { type: "string", length: 40, nullable: false },
    },
  },
});

/** El error de una llamada que debe fallar (con su status HTTP). */
async function falla(fn: () => Promise<unknown>): Promise<HttpError> {
  try {
    await fn();
  } catch (e) {
    return e as HttpError;
  }
  throw new Error("La llamada deberia haber fallado");
}

/** Sesion sin JWT: `x-usuario` dice quien es; `x-empresa` en que empresa actua (el ambito de app va en `x-app`). */
function sesionDe(req: Request): { id: string; claims: Record<string, unknown> } | null {
  const usuario = req.headers.get("x-usuario");
  if (!usuario) return null;
  return { id: usuario, claims: { iempresa: req.headers.get("x-empresa") ?? "" } };
}

/** Cabeceras de la peticion: usuario, empresa y (opcional) el ambito de app. */
const como = (usuario: string, empresa = "", app = "") => {
  const headers: Record<string, string> = { "x-usuario": usuario };
  if (empresa) headers["x-empresa"] = empresa;
  if (app) headers["x-app"] = app;
  return headers;
};

/** API con el plugin de apps sobre SQLite en memoria (las puertas del registro son las de la sesion simple). */
async function montar() {
  registry.secure(null);
  const db = sqliteDatabase();
  const apps = crearApps({ db, cfg: {} });
  const datos = new ServerController(entidadDatos, { db });
  const router = createRouter([], { basePath: "/api", plugins: [apps] });
  registry.secure({ extract: sesionDe });
  await router.seed();
  await datos.seed();
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { router, db, apps, datos, cerrar };
}

/** API con identidad, permisos y apps (el permiso `apps.administrar` se decide de verdad). */
async function montarConPermisos() {
  registry.secure(null);
  const db = sqliteDatabase();
  const auth = createServer(identityServer, { db, cfg: identityCfg() });
  const permisos = createServer(permissionsServer, { db, cfg: { grupo: "API", admins: ["admin"] } });
  const apps = crearApps({ db, cfg: {} });
  const router = createRouter([], { basePath: "/api", plugins: [auth, permisos, apps] });
  await router.seed();
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { router, db, apps, cerrar };
}

/** Crea una app y falla el test si la respuesta no es 200. */
async function crear(router: Awaited<ReturnType<typeof montar>>["router"], body: Record<string, unknown>): Promise<App> {
  const r = await call(router, "POST", "apps", { body, headers: como("ana", "acme") });
  assertEquals(r.status, 200, JSON.stringify(r.data));
  return r.data as App;
}

Deno.test("apps: la cabecera X-App aisla (una consulta con x-app A nunca ve filas de B)", async () => {
  const { router, cerrar } = await montar();
  await crear(router, { iapp: "riogo24", nombre: "Rio Go 24", modo: "restaurante", iempresa: "acme" });
  await crear(router, { iapp: "hotel-bogota", nombre: "Hotel Bogota", modo: "hotel", iempresa: "acme" });
  await crear(router, { iapp: "tienda-x", nombre: "Tienda X", modo: "tienda", iempresa: "otra" });
  const deA = await call(router, "GET", "apps", { headers: como("ana", "acme", "riogo24") });
  assertEquals(deA.status, 200, JSON.stringify(deA.data));
  assertEquals((deA.data as App[]).map((x) => x.iapp), ["riogo24"], "con x-app solo se ve esa app");
  const deB = await call(router, "GET", "apps", { headers: como("ana", "acme", "hotel-bogota") });
  assertEquals((deB.data as App[]).map((x) => x.iapp), ["hotel-bogota"], "con x-app de otra app, la otra");
  const deOtra = await call(router, "GET", "apps", { headers: como("ana", "otra", "tienda-x") });
  assertEquals((deOtra.data as App[]).map((x) => x.iapp), ["tienda-x"]);
  const deEmpresa = await call(router, "GET", "apps", { headers: como("ana", "acme") });
  assertEquals((deEmpresa.data as App[]).map((x) => x.iapp).sort(), ["hotel-bogota", "riogo24"], "sin x-app, las apps de la empresa");
  const instalador = await call(router, "GET", "apps", { headers: como("ana") });
  assertEquals((instalador.data as App[]).length, 3, "sin ambito ni empresa, el instalador ve todas");
  const filtrada = await call(router, "GET", "apps?modo=hotel", { headers: como("ana", "acme") });
  assertEquals((filtrada.data as App[]).map((x) => x.iapp), ["hotel-bogota"]);
  await cerrar();
});

Deno.test("apps: la publica no filtra datos internos (ni empresa, ni demo, ni creacion, ni la clave)", async () => {
  const { router, cerrar } = await montar();
  await crear(router, {
    iapp: "riogo24",
    nombre: "Rio Go 24",
    modo: "restaurante",
    iempresa: "acme",
    bdemo: true,
    soporte_wa: true,
    contacto_wa: "+573001112233",
    servidor: "https://api.example.com",
    marca: { colores: ["#ff0000"], logo: "https://x/logo.png", favicon: "https://x/fav.png" },
  });
  const r = await call(router, "GET", "apps/riogo24/publica");
  assertEquals(r.status, 200, JSON.stringify(r.data));
  const publica = r.data as AppPublica;
  assertEquals(Object.keys(publica).sort(), ["contacto_wa", "marca", "modo", "nombre", "servidor"], "solo lo publico");
  assertEquals(publica.nombre, "Rio Go 24");
  assertEquals(publica.modo, "restaurante");
  assertEquals(publica.servidor, "https://api.example.com");
  assertEquals(publica.contacto_wa, "+573001112233");
  assertEquals(publica.marca?.colores, ["#ff0000"]);
  assertEquals(publica.marca?.logo, "https://x/logo.png");
  assert(!("iempresa" in publica), "no filtra la empresa");
  assert(!("bdemo" in publica), "no filtra si es demo");
  assert(!("fhcre" in publica), "no filtra la fecha de creacion");
  assert(!("iapp" in publica), "no filtra la clave");
  assert(!("soporte_wa" in publica), "no filtra el soporte de WhatsApp");
  const inexistente = await call(router, "GET", "apps/no-existe/publica");
  assertEquals(inexistente.status, 404);
  await cerrar();
});

Deno.test("apps: el permiso apps.administrar protege la lista, el alta y el cambio (la publica no)", async () => {
  const { router, cerrar } = await montarConPermisos();
  const admin = await login(router, "admin", "admin-12345");
  await call(router, "POST", "usuario", { token: admin, body: { iusuario: "carla", password: "carla-clave-123" } });
  const carla = await login(router, "carla", "carla-clave-123");
  const carga = await call(router, "PUT", "permisos", { token: admin, body: { acciones: [{ irol: "USR", iaccion: "apps.administrar", valor: false }] } });
  assertEquals(carga.status, 200, JSON.stringify(carga.data));
  assertEquals((await call(router, "GET", "apps", { token: carla })).status, 403, "la lista exige apps.administrar");
  assertEquals((await call(router, "POST", "apps", { token: carla, body: { nombre: "X", modo: "tienda" } })).status, 403, "el alta exige apps.administrar");
  assertEquals((await call(router, "PUT", "apps/riogo24", { token: carla, body: { nombre: "Y" } })).status, 403, "el cambio exige apps.administrar");
  assertEquals((await call(router, "GET", "apps", { token: admin })).status, 200, "el administrador si puede");
  const publica = await call(router, "GET", "apps/riogo24/publica");
  assertEquals(publica.status, 404, "la publica es publica (la app no existe todavia)");
  const conRol = await call(router, "PUT", "permisos", {
    token: admin,
    body: {
      roles: [{ irol: "JEFE", igrupo: "API" }],
      rolesusuario: [{ iusuario: "carla", irol: "JEFE", bprincipal: true }],
      acciones: [{ irol: "JEFE", iaccion: "apps.administrar", valor: true }],
    },
  });
  assertEquals(conRol.status, 200, JSON.stringify(conRol.data));
  assertEquals((await call(router, "GET", "apps", { token: carla })).status, 200, "con la accion en su rol, ya puede");
  await cerrar();
});

Deno.test("apps: alta (el iapp se deduce del nombre), cambio y conflicto de iapp", async () => {
  const { router, cerrar } = await montar();
  const alta = await call(router, "POST", "apps", { body: { nombre: "Rio Go 24", modo: "restaurante", iempresa: "acme", marca: { colores: ["#fff"] } }, headers: como("ana", "acme") });
  assertEquals(alta.status, 200, JSON.stringify(alta.data));
  const app = alta.data as App;
  assertEquals(app.iapp, "rio-go-24", "el iapp se deduce del nombre");
  assertEquals(app.nombre, "Rio Go 24");
  assertEquals(app.modo, "restaurante");
  assertEquals(app.bdemo, false);
  assertEquals(app.soporte_wa, false);
  assertEquals(app.marca?.colores, ["#fff"]);
  assert(app.fhcre, "pone la fecha de creacion");
  const repetido = await call(router, "POST", "apps", { body: { iapp: "rio-go-24", nombre: "Otro", modo: "tienda" }, headers: como("ana", "acme") });
  assertEquals(repetido.status, 409, "el iapp es unico");
  const modoMalo = await call(router, "POST", "apps", { body: { nombre: "Zapateria", modo: "zapato" }, headers: como("ana", "acme") });
  assertEquals(modoMalo.status, 400, "el modo es uno de los cinco");
  const cambio = await call(router, "PUT", "apps/rio-go-24", { body: { nombre: "Rio Go 24 SAS", modo: "tienda", bdemo: true }, headers: como("ana", "acme") });
  assertEquals(cambio.status, 200, JSON.stringify(cambio.data));
  assertEquals((cambio.data as App).nombre, "Rio Go 24 SAS");
  assertEquals((cambio.data as App).modo, "tienda");
  assertEquals((cambio.data as App).bdemo, true);
  assertEquals((cambio.data as App).iapp, "rio-go-24", "el iapp no cambia");
  const porCuerpo = await call(router, "PUT", "apps", { body: { iapp: "rio-go-24", contacto_wa: "+573001112233" }, headers: como("ana", "acme") });
  assertEquals(porCuerpo.status, 200, JSON.stringify(porCuerpo.data));
  assertEquals((porCuerpo.data as App).contacto_wa, "+573001112233");
  assertEquals((porCuerpo.data as App).nombre, "Rio Go 24 SAS", "lo que no viene no se toca");
  assertEquals((await call(router, "GET", "apps")).status, 401, "la lista exige sesion");
  await cerrar();
});

Deno.test("apps: la purga borra las filas de la app demo y solo las suyas", async () => {
  const { router, apps, datos, cerrar } = await montar();
  await crear(router, { iapp: "demo-a", nombre: "Demo A", modo: "tienda", bdemo: true });
  await crear(router, { iapp: "demo-b", nombre: "Demo B", modo: "hotel" });
  // datos de cada app (como las tablas de catalogo o pagos)
  await datos.post(datos.pojo({ id: "1", iapp: "demo-a", dato: "uno" }));
  await datos.post(datos.pojo({ id: "2", iapp: "demo-a", dato: "dos" }));
  await datos.post(datos.pojo({ id: "3", iapp: "demo-b", dato: "tres" }));
  const purga = await apps.purgarApp("demo-a", ["prueba_datos"]);
  assertEquals(purga.total, 2, "borra todas las filas de la app");
  assertEquals(purga.tablas.length, 1);
  const quedan = await datos.query({ where: { iapp: "demo-b" } } as never);
  assertEquals(quedan.length, 1, "las filas de otra app no se tocan");
  assertEquals(quedan[0]?.dato, "tres");
  const sinForzar = await falla(() => apps.purgarApp("demo-b", ["prueba_datos"]));
  assertEquals(sinForzar.status, 403, "una app que no es demo no se purga sin forzar");
  const conForzar = await apps.purgarApp("demo-b", ["prueba_datos"], { forzar: true });
  assertEquals(conForzar.total, 1);
  assertEquals((await datos.query({ where: {} } as never)).length, 0);
  const inexistente = await falla(() => apps.purgarApp("no-existe", ["prueba_datos"]));
  assertEquals(inexistente.status, 404);
  const tablaAjena = await falla(() => apps.purgarApp("demo-a", ["tabla_que_no_existe"]));
  assertEquals(tablaAjena.status, 400, "una tabla que no administra ningun controller de esta base");
  await cerrar();
});

Deno.test("apps: la purga con la tabla de apps borra tambien la app (el clon se removible)", async () => {
  const { router, apps, cerrar } = await montar();
  await crear(router, { iapp: "demo-a", nombre: "Demo A", modo: "tienda", bdemo: true });
  const purga = await apps.purgarApp("demo-a", ["apps_apps"]);
  assertEquals(purga.total, 1);
  assertEquals((await call(router, "GET", "apps/demo-a/publica")).status, 404, "la fila de la app se borro");
  await cerrar();
});

Deno.test("apps: ambitoApp resuelve la cabecera, luego la sesion, y da 400 si no hay ambito", async () => {
  assertEquals(ambitoApp({ request: new Request("http://x/api/apps", { headers: { "x-app": "riogo24" } }) }), "riogo24");
  assertEquals(ambitoApp({ session: { id: "ana", claims: { iapp: "hotel-x" } } }), "hotel-x");
  assertEquals(ambitoApp({ request: new Request("http://x/api/apps", { headers: { "x-app": "riogo24" } }), session: { id: "ana", claims: { iapp: "hotel-x" } } }), "riogo24", "la cabecera manda");
  const error = await falla(async () => ambitoApp({}));
  assertEquals(error.status, 400);
  assert(error.message.includes("X-APP"), "el error dice que cabecera falta");
});
