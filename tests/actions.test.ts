/**
 * Acciones de seguridad personalizadas en los registros (no sólo los ids autogenerados de las rutas):
 * por acción/endpoint del controller, compartidas entre rutas y partidas por verbo, en rutas irregulares y
 * capacidades sólo de código (`ctx.state.can`). Catálogo, perfil y carga del DER usan esos ids.
 */
import { assert, assertEquals } from "@std/assert";
import { type CanFn, createRouter, type Router, ServerController } from "@Jeff-Aporta/DER/src/02 controllers/server/mod.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02 controllers/server/sqlite/mod.ts";
import { pluginsFromConfig } from "@Jeff-Aporta/DER/src/03 plugins/mod.ts";
import { CategoriaEntity, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";
import { CFG_TABLA } from "@Jeff-Aporta/DER/examples/backend.ts";

const SECRET = "secret-de-pruebas-de-acciones-con-32-o-mas";

function controllers(db: ReturnType<typeof sqliteDatabase>) {
  const categorias = new ServerController(CategoriaEntity, { db, table: "categorias" });
  const productos = new ServerController(ProductoEntity, {
    db,
    table: "productos",
    security: {
      public: ["list", "get", "doc"],
      actions: {
        delete: "productos.eliminar",
        put: "productos.editar",
        putList: "productos.editar",
        getCfg: "productos.config", // un solo id para leer y escribir la config (como CFG:/ de ISS)
        putCfg: "productos.config",
      },
    },
    routes: [{
      method: "GET",
      path: "reportes/ventas",
      security: { protected: true, permissions: true, action: "reportes.ver" },
      async handler(_input, ctx) {
        const can = ctx.state["can"] as CanFn;
        return { auditoria: (await can("auditoria")).allowed }; // capacidad sólo de código
      },
    }],
  });
  return [categorias, productos];
}

async function setup() {
  const db = sqliteDatabase(":memory:", { cfg: CFG_TABLA });
  const plugins = pluginsFromConfig({
    identity: { secret: SECRET, iterations: 10_000, admin: { usuario: "admin", password: "admin-12345" } },
    permissions: { grupo: "API", actions: ["auditoria"] },
  }, { db });
  const router = createRouter(controllers(db), { basePath: "/api", plugins });
  await router.seed();
  return { db, router };
}

async function call(router: Router, method: string, path: string, opts: { token?: string | undefined; body?: unknown } = {}) {
  const res = await router.fetch(
    new Request(`http://t/api/${path}`, {
      method,
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    }),
  );
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : undefined };
}

const login = async (router: Router, u: string, p: string) =>
  (await call(router, "POST", "login", { body: { usuario: u, password: p } })).data.token as string;

Deno.test("acciones personalizadas: compartidas, partidas por verbo, en rutas irregulares y sólo de código", async () => {
  const { db, router } = await setup();
  try {
    const admin = await login(router, "admin", "admin-12345");
    for (const u of ["base", "sup"]) {
      await call(router, "POST", "usuario", { token: admin, body: { iusuario: u, password: `${u}-clave-123` } });
    }
    const carga = await call(router, "PUT", "permisos", {
      token: admin,
      body: {
        roles: [{ irol: "SUPERVISOR", igrupo: "API" }],
        rolesusuario: [{ iusuario: "sup", irol: "SUPERVISOR", bprincipal: true }],
        acciones: [
          { irol: "USR", iaccion: "productos.eliminar", valor: false },
          { irol: "USR", iaccion: "productos.config", valor: { GET: true, PUT: false } },
          { irol: "USR", iaccion: "reportes.ver", valor: false },
          { irol: "USR", iaccion: "auditoria", valor: false },
          { irol: "SUPERVISOR", iaccion: "productos.eliminar", valor: true },
          { irol: "SUPERVISOR", iaccion: "productos.config", valor: { PUT: true } }, // GET cae al base
          { irol: "SUPERVISOR", iaccion: "reportes.ver", valor: true },
          { irol: "SUPERVISOR", iaccion: "auditoria", valor: true },
        ],
      },
    });
    assertEquals(carga.status, 200);
    const base = await login(router, "base", "base-clave-123");
    const sup = await login(router, "sup", "sup-clave-123");
    const p = (await call(router, "POST", "producto", { token: base, body: { nombre: "A", precio: 1 } })).data;

    // delete vinculado a "productos.eliminar"
    const del = await call(router, "DELETE", `producto/${p.iproducto}`, { token: base });
    assertEquals([del.status, del.data.error], [403, "Sin permiso: productos.eliminar"]);
    // config: un id para GET y PUT, partido por verbo
    assertEquals((await call(router, "GET", "productos/cfg", { token: base })).status, 200);
    assertEquals((await call(router, "PUT", "productos/cfg", { token: base, body: { stockMinimo: 3 } })).status, 403);
    assertEquals((await call(router, "PUT", "productos/cfg", { token: sup, body: { stockMinimo: 3 } })).status, 200);
    assertEquals((await call(router, "GET", "productos/cfg", { token: sup })).status, 200);
    // ruta irregular con su acción + capacidad sólo de código
    assertEquals((await call(router, "GET", "reportes/ventas", { token: base })).status, 403);
    assertEquals((await call(router, "GET", "reportes/ventas", { token: sup })).data, { auditoria: true });
    assertEquals((await call(router, "DELETE", `producto/${p.iproducto}`, { token: sup })).status, 200);

    // catálogo: ids personalizados (con sus rutas) y capacidades sin ruta; el autogenerado reemplazado no aparece
    const cat = (await call(router, "GET", "permisos?catalogo=1", { token: admin })).data as { id: string; routes: unknown[] }[];
    const byId = new Map(cat.map((a) => [a.id, a.routes.length]));
    assertEquals([byId.get("productos.config"), byId.get("productos.editar"), byId.get("auditoria")], [2, 2, 0]);
    assert(!byId.has("DELETE:/producto/{iproducto}"));
    assert(byId.has("POST:/producto")); // los no personalizados siguen con su id autogenerado
    // perfil: la acción compartida por verbos se informa por verbo
    const perfilBase = (await call(router, "GET", "permisos", { token: base })).data.perms;
    const perfilSup = (await call(router, "GET", "permisos", { token: sup })).data.perms;
    assertEquals(perfilBase["productos.config"], { GET: true, PUT: false });
    assertEquals(perfilSup["productos.config"], { GET: true, PUT: true });
    assertEquals([perfilBase["auditoria"], perfilSup["auditoria"]], [false, true]);
    // carga: un id que no está declarado (ni ruta ni capacidad) se rechaza
    const mala = await call(router, "PUT", "permisos", {
      token: admin,
      body: { acciones: [{ irol: "USR", iaccion: "DELETE:/producto/{iproducto}", valor: true }] },
    });
    assertEquals([mala.status, mala.data.error], [400, "Acciones no declaradas: DELETE:/producto/{iproducto}"]);
  } finally {
    await db.destroy();
  }
});

Deno.test("acciones personalizadas sin plugins: se omiten y `can` permite (seguridad en skip)", async () => {
  const db = sqliteDatabase();
  try {
    const router = createRouter(controllers(db), { basePath: "/api" });
    await router.seed();
    assertEquals((await call(router, "GET", "reportes/ventas")).data, { auditoria: true });
    assertEquals((await call(router, "DELETE", "producto/1")).status, 404);
  } finally {
    await db.destroy();
  }
});
