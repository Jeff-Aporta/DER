/**
 * Tests del plugin de permisos RBAC: el catalogo y los roles viven en la BASE y el codigo solo comprueba acciones.
 *
 *   P-RBAC-01 semilla: catalogo de acciones, roles base y matriz por defecto
 *   P-RBAC-02 (a) cambiar una celda de la matriz cambia el comportamiento sin tocar codigo
 *   P-RBAC-03 (b) un rol nuevo creado en la base funciona (y se asigna sin desplegar)
 *   P-RBAC-04 (c) WRKR solo ve tiquetes
 *   P-RBAC-05 (d) aislamiento por empresa (los roles de una empresa no aplican en otra)
 *   P-RBAC-06 (e) mis permisos coincide con la matriz del rol
 *   P-RBAC-07 protecciones: rol de sistema no se borra, sin escalada de privilegios
 *   P-RBAC-08 HTTP: GET permisos/mios, permisos/puede y la puerta de permisos.ver
 *   P-RBAC-09 la matriz por defecto: errores.gestionar solo para propietario y gerente
 */
import { assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer, type ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { identityServer, permisosServer } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import type { MisPermisos } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { call, identityCfg, login } from "@Jeff-Aporta/DER/tests/_util.ts";

/** API de prueba con identidad (para las rutas) y el plugin de permisos. */
async function setup() {
  registry.secure(null);
  const db = sqliteDatabase();
  const auth = createServer(identityServer, { db, cfg: identityCfg() });
  const permisos = createServer(permisosServer, { db, cfg: {} }) as ServerPlugin & Record<string, any>;
  const router = createRouter([], { basePath: "/api", plugins: [auth, permisos] });
  await router.seed();
  // la duena de la empresa (actor de las pruebas de administracion)
  await (permisos as ServerPlugin & Record<string, any>)["ponerRoles"]("jefa", "acme", ["propietario"]);
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { db, auth, permisos, router, cerrar };
}

/** Acciones permitidas de la matriz de un rol. */
async function permitidasDe(p: ServerPlugin & Record<string, any>, irol: string): Promise<string[]> {
  const m = await p["matriz"](irol);
  return m.acciones.filter((a: { permitido: boolean }) => a.permitido).map((a: { clave: string }) => a.clave);
}

Deno.test("P-RBAC-01 semilla: catalogo, roles base y matriz por defecto", async () => {
  const { permisos, cerrar } = await setup();
  try {
    const acciones = await permisos["catalogo"]();
    const claves = acciones.map((a: { clave: string }) => a.clave);
    for (const esperada of ["inbox.ver", "chat.enviar", "usuarios.rol", "tiquetes.ver", "tiquetes.cerrar", "errores.gestionar", "empresa.perfil", "permisos.editar", "csat.destinatarios"]) {
      assertEquals(claves.includes(esperada), true, "falta la accion " + esperada);
    }
    const roles = await permisos["roles"]("acme");
    const clavesRol = roles.map((r: { clave: string }) => r.clave);
    for (const esperado of ["propietario", "gerente", "admin", "auditor", "agente", "wrkr", "lector", "cliente"]) {
      assertEquals(clavesRol.includes(esperado), true, "falta el rol " + esperado);
    }
    // el catalogo y los roles base tienen su numero (dato de arranque, editable despues)
    assertEquals(clavesRol.length, 8, "la semilla trae 8 roles");
    assertEquals(claves.length, 55, "la semilla trae 55 acciones");
    // el propietario lo puede todo y su etiqueta sale de la base
    const todo = await permitidasDe(permisos, "propietario");
    assertEquals(todo.length, claves.length, "propietario debe tener todo el catalogo");
    const propio = roles.find((r: { clave: string }) => r.clave === "propietario");
    assertEquals(propio.etiqueta, "ROOT");
    // el rol de sistema no depende del codigo: se edita su matriz
    const m = await permisos["matriz"]("wrkr");
    assertEquals(m.rol.sistema, true);
    assertEquals(m.acciones.length, claves.length);
  } finally {
    await cerrar();
  }
});

Deno.test("P-RBAC-02 (a) cambiar una celda de la matriz cambia el comportamiento sin tocar codigo", async () => {
  const { permisos, cerrar } = await setup();
  try {
    await permisos["ponerRoles"]("tra", "acme", ["wrkr"]);
    assertEquals(await permisos["puede"]("tra", "acme", "inbox.ver"), false);
    await permisos["ponerMatriz"]("jefa", "acme", "wrkr", { acciones: [{ clave: "inbox.ver", permitido: true }] });
    assertEquals(await permisos["puede"]("tra", "acme", "inbox.ver"), true);
    // y volver a apagarla sin tocar codigo
    await permisos["ponerMatriz"]("jefa", "acme", "wrkr", { acciones: [{ clave: "inbox.ver", permitido: false }] });
    assertEquals(await permisos["puede"]("tra", "acme", "inbox.ver"), false);
  } finally {
    await cerrar();
  }
});

Deno.test("P-RBAC-03 (b) un rol nuevo creado en la base funciona", async () => {
  const { permisos, cerrar } = await setup();
  try {
    const rol = await permisos["crearRol"]("jefa", "acme", { clave: "supervisor", nombre: "Supervisor", etiqueta: "SUPER", nivel: 60, permisos: ["inbox.ver", "chat.enviar"] });
    assertEquals(rol.clave, "supervisor");
    assertEquals(rol.iempresa, "acme");
    await permisos["asignarRoles"]("jefa", "acme", "sofia", { roles: ["supervisor"] });
    assertEquals(await permisos["puede"]("sofia", "acme", "inbox.ver"), true);
    assertEquals(await permisos["puede"]("sofia", "acme", "chat.enviar"), true);
    assertEquals(await permisos["puede"]("sofia", "acme", "usuarios.rol"), false);
    // su etiqueta y su nombre salen de la base (badge del chat)
    const mis = await permisos["misPermisos"]("sofia", "acme");
    assertEquals(mis.rol.etiqueta, "SUPER");
    assertEquals(mis.rol.nombre, "Supervisor");
    // se puede editar y borrar (no es de sistema)
    await permisos["editarRol"]("jefa", "acme", "acme:supervisor", { nombre: "Supervisor de turno" });
    assertEquals((await permisos["misPermisos"]("sofia", "acme")).rol.nombre, "Supervisor de turno");
    await permisos["borrarRol"]("jefa", "acme", "acme:supervisor");
    assertEquals(await permisos["puede"]("sofia", "acme", "inbox.ver"), false);
  } finally {
    await cerrar();
  }
});

Deno.test("P-RBAC-04 (c) WRKR solo ve tiquetes", async () => {
  const { permisos, cerrar } = await setup();
  try {
    await permisos["ponerRoles"]("wanda", "acme", ["wrkr"]);
    const permitidas = (await permisos["permisosDe"]("wanda", "acme"));
    const activas = Object.entries(permitidas).filter(([, v]) => v).map(([k]) => k).sort();
    assertEquals(activas, ["tiquetes.adoptar", "tiquetes.cerrar", "tiquetes.comentar", "tiquetes.estado", "tiquetes.ver"]);
    assertEquals(await permisos["puede"]("wanda", "acme", "usuarios.rol"), false);
    assertEquals(await permisos["puede"]("wanda", "acme", "inbox.ver"), false);
    assertEquals(await permisos["puede"]("wanda", "acme", "errores.ver"), false);
    assertEquals(await permisos["puede"]("wanda", "acme", "metricas.ver"), false);
    assertEquals(await permisos["puede"]("wanda", "acme", "tiquetes.ver"), true);
    // el trabajador opera sus tiquetes: adopta, cambia estado, comenta y resuelve
    assertEquals(await permisos["puede"]("wanda", "acme", "tiquetes.adoptar"), true);
    assertEquals(await permisos["puede"]("wanda", "acme", "tiquetes.estado"), true);
    assertEquals(await permisos["puede"]("wanda", "acme", "tiquetes.comentar"), true);
    assertEquals(await permisos["puede"]("wanda", "acme", "tiquetes.cerrar"), true);
    // pero no los crea ni los reparte a otros
    assertEquals(await permisos["puede"]("wanda", "acme", "tiquetes.crear"), false);
    assertEquals(await permisos["puede"]("wanda", "acme", "tiquetes.asignar"), false);
    const mis = await permisos["misPermisos"]("wanda", "acme");
    assertEquals(mis.rol.etiqueta, "WRKR");
  } finally {
    await cerrar();
  }
});

Deno.test("P-RBAC-05 (d) aislamiento por empresa", async () => {
  const { permisos, cerrar } = await setup();
  try {
    // cada empresa tiene a su duena: el rol de una no sirve en la otra
    await permisos["ponerRoles"]("jefaOtra", "otra", ["propietario"]);
    await permisos["crearRol"]("jefaOtra", "otra", { clave: "jefe", nombre: "Jefe", permisos: ["usuarios.rol", "inbox.ver"] });
    await permisos["asignarRoles"]("jefaOtra", "otra", "otto", { roles: ["jefe"] });
    assertEquals(await permisos["puede"]("otto", "otra", "usuarios.rol"), true);
    assertEquals(await permisos["puede"]("otto", "acme", "usuarios.rol"), false, "el rol de otra empresa no aplica en acme");
    // un usuario de acme no hereda nada de otra-empresa
    await permisos["ponerRoles"]("ana", "acme", ["agente"]);
    assertEquals(await permisos["puede"]("ana", "acme", "chat.enviar"), true);
    assertEquals(await permisos["puede"]("ana", "otra", "chat.enviar"), false, "sin asignacion en otra no hay permisos");
    // no se puede asignar un rol de otra empresa
    let errore = false;
    try {
      await permisos["asignarRoles"]("jefa", "acme", "ana", { roles: ["jefe"] });
    } catch {
      errore = true;
    }
    assertEquals(errore, true);
  } finally {
    await cerrar();
  }
});

Deno.test("P-RBAC-06 (e) mis permisos coincide con la matriz del rol", async () => {
  const { permisos, cerrar } = await setup();
  try {
    await permisos["ponerRoles"]("mica", "acme", ["auditor"]);
    const mis: MisPermisos = await permisos["misPermisos"]("mica", "acme");
    const deMatriz = await permitidasDe(permisos, "auditor");
    const deMis = Object.entries(mis.permisos).filter(([, v]) => v).map(([k]) => k).sort();
    assertEquals(deMis, [...deMatriz].sort());
    assertEquals(mis.permitidas.sort(), deMis);
    assertEquals(mis.roles.length, 1);
    assertEquals(mis.rol?.clave, "auditor");
  } finally {
    await cerrar();
  }
});

Deno.test("P-RBAC-07 protecciones: sistema no se borra, sin escalada", async () => {
  const { permisos, cerrar } = await setup();
  try {
    let borrado = false;
    try {
      await permisos["borrarRol"]("jefa", "acme", "propietario");
    } catch {
      borrado = true;
    }
    assertEquals(borrado, true, "un rol de sistema no se borra");
    // un gerente (nivel 90, sin comodin) no puede asignar propietario (nivel 100)
    await permisos["ponerRoles"]("gera", "acme", ["gerente"]);
    let escalada = false;
    try {
      await permisos["asignarRoles"]("gera", "acme", "gera", { roles: ["propietario"] });
    } catch {
      escalada = true;
    }
    assertEquals(escalada, true, "no se puede subir a un rol de nivel igual o superior");
    assertEquals(await permisos["puede"]("gera", "acme", "usuarios.rol"), true);
  } finally {
    await cerrar();
  }
});

Deno.test("P-RBAC-08 HTTP: permisos/mios, permisos/puede y la puerta permisos.ver", async () => {
  const { permisos, router, cerrar } = await setup();
  try {
    await permisos["ponerRoles"]("admin", "acme", ["propietario"]);
    await permisos["ponerRoles"]("wanda", "acme", ["wrkr"]);
    const tokenAdmin = await login(router, "admin", "admin-12345");
    // las cuentas de prueba de identidad: se crean desde el admin si no existen
    await call(router, "POST", "usuario", { token: tokenAdmin, body: { iusuario: "wanda", password: "wanda-clave-123" } });
    const tokenWanda = await login(router, "wanda", "wanda-clave-123");
    const cabecera = { "x-empresa": "acme" };
    const mios = await call(router, "GET", "permisos/mios", { token: tokenAdmin, headers: cabecera });
    assertEquals(mios.status, 200);
    assertEquals(mios.data.rol.clave, "propietario");
    assertEquals(mios.data.permisos["usuarios.rol"], true);
    assertEquals(mios.data.iempresa, "acme");
    const suyos = await call(router, "GET", "permisos/mios", { token: tokenWanda, headers: cabecera });
    assertEquals(suyos.status, 200);
    assertEquals(suyos.data.rol.clave, "wrkr");
    assertEquals(suyos.data.permisos["tiquetes.ver"], true);
    assertEquals(suyos.data.permisos["usuarios.rol"], false);
    const puede = await call(router, "GET", "permisos/puede?clave=tiquetes.ver", { token: tokenWanda, headers: cabecera });
    assertEquals(puede.data.permitido, true);
    const noPuede = await call(router, "GET", "permisos/puede?clave=usuarios.rol", { token: tokenWanda, headers: cabecera });
    assertEquals(noPuede.data.permitido, false);
    // wanda no tiene permisos.ver: no ve el catalogo de roles de la empresa
    assertEquals((await call(router, "GET", "permisos/roles", { token: tokenWanda, headers: cabecera })).status, 403);
    assertEquals((await call(router, "GET", "permisos/roles", { token: tokenAdmin, headers: cabecera })).status, 200);
  } finally {
    await cerrar();
  }
});

Deno.test("P-RBAC-09 la matriz por defecto: errores.gestionar solo para propietario y gerente", async () => {
  const { permisos, cerrar } = await setup();
  try {
    const conGestionar: string[] = [];
    for (const rol of ["propietario", "gerente", "admin", "auditor", "agente", "wrkr", "lector", "cliente"]) {
      const permitidas = await permitidasDe(permisos, rol);
      if (permitidas.includes("errores.gestionar")) conGestionar.push(rol);
      // el que no puede gestionar errores, solo puede verlos (o ni eso)
      if (!permitidas.includes("errores.gestionar")) {
        assertEquals(permitidas.includes("errores.ver"), rol === "admin" || rol === "auditor", rol + " y errores");
      }
    }
    assertEquals(conGestionar.sort(), ["gerente", "propietario"]);
    // el gerente administra la empresa pero no edita las matrices de permisos
    const gerente = await permitidasDe(permisos, "gerente");
    assertEquals(gerente.includes("permisos.editar"), false);
    assertEquals(gerente.includes("usuarios.rol"), true);
    // el admin opera sin tocar permisos ni tokens de canal
    const admin = await permitidasDe(permisos, "admin");
    assertEquals(admin.includes("permisos.editar"), false);
    assertEquals(admin.includes("empresa.canales"), false);
    assertEquals(admin.includes("usuarios.rol"), true);
    // y el propietario lo puede todo
    const propietario = await permitidasDe(permisos, "propietario");
    assertEquals(propietario.includes("permisos.editar"), true);
    assertEquals(propietario.includes("errores.gestionar"), true);
  } finally {
    await cerrar();
  }
});
