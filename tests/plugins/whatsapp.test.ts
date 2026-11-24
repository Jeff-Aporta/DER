/**
 * El plugin de WhatsApp por dentro, en DOS motores (SQLite y PGlite) con el mismo seed: el número decide la app, el
 * entrante es idempotente por wamid, la conversación respeta la ventana de 24 h, los estados de Meta se traducen sin
 * retroceder, el historial sale en orden y las rutas `protected` piden sesión.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { pgliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/pglite.ts";
import { crearWhatsapp } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import type { WaConversacion, WaTurno } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { call } from "@Jeff-Aporta/DER/tests/_util.ts";

const PH1 = "1522115044307992";
const PH2 = "2222222222";

const CFG = {
  apps: [{ slug: "chat-assistant", nombre: "Chat Assistant", perfil: "dsh-chat-assistant", contrato: "# Contrato" }, { slug: "peon", nombre: "Peón", bautorespuesta: false }],
  numeros: [{ iphone: PH1, app: "chat-assistant", tipo: "prueba" as const }, { iphone: PH2, app: "peon" }],
};

const MOTORES = [["sqlite", () => sqliteDatabase()], ["pglite", () => pgliteDatabase()]] as const;

/** Payload de Meta con un mensaje de texto (o con estados). */
function entrante(phone: string, from: string, id: string, texto: string, ts = 1770000000) {
  return { object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phone }, contacts: [{ profile: { name: "Jeff" }, wa_id: from }], messages: [{ from, id, timestamp: String(ts), type: "text", text: { body: texto } }] } }] }] };
}

function estado(id: string, status: string) {
  return { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PH1 }, statuses: [{ id, status, timestamp: "1770000100" }] } }] }] };
}

async function montar(fabrica: () => ReturnType<typeof sqliteDatabase>) {
  registry.secure(null);
  const db = fabrica();
  const wa = crearWhatsapp({ db, cfg: CFG });
  await wa.seed();
  return { db, wa, cerrar: async () => { registry.secure(null); await db.destroy(); } };
}

for (const [motor, fabrica] of MOTORES) {
  Deno.test(`whatsapp (${motor}): el seed crea las tablas y deja vinculados los números de la configuración`, async () => {
    const { wa, cerrar } = await montar(fabrica);
    try {
      assertEquals((await wa.numeros()).map((n) => [n.iphone, n.app]), [[PH1, "chat-assistant"], [PH2, "peon"]]);
      assertEquals((await wa.appDeNumero(PH1))?.perfil, "dsh-chat-assistant");
      assertEquals(await wa.appDeNumero("999"), null, "un número sin vincular no tiene app");
      await wa.seed();
      assertEquals((await wa.numeros()).length, 2, "el seed es idempotente");
    } finally {
      await cerrar();
    }
  });

  Deno.test(`whatsapp (${motor}): un reintento de Meta con el mismo wamid no duplica ni pide otra respuesta`, async () => {
    const { wa, cerrar } = await montar(fabrica);
    try {
      const a = await wa.procesarWebhook(entrante(PH1, "573100000000", "wamid.A", "hola"));
      assertEquals([a.entrantes, a.nuevos.length, a.eventos], [1, 1, 1]);
      assertEquals(a.nuevos[0]?.app?.slug, "chat-assistant");
      const b = await wa.procesarWebhook(entrante(PH1, "573100000000", "wamid.A", "hola"));
      assertEquals([b.entrantes, b.nuevos.length], [1, 0]);
      assertEquals((await wa.historial(a.nuevos[0]!.conversacion.id)).length, 1);
    } finally {
      await cerrar();
    }
  });

  Deno.test(`whatsapp (${motor}): cada número tiene su conversación y su app; el desconocido no se pierde`, async () => {
    const { wa, cerrar } = await montar(fabrica);
    try {
      const [x] = (await wa.procesarWebhook(entrante(PH1, "573100000000", "wamid.B1", "hola"))).nuevos;
      const [y] = (await wa.procesarWebhook(entrante(PH2, "573100000000", "wamid.B2", "despacho"))).nuevos;
      const [z] = (await wa.procesarWebhook(entrante("999", "573100000000", "wamid.B3", "¿hola?"))).nuevos;
      assertEquals(x!.contacto.id, y!.contacto.id, "mismo contacto");
      assert(x!.conversacion.id !== y!.conversacion.id, "una conversación por número");
      assertEquals([x!.app?.slug, y!.app?.slug, z!.app], ["chat-assistant", "peon", null]);
      assertEquals(y!.app?.bautorespuesta, false);
      assertEquals((await wa.conversaciones()).length, 3);
      assertEquals((await wa.conversaciones(PH2)).map((c: WaConversacion) => c.app), ["peon"]);
    } finally {
      await cerrar();
    }
  });

  Deno.test(`whatsapp (${motor}): la ventana de 24 h se extiende con cada entrante y al vencer abre otra conversación`, async () => {
    const { wa, cerrar } = await montar(fabrica);
    try {
      const t0 = 1770000000;
      const [a] = (await wa.procesarWebhook(entrante(PH1, "573100000000", "wamid.C1", "uno", t0))).nuevos;
      const [b] = (await wa.procesarWebhook(entrante(PH1, "573100000000", "wamid.C2", "dos", t0 + 20 * 3600))).nuevos;
      assertEquals(a!.conversacion.id, b!.conversacion.id, "dentro de la ventana se reusa");
      assert(await wa.ventanaAbierta(b!.conversacion.id, new Date((t0 + 43 * 3600) * 1000).toISOString()), "el segundo entrante extendió la ventana");
      const [c] = (await wa.procesarWebhook(entrante(PH1, "573100000000", "wamid.C3", "tres", t0 + 70 * 3600))).nuevos;
      assert(c!.conversacion.id !== a!.conversacion.id, "vencida, se abre otra");
      const vieja = (await wa.conversaciones()).find((x: WaConversacion) => x.id === a!.conversacion.id);
      assertEquals(vieja?.estado, "cerrada");
    } finally {
      await cerrar();
    }
  });

  Deno.test(`whatsapp (${motor}): saliente, estados traducidos sin retroceder e historial cronológico para el modelo`, async () => {
    const { wa, cerrar } = await montar(fabrica);
    try {
      const [e] = (await wa.procesarWebhook(entrante(PH1, "573100000000", "wamid.D1", "¿cuánto debo?"))).nuevos;
      const conv = e!.conversacion.id;
      const s = await wa.guardarSaliente({ iconversacion: conv, texto: "Necesito el periodo.", wamid: "wamid.OUT" });
      assertEquals(s.estado, "enviado");
      assertEquals((await wa.guardarSaliente({ iconversacion: conv, texto: "Necesito el periodo.", wamid: "wamid.OUT" })).id, s.id, "idempotente por wamid");
      const f = await wa.guardarSaliente({ iconversacion: conv, texto: "no salió", estado: "fallido", error: "131047 Re-engagement message" });
      assertEquals([f.estado, f.wamid], ["fallido", null]);
      await wa.procesarWebhook(estado("wamid.OUT", "read"));
      await wa.procesarWebhook(estado("wamid.OUT", "delivered"));
      const h: WaTurno[] = await wa.historial(conv);
      assertEquals(h.map((t) => [t.role, t.content]), [["user", "¿cuánto debo?"], ["assistant", "Necesito el periodo."], ["assistant", "no salió"]]);
      const r = await wa.actualizarEstado({ wamid: "wamid.OUT", status: "sent" });
      assertEquals(r?.estado, "leido", "un estado tardío no retrocede");
      assertEquals((await wa.actualizarEstado({ wamid: "wamid.D1", status: "failed", error: "x" }))?.estado, "fallido");
      assertEquals(await wa.actualizarEstado({ wamid: "wamid.AJENO", status: "read" }), null);
    } finally {
      await cerrar();
    }
  });
}

Deno.test("whatsapp: vincular otro número es solo configuración, y a una app inexistente es 400", async () => {
  const { wa, cerrar } = await montar(() => sqliteDatabase());
  try {
    await wa.vincularNumero({ iphone: "3333", app: "peon", display: "+57 300" });
    assertEquals((await wa.appDeNumero("3333"))?.slug, "peon");
    await wa.vincularNumero({ iphone: "3333", app: "chat-assistant" });
    assertEquals((await wa.appDeNumero("3333"))?.slug, "chat-assistant", "mover un número de app");
    await assertRejects(() => wa.vincularNumero({ iphone: "4444", app: "no-existe" }), Error, "no existe");
    await wa.vincularApp({ slug: "peon", bactivo: false });
    assertEquals(await wa.appDeNumero(PH2), null, "app inactiva: el número queda sin app");
  } finally {
    await cerrar();
  }
});

Deno.test("whatsapp: las rutas son protected (sin sesión 401) y con sesión devuelven el historial", async () => {
  registry.secure(null);
  const db = sqliteDatabase();
  const wa = crearWhatsapp({ db, cfg: CFG });
  const router = createRouter([], { basePath: "/api", plugins: [wa] });
  registry.secure({ extract: (req: Request) => (req.headers.get("x-usuario") ? { id: String(req.headers.get("x-usuario")), claims: { roles: [], grupos: [] } } : null) });
  try {
    await router.seed();
    const [e] = (await wa.procesarWebhook(entrante(PH1, "573100000000", "wamid.H1", "hola"))).nuevos;
    const sin = await call(router, "GET", `whatsapp/historial?iconversacion=${e!.conversacion.id}`);
    assertEquals(sin.status, 401);
    const con = await call(router, "GET", `whatsapp/historial?iconversacion=${e!.conversacion.id}`, { headers: { "x-usuario": "admin" } });
    assertEquals(con.status, 200, JSON.stringify(con.data));
    assertEquals(con.data, [{ role: "user", content: "hola" }]);
    const v = await call(router, "POST", "whatsapp/vincular", { body: { iphone: "5555", app: "peon" }, headers: { "x-usuario": "admin" } });
    assertEquals(v.status, 200, JSON.stringify(v.data));
  } finally {
    registry.secure(null);
    await db.destroy();
  }
});
