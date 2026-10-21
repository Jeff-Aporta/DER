/**
 * Reglas finas del vector de acciones y estado del usuario: valores por verbo, comodín en el rol base, roles inactivos /
 * fuera de vigencia / de otro grupo, usuario inactivo (no inicia sesión y sus tokens dejan de servir), el valor del permiso
 * en el handler y `controller.permissions()` desde código.
 */
import { assertEquals } from "@std/assert";
import { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { decide, effectiveValue } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { CategoriaEntity, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";
import { apiConPlugins, call, identityCfg, login } from "@Jeff-Aporta/DER/tests/_util.ts";

async function setup() {
  const db = sqliteDatabase();
  const permisoVisto: unknown[] = [];
  const categorias = new ServerController(CategoriaEntity, { db, table: "categorias", security: true });
  const productos = new ServerController(ProductoEntity, {
    db,
    table: "productos",
    security: true,
    hooks: {
      preConfirm(_input, ctx) {
        permisoVisto.push(ctx.state["permiso"]);
        return null;
      },
    },
  });
  const api = await apiConPlugins(db, [categorias, productos], { identity: identityCfg(), permissions: { grupo: "API", admins: ["admin"] } });
  return { ...api, productos, permisoVisto };
}

Deno.test("reglas puras: valor por verbo, comodín y precedencia rol > base, id exacto > *", () => {
  const base = new Map<string, unknown>([["*", { protected: true }], ["X:/a", { GET: true, PUT: false }]]);
  const rol = new Map<string, unknown>([["X:/a", { PUT: { tope: 5 } }]]);
  assertEquals(effectiveValue(base, rol, "X:/a", "PUT"), { tope: 5 });
  assertEquals(effectiveValue(base, rol, "X:/a", "GET"), true); // el rol no trae GET: cae al base
  assertEquals(effectiveValue(base, null, "X:/a", "PUT"), false);
  assertEquals(effectiveValue(base, null, "Y:/b", "GET"), { protected: true }); // comodín del base
  assertEquals(decide(base, null, "Y:/b", "GET"), { allowed: true, value: true });
  assertEquals(decide(base, null, "X:/a", "PUT").allowed, false);
  assertEquals(decide(new Map(), null, "Z:/c", "GET", true).allowed, false); // denyByDefault
  assertEquals(decide(new Map([["Z:/c", "false"]]), null, "Z:/c", "GET").allowed, false); // "false" texto
});

Deno.test("permisos: por verbo vía HTTP, roles inactivos / futuros / de otro grupo no aplican, valor al handler y permissions() desde código", async () => {
  const { router, productos, permisoVisto, cerrar } = await setup();
  try {
    const admin = await login(router, "admin", "admin-12345");
    for (const u of ["ana", "beto", "caro", "dani"]) await call(router, "POST", "usuario", { token: admin, body: { iusuario: u, password: `${u}-clave-123` } });
    const manana = new Date(Date.now() + 86_400_000).toISOString();
    const carga = await call(router, "PUT", "permisos", {
      token: admin,
      body: {
        grupos: [{ igrupo: "OTRO", nombre: "Ajeno (no desciende de API)" }],
        roles: [{ irol: "EDITOR", igrupo: "API" }, { irol: "APAGADO", igrupo: "API", bactivo: false }, { irol: "AJENO", igrupo: "OTRO" }],
        rolesusuario: [{ iusuario: "ana", irol: "EDITOR", bprincipal: true }, { iusuario: "beto", irol: "APAGADO", bprincipal: true }, { iusuario: "caro", irol: "AJENO", bprincipal: true }, { iusuario: "dani", irol: "EDITOR", finicial: manana }],
        acciones: [
          { irol: "USR", iaccion: "POST:/producto", valor: false },
          { irol: "USR", iaccion: "PUT:/producto/{iproducto}", valor: { tope: 1 } },
          { irol: "EDITOR", iaccion: "POST:/producto", valor: true },
          { irol: "EDITOR", iaccion: "PUT:/producto/{iproducto}", valor: { tope: 10 } },
          { irol: "APAGADO", iaccion: "POST:/producto", valor: true },
          { irol: "AJENO", iaccion: "POST:/producto", valor: true },
        ],
      },
    });
    assertEquals(carga.status, 200);
    const tokens = Object.fromEntries(await Promise.all(["ana", "beto", "caro", "dani"].map(async (u) => [u, await login(router, u, `${u}-clave-123`)]))) as Record<string, string>;
    const crear = (u: string) => call(router, "POST", "producto", { token: tokens[u], body: { nombre: "X", precio: 1 } });
    assertEquals((await crear("ana")).status, 201);
    assertEquals((await crear("beto")).status, 403, "rol inactivo → base");
    assertEquals((await crear("caro")).status, 403, "rol de un grupo ajeno → base");
    assertEquals((await crear("dani")).status, 403, "rol que aún no inicia → base");
    assertEquals((await call(router, "GET", "permisos", { token: tokens["dani"] })).data.irol, "USR");
    permisoVisto.length = 0;
    await call(router, "PUT", "producto/1", { token: tokens["ana"], body: { precio: 2 } });
    await call(router, "PUT", "producto/1", { token: tokens["beto"], body: { precio: 3 } });
    assertEquals(permisoVisto, [{ tope: 10 }, { tope: 1 }]); // el valor efectivo llega al handler/hook
    // la misma puerta desde código, con la sesión que se le pase (id de la acción + entidad)
    const ana = await productos.permissions("PUT:/producto/{iproducto}", { session: { id: "ana" } }, { method: "PUT" });
    const beto = await productos.permissions("POST:/producto", { session: { id: "beto" } }, { method: "POST" });
    assertEquals([ana.value, beto.allowed], [{ tope: 10 }, false]);
  } finally {
    await cerrar();
  }
});

Deno.test("identidad: usuario inactivo no inicia sesión y sus tokens vigentes dejan de servir", async () => {
  const { router, cerrar } = await setup();
  try {
    const admin = await login(router, "admin", "admin-12345");
    await call(router, "POST", "usuario", { token: admin, body: { iusuario: "eva", password: "eva-clave-123" } });
    const eva = await login(router, "eva", "eva-clave-123");
    assertEquals((await call(router, "GET", "categorias", { token: eva })).status, 200);
    await call(router, "PUT", "usuario/eva", { token: admin, body: { bactivo: false } });
    const r = await call(router, "GET", "categorias", { token: eva });
    assertEquals([r.status, r.data.error], [401, "Usuario inactivo"]);
    const l = await call(router, "POST", "login", { body: { usuario: "eva", password: "eva-clave-123" } });
    assertEquals([l.status, l.data.error], [401, "Usuario o contraseña inválidos"]);
  } finally {
    await cerrar();
  }
});
