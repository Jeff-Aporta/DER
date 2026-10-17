/**
 * Endurecimiento del login: auditoría (IP, user-agent, SO, navegador, dispositivo), bloqueo por fuerza bruta,
 * dispositivo nuevo, viaje imposible básico, `GET /sessions`, `DELETE /logout/all`, `PUT /password` y
 * `GET /events`. También valida la configuración `identity.security` con Zod y el cliente `IdentityClient`.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { createRouter, type Database, type Router, ServerController } from "@Jeff-Aporta/DER/src/02 controllers/server/mod.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02 controllers/server/sqlite/mod.ts";
import {
  type IdentityPlugin,
  type IdentitySecurityConfig,
  IdentityClient,
  type LoginResult,
  pluginsFromConfig,
  type PluginsConfig,
} from "@Jeff-Aporta/DER/src/03 plugins/mod.ts";
import { CategoriaEntity, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";

const SECRET = "una-secret-key-de-pruebas-con-mas-de-32-caracteres";
const UA_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const UA_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";

const config = (security?: IdentitySecurityConfig): PluginsConfig => ({
  identity: {
    secret: "env:TEST_JWT_SECRET",
    iterations: 10_000,
    admin: { usuario: "admin", password: "admin-12345" },
    ...(security ? { security } : {}),
  },
  permissions: { grupo: "API" },
});

async function setup(security?: IdentitySecurityConfig) {
  const db: Database = sqliteDatabase();
  const categorias = new ServerController(CategoriaEntity, { db, table: "categorias" });
  const productos = new ServerController(ProductoEntity, { db, table: "productos", security: true });
  const plugins = pluginsFromConfig(config(security), { db, env: { TEST_JWT_SECRET: SECRET } });
  const router = createRouter([categorias, productos], { basePath: "/api", plugins });
  await router.seed();
  return { db, router, identity: plugins[0] as IdentityPlugin };
}

interface CallOpts {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

const call = async (router: Router, method: string, path: string, opts: CallOpts = {}) => {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  const res = await router.fetch(
    new Request(`http://t/api/${path}`, {
      method,
      headers,
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    }),
  );
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : undefined };
};

const login = async (
  router: Router,
  usuario: string,
  password: string,
  dev: { ip: string; ua: string } = { ip: "1.1.1.1", ua: UA_CHROME },
) => {
  const r = await call(router, "POST", "login", {
    body: { usuario, password },
    headers: { "x-forwarded-for": dev.ip, "user-agent": dev.ua },
  });
  return r;
};

const token = async (
  router: Router,
  usuario = "admin",
  password = "admin-12345",
  dev: { ip: string; ua: string } = { ip: "1.1.1.1", ua: UA_CHROME },
): Promise<string> => {
  const r = await login(router, usuario, password, dev);
  assertEquals(r.status, 200, JSON.stringify(r.data));
  return (r.data as LoginResult).token;
};

Deno.test("auditoría: cada intento guarda IP real, user-agent, SO, navegador, dispositivo y motivo", async () => {
  const { db, router, identity } = await setup();
  try {
    const primero = await login(router, "admin", "admin-12345", { ip: "8.8.8.8", ua: UA_CHROME });
    await login(router, "admin", "mala", { ip: "9.9.9.9", ua: UA_FIREFOX });
    await login(router, "nadie", "x", { ip: "9.9.9.9", ua: UA_FIREFOX });

    const intentos = await identity.intentos.select({ orderBy: ["-creado"] });
    assertEquals(intentos.length, 3);
    const ok = intentos.find((i) => i.resultado === "ok");
    const fallo = intentos.find((i) => i.motivo === "credenciales");
    const inexistente = intentos.find((i) => i.motivo === "usuario_inexistente");
    assertEquals([ok?.ip, ok?.so, ok?.navegador, ok?.dispositivo], ["8.8.8.8", "Windows", "Chrome", "escritorio"]);
    assertEquals([fallo?.ip, fallo?.so, fallo?.navegador, fallo?.resultado], ["9.9.9.9", "Linux", "Firefox", "fallo"]);
    assertEquals(inexistente?.iusuario, "nadie");
    assert((ok?.user_agent ?? "").includes("Chrome"));

    const admin = (primero.data as LoginResult).token;
    const eventos = await call(router, "GET", "events?accion=login", { token: admin });
    assertEquals(eventos.status, 200);
    assertEquals((eventos.data as { accion: string }[]).map((e) => e.accion), ["login"]);
  } finally {
    await db.destroy();
  }
});

Deno.test("bloqueo: N fallos por IP bloquean incluso con la contraseña correcta, y expira solo", async () => {
  const { db, router } = await setup({ maxAttempts: 2, windowSeconds: 60, lockSeconds: 1 });
  try {
    const mala = { ip: "7.7.7.7", ua: UA_CHROME };
    assertEquals((await login(router, "admin", "mala", mala)).status, 401);
    assertEquals((await login(router, "admin", "mala", mala)).status, 401);
    const bloqueado = await login(router, "admin", "admin-12345", mala);
    assertEquals(bloqueado.status, 429);
    assert(String(bloqueado.data.error).includes("Demasiados intentos"));
    // otra IP no está bloqueada (el bloqueo es por IP o usuario; el usuario sigue bloqueado)
    assertEquals((await login(router, "admin", "admin-12345", { ip: "6.6.6.6", ua: UA_CHROME })).status, 429);
    await new Promise((r) => setTimeout(r, 1100));
    assertEquals((await login(router, "admin", "admin-12345", mala)).status, 200);
  } finally {
    await db.destroy();
  }
});

Deno.test("dispositivo nuevo: se audita y, si se configura, se bloquea", async () => {
  const { db, router } = await setup({ blockNewDevice: true });
  try {
    assertEquals((await login(router, "admin", "admin-12345", { ip: "1.1.1.1", ua: UA_CHROME })).status, 200);
    const nuevo = await login(router, "admin", "admin-12345", { ip: "1.1.1.1", ua: UA_FIREFOX });
    assertEquals(nuevo.status, 403);
    assert(String(nuevo.data.error).includes("Dispositivo"));
  } finally {
    await db.destroy();
  }
});

Deno.test("dispositivo nuevo: sin bloqueo deja entrar y deja el evento en auditoría", async () => {
  const { db, router } = await setup();
  try {
    const primero = await token(router, "admin", "admin-12345", { ip: "1.1.1.1", ua: UA_CHROME });
    assertEquals((await login(router, "admin", "admin-12345", { ip: "1.1.1.1", ua: UA_FIREFOX })).status, 200);
    const eventos = await call(router, "GET", "events?accion=dispositivo_nuevo", { token: primero });
    assertEquals((eventos.data as unknown[]).length, 1);
  } finally {
    await db.destroy();
  }
});

Deno.test("viaje imposible: cambio de IP en ventana corta se audita y, si se configura, se bloquea", async () => {
  const { db, router } = await setup({ travel: { enabled: true, minMinutes: 60, block: true } });
  try {
    assertEquals((await login(router, "admin", "admin-12345", { ip: "1.1.1.1", ua: UA_CHROME })).status, 200);
    const viaje = await login(router, "admin", "admin-12345", { ip: "9.9.9.9", ua: UA_CHROME });
    assertEquals(viaje.status, 403);
    assert(String(viaje.data.error).includes("ubicación"));
  } finally {
    await db.destroy();
  }
});

Deno.test("sesiones: GET /sessions lista con IP/dispositivo/último acceso y marca la actual", async () => {
  const { db, router } = await setup();
  try {
    const t1 = await token(router, "admin", "admin-12345", { ip: "1.1.1.1", ua: UA_CHROME });
    const t2 = await token(router, "admin", "admin-12345", { ip: "2.2.2.2", ua: UA_FIREFOX });
    const r = await call(router, "GET", "sessions", { token: t2 });
    assertEquals(r.status, 200);
    const sesiones = r.data as { ip: string; so: string; navegador: string; actual: boolean; jti: string }[];
    assertEquals(sesiones.length, 2);
    assertEquals(sesiones.filter((s) => s.actual).length, 1);
    const ip = sesiones.find((s) => s.ip === "1.1.1.1");
    assertEquals([ip?.so, ip?.navegador, ip?.actual], ["Windows", "Chrome", false]);
    assertEquals(sesiones.some((s) => s.ip === "2.2.2.2" && s.actual), true);
    assertEquals((await call(router, "GET", "sessions")).status, 401);
    void t1;
  } finally {
    await db.destroy();
  }
});

Deno.test("logout/all: revoca todas las sesiones del usuario", async () => {
  const { db, router } = await setup();
  try {
    const t1 = await token(router, "admin", "admin-12345", { ip: "1.1.1.1", ua: UA_CHROME });
    const t2 = await token(router, "admin", "admin-12345", { ip: "2.2.2.2", ua: UA_FIREFOX });
    const res = await call(router, "DELETE", "logout/all", { token: t1 });
    assertEquals([res.status, res.data.revocadas], [200, 2]);
    assertEquals((await call(router, "GET", "sessions", { token: t1 })).status, 401);
    assertEquals((await call(router, "GET", "sessions", { token: t2 })).status, 401);
    assertEquals((await call(router, "DELETE", "logout/all")).status, 401);
  } finally {
    await db.destroy();
  }
});

Deno.test("password: exige la actual, aplica política y revoca las demás sesiones", async () => {
  const { db, router } = await setup();
  try {
    const t1 = await token(router, "admin", "admin-12345", { ip: "1.1.1.1", ua: UA_CHROME });
    const t2 = await token(router, "admin", "admin-12345", { ip: "2.2.2.2", ua: UA_FIREFOX });

    assertEquals((await call(router, "PUT", "password", { token: t1, body: { actual: "mala", nueva: "nueva-clave-1" } })).status, 401);
    assertEquals((await call(router, "PUT", "password", { token: t1, body: { actual: "admin-12345", nueva: "123" } })).status, 400);
    assertEquals(
      (await call(router, "PUT", "password", { token: t1, body: { actual: "admin-12345", nueva: "admin-12345" } })).status,
      400,
    );

    const ok = await call(router, "PUT", "password", { token: t1, body: { actual: "admin-12345", nueva: "nueva-clave-1" } });
    assertEquals([ok.status, ok.data.revocadas], [200, 1]);
    // la sesión actual sigue viva; la otra se revocó
    assertEquals((await call(router, "GET", "sessions", { token: t1 })).status, 200);
    assertEquals((await call(router, "GET", "sessions", { token: t2 })).status, 401);
    // la contraseña vieja ya no sirve
    assertEquals((await login(router, "admin", "admin-12345")).status, 401);
    assertEquals((await login(router, "admin", "nueva-clave-1")).status, 200);
  } finally {
    await db.destroy();
  }
});

Deno.test("events: filtros por acción, usuario, límite y rango de fechas inválidas", async () => {
  const { db, router } = await setup();
  try {
    const t = await token(router);
    await call(router, "PUT", "password", { token: t, body: { actual: "admin-12345", nueva: "otra-clave-9" } });
    const porAccion = await call(router, "GET", "events?accion=password", { token: t });
    assertEquals((porAccion.data as unknown[]).length, 1);
    const porUsuario = await call(router, "GET", "events?iusuario=admin&limit=1", { token: t });
    assertEquals((porUsuario.data as unknown[]).length, 1);
    assertEquals((await call(router, "GET", "events?desde=no-es-fecha", { token: t })).status, 400);
    assertEquals((await call(router, "GET", "events?limit=0", { token: t })).status, 400);
  } finally {
    await db.destroy();
  }
});

Deno.test("config: identity.security inválido se rechaza con Zod", async () => {
  const db: Database = sqliteDatabase();
  try {
    assertThrows(() => pluginsFromConfig({ identity: { secret: SECRET, security: { maxAttempts: 0 } } }, { db }));
    assertThrows(() => pluginsFromConfig({ identity: { secret: SECRET, security: { maxAttempts: 3, extra: true } } }, { db }));
    assertThrows(() => pluginsFromConfig({ identity: { secret: SECRET, security: { password: { minLength: 4 } } } }, { db }));
    const ok = pluginsFromConfig(
      { identity: { secret: SECRET, security: { maxAttempts: 3, travel: { enabled: true, minMinutes: 10 } } } },
      { db },
    );
    assertEquals(ok.length, 1);
  } finally {
    await db.destroy();
  }
});

Deno.test("cliente: IdentityClient expone sessions, events, changePassword y logoutAll", async () => {
  const { db, router } = await setup();
  try {
    const shim: typeof fetch = (input, init) => router.fetch(new Request(String(input), init));
    const client = new IdentityClient({ baseUrl: "http://t/api", fetch: shim });
    await client.login({ usuario: "admin", password: "admin-12345" });
    const sesiones = await client.sessions();
    assertEquals(sesiones.length, 1);
    assertEquals(sesiones[0]?.actual, true);
    const eventos = await client.events({ accion: "login" });
    assertEquals(eventos.length, 1);
    assertEquals(await client.changePassword("admin-12345", "clave-cliente-1"), 0);
    await client.login({ usuario: "admin", password: "clave-cliente-1" });
    assertEquals(await client.logoutAll(), 2);
    assertEquals(client.token, null);
  } finally {
    await db.destroy();
  }
});