/** Seguridad del lab: sesión por cabecera `x-usuario` (sin contraseña) y permisos de DER evaluados por rol en cada ruta. */
import { assert, assertEquals, assertMatch } from "@std/assert";
import { appDePrueba, at, call } from "./_setup.ts";
import { USUARIOS_SEMILLA } from "../src/security.ts";

Deno.test("sesión: sin cabecera es anónimo (401 en rutas protegidas); usuario desconocido o inactivo 401", async () => {
  const app = await appDePrueba();
  try {
    assertEquals((await call(app, "GET", "sedes", { usuario: null })).status, 401);
    assertEquals((await call(app, "GET", "sedes", { usuario: "nadie" })).status, 401);
    assertEquals((await call(app, "GET", "sedes", { usuario: "dario" })).status, 200);
    assertEquals((await call(app, "GET", "doc", { usuario: null })).status, 200);
    const publico = await call(app, "GET", "lab/usuarios", { usuario: null });
    assertEquals(publico.status, 200);
    assertEquals(publico.data.map((u: { iusuario: string }) => u.iusuario).sort(), USUARIOS_SEMILLA.map((u) => u.iusuario).sort());
    assertEquals(publico.data.find((u: { iusuario: string }) => u.iusuario === "ana").roles, ["VENDEDOR"]);
    await call(app, "PUT", "usuario/dario", { body: { bactivo: false } });
    assertEquals((await call(app, "GET", "sedes", { usuario: "dario" })).status, 401);
  } finally {
    await app.db.destroy();
  }
});

Deno.test("permisos: cada rol sólo puede lo suyo; el rol base lee todo; ADMIN todo", async () => {
  const app = await appDePrueba();
  try {
    const c = app.controllers;
    const sede = at(await c.sedes.list(), 0);
    const vendedor = at(await c.vendedores.query({ where: { id_sede: sede.id_sede } }), 0);
    const cliente = at(await c.clientes.list(), 0);
    const [cafe] = await c.productos.query({ where: { sku: "ALI-001" } });
    assert(cafe);
    const venta = { id_sede: sede.id_sede, id_vendedor: vendedor.id_vendedor, id_cliente: cliente.id_cliente, items: [{ id_producto: cafe.id_producto, cantidad: 1 }] };
    const compra = { id_sede: sede.id_sede, id_producto: cafe.id_producto, cantidad: 1 };
    // base (dario): lee, no escribe
    assertEquals((await call(app, "GET", "ventas", { usuario: "dario" })).status, 200);
    assertEquals((await call(app, "GET", "ventas/cubo", { usuario: "dario" })).status, 200);
    assertEquals((await call(app, "POST", "ventas/registrar", { usuario: "dario", body: venta })).status, 403);
    assertEquals((await call(app, "POST", "sede", { usuario: "dario", body: { nombre: "X", ciudad: "Y" } })).status, 403);
    // vendedora (ana): ventas sí, compras y catálogo no
    assertEquals((await call(app, "POST", "ventas/registrar", { usuario: "ana", body: venta })).status, 200);
    assertEquals((await call(app, "POST", "inventarios/compra", { usuario: "ana", body: compra })).status, 403);
    assertEquals((await call(app, "POST", "productos/ajuste-precios", { usuario: "ana", body: {} })).status, 403);
    assertEquals((await call(app, "PUT", `producto/${cafe.id_producto}`, { usuario: "ana", body: { nombre: "Café" } })).status, 403);
    // bodega (beto): compras y transferencias sí, ventas no
    assertEquals((await call(app, "POST", "inventarios/compra", { usuario: "beto", body: compra })).status, 200);
    assertEquals((await call(app, "POST", "ventas/registrar", { usuario: "beto", body: venta })).status, 403);
    // gerente (carla): catálogo y precios sí, ventas no
    assertEquals((await call(app, "PUT", `producto/${cafe.id_producto}`, { usuario: "carla", body: { nombre: "Café 500 g premium" } })).status, 200);
    assertEquals((await call(app, "POST", "productos/limpieza", { usuario: "carla", body: { dryRun: true } })).status, 200);
    assertEquals((await call(app, "POST", "ventas/registrar", { usuario: "carla", body: venta })).status, 403);
    assertEquals((await call(app, "POST", "usuario", { usuario: "carla", body: { iusuario: "x", password: "sin-clave-laboratorio" } })).status, 403);
    // admin: todo, incluido el CRUD de usuarios y permisos
    assertEquals((await call(app, "POST", "ventas/registrar", { usuario: "admin", body: venta })).status, 200);
    assertEquals((await call(app, "POST", "usuario", { usuario: "admin", body: { iusuario: "elena", nombre: "Elena", password: "sin-clave-laboratorio" } })).status, 201);
    assertEquals((await call(app, "POST", "permisos/rolusuario", { usuario: "admin", body: { iusuario: "elena", irol: "VENDEDOR", bprincipal: true } })).status, 201);
    assertEquals((await call(app, "POST", "ventas/registrar", { usuario: "elena", body: venta })).status, 200);
    assertEquals((await call(app, "POST", "inventarios/compra", { usuario: "elena", body: compra })).status, 403);
    // las entidades de sólo lectura no publican escrituras por CRUD (404), ni siquiera para admin
    assertEquals((await call(app, "POST", "venta", { usuario: "admin", body: {} })).status, 404);
    assertEquals((await call(app, "DELETE", "movimiento/1", { usuario: "admin" })).status, 404);
  } finally {
    await app.db.destroy();
  }
});

Deno.test("perfil: GET permisos informa rol efectivo, roles vigentes y el valor por acción (alias legibles)", async () => {
  const app = await appDePrueba();
  try {
    const ana = (await call(app, "GET", "permisos", { usuario: "ana" })).data;
    assertEquals(ana.irol, "VENDEDOR");
    assertEquals(ana.roles, ["VENDEDOR"]);
    assertEquals(ana.perms["ventas.registrar"], true);
    assertEquals(ana.perms["inventario.comprar"], false);
    // una acción compartida por varios verbos se informa por verbo
    assertEquals(ana.perms["catalogo.escribir"], { POST: false, PUT: false, DELETE: false });
    const carla = (await call(app, "GET", "permisos", { usuario: "carla" })).data;
    assertEquals(carla.perms["catalogo.escribir"], { POST: true, PUT: true, DELETE: true });
    const dario = (await call(app, "GET", "permisos", { usuario: "dario" })).data;
    assertEquals(dario.irol, "USR");
    assertEquals(dario.perms["ventas.registrar"], false);
    assertEquals(dario.perms["reportes.cubo"], true);
    const admin = (await call(app, "GET", "permisos", { usuario: "admin" })).data;
    assertEquals(admin.irol, "ADMIN");
    assertEquals(admin.perms["seguridad.administrar"], { POST: true, PUT: true, DELETE: true });
    const anonimo = (await call(app, "GET", "permisos", { usuario: null })).data;
    assertEquals(anonimo.usuario, null);
    assertEquals(anonimo.perms, {});
    // el catálogo lista las acciones con alias y sus rutas
    const catalogo = (await call(app, "GET", "permisos?catalogo=1", { usuario: "admin" })).data as { id: string; routes: unknown[] }[];
    const ids = catalogo.map((x) => x.id);
    for (const id of ["ventas.registrar", "ventas.anular", "inventario.comprar", "inventario.transferir", "catalogo.escribir", "seguridad.administrar", "reportes.ranking"]) assert(ids.includes(id), id);
    assertMatch(JSON.stringify(catalogo.find((x) => x.id === "catalogo.escribir")!.routes), /POST:\/sede/);
  } finally {
    await app.db.destroy();
  }
});
