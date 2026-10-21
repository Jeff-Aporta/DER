/**
 * Lado cliente de los plugins JSON (`createClient`): identidad y permisos contra el router real, importados desde la
 * entrada de cliente (sólo zod). Un `ClientController` por entidad, `call()` de las irregulares y las `ops`.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { ClientController, HttpError, ValidationError } from "@Jeff-Aporta/DER/src/02-controllers/client/index.ts";
import { createClient, identity, permissions } from "@Jeff-Aporta/DER/src/03-plugins/client.ts";
import { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { CategoriaEntity, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";
import { apiConPlugins, identityCfg } from "@Jeff-Aporta/DER/tests/_util.ts";

async function setup() {
  const db = sqliteDatabase();
  const ctrls = [new ServerController(CategoriaEntity, { db, table: "categorias" }), new ServerController(ProductoEntity, { db, table: "productos", security: true })];
  const api = await apiConPlugins(db, ctrls, { identity: identityCfg(), permissions: { grupo: "API", admins: ["admin"] } });
  let llamadas = 0;
  const fetchFn: typeof fetch = (input, init) => {
    llamadas++;
    return api.router.fetch(new Request(input, init));
  };
  return { ...api, fetchFn, llamadas: () => llamadas };
}

Deno.test("identity: login guarda el token, headers lo inyecta en otros controllers, logout lo revoca", async () => {
  const { fetchFn, llamadas, cerrar } = await setup();
  try {
    const tokens: (string | null)[] = [];
    const auth = createClient(identity, { baseUrl: "http://t/api", fetch: fetchFn, onToken: (t) => tokens.push(t) });
    const productos = new ClientController(ProductoEntity, { baseUrl: "http://t/api", fetch: fetchFn, headers: auth.headers });
    // validación local con el mismo Zod que el server: no sale la petición
    const antes = llamadas();
    await assertRejects(() => auth["login"]({ usuario: "admin", password: "" }), ValidationError, "contraseña");
    assertEquals(llamadas(), antes);
    await assertRejects(() => auth["login"]({ usuario: "admin", password: "mala-clave" }), HttpError, "inválidos");
    await assertRejects(() => productos.post({ nombre: "A", precio: 1 }), HttpError, "Requiere autenticación");
    const r = await auth["login"]({ usuario: "admin", password: "admin-12345" });
    assertEquals([auth.token, tokens.at(-1)], [r.token, r.token]);
    assertEquals((await productos.post({ nombre: "A", precio: 1 })).nombre, "A");
    // CRUD de usuarios con el mismo cliente (controllers por clave del JSON; pojos indirectos)
    const usuarios = auth.controllers["usuarios"]!;
    await usuarios.post(usuarios.pojo({ iusuario: "ana", nombre: "Ana", password: "ana-clave-123" }));
    assertEquals((await usuarios.get({ iusuario: "ana" }))?.nombre, "Ana");
    const viejo = auth.token;
    await auth["logout"]();
    assertEquals([auth.token, tokens.at(-1)], [null, null]);
    const otro = new ClientController(ProductoEntity, { baseUrl: "http://t/api", fetch: fetchFn, headers: { authorization: `Bearer ${viejo}` } });
    await assertRejects(() => otro.post({ nombre: "B", precio: 1 }), HttpError, "Sesión cerrada");
  } finally {
    await cerrar();
  }
});

Deno.test("permissions: perfil, carga del DER (validada en el cliente), catálogo y CRUD del DER", async () => {
  const { fetchFn, llamadas, cerrar } = await setup();
  try {
    const auth = createClient(identity, { baseUrl: "http://t/api", fetch: fetchFn });
    const permisos = createClient(permissions, { baseUrl: "http://t/api", fetch: fetchFn, headers: auth.headers });
    assertEquals((await permisos["profile"]()).usuario, null); // anónimo
    await auth["login"]({ usuario: "admin", password: "admin-12345" });
    assertEquals((await permisos["profile"]()).irol, "ADMIN");
    const antes = llamadas();
    await assertRejects(() => permisos["load"]({ roles: [{ irol: "", igrupo: "API" }] }), ValidationError);
    assertEquals(llamadas(), antes);
    const res = await permisos["load"]({ roles: [{ irol: "VENDEDOR", igrupo: "API" }], acciones: [{ irol: "VENDEDOR", iaccion: "POST:/producto", valor: true }] });
    assertEquals(res, { grupos: 0, roles: 1, rolesusuario: 0, acciones: 1 });
    const cat = await permisos["catalog"]();
    assert(cat.some((a: { id: string; routes: unknown[] }) => a.id === "POST:/producto" && a.routes.length === 1));
    const [vendedor] = await permisos.controllers["roles"]!.query({ where: { irol: "VENDEDOR" }, include: { acciones: true } });
    assertEquals(vendedor?.acciones.map((a: { iaccion: string }) => a.iaccion), ["POST:/producto"]);
    assertEquals((await permisos.controllers["grupos"]!.list()).map((g) => g.igrupo), ["API"]);
    // la relación `usuario` apunta a la entidad de identidad (si está registrada): la asignación trae su usuario (sin hash)
    const [asignacion] = await permisos.controllers["rolesUsuario"]!.query({ where: { iusuario: "admin" }, include: { usuario: true } });
    assertEquals([asignacion?.irol, asignacion?.usuario?.iusuario, asignacion?.usuario?.hash], ["ADMIN", "admin", undefined]);
  } finally {
    await cerrar();
  }
});
