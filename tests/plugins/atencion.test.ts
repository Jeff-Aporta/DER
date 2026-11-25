/**
 * El plugin de atención omnicanal en DOS motores (SQLite y PGlite): entrantes idempotentes con cliente y código de 4
 * dígitos, aislamiento por empresa, matriz canal × capacidad, ventana de 24 h de WhatsApp, modo auto/entrenamiento
 * (enviar, corregir, reportar, descartar), calificación del cliente final con plazo y bloqueo por fuerza bruta, y la
 * sesión HTTP resuelta por el CRM (el plugin no depende de él).
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { pgliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/pglite.ts";
import { type Borrador, CABECERA_EMPRESA, crearAtencion, crearCrm, identityServer, type LoginCrmResult, type MensajeAtencion, type VistaCalificacion } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { call, identityCfg } from "@Jeff-Aporta/DER/tests/_util.ts";

const MOTORES = [["sqlite", () => sqliteDatabase()], ["pglite", () => pgliteDatabase()]] as const;
const CLAVE = "clave-segura-123";

async function montar(fabrica: () => ReturnType<typeof sqliteDatabase>) {
  registry.secure(null);
  const db = fabrica();
  const entregados: MensajeAtencion[] = [];
  const auth = createServer(identityServer, { db, cfg: identityCfg() });
  const crm = crearCrm({ db, cfg: { empresas: [{ iempresa: "acme", nombre: "Acme", miembros: [{ iusuario: "ana", rol: "agente" }] }, { iempresa: "zeta", nombre: "Zeta", miembros: [{ iusuario: "caro", rol: "agente" }] }] }, services: { login: (i: { usuario: string; password: string }, req?: Request) => (auth as unknown as { login(i: unknown, r?: Request): Promise<never> }).login(i, req) } });
  const at = crearAtencion({
    db,
    cfg: { plazoCalificacionDias: 10, maxIntentosCodigo: 3, canales: [{ iempresa: "acme", canal: "whatsapp", icuenta: "wa-1", nombre: "Soporte Acme" }, { iempresa: "acme", canal: "telegram", icuenta: "tg-1", nombre: "Bot Acme", modo: "auto" }, { iempresa: "zeta", canal: "whatsapp", icuenta: "wa-2", nombre: "Soporte Zeta" }] },
    services: {
      contexto: async (req: Request, sesion: { id?: string } | null | undefined) => {
        const c = await crm.contexto(String(sesion?.id), req.headers.get(CABECERA_EMPRESA));
        return { iusuario: c.iusuario, iempresa: c.iempresa, rol: c.rol };
      },
      entregar: (_c: unknown, _cl: unknown, m: MensajeAtencion) => {
        entregados.push(m);
        return { iexterno: `ext-${entregados.length}` };
      },
    },
  });
  const router = createRouter([], { basePath: "/api", plugins: [auth, crm, at] });
  await router.seed();
  const usuarios = auth.controllers["usuarios"]!;
  for (const u of ["ana", "caro"]) await usuarios.post(usuarios.pojo({ iusuario: u, password: CLAVE }));
  const entrar = async (usuario: string, empresa: string) => ((await call(router, "POST", "crm/login", { body: { empresa, usuario, password: CLAVE } })).data as LoginCrmResult).token;
  return { db, router, at, entregados, entrar, cerrar: async () => { registry.secure(null); await db.destroy(); } };
}

const entrante = (icuenta: string, canal: "whatsapp" | "telegram", id: string, texto: string, cliente = "57300") => ({ canal, icuenta, cliente: { iexterno: cliente, nombre: "Cliente", idioma: "es" }, mensaje: { iexterno: id, texto } });

for (const [motor, fabrica] of MOTORES) {
  Deno.test(`atencion (${motor}): el seed vincula los canales; el entrante es idempotente y arma cliente, chat y código`, async () => {
    const { at, cerrar } = await montar(fabrica);
    try {
      assertEquals((await at.canalDe("whatsapp", "wa-1"))?.iempresa, "acme");
      await assertRejects(() => at.registrarCanal({ iempresa: "zeta", canal: "whatsapp", icuenta: "wa-1", nombre: "robado" }), Error, "otra empresa");
      const r = await at.registrarEntrante(entrante("wa-1", "whatsapp", "wamid.1", "Hola"));
      assertEquals([r.nuevo, r.modo, r.chat?.codigo.length], [true, "entrenamiento", 4]);
      const otra = await at.registrarEntrante(entrante("wa-1", "whatsapp", "wamid.1", "Hola"));
      assertEquals([otra.nuevo, otra.mensaje?.id], [false, r.mensaje?.id]);
      const segundo = await at.registrarEntrante(entrante("wa-1", "whatsapp", "wamid.2", "¿Hay alguien?"));
      assertEquals(segundo.chat?.id, r.chat?.id, "un cliente, un chat por canal");
      assertEquals((await at.registrarEntrante(entrante("desconocido", "whatsapp", "w3", "x"))).canal, null);
      const tg = await at.registrarEntrante(entrante("tg-1", "telegram", "m1", "hola", "777"));
      assertEquals(tg.modo, "auto");
      assertEquals((await at.mensajes("acme", r.chat!.id)).map((m) => m.texto), ["Hola", "¿Hay alguien?"]);
      await assertRejects(() => at.mensajes("zeta", r.chat!.id), Error, "No existe");
      assertEquals((await at.chats("zeta")).length, 0, "zeta no ve los chats de acme");
    } finally {
      await cerrar();
    }
  });

  Deno.test(`atencion (${motor}): matriz canal × capacidad y ventana de 24 h de WhatsApp`, async () => {
    const { at, entregados, cerrar } = await montar(fabrica);
    try {
      const wa = await at.registrarEntrante(entrante("wa-1", "whatsapp", "w1", "Hola"));
      const tg = await at.registrarEntrante(entrante("tg-1", "telegram", "t1", "Hola", "9"));
      const m = await at.enviar("acme", { ichat: wa.chat!.id, texto: "Te ayudo", iusuario: "ana", ireply: wa.mensaje!.id });
      assertEquals([m.estado, m.iexterno, m.origen, m.ireply], ["enviado", "ext-1", "usuario", wa.mensaje!.id]);
      assertEquals(entregados.length, 1);
      await assertRejects(() => at.enviar("acme", { ichat: wa.chat!.id, tipo: "encuesta", contenido: { p: "?" }, iusuario: "ana" }), Error, "no permite");
      await assertRejects(() => at.enviar("acme", { ichat: tg.chat!.id, tipo: "plantilla", contenido: { n: "x" }, iusuario: "ana" }), Error, "no permite");
      assertEquals((await at.enviar("acme", { ichat: tg.chat!.id, tipo: "encuesta", contenido: { p: "¿Cómo te fue?", o: ["bien", "mal"] }, iusuario: "ana" })).tipo, "encuesta");
      assertEquals((await at.enviar("acme", { ichat: wa.chat!.id, tipo: "ubicacion", contenido: { lat: 4.5, lng: -75.6 }, iusuario: "ana" })).tipo, "ubicacion");
      await assertRejects(() => at.enviar("zeta", { ichat: wa.chat!.id, texto: "x", iusuario: "caro" }), Error, "No existe");
      await assertRejects(() => at.enviar("acme", { ichat: wa.chat!.id, texto: "  ", iusuario: "ana" }), Error, "texto");
      // Ventana vencida: solo plantilla.
      await at.registrarEntrante({ ...entrante("wa-1", "whatsapp", "w-viejo", "viejo", "58"), mensaje: { iexterno: "w-viejo", texto: "viejo", fh: new Date(Date.now() - 30 * 3600_000).toISOString() } });
      const viejo = (await at.chats("acme")).find((c) => c.codigo && c.id !== wa.chat!.id && c.icanal === wa.chat!.icanal)!;
      await assertRejects(() => at.enviar("acme", { ichat: viejo.id, texto: "tarde", iusuario: "ana" }), Error, "ventana");
      assertEquals((await at.enviar("acme", { ichat: viejo.id, tipo: "plantilla", contenido: { nombre: "recordatorio" }, iusuario: "ana" })).estado, "enviado");
    } finally {
      await cerrar();
    }
  });

  Deno.test(`atencion (${motor}): modo auto responde solo; entrenamiento deja borrador que el humano envía, corrige, reporta o descarta`, async () => {
    const { at, cerrar } = await montar(fabrica);
    try {
      const tg = await at.registrarEntrante(entrante("tg-1", "telegram", "t1", "Hola", "9"));
      const auto = await at.proponer("acme", { ichat: tg.chat!.id, texto: "¡Hola!" });
      assertEquals([auto.enviado, auto.mensaje?.origen], [true, "bot"]);
      const wa = await at.registrarEntrante(entrante("wa-1", "whatsapp", "w1", "Precio?"));
      const p1 = await at.proponer("acme", { ichat: wa.chat!.id, texto: "Cuesta 10" });
      assertEquals([p1.enviado, p1.borrador?.estado], [false, "pendiente"]);
      assertEquals((await at.borradores("acme")).length, 1);
      assertEquals((await at.borradores("zeta")).length, 0);
      const enviado = await at.resolverBorrador("acme", "ana", { id: p1.borrador!.id, accion: "enviar" });
      assertEquals([enviado.mensaje?.origen, enviado.mensaje?.iusuario, enviado.borrador.estado], ["bot", "ana", "enviado"]);
      await assertRejects(() => at.resolverBorrador("acme", "ana", { id: p1.borrador!.id, accion: "enviar" }), Error, "ya se resolvió");
      const p2 = await at.proponer("acme", { ichat: wa.chat!.id, texto: "Cuesta 10 pesos" });
      const corregido = await at.resolverBorrador("acme", "ana", { id: p2.borrador!.id, accion: "corregir", texto: "Cuesta 10.000 COP", motivo: "falta la moneda" });
      assertEquals([corregido.mensaje?.origen, corregido.mensaje?.texto, corregido.entrenamiento?.clase, corregido.entrenamiento?.propuesto], ["usuario", "Cuesta 10.000 COP", "correccion", "Cuesta 10 pesos"]);
      const p3 = await at.proponer("acme", { ichat: wa.chat!.id, texto: "Saludos cordiales, estimado" });
      await assertRejects(() => at.resolverBorrador("acme", "ana", { id: p3.borrador!.id, accion: "reportar" }), Error, "motivo");
      await assertRejects(() => at.resolverBorrador("zeta", "caro", { id: p3.borrador!.id, accion: "descartar" }), Error, "No existe");
      const rep = await at.resolverBorrador("acme", "ana", { id: p3.borrador!.id, accion: "reportar", motivo: "demasiado formal" });
      assertEquals([rep.borrador.estado, rep.mensaje, rep.entrenamiento?.clase], ["reportado", null, "error_redaccion"]);
      assert((rep.entrenamiento?.jcontexto as unknown[]).length >= 3, "el reporte guarda el contexto de la conversación");
      const p4 = await at.proponer("acme", { ichat: wa.chat!.id, texto: "x" });
      assertEquals((await at.resolverBorrador("acme", "ana", { id: p4.borrador!.id, accion: "descartar" })).borrador.estado, "descartado");
      assertEquals((await at.entrenamientos("acme")).length, 2);
      assertEquals((await at.entrenamientos("zeta")).length, 0);
      // Cambiar el modo: el chat a auto, y luego hereda del canal.
      await at.setModo("acme", { ichat: wa.chat!.id, modo: "auto" });
      assertEquals((await at.proponer("acme", { ichat: wa.chat!.id, texto: "solo" })).enviado, true);
      await at.setModo("acme", { ichat: wa.chat!.id, modo: null });
      assertEquals((await at.proponer("acme", { ichat: wa.chat!.id, texto: "otra vez" })).enviado, false);
      await assertRejects(() => at.setModo("zeta", { ichat: wa.chat!.id, modo: "auto" }), Error, "No existe");
    } finally {
      await cerrar();
    }
  });

  Deno.test(`atencion (${motor}): calificación del cliente final con código, motivos, plazo y bloqueo`, async () => {
    const { at, db, router, cerrar } = await montar(fabrica);
    try {
      const r = await at.registrarEntrante(entrante("wa-1", "whatsapp", "w1", "Hola"));
      const chat = r.chat!;
      const m = await at.enviar("acme", { ichat: chat.id, texto: "Te atiendo", iusuario: "ana" });
      const vista = await call(router, "GET", `atencion/calificacion?ichat=${chat.id}&codigo=${chat.codigo}`);
      assertEquals(vista.status, 200, JSON.stringify(vista.data));
      assertEquals((vista.data as VistaCalificacion).plazoDias, 10);
      assertEquals((vista.data as VistaCalificacion).mensajes.map((x) => [x.id, x.vigente, x.calificacion]), [[m.id, true, null]]);
      const ok = await call(router, "POST", "atencion/calificar", { body: { ichat: chat.id, codigo: chat.codigo, imensaje: m.id, valor: 4, motivos: ["amable", "rápido"] } });
      assertEquals(ok.status, 200, JSON.stringify(ok.data));
      await call(router, "POST", "atencion/calificar", { body: { ichat: chat.id, codigo: chat.codigo, imensaje: m.id, valor: 5 } });
      const despues = (await call(router, "GET", `atencion/calificacion?ichat=${chat.id}&codigo=${chat.codigo}`)).data as VistaCalificacion;
      assertEquals(despues.mensajes[0]?.calificacion, 5, "calificar de nuevo reemplaza la nota");
      assertEquals((await call(router, "POST", "atencion/calificar", { body: { ichat: chat.id, codigo: chat.codigo, imensaje: r.mensaje!.id, valor: 3 } })).status, 404, "el mensaje del cliente no se califica");
      assertEquals((await call(router, "POST", "atencion/calificar", { body: { ichat: chat.id, codigo: chat.codigo, imensaje: m.id, valor: 9 } })).status, 400);
      // Plazo vencido: el mensaje se envejece 11 días directamente en la base.
      const viejo = new Date(Date.now() - 11 * 86_400_000).toISOString();
      await at.controllers["mensajes"]!.put(at.controllers["mensajes"]!.pojo({ id: m.id, fhcre: viejo }));
      const vencido = await call(router, "POST", "atencion/calificar", { body: { ichat: chat.id, codigo: chat.codigo, imensaje: m.id, valor: 1 } });
      assertEquals(vencido.status, 400);
      assert(JSON.stringify(vencido.data).includes("venció"));
      assertEquals(((await call(router, "GET", `atencion/calificacion?ichat=${chat.id}&codigo=${chat.codigo}`)).data as VistaCalificacion).mensajes[0]?.vigente, false);
      // Código malo: 404 y, tras 3 fallos, 429 aunque luego venga el código bueno.
      const malo = chat.codigo === "0000" ? "1111" : "0000";
      for (let i = 0; i < 3; i++) assertEquals((await call(router, "GET", `atencion/calificacion?ichat=${chat.id}&codigo=${malo}`)).status, 404);
      assertEquals((await call(router, "GET", `atencion/calificacion?ichat=${chat.id}&codigo=${chat.codigo}`)).status, 429);
      void db;
    } finally {
      await cerrar();
    }
  });

  Deno.test(`atencion (${motor}): las rutas HTTP usan la empresa activa del CRM y no cruzan empresas`, async () => {
    const { at, router, entrar, cerrar } = await montar(fabrica);
    try {
      const r = await at.registrarEntrante(entrante("wa-1", "whatsapp", "w1", "Hola"));
      const ana = await entrar("ana", "acme");
      const caro = await entrar("caro", "zeta");
      assertEquals((await call(router, "GET", "atencion/chats")).status, 401);
      const chats = await call(router, "GET", "atencion/chats", { token: ana });
      assertEquals(chats.status, 200, JSON.stringify(chats.data));
      assertEquals((chats.data as { id: string }[]).map((c) => c.id), [r.chat!.id]);
      assertEquals(((await call(router, "GET", "atencion/chats", { token: caro })).data as unknown[]).length, 0);
      assertEquals((await call(router, "GET", `atencion/mensajes?ichat=${r.chat!.id}`, { token: caro })).status, 404);
      const env = await call(router, "POST", "atencion/enviar", { token: ana, body: { ichat: r.chat!.id, texto: "Hola cliente" } });
      assertEquals((env.data as MensajeAtencion).iusuario, "ana", "el usuario sale de la sesión, no del cuerpo");
      assertEquals((await call(router, "POST", "atencion/enviar", { token: caro, body: { ichat: r.chat!.id, texto: "intruso" } })).status, 404);
      const p = await at.proponer("acme", { ichat: r.chat!.id, texto: "borrador" });
      const lista = (await call(router, "GET", "atencion/borradores", { token: ana })).data as Borrador[];
      assertEquals(lista.length, 1);
      const res = await call(router, "POST", "atencion/borradores/resolver", { token: ana, body: { id: p.borrador!.id, accion: "descartar" } });
      assertEquals(res.status, 200, JSON.stringify(res.data));
      const caps = (await call(router, "GET", "atencion/capacidades", { token: ana })).data as Record<string, string[]>;
      assert(caps["whatsapp"]!.includes("plantilla") && !caps["telegram"]!.includes("plantilla"));
    } finally {
      await cerrar();
    }
  });
}
