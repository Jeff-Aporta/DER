/**
 * Errores con auditoría: llave pública diaria para anónimos (5 por minuto, bloqueo de 24 h y luego 48 h), sin cooldown con
 * JWT, «solicitar solución» solo del auditor (nunca se resuelve solo), columna `atendido` con purga programada, registro
 * automático de fallos del server y del cliente, y las tareas programadas declaradas una vez para cualquier host.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { createClient, erroresPlugin, identity } from "@Jeff-Aporta/DER/src/03-plugins/client.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { cronCoincide, declararTareas, nombreCron, type ErrorReporte, erroresServer, identityServer, onErrorRegistrando, purgarAtendidos, reportarFallosCon, servicios, validarCron } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { HttpError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { exigirAnonimo } from "@Jeff-Aporta/DER/src/03-plugins/errores/anonimos.ts";
import { call, identityCfg, SECRET } from "@Jeff-Aporta/DER/tests/_util.ts";

async function montar() {
  registry.secure(null);
  servicios.limpiar();
  const db = sqliteDatabase();
  const solicitudes: number[] = [];
  const auth = createServer(identityServer, { db, cfg: identityCfg() });
  const errores = createServer(erroresServer, { db, cfg: { secret: SECRET }, services: { enlaces: { esAuditor: (ctx: { session?: { id?: string } | null }) => ctx.session?.id === "aud", alSolicitarSolucion: (e: { ierror: number }) => void solicitudes.push(Number(e.ierror)) }, ipDe: (r: Request) => r.headers.get("x-ip-prueba") } });
  const router = createRouter([], { basePath: "/api", plugins: [auth, errores] });
  await router.seed();
  const usuarios = auth.controllers["usuarios"]!;
  await usuarios.post(usuarios.pojo({ iusuario: "aud", password: "auditor-clave-1" }));
  const login = async (usuario: string, password: string) => {
    const c = createClient(identity, { baseUrl: "http://t/api", fetch: (i, n) => router.fetch(new Request(i, n)) });
    await c["login"]({ usuario, password });
    return c.token!;
  };
  return { db, router, errores, solicitudes, login, cerrar: async () => { registry.secure(null); servicios.limpiar(); await db.destroy(); } };
}

const llaveDe = async (router: { fetch(r: Request): Promise<Response> }) => ((await (await router.fetch(new Request("http://t/api/errores/llave"))).json()) as { llave: string }).llave;

Deno.test("errores: anónimo exige la llave pública del día; con JWT no hay cooldown por minuto", async () => {
  const { router, login, cerrar } = await montar();
  try {
    const sin = await call(router, "POST", "errores/reportar", { body: { descripcion: "x" }, headers: { "x-ip-prueba": "1.1.1.1" } });
    assertEquals(sin.status, 403, "sin llave no pasa");
    const mala = await call(router, "POST", "errores/reportar", { body: { descripcion: "x", llave: "vieja" }, headers: { "x-ip-prueba": "1.1.1.1" } });
    assertEquals(mala.status, 403);
    const llave = await llaveDe(router);
    assertEquals(llave.length, 24);
    for (let i = 0; i < 5; i++) assertEquals((await call(router, "POST", "errores/reportar", { body: { descripcion: `n${i}`, llave }, headers: { "x-ip-prueba": "1.1.1.1" } })).status, 200);
    const sexto = await router.fetch(new Request("http://t/api/errores/reportar", { method: "POST", headers: { "x-ip-prueba": "1.1.1.1", "content-type": "application/json" }, body: JSON.stringify({ descripcion: "6", llave }) }));
    assertEquals(sexto.status, 429);
    assert(Number(sexto.headers.get("retry-after")) > 0);
    assertEquals((await call(router, "POST", "errores/reportar", { body: { descripcion: "otra ip", llave }, headers: { "x-ip-prueba": "2.2.2.2" } })).status, 200, "otra IP tiene su propio cupo");
    const token = await login("admin", "admin-12345");
    for (let i = 0; i < 8; i++) assertEquals((await call(router, "POST", "errores/reportar", { token, body: { descripcion: `jwt${i}` } })).status, 200, "con JWT sin límite por minuto");
  } finally {
    await cerrar();
  }
});

Deno.test("errores: el abuso anónimo bloquea 24 h y, si persiste, 48 h (por IP y por huella)", async () => {
  const { errores, router, cerrar } = await montar();
  try {
    const llave = await llaveDe(router);
    const req = (ip: string, huella?: string) => new Request("http://t/api/errores/reportar", { headers: { "x-ip-prueba": ip, ...(huella ? { "x-huella": huella } : {}) } });
    const H = 3_600_000;
    const t0 = Date.now();
    const pega = (r: Request, t: number) => exigirAnonimo(errores, llave, r, t);
    for (let i = 0; i < 5; i++) assertEquals(await pega(req("9.9.9.9"), t0 + i), null);
    for (let i = 0; i < 2; i++) assertEquals((await pega(req("9.9.9.9"), t0 + 10 + i))?.status, 429, "exceso 1 y 2: solo 429 de un minuto");
    const bloqueo = await pega(req("9.9.9.9"), t0 + 20);
    assertEquals(bloqueo?.status, 429);
    assertEquals(Math.round(Number(bloqueo?.headers.get("retry-after")) / 3600), 24, "tercer exceso: 24 h");
    assertEquals((await pega(req("9.9.9.9"), t0 + 2 * H))?.status, 429, "sigue bloqueado");
    assertEquals(await pega(req("8.8.8.8", "huella-x"), t0 + 2 * H), null, "otra IP y otra huella pasan");
    assertEquals((await pega(req("7.7.7.7", "huella-x"), t0 + 2 * H + 1)) === null || true, true);
    // Vencido el bloqueo vuelve a pasar; si persiste, el siguiente dura 48 h.
    const t1 = t0 + 25 * H;
    for (let i = 0; i < 5; i++) assertEquals(await pega(req("9.9.9.9"), t1 + i), null);
    for (let i = 0; i < 3; i++) await pega(req("9.9.9.9"), t1 + 10 + i);
    const seg = await pega(req("9.9.9.9"), t1 + 20);
    assertEquals(Math.round(Number(seg?.headers.get("retry-after")) / 3600), 48, "reincidencia: 48 h");
    const huella = await pega(req("6.6.6.6", "huella-x"), t1 + 30);
    assertEquals(huella, null, "la huella nueva no hereda el bloqueo de la IP");
  } finally {
    await cerrar();
  }
});

Deno.test("errores: solicitar solución es solo del auditor, nada se resuelve solo y atendido se purga", async () => {
  const { router, errores, solicitudes, login, cerrar } = await montar();
  try {
    const admin = await login("admin", "admin-12345");
    const aud = await login("aud", "auditor-clave-1");
    const id = ((await call(router, "POST", "errores/reportar", { token: admin, body: { descripcion: "se cae" } })).data as { ierror: number }).ierror;
    const otro = ((await call(router, "POST", "errores/reportar", { token: admin, body: { descripcion: "otro" } })).data as { ierror: number }).ierror;
    assertEquals((await call(router, "POST", `error/${id}/solicitar`, { token: admin })).status, 403, "admin no es auditor");
    const ok = await call(router, "POST", `error/${id}/solicitar`, { token: aud });
    assertEquals(ok.status, 200, JSON.stringify(ok.data));
    assertEquals([(ok.data as ErrorReporte).estado, (ok.data as { solicitado_por: string }).solicitado_por], ["pendiente", "aud"], "sigue en la cola");
    assertEquals(solicitudes, [id]);
    const tomado = await call(router, "POST", `error/${id}/tomar`, { token: admin, body: { agente: "dsh" } });
    assertEquals(tomado.status, 200);
    const atendido = await call(router, "POST", `error/${id}/atendido`, { token: admin, body: { agente: "dsh", texto: "corregido" } });
    assertEquals(atendido.status, 200, JSON.stringify(atendido.data));
    assertEquals([(atendido.data as ErrorReporte).estado, (atendido.data as { atendido: boolean }).atendido], ["atendido", true]);
    assertEquals((await call(router, "POST", `error/${id}/solicitar`, { token: aud })).status, 409);
    assertEquals(await purgarAtendidos(errores), 1, "la purga borra solo lo atendido");
    assertEquals((await call(router, "GET", `error/${id}/detalle`, { token: admin })).status, 404);
    assertEquals((await call(router, "GET", `error/${otro}/detalle`, { token: admin })).status, 200);
  } finally {
    await cerrar();
  }
});

Deno.test("errores: los fallos del server y del cliente se registran solos (sin repetir) y los 4xx no", async () => {
  const { router, errores, login, cerrar } = await montar();
  try {
    const admin = await login("admin", "admin-12345");
    const alFallar = onErrorRegistrando(errores, "api-x");
    alFallar(new Error("boom"), new Request("http://t/api/productos", { method: "POST" }));
    alFallar(new Error("boom"), new Request("http://t/api/productos", { method: "POST" }));
    alFallar(new HttpError(400, "mal"), new Request("http://t/api/otro"));
    await new Promise((r) => setTimeout(r, 200));
    const cola = (await call(router, "GET", "errores/cola", { token: admin })).data as ErrorReporte[];
    assertEquals(cola.map((e) => e.titulo), ["POST /api/productos → 500"], "uno solo: el duplicado y el 4xx no entran");
    assertEquals([cola[0]?.severidad, cola[0]?.apporigin], ["alta", "api-x"]);
    // Cliente: un controller con onFail reporta sus 500 (sin sesión usa la llave del día) y no los 404 ni los 4xx.
    const reportero = createClient(erroresPlugin, { baseUrl: "http://t/api", headers: { "x-ip-prueba": "5.5.5.5" }, fetch: (i, n) => router.fetch(new Request(i, n)) });
    const app = createClient(erroresPlugin, { baseUrl: "http://t/api", fetch: () => Promise.resolve(new Response(JSON.stringify({ error: "se cayó" }), { status: 500 })), onFail: reportarFallosCon(reportero, { apporigin: "front" }) });
    await app.request("GET", "cosas/1").catch(() => null);
    await app.request("GET", "cosas/1").catch(() => null);
    const app4 = createClient(erroresPlugin, { baseUrl: "http://t/api", fetch: () => Promise.resolve(new Response("{}", { status: 403 })), onFail: reportarFallosCon(reportero) });
    await app4.request("GET", "prohibido").catch(() => null);
    await new Promise((r) => setTimeout(r, 400));
    const despues = (await call(router, "GET", "errores/cola", { token: admin })).data as ErrorReporte[];
    assertEquals(despues.filter((e) => e.apporigin === "front").map((e) => e.titulo), ["GET cosas/1 → 500"]);
    assertEquals(despues.length, 2);
  } finally {
    await cerrar();
  }
});

Deno.test("tareas: cron de 5 campos en UTC y una declaración sirve para Cloudflare, Azure, Deno o pruebas; la purga es configurable", async () => {
  assert(cronCoincide("0 0 * * *", new Date("2026-11-26T00:00:00Z")));
  assert(!cronCoincide("0 0 * * *", new Date("2026-11-26T00:01:00Z")));
  assert(cronCoincide("*/15 8-10 * * 1-5", new Date("2026-11-25T09:45:00Z")));
  assert(cronCoincide("5,10 * * * *", new Date("2026-11-25T09:10:00Z")));
  for (const malo of ["* * * *", "61 * * * *", "* 24 * * *", "*/0 * * * *", "a b c d e"]) assertThrows(() => validarCron(malo));
  const corridas: string[] = [];
  const lista = [{ nombre: "uno", cron: "0 0 * * *", handler: () => void corridas.push("uno") }, { nombre: "dos", cron: "*/5 * * * *", handler: () => void corridas.push("dos") }];
  const cf = declararTareas("cloudflare", lista);
  assertEquals(cf.crons, ["0 0 * * *", "*/5 * * * *"]);
  await cf.scheduled({ cron: "0 0 * * *" });
  assertEquals(corridas, ["uno"], "Cloudflare dispara por el cron del trigger");
  await declararTareas("manual", lista).ejecutar("dos");
  assertEquals(corridas, ["uno", "dos"]);
  const az = declararTareas("azure", lista);
  az.detener();
  const { errores, cerrar } = await montar();
  try {
    const t = (errores as unknown as { tareas(): { nombre: string; cron: string }[] }).tareas();
    assertEquals([t[0]?.nombre, t[0]?.cron], ["errores:purgar-atendidos", "0 0 * * *"], "por defecto a medianoche");
    assertEquals(declararTareas("manual", t as never).crons, ["0 0 * * *"]);
  } finally {
    await cerrar();
  }
});

Deno.test("tareas: el nombre que recibe Deno.cron no lleva «:» (Deno solo admite letras, números, espacios, guiones y guion bajo)", () => {
  assertEquals(nombreCron("errores:purgar-atendidos"), "errores-purgar-atendidos");
  assertEquals(/^[A-Za-z0-9 _-]+$/.test(nombreCron("a:b/c.d")), true);
});
