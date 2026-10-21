/**
 * Endurecimiento del login: auditoría (IP, user-agent, SO, navegador, dispositivo), bloqueo por fuerza bruta, dispositivo
 * nuevo, viaje imposible básico, `GET /sessions`, `DELETE /logout/all`, `PUT /password` y `GET /events`. También el
 * cliente JSON (`createClient(identity)`): sesión singleton del registro, token y operaciones.
 */
import { assert, assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { createClient, identity, type IdentitySecurityConfig, type LoginResult } from "@Jeff-Aporta/DER/src/03-plugins/client.ts";
import { CategoriaEntity, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";
import { apiConPlugins, call, identityCfg } from "@Jeff-Aporta/DER/tests/_util.ts";

const UA_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const UA_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";

function setup(security?: IdentitySecurityConfig) {
  const db = sqliteDatabase();
  const ctrls = [new ServerController(CategoriaEntity, { db, table: "categorias" }), new ServerController(ProductoEntity, { db, table: "productos", security: true })];
  return apiConPlugins(db, ctrls, { identity: identityCfg(security ? { security } : {}), permissions: { grupo: "API", admins: ["admin"] } });
}

type Dev = { ip: string; ua: string };
const dev = (ip: string, ua: string): Dev => ({ ip, ua });

const loginAs = (router: Awaited<ReturnType<typeof setup>>["router"], usuario: string, password: string, d: Dev = dev("1.1.1.1", UA_CHROME)) => call(router, "POST", "login", { body: { usuario, password }, headers: { "x-forwarded-for": d.ip, "user-agent": d.ua } });

const token = async (router: Awaited<ReturnType<typeof setup>>["router"], usuario = "admin", password = "admin-12345", d: Dev = dev("1.1.1.1", UA_CHROME)): Promise<string> => {
  const r = await loginAs(router, usuario, password, d);
  assertEquals(r.status, 200, JSON.stringify(r.data));
  return (r.data as LoginResult).token;
};

Deno.test("auditoría: cada intento guarda IP real, user-agent, SO, navegador, dispositivo y motivo", async () => {
  const { router, auth, cerrar } = await setup();
  try {
    const primero = await loginAs(router, "admin", "admin-12345", dev("8.8.8.8", UA_CHROME));
    await loginAs(router, "admin", "mala", dev("9.9.9.9", UA_FIREFOX));
    await loginAs(router, "nadie", "x", dev("9.9.9.9", UA_FIREFOX));
    const intentos = await auth.controllers["intentos"]!.select({ orderBy: ["-creado"] });
    assertEquals(intentos.length, 3);
    const ok = intentos.find((i) => i.resultado === "ok");
    const fallo = intentos.find((i) => i.motivo === "credenciales");
    assertEquals([ok?.ip, ok?.so, ok?.navegador, ok?.dispositivo], ["8.8.8.8", "Windows", "Chrome", "escritorio"]);
    assertEquals([fallo?.ip, fallo?.so, fallo?.navegador, fallo?.resultado], ["9.9.9.9", "Linux", "Firefox", "fallo"]);
    assertEquals(intentos.find((i) => i.motivo === "usuario_inexistente")?.iusuario, "nadie");
    assert((ok?.user_agent ?? "").includes("Chrome"));
    const eventos = await call(router, "GET", "events?accion=login", { token: (primero.data as LoginResult).token });
    assertEquals([eventos.status, (eventos.data as { accion: string }[]).map((e) => e.accion)], [200, ["login"]]);
  } finally {
    await cerrar();
  }
});

Deno.test("bloqueo: N fallos por IP bloquean incluso con la contraseña correcta, y expira solo", async () => {
  const { router, cerrar } = await setup({ maxAttempts: 2, windowSeconds: 60, lockSeconds: 1 });
  try {
    const mala = dev("7.7.7.7", UA_CHROME);
    assertEquals((await loginAs(router, "admin", "mala", mala)).status, 401);
    assertEquals((await loginAs(router, "admin", "mala", mala)).status, 401);
    const bloqueado = await loginAs(router, "admin", "admin-12345", mala);
    assertEquals(bloqueado.status, 429);
    assert(String(bloqueado.data.error).includes("Demasiados intentos"));
    // otra IP no está bloqueada (el bloqueo es por IP o usuario; el usuario sigue bloqueado)
    assertEquals((await loginAs(router, "admin", "admin-12345", dev("6.6.6.6", UA_CHROME))).status, 429);
    await new Promise((r) => setTimeout(r, 1100));
    assertEquals((await loginAs(router, "admin", "admin-12345", mala)).status, 200);
  } finally {
    await cerrar();
  }
});

Deno.test("dispositivo nuevo: se audita y, si se configura, se bloquea", async () => {
  const bloquea = await setup({ blockNewDevice: true });
  try {
    assertEquals((await loginAs(bloquea.router, "admin", "admin-12345", dev("1.1.1.1", UA_CHROME))).status, 200);
    const nuevo = await loginAs(bloquea.router, "admin", "admin-12345", dev("1.1.1.1", UA_FIREFOX));
    assertEquals(nuevo.status, 403);
    assert(String(nuevo.data.error).includes("Dispositivo"));
  } finally {
    await bloquea.cerrar();
  }
  const audita = await setup();
  try {
    const primero = await token(audita.router, "admin", "admin-12345", dev("1.1.1.1", UA_CHROME));
    assertEquals((await loginAs(audita.router, "admin", "admin-12345", dev("1.1.1.1", UA_FIREFOX))).status, 200);
    const eventos = await call(audita.router, "GET", "events?accion=dispositivo_nuevo", { token: primero });
    assertEquals((eventos.data as unknown[]).length, 1);
  } finally {
    await audita.cerrar();
  }
});

Deno.test("viaje imposible: cambio de IP en ventana corta se audita y, si se configura, se bloquea", async () => {
  const { router, cerrar } = await setup({ travel: { enabled: true, minMinutes: 60, block: true } });
  try {
    assertEquals((await loginAs(router, "admin", "admin-12345", dev("1.1.1.1", UA_CHROME))).status, 200);
    const viaje = await loginAs(router, "admin", "admin-12345", dev("9.9.9.9", UA_CHROME));
    assertEquals(viaje.status, 403);
    assert(String(viaje.data.error).includes("ubicación"));
  } finally {
    await cerrar();
  }
});

Deno.test("sesiones: GET /sessions lista con IP/dispositivo/último acceso y marca la actual; logout/all revoca todas", async () => {
  const { router, cerrar } = await setup();
  try {
    const t1 = await token(router, "admin", "admin-12345", dev("1.1.1.1", UA_CHROME));
    const t2 = await token(router, "admin", "admin-12345", dev("2.2.2.2", UA_FIREFOX));
    const r = await call(router, "GET", "sessions", { token: t2 });
    const sesiones = r.data as { ip: string; so: string; navegador: string; actual: boolean }[];
    assertEquals([r.status, sesiones.length, sesiones.filter((s) => s.actual).length], [200, 2, 1]);
    const ip = sesiones.find((s) => s.ip === "1.1.1.1");
    assertEquals([ip?.so, ip?.navegador, ip?.actual], ["Windows", "Chrome", false]);
    assertEquals((await call(router, "GET", "sessions")).status, 401);
    const res = await call(router, "DELETE", "logout/all", { token: t1 });
    assertEquals([res.status, res.data.revocadas], [200, 2]);
    assertEquals((await call(router, "GET", "sessions", { token: t1 })).status, 401);
    assertEquals((await call(router, "GET", "sessions", { token: t2 })).status, 401);
    assertEquals((await call(router, "DELETE", "logout/all")).status, 401);
  } finally {
    await cerrar();
  }
});

Deno.test("password: exige la actual, aplica política y revoca las demás sesiones; events filtra", async () => {
  const { router, cerrar } = await setup();
  try {
    const t1 = await token(router, "admin", "admin-12345", dev("1.1.1.1", UA_CHROME));
    const t2 = await token(router, "admin", "admin-12345", dev("2.2.2.2", UA_FIREFOX));
    assertEquals((await call(router, "PUT", "password", { token: t1, body: { actual: "mala", nueva: "nueva-clave-1" } })).status, 401);
    assertEquals((await call(router, "PUT", "password", { token: t1, body: { actual: "admin-12345", nueva: "123" } })).status, 400);
    assertEquals((await call(router, "PUT", "password", { token: t1, body: { actual: "admin-12345", nueva: "admin-12345" } })).status, 400);
    const ok = await call(router, "PUT", "password", { token: t1, body: { actual: "admin-12345", nueva: "nueva-clave-1" } });
    assertEquals([ok.status, ok.data.revocadas], [200, 1]);
    assertEquals((await call(router, "GET", "sessions", { token: t1 })).status, 200); // la actual sigue viva
    assertEquals((await call(router, "GET", "sessions", { token: t2 })).status, 401); // la otra se revocó
    assertEquals((await loginAs(router, "admin", "admin-12345")).status, 401);
    assertEquals((await loginAs(router, "admin", "nueva-clave-1")).status, 200);
    assertEquals(((await call(router, "GET", "events?accion=password", { token: t1 })).data as unknown[]).length, 1);
    assertEquals(((await call(router, "GET", "events?iusuario=admin&limit=1", { token: t1 })).data as unknown[]).length, 1);
    assertEquals((await call(router, "GET", "events?desde=no-es-fecha", { token: t1 })).status, 400);
    assertEquals((await call(router, "GET", "events?limit=0", { token: t1 })).status, 400);
  } finally {
    await cerrar();
  }
});

Deno.test("cliente JSON: login deja token y sesión singleton; sessions, events, changePassword y logoutAll", async () => {
  const { router, cerrar } = await setup();
  try {
    const shim: typeof fetch = (input, init) => router.fetch(new Request(String(input), init));
    const client = createClient(identity, { baseUrl: "http://t/api", fetch: shim });
    assertEquals(registry.session, null);
    await client["login"]({ usuario: "admin", password: "admin-12345" });
    assertEquals(registry.session?.id, "admin");
    const sesiones = await client["sessions"]();
    assertEquals([sesiones.length, sesiones[0]?.actual], [1, true]);
    assertEquals((await client["events"]({ accion: "login" })).length, 1);
    assertEquals(await client["changePassword"]("admin-12345", "clave-cliente-1"), 0);
    await client["login"]({ usuario: "admin", password: "clave-cliente-1" });
    assertEquals(await client["logoutAll"](), 2);
    assertEquals([client.token, registry.session], [null, null]);
  } finally {
    await cerrar();
  }
});
