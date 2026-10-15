/**
 * Lado cliente estándar de los plugins (armado con ClientController): IdentityClient y PermissionsClient
 * contra el router real, importados desde la entrada de cliente (sólo zod).
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { ClientController, HttpError, ValidationError } from "../src/02 controllers/client/mod.ts";
import { IdentityClient, PermissionsClient } from "../src/03 plugins/client.ts";
import { createRouter, ServerController } from "../src/02 controllers/server/mod.ts";
import { sqliteDatabase } from "../src/02 controllers/server/sqlite/mod.ts";
import { pluginsFromConfig } from "../src/03 plugins/mod.ts";
import { Categoria, Producto } from "../examples/domain.ts";

async function setup() {
  const db = sqliteDatabase();
  const plugins = pluginsFromConfig({
    identity: { secret: "secret-de-pruebas-clientes-con-32-o-mas", iterations: 10_000, admin: { usuario: "admin", password: "admin-12345" } },
    permissions: { grupo: "API" },
  }, { db });
  const router = createRouter([
    new ServerController(Categoria, { db, table: "categorias" }),
    new ServerController(Producto, { db, table: "productos", security: true }),
  ], { basePath: "/api", plugins });
  await router.seed();
  let llamadas = 0;
  const fetchFn: typeof fetch = (input, init) => {
    llamadas++;
    return router.fetch(new Request(input, init));
  };
  return { db, fetchFn, llamadas: () => llamadas };
}

Deno.test("IdentityClient: login guarda el token, headers lo inyecta en otros controllers, logout lo revoca", async () => {
  const { db, fetchFn, llamadas } = await setup();
  try {
    const tokens: (string | null)[] = [];
    const auth = new IdentityClient({ baseUrl: "http://t/api", fetch: fetchFn, onToken: (t) => tokens.push(t) });
    const productos = new ClientController(Producto, { baseUrl: "http://t/api", fetch: fetchFn, headers: auth.headers });

    // validación local con el mismo Zod que el server: no sale la petición
    const antes = llamadas();
    await assertRejects(() => auth.login({ usuario: "admin", password: "" }), ValidationError, "contraseña");
    assertEquals(llamadas(), antes);
    await assertRejects(() => auth.login({ usuario: "admin", password: "mala-clave" }), HttpError, "inválidos");

    await assertRejects(() => productos.post({ nombre: "A", precio: 1 }), HttpError, "Requiere autenticación");
    const r = await auth.login({ usuario: "admin", password: "admin-12345" });
    assertEquals([auth.token, tokens.at(-1)], [r.token, r.token]);
    assertEquals((await productos.post({ nombre: "A", precio: 1 })).nombre, "A");

    // CRUD de usuarios con el mismo cliente
    await auth.usuarios.post({ iusuario: "ana", nombre: "Ana", password: "ana-clave-123" });
    assertEquals((await auth.usuarios.get({ iusuario: "ana" }))?.nombre, "Ana");

    const viejo = auth.token;
    await auth.logout();
    assertEquals([auth.token, tokens.at(-1)], [null, null]);
    const otro = new ClientController(Producto, {
      baseUrl: "http://t/api",
      fetch: fetchFn,
      headers: { authorization: `Bearer ${viejo}` },
    });
    await assertRejects(() => otro.post({ nombre: "B", precio: 1 }), HttpError, "Sesión cerrada");
  } finally {
    await db.destroy();
  }
});

Deno.test("PermissionsClient: perfil, carga del DER (validada en el cliente), catálogo y CRUD del DER", async () => {
  const { db, fetchFn, llamadas } = await setup();
  try {
    const auth = new IdentityClient({ baseUrl: "http://t/api", fetch: fetchFn });
    const permisos = new PermissionsClient({ baseUrl: "http://t/api", fetch: fetchFn, headers: auth.headers });
    assertEquals((await permisos.profile()).usuario, null); // anónimo
    await auth.login({ usuario: "admin", password: "admin-12345" });
    assertEquals((await permisos.profile()).irol, "ADMIN");

    const antes = llamadas();
    await assertRejects(() => permisos.load({ roles: [{ irol: "", igrupo: "API" }] }), ValidationError);
    assertEquals(llamadas(), antes);
    const res = await permisos.load({
      roles: [{ irol: "VENDEDOR", igrupo: "API" }],
      acciones: [{ irol: "VENDEDOR", iaccion: "POST:/producto", valor: true }],
    });
    assertEquals(res, { grupos: 0, roles: 1, rolesusuario: 0, acciones: 1 });
    const cat = await permisos.catalog();
    assert(cat.some((a) => a.id === "POST:/producto" && a.routes.length === 1));
    const [vendedor] = await permisos.roles.query({ where: { irol: "VENDEDOR" }, include: { acciones: true } });
    assertEquals(vendedor?.acciones.map((a) => a.iaccion), ["POST:/producto"]);
    assertEquals((await permisos.grupos.list()).map((g) => g.igrupo), ["API"]);
  } finally {
    await db.destroy();
  }
});
