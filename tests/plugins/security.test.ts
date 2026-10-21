/**
 * Plugins de seguridad como JSON (`createServer` + `plugins` del Router): identidad (usuarios, hash, JWT, login/logout)
 * y permisos (DER grupos/roles/acciones, vector de acciones, perfil, carga). Todo por HTTP sobre el Router. También la
 * validación de la configuración (Zod, `env:`, secret corto) y la hermeticidad: identidad sin permisos y al revés.
 */
import { assert, assertEquals, assertMatch, assertNotEquals, assertThrows } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer, type Database, resolveEnv, ServerController, sql } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { identityServer, type LoginResult, permissionsServer, signJwt } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { CategoriaEntity, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";
import { CFG_TABLA } from "@Jeff-Aporta/DER/examples/backend.ts";
import { ADMIN, apiConPlugins, call, identityCfg, login, SECRET } from "@Jeff-Aporta/DER/tests/_util.ts";

function controllers(db: Database) {
  const categorias = new ServerController(CategoriaEntity, { db, table: "categorias" }); // pública
  const productos = new ServerController(ProductoEntity, { db, table: "productos", security: { public: ["list", "get", "doc"] } }); // el resto: sesión + permisos
  return [categorias, productos];
}

const setup = (cfg: Parameters<typeof apiConPlugins>[2] = { identity: { secret: "env:TEST_JWT_SECRET", iterations: 10_000, admin: ADMIN }, permissions: { grupo: "API", admins: ["admin"] }, env: { TEST_JWT_SECRET: SECRET } }) => {
  const db = sqliteDatabase();
  return apiConPlugins(db, controllers(db), cfg);
};

Deno.test("seguridad: sin plugins no aplica (skip), aunque las rutas declaren security", async () => {
  const { router, cerrar } = await setup({});
  try {
    assertEquals(registry.secured, false);
    assertEquals((await call(router, "POST", "producto", { body: { nombre: "A", precio: 1 } })).status, 201);
    assertEquals((await call(router, "DELETE", "producto/1")).status, 200);
    assertEquals((await call(router, "POST", "usuarios/login", { body: {} })).status, 404); // sin plugin no hay /login
  } finally {
    await cerrar();
  }
});

Deno.test("identidad: login/logout, rutas públicas vs protegidas y validación del token", async () => {
  const { router, cerrar } = await setup();
  try {
    const mal = await call(router, "POST", "usuarios/login", { body: { usuario: "admin", password: "otra-cosa" } });
    assertEquals([mal.status, mal.data.error], [401, "Usuario o contraseña inválidos"]);
    assertEquals((await call(router, "POST", "usuarios/login", { body: { usuario: "nadie", password: "x" } })).status, 401);
    assertEquals((await call(router, "POST", "usuarios/login", { body: { usuario: "admin" } })).status, 400);
    const ok = await call(router, "POST", "usuarios/login", { body: { usuario: "admin", password: "admin-12345" } });
    const res = ok.data as LoginResult;
    assertEquals([ok.status, res.tipo, res.usuario.iusuario], [200, "Bearer", "admin"]);
    assertMatch(res.token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
    // públicas: sin token (y un token basura en una pública no bloquea)
    assertEquals((await call(router, "GET", "productos")).status, 200);
    assertEquals((await call(router, "GET", "categorias", { token: "basura" })).status, 200);
    // protegidas
    assertEquals((await call(router, "POST", "producto", { body: { nombre: "A", precio: 1 } })).status, 401);
    const basura = await call(router, "POST", "producto", { token: "a.b.c", body: { nombre: "A", precio: 1 } });
    assertEquals(basura.status, 401);
    assertMatch(basura.data.error, /^Token inválido/);
    assertEquals((await call(router, "POST", "producto", { token: res.token, body: { nombre: "A", precio: 1 } })).status, 201);
    // logout revoca: el mismo token deja de servir
    assertEquals((await call(router, "DELETE", "usuario/logout", { token: res.token })).status, 204);
    const tras = await call(router, "POST", "producto", { token: res.token, body: { nombre: "B", precio: 1 } });
    assertEquals([tras.status, tras.data.error], [401, "Sesión cerrada o inexistente"]);
    assertEquals((await call(router, "DELETE", "usuario/logout")).status, 401);
  } finally {
    await cerrar();
  }
});

Deno.test("identidad: alg distinto de HS384, firma ajena y token vencido se rechazan con códigos distintos", async () => {
  const { router, auth, cerrar } = await setup();
  try {
    const now = Math.floor(Date.now() / 1000);
    await auth.controllers["sesiones"]!.post({ jti: "s1", iusuario: "admin", emitido: new Date(), expira: new Date() });
    const vencido = await signJwt({ sub: "admin", jti: "s1", iat: now - 100, exp: now - 10 }, SECRET);
    const r1 = await call(router, "POST", "producto", { token: vencido, body: { nombre: "A", precio: 1 } });
    assertEquals([r1.status, r1.data.error], [401, "Token vencido"]);
    const ajeno = await signJwt({ sub: "admin", jti: "s1", iat: now, exp: now + 60 }, "otra-secret-con-mas-de-32-caracteres!!");
    assertMatch((await call(router, "POST", "producto", { token: ajeno, body: {} })).data.error, /firma/);
    const [, payload] = vencido.split(".");
    const none = `${btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(/=+$/, "")}.${payload}.`;
    assertMatch((await call(router, "POST", "producto", { token: none, body: {} })).data.error, /Token inválido/);
  } finally {
    await cerrar();
  }
});

Deno.test("identidad: usuarios con hash PBKDF2+pepper, nunca expuesto ni consultable; pojos indirectos", async () => {
  const { db, router, auth, cerrar } = await setup();
  try {
    const admin = await login(router, "admin", "admin-12345");
    const alta = await call(router, "POST", "usuario", { token: admin, body: { iusuario: "ana", nombre: "Ana", password: "ana-secreta-1" } });
    assertEquals(alta.status, 201);
    assertEquals([alta.data.hash, alta.data.password], [undefined, undefined]);
    const corta = await call(router, "POST", "usuario", { token: admin, body: { iusuario: "x", password: "123" } });
    assertEquals([corta.status, corta.data.error], [400, "La contraseña debe tener al menos 8 caracteres"]);
    const got = await call(router, "GET", "usuario/ana", { token: admin });
    assertEquals(Object.keys(got.data).sort(), ["bactivo", "creado", "email", "iusuario", "jdata", "nombre"]);
    assertEquals((await call(router, "POST", "usuarios/query", { token: admin, body: { select: ["hash"] } })).status, 400);
    assertEquals((await call(router, "POST", "usuarios/query", { token: admin, body: { where: { hash: "x" } } })).status, 400);
    const { rows } = await sql<{ hash: string }>`select hash from identity_usuarios where iusuario = 'ana'`.execute(db.kysely);
    const hash = rows[0]?.hash ?? "";
    assertMatch(hash, /^pbkdf2-sha256\$10000\$[\w-]{22}\$[\w-]{43}$/);
    assert(!hash.includes("ana-secreta-1"));
    // misma contraseña → otro hash (sal aleatoria)
    await call(router, "POST", "usuario", { token: admin, body: { iusuario: "bea", password: "ana-secreta-1" } });
    const { rows: r2 } = await sql<{ hash: string }>`select hash from identity_usuarios where iusuario = 'bea'`.execute(db.kysely);
    assertNotEquals(r2[0]?.hash, hash);
    assertEquals((await call(router, "POST", "usuarios/login", { body: { usuario: "ana", password: "ana-secreta-1" } })).status, 200);
    // cambio de contraseña por PUT
    await call(router, "PUT", "usuario/ana", { token: admin, body: { password: "nueva-clave-2" } });
    assertEquals((await call(router, "POST", "usuarios/login", { body: { usuario: "ana", password: "ana-secreta-1" } })).status, 401);
    assertEquals((await call(router, "POST", "usuarios/login", { body: { usuario: "ana", password: "nueva-clave-2" } })).status, 200);
    // el plugin no expone clases: los pojos salen del controller o del registro por su plural
    const u = auth.controllers["usuarios"]!.pojo({ iusuario: "caro" });
    assertEquals([u.iusuario, registry.pojo<{ iusuario: string } & typeof u>("usuarios", { iusuario: "dani" }).iusuario], ["caro", "dani"]);
    assertEquals(registry.entity("usuarios").table, "identity_usuarios");
  } finally {
    await cerrar();
  }
});

Deno.test("permisos: carga del DER, vector por rol (base USR + rol), comodín admin, vigencia y perfil", async () => {
  const { router, cerrar } = await setup();
  try {
    const admin = await login(router, "admin", "admin-12345");
    for (const u of ["ana", "beto", "caro"]) await call(router, "POST", "usuario", { token: admin, body: { iusuario: u, password: `${u}-clave-123` } });
    const carga = await call(router, "PUT", "permisos", {
      token: admin,
      body: {
        roles: [{ irol: "VENDEDOR", igrupo: "API", nombre: "Vendedor" }],
        rolesusuario: [{ iusuario: "ana", irol: "VENDEDOR", bprincipal: true }, { iusuario: "caro", irol: "VENDEDOR", ffinal: "2000-01-01T00:00:00Z" }],
        acciones: [{ irol: "USR", iaccion: "DELETE:/producto/{iproducto}", valor: false }, { irol: "USR", iaccion: "PUT:/producto/{iproducto}", valor: false }, { irol: "VENDEDOR", iaccion: "PUT:/producto/{iproducto}", valor: { descuentoMax: 10 } }],
      },
    });
    assertEquals([carga.status, carga.data], [200, { grupos: 0, roles: 1, rolesusuario: 2, acciones: 3 }]);
    const [ana, beto, caro] = [await login(router, "ana", "ana-clave-123"), await login(router, "beto", "beto-clave-123"), await login(router, "caro", "caro-clave-123")];
    const p = (await call(router, "POST", "producto", { token: beto, body: { nombre: "A", precio: 1 } })).data;
    // PUT: USR false, VENDEDOR lo redefine (el valor viaja al handler)
    assertEquals((await call(router, "PUT", `producto/${p.iproducto}`, { token: ana, body: { precio: 2 } })).status, 200);
    const pb = await call(router, "PUT", `producto/${p.iproducto}`, { token: beto, body: { precio: 3 } });
    assertEquals([pb.status, pb.data.error], [403, "Sin permiso: PUT:/producto/{iproducto}"]);
    assertEquals((await call(router, "PUT", `producto/${p.iproducto}`, { token: caro, body: { precio: 3 } })).status, 403);
    // DELETE: false para todos salvo ADMIN ("*": true)
    assertEquals((await call(router, "DELETE", `producto/${p.iproducto}`, { token: ana })).status, 403);
    assertEquals((await call(router, "DELETE", `producto/${p.iproducto}`, { token: admin })).status, 200);
    // perfil: anónimo (público, sin perms) y del usuario (mismo cálculo que la puerta)
    assertEquals((await call(router, "GET", "permisos")).data, { usuario: null, irol: "USR", igrupo: "API", roles: [], perms: {} });
    const perfil = (await call(router, "GET", "permisos", { token: ana })).data;
    assertEquals([perfil.usuario, perfil.irol, perfil.roles], ["ana", "VENDEDOR", ["VENDEDOR"]]);
    assertEquals(perfil.perms["PUT:/producto/{iproducto}"], { descuentoMax: 10 });
    assertEquals(perfil.perms["DELETE:/producto/{iproducto}"], false);
    assertEquals(perfil.perms["POST:/producto"], true);
    assertEquals((await call(router, "GET", "permisos", { token: caro })).data.irol, "USR");
    // CRUD/list del DER y catálogo
    const roles = (await call(router, "GET", "permisos/roles", { token: admin })).data.map((r: { irol: string }) => r.irol);
    assertEquals(roles.sort(), ["ADMIN", "USR", "VENDEDOR"]);
    const cat = (await call(router, "GET", "permisos?catalogo=1", { token: admin })).data as { id: string }[];
    assert(cat.some((r) => r.id === "DELETE:/producto/{iproducto}"));
    assert(!cat.some((r) => r.id === "GET:/productos"), "las públicas no se evalúan");
    const malo = await call(router, "PUT", "permisos", { token: admin, body: { acciones: [{ irol: "USR", iaccion: "GET:/no/existe", valor: true }] } });
    assertEquals([malo.status, malo.data.error], [400, "Acciones no declaradas: GET:/no/existe"]);
    // cualquiera con USR no puede cargar si el base lo niega
    await call(router, "PUT", "permisos", { token: admin, body: { acciones: [{ irol: "USR", iaccion: "PUT:/permisos", valor: false }] } });
    assertEquals((await call(router, "PUT", "permisos", { token: beto, body: {} })).status, 403);
    // el catálogo (`?catalogo=1`) lo ve quien puede cargar el DER
    assertEquals((await call(router, "GET", "permisos?catalogo=1")).status, 401);
    assertEquals((await call(router, "GET", "permisos?catalogo=1", { token: beto })).status, 403);
    assertEquals((await call(router, "GET", "permisos?catalogo=1", { token: admin })).status, 200);
  } finally {
    await cerrar();
  }
});

Deno.test("permisos: denyByDefault y sólo identidad (sin plugin de permisos = sólo sesión)", async () => {
  const strict = await setup({ identity: identityCfg(), permissions: { grupo: "API", denyByDefault: true, admins: ["admin"] } });
  try {
    const admin = await login(strict.router, "admin", "admin-12345");
    await call(strict.router, "POST", "usuario", { token: admin, body: { iusuario: "dan", password: "dan-clave-123" } });
    const dan = await login(strict.router, "dan", "dan-clave-123");
    const r = await call(strict.router, "POST", "producto", { token: dan, body: { nombre: "A", precio: 1 } });
    assertEquals([r.status, r.data.error], [403, "Sin permiso definido: POST:/producto"]);
    assertEquals((await call(strict.router, "POST", "producto", { token: admin, body: { nombre: "A", precio: 1 } })).status, 201);
  } finally {
    await strict.cerrar();
  }
  const soloJwt = await setup({ identity: identityCfg() });
  try {
    const admin = await login(soloJwt.router, "admin", "admin-12345");
    assertEquals((await call(soloJwt.router, "DELETE", "producto/1", { token: admin })).status, 404);
    assertEquals((await call(soloJwt.router, "DELETE", "producto/1")).status, 401);
    assertEquals((await call(soloJwt.router, "GET", "permisos")).status, 404);
  } finally {
    await soloJwt.cerrar();
  }
});

Deno.test("hermeticidad: permisos con un sistema de identidad propio del consumidor (sin plugin de identidad)", async () => {
  const db = sqliteDatabase();
  registry.secure(null);
  try {
    // el consumidor define su propia extracción de sesión: `x-user` → sesión
    registry.secure({ extract: (req) => (req.headers.get("x-user") ? { id: req.headers.get("x-user")! } : null) });
    const permisos = createServer(permissionsServer, { db, cfg: { grupo: "API", admins: ["root"] } });
    const router = createRouter(controllers(db), { basePath: "/api", plugins: [permisos] });
    await router.seed();
    const as = (u: string) => ({ headers: { "x-user": u } });
    assertEquals((await call(router, "POST", "producto", { body: { nombre: "A", precio: 1 } })).status, 401);
    assertEquals((await call(router, "POST", "producto", { ...as("root"), body: { nombre: "A", precio: 1 } })).status, 201);
    await call(router, "PUT", "permisos", { ...as("root"), body: { acciones: [{ irol: "USR", iaccion: "DELETE:/producto/{iproducto}", valor: false }] } });
    assertEquals((await call(router, "DELETE", "producto/1", as("pepe"))).status, 403);
    assertEquals((await call(router, "DELETE", "producto/1", as("root"))).status, 200);
    assertEquals((await call(router, "GET", "permisos", as("root"))).data.irol, "ADMIN");
  } finally {
    registry.secure(null);
    await db.destroy();
  }
});

Deno.test("hermeticidad: identidad con un sistema de permisos propio del consumidor (sin plugin de permisos)", async () => {
  const db = sqliteDatabase();
  registry.secure(null);
  try {
    const vistos: string[] = [];
    registry.secure({ permissions: (info, action) => { vistos.push(`${info?.id}:${action}`); return { allowed: action !== "DELETE:/producto/{iproducto}", value: "ok" }; } });
    const auth = createServer(identityServer, { db, cfg: identityCfg() });
    const router = createRouter(controllers(db), { basePath: "/api", plugins: [auth] });
    await router.seed();
    const admin = await login(router, "admin", "admin-12345");
    assertEquals((await call(router, "POST", "producto", { token: admin, body: { nombre: "A", precio: 1 } })).status, 201);
    assertEquals((await call(router, "DELETE", "producto/1", { token: admin })).status, 403);
    assertEquals(vistos, ["admin:POST:/producto", "admin:DELETE:/producto/{iproducto}"]);
  } finally {
    registry.secure(null);
    await db.destroy();
  }
});

Deno.test("seguridad: /doc es pública por defecto (contexto para agentes), salvo que se proteja explícitamente", async () => {
  const db = sqliteDatabase();
  const ctrls = [new ServerController(CategoriaEntity, { db, table: "categorias", security: true }), new ServerController(ProductoEntity, { db, table: "productos", security: { protected: ["post", "doc"] } })];
  const { router, cerrar } = await apiConPlugins(db, ctrls, { identity: identityCfg(), permissions: { grupo: "API", admins: ["admin"] } });
  try {
    const doc = (p: string) => router.fetch(new Request(`http://t/api/${p}`)); // markdown, no JSON
    assertEquals((await doc("categorias/doc")).status, 200);
    assertEquals((await call(router, "GET", "categorias")).status, 401);
    assertEquals((await doc("productos/doc")).status, 401); // protegida a propósito
  } finally {
    await cerrar();
  }
});

Deno.test("config: JSON inválido, env ausente, secret corto, env del runtime y resolveEnv", () => {
  const db = sqliteDatabase();
  registry.secure(null);
  try {
    assertThrows(() => createServer(identityServer, { db, cfg: { secret: "x".repeat(40), extra: 1 } }), Error, "inválida");
    assertThrows(() => createServer(identityServer, { db, cfg: { secret: "env:NO_EXISTE_ESTA_VAR" } }), Error, "NO_EXISTE_ESTA_VAR");
    assertThrows(() => createServer(identityServer, { db, cfg: { secret: "corta" } }), Error, "32");
    assertThrows(() => createServer(identityServer, { db, cfg: { secret: SECRET, security: { maxAttempts: 0 } } }));
    assertThrows(() => createServer(identityServer, { db, cfg: { secret: SECRET, security: { password: { minLength: 4 } } } }));
    assertEquals(resolveEnv("env:MI_VAR", { MI_VAR: "valor" }), "valor");
    assertEquals(resolveEnv("literal"), "literal");
    const ok = createServer(identityServer, { db, cfg: { secret: "env:S", security: { maxAttempts: 3, travel: { enabled: true, minMinutes: 10 } } }, env: { S: SECRET } });
    assertEquals([ok.cfg["secret"], ok.state["maxAttempts"], ok.list.length], [SECRET, 3, 4]);
  } finally {
    db.destroy();
    registry.secure(null);
  }
});

Deno.test("permisos: un rol particular no repite el valor del rol base; aliases renombran lo que se quema en la BD; cfg es una sola acción", async () => {
  const db = sqliteDatabase(":memory:", { cfg: CFG_TABLA });
  const productos = new ServerController(ProductoEntity, { db, table: "productos", security: true });
  const { router, cerrar } = await apiConPlugins(db, [new ServerController(CategoriaEntity, { db, table: "categorias" }), productos], { identity: identityCfg(), permissions: { grupo: "API", rolBase: "BASE", admins: ["admin"], aliases: { "DELETE:/producto/{iproducto}": "productos.borrar", "CFG:/productos": "productos.config" } } });
  try {
    const admin = await login(router, "admin", "admin-12345");
    await call(router, "POST", "usuario", { token: admin, body: { iusuario: "ana", password: "ana-clave-123" } });
    // el id de la ruta ya no existe en la BD: se carga por su alias; el base se llama BASE
    const malo = await call(router, "PUT", "permisos", { token: admin, body: { acciones: [{ irol: "BASE", iaccion: "DELETE:/producto/{iproducto}", valor: false }] } });
    assertEquals([malo.status, malo.data.error], [400, "Acciones no declaradas: DELETE:/producto/{iproducto}"]);
    const ok = await call(router, "PUT", "permisos", { token: admin, body: { roles: [{ irol: "EDITOR", igrupo: "API" }], rolesusuario: [{ iusuario: "ana", irol: "EDITOR", bprincipal: true }], acciones: [{ irol: "BASE", iaccion: "productos.borrar", valor: false }, { irol: "EDITOR", iaccion: "productos.borrar", valor: true }] } });
    assertEquals(ok.status, 200);
    // repetir en un rol el valor del base se rechaza
    const rep = await call(router, "PUT", "permisos", { token: admin, body: { acciones: [{ irol: "EDITOR", iaccion: "productos.borrar", valor: false }] } });
    assertEquals([rep.status, rep.data.error], [400, "Acciones que repiten el valor del rol base BASE: EDITOR:productos.borrar"]);
    const ana = await login(router, "ana", "ana-clave-123");
    const p = (await call(router, "POST", "producto", { token: admin, body: { nombre: "A", precio: 1 } })).data;
    assertEquals((await call(router, "DELETE", `producto/${p.iproducto}`, { token: ana })).status, 200);
    assertEquals((await call(router, "GET", "permisos")).data.irol, "BASE");
    // cfg: GET y PUT comparten una acción (CFG:/productos → alias productos.config) en el catálogo
    const cat = (await call(router, "GET", "permisos?catalogo=1", { token: admin })).data as { id: string; routes: { method: string }[] }[];
    assertEquals(cat.find((a) => a.id === "productos.config")?.routes.map((r) => r.method).sort(), ["GET", "PUT"]);
    assert(cat.some((a) => a.id === "productos.borrar"));
  } finally {
    await cerrar();
  }
});
