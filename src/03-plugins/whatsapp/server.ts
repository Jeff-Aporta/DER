/**
 * Plugin de WhatsApp (server): el transversal con los comportamientos del gateway como verbos de servidor.
 *
 * - `registrarEntrante` es idempotente por `wamid`: un reintento de Meta devuelve `nuevo: false` y no duplica nada.
 * - `abrirConversacion` reusa la conversación abierta del contacto con ESE número mientras su ventana de 24 h siga
 *   vigente (cada entrante la extiende); vencida, la cierra y abre otra. Un saliente nunca abre ni extiende ventana.
 * - `actualizarEstado` traduce `sent`/`delivered`/`read`/`failed` y nunca retrocede (un `delivered` tardío no pisa
 *   un `read`).
 * - `historial` da los turnos (user/assistant) en orden cronológico para el modelo.
 * - `procesarWebhook` recorre el JSON de Meta: guarda el evento crudo, los entrantes y los estados.
 * - `seed()` crea las tablas en el motor que sea (SQLite, PostgreSQL, PGlite, D1…) y deja creadas las apps y los
 *   números de `cfg`: cambiar de base es volver a correr el seed.
 *
 * ```ts
 * const wa = crearWhatsapp({ db, cfg: { apps: [{ slug: "chat", nombre: "Chat" }], numeros: [{ iphone: "1522115044307992", app: "chat" }] } });
 * await wa.seed();
 * const { nuevos } = await wa.procesarWebhook(JSON.parse(cuerpoCrudo));
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/whatsapp.md
 */
import type { z } from "zod";
import { Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type { ExtraRouteInput, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { randomId } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { whatsappPlugin } from "@Jeff-Aporta/DER/src/03-plugins/whatsapp/index.ts";
import { ESTADOS_META, ORDEN_ESTADOS, VENTANA_HORAS, type VerbosWhatsapp, type WaApp, type WaAppInput, type WaContacto, type WaConversacion, type WaEntrante, type WaEntranteInput, type WaEstadoInput, type WaEvento, type WaMensaje, type WaNumero, type WaNumeroInput, type WaSalienteInput, type WaTurno, type WaWebhook, type WhatsappConfig, ZWaApp, ZWaEntrante, ZWaEstado, ZWaNumero, ZWaSaliente, ZWhatsappConfig } from "@Jeff-Aporta/DER/src/03-plugins/whatsapp/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/whatsapp/index.ts";

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

const fila = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && "toJSON" in p && typeof (p as { toJSON: unknown }).toJSON === "function" ? (p as { toJSON(): Record<string, unknown> }).toJSON() : (p as Record<string, unknown>));

const ctrl = (plugin: ServerPlugin, nombre: string) => plugin.controllers[nombre]!;

const cfgDe = (plugin: ServerPlugin): WhatsappConfig => (plugin.cfg ?? {}) as WhatsappConfig;

/** Milisegundos de una fecha (texto ISO o Date, según el motor). */
function ms(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  return Date.parse(String(v));
}

/** Fecha en ISO (las columnas `datetime` se guardan así en todos los motores). */
const iso = (t: number): string => new Date(t).toISOString();

/** Id ordenable por llegada (base 36 del reloj + azar): el historial se ordena por id sin empates. */
const idNuevo = (): string => `${Date.now().toString(36).padStart(9, "0")}${randomId(6)}`;

/** Un registro por PK, como fila plana (o null). */
async function porPk<T>(plugin: ServerPlugin, entidad: string, pk: Record<string, unknown>): Promise<T | null> {
  const c = ctrl(plugin, entidad);
  const p = await c.get(c.pojo(pk), { include: {} } as never);
  return p ? (fila(p) as T) : null;
}

/** Inserta o cambia por PK (merge con lo que había) y devuelve la fila final. */
async function guardar<T>(plugin: ServerPlugin, entidad: string, pk: Record<string, unknown>, datos: Record<string, unknown>): Promise<T> {
  const c = ctrl(plugin, entidad);
  const previa = await porPk<Record<string, unknown>>(plugin, entidad, pk);
  const final = { ...(previa ?? {}), ...datos, ...pk };
  if (previa) await c.put(c.pojo(final));
  else await c.post(c.pojo(final));
  return final as T;
}

/** Alta o cambio de una app (contrato, perfil del bot, autorespuesta). */
async function vincularApp(plugin: ServerPlugin, input: WaAppInput): Promise<WaApp> {
  const d = validado<WaAppInput>(ZWaApp, input);
  const previa = await porPk<WaApp>(plugin, "apps", { slug: d.slug });
  const datos: Record<string, unknown> = { nombre: d.nombre ?? previa?.nombre ?? d.slug, fhcre: previa?.fhcre ?? iso(Date.now()) };
  for (const k of ["perfil", "contrato", "jconfig", "bautorespuesta", "bactivo"] as const) if (d[k] !== undefined) datos[k] = d[k];
  if (!previa) datos["bautorespuesta"] ??= true;
  if (!previa) datos["bactivo"] ??= true;
  return await guardar<WaApp>(plugin, "apps", { slug: d.slug }, datos);
}

/** Vincula (o mueve) un número a una app existente: vincular otro número es solo esto. */
async function vincularNumero(plugin: ServerPlugin, input: WaNumeroInput): Promise<WaNumero> {
  const d = validado<WaNumeroInput>(ZWaNumero, input);
  if (!(await porPk<WaApp>(plugin, "apps", { slug: d.app }))) throw new ValidationError(`La app "${d.app}" no existe: créala antes de vincularle un número`);
  const previo = await porPk<WaNumero>(plugin, "numeros", { iphone: d.iphone });
  const datos: Record<string, unknown> = { app: d.app, fhcre: previo?.fhcre ?? iso(Date.now()) };
  for (const k of ["display", "nombre", "tipo", "bactivo"] as const) if (d[k] !== undefined) datos[k] = d[k];
  if (!previo) datos["tipo"] ??= "prueba";
  if (!previo) datos["bactivo"] ??= true;
  return await guardar<WaNumero>(plugin, "numeros", { iphone: d.iphone }, datos);
}

/** Los números activos. */
async function numeros(plugin: ServerPlugin): Promise<WaNumero[]> {
  return (await ctrl(plugin, "numeros").query({ where: { bactivo: true }, orderBy: ["iphone"] } as never)).map(fila) as WaNumero[];
}

/** La app activa que atiende un número (null si el número no está vinculado o su app está inactiva). */
async function appDeNumero(plugin: ServerPlugin, iphone: string): Promise<WaApp | null> {
  const n = await porPk<WaNumero>(plugin, "numeros", { iphone });
  if (!n || !n.bactivo) return null;
  const a = await porPk<WaApp>(plugin, "apps", { slug: n.app });
  return a && a.bactivo ? a : null;
}

/** El contacto de un `wa_id` (lo crea si no existe; refresca nombre y última actividad). */
async function contactoDe(plugin: ServerPlugin, waid: string, nombre: string | null | undefined, fh: string): Promise<WaContacto> {
  const c = ctrl(plugin, "contactos");
  const [previo] = (await c.query({ where: { waid }, pageSize: 1 } as never)).map(fila) as WaContacto[];
  if (!previo) {
    const nuevo: WaContacto = { id: idNuevo(), waid, nombre: nombre ?? null, fhcre: fh, fhult: fh };
    await c.post(c.pojo(nuevo));
    return nuevo;
  }
  const cambio = { ...previo, nombre: nombre ?? previo.nombre, fhult: fh };
  await c.put(c.pojo(cambio));
  return cambio;
}

/** Reusa la conversación abierta (ventana vigente, o sin ventana aún) o cierra la vencida y abre otra. */
async function abrirConversacion(plugin: ServerPlugin, icontacto: string, iphone: string, entrante = true, fh?: string): Promise<WaConversacion> {
  const c = ctrl(plugin, "conversaciones");
  const ahora = fh ? ms(fh) : Date.now();
  const ventana = (cfgDe(plugin).ventanaHoras ?? VENTANA_HORAS) * 3600_000;
  const [actual] = (await c.query({ where: { icontacto, iphone, estado: "abierta" }, orderBy: ["-id"], pageSize: 1 } as never)).map(fila) as WaConversacion[];
  const vigente = !!actual?.fhventana && ms(actual.fhventana) > ahora;
  if (actual && (vigente || !entrante || !actual.fhventana)) {
    if (!entrante) return actual;
    const hasta = Math.max(actual.fhventana ? ms(actual.fhventana) : 0, ahora + ventana);
    const cambio: WaConversacion = { ...actual, fhventana: iso(hasta), fhult: iso(Math.max(ahora, actual.fhult ? ms(actual.fhult) : 0)) };
    await c.put(c.pojo(cambio));
    return cambio;
  }
  if (actual) await c.put(c.pojo({ ...actual, estado: "cerrada" }));
  const numero = await porPk<WaNumero>(plugin, "numeros", { iphone });
  const nueva: WaConversacion = { id: idNuevo(), icontacto, iphone, app: numero?.app ?? null, estado: "abierta", fhventana: entrante ? iso(ahora + ventana) : null, fhabierta: iso(ahora), fhult: iso(ahora) };
  await c.post(c.pojo(nueva));
  return nueva;
}

/** Un mensaje por su `wamid` (o null). */
async function porWamid(plugin: ServerPlugin, wamid: string): Promise<WaMensaje | null> {
  const [m] = (await ctrl(plugin, "mensajes").query({ where: { wamid }, pageSize: 1 } as never)).map(fila) as WaMensaje[];
  return m ?? null;
}

/** El resultado de un entrante ya guardado (reintento de Meta): mismas filas, `nuevo: false`. */
async function repetido(plugin: ServerPlugin, mensaje: WaMensaje): Promise<WaEntrante> {
  const conversacion = (await porPk<WaConversacion>(plugin, "conversaciones", { id: mensaje.iconversacion }))!;
  const contacto = (await porPk<WaContacto>(plugin, "contactos", { id: conversacion.icontacto }))!;
  return { nuevo: false, mensaje, conversacion, contacto, app: await appDeNumero(plugin, conversacion.iphone) };
}

/** Guarda un entrante UNA sola vez por `wamid`; abre o reusa la conversación y extiende su ventana. */
async function registrarEntrante(plugin: ServerPlugin, input: WaEntranteInput): Promise<WaEntrante> {
  const d = validado<WaEntranteInput>(ZWaEntrante, input);
  const fh = d.fh ?? iso(Date.now());
  const previo = await porWamid(plugin, d.wamid);
  if (previo) return await repetido(plugin, previo);
  const contacto = await contactoDe(plugin, d.waid, d.nombre, fh);
  const conversacion = await abrirConversacion(plugin, contacto.id, d.iphone, true, fh);
  const mensaje: WaMensaje = { id: idNuevo(), wamid: d.wamid, iconversacion: conversacion.id, direccion: "entrante", tipo: d.tipo ?? "text", texto: d.texto ?? null, estado: "recibido", error: null, jpayload: d.payload ?? null, fhcre: fh, fhestado: fh };
  const c = ctrl(plugin, "mensajes");
  try {
    await c.post(c.pojo(mensaje));
  } catch (e) {
    // Dos entregas simultáneas del mismo wamid: la segunda choca con el UNIQUE y se trata como repetida.
    const ya = await porWamid(plugin, d.wamid);
    if (ya) return await repetido(plugin, ya);
    throw e;
  }
  return { nuevo: true, mensaje, conversacion, contacto, app: await appDeNumero(plugin, d.iphone) };
}

/** Guarda un saliente (enviado con `wamid`, `pendiente` sin él, o `fallido` con su `error`). Idempotente por `wamid`. */
async function guardarSaliente(plugin: ServerPlugin, input: WaSalienteInput): Promise<WaMensaje> {
  const d = validado<WaSalienteInput>(ZWaSaliente, input);
  if (d.wamid) {
    const ya = await porWamid(plugin, d.wamid);
    if (ya) return ya;
  }
  const conv = await porPk<WaConversacion>(plugin, "conversaciones", { id: d.iconversacion });
  if (!conv) throw new ValidationError(`La conversación "${d.iconversacion}" no existe`);
  const fh = iso(Date.now());
  const mensaje: WaMensaje = { id: idNuevo(), wamid: d.wamid ?? null, iconversacion: d.iconversacion, direccion: "saliente", tipo: d.tipo ?? "text", texto: d.texto ?? null, estado: d.estado ?? (d.wamid ? "enviado" : "pendiente"), error: d.error ?? null, jpayload: d.payload ?? null, fhcre: fh, fhestado: fh };
  const c = ctrl(plugin, "mensajes");
  await c.post(c.pojo(mensaje));
  const cc = ctrl(plugin, "conversaciones");
  await cc.put(cc.pojo({ ...conv, fhult: fh }));
  return mensaje;
}

/** Traduce el estado de Meta y lo aplica sin retroceder; null si el `wamid` no es nuestro. */
async function actualizarEstado(plugin: ServerPlugin, input: WaEstadoInput): Promise<WaMensaje | null> {
  const d = validado<WaEstadoInput>(ZWaEstado, input);
  const m = await porWamid(plugin, d.wamid);
  if (!m) return null;
  const estado = ESTADOS_META[d.status] ?? "fallido";
  if (ORDEN_ESTADOS[estado] < ORDEN_ESTADOS[m.estado]) return m;
  const cambio: WaMensaje = { ...m, estado, error: d.error ?? m.error, fhestado: d.fh ?? iso(Date.now()) };
  const c = ctrl(plugin, "mensajes");
  await c.put(c.pojo(cambio));
  return cambio;
}

/** Los últimos `max` turnos con texto de una conversación, en orden cronológico (entrante = user). */
async function historial(plugin: ServerPlugin, iconversacion: string, max?: number): Promise<WaTurno[]> {
  const tope = Math.min(Math.max(max ?? cfgDe(plugin).historial ?? 20, 1), 200);
  const filas = (await ctrl(plugin, "mensajes").query({ where: { iconversacion }, orderBy: ["-id"], pageSize: tope } as never)).map(fila) as WaMensaje[];
  return filas.filter((m) => m.texto).reverse().map((m) => ({ role: m.direccion === "entrante" ? "user" : "assistant", content: String(m.texto) }));
}

/** ¿Se puede mandar texto libre? (ventana de servicio vigente). Fuera de ella solo van plantillas. */
async function ventanaAbierta(plugin: ServerPlugin, iconversacion: string, fh?: string): Promise<boolean> {
  const conv = await porPk<WaConversacion>(plugin, "conversaciones", { id: iconversacion });
  if (!conv?.fhventana || conv.estado !== "abierta") return false;
  return ms(conv.fhventana) > (fh ? ms(fh) : Date.now());
}

/** Guarda el evento crudo del webhook (todo lo que llega, para auditar y reprocesar). */
async function registrarEvento(plugin: ServerPlugin, campo: string, payload: unknown, iphone?: string | null): Promise<WaEvento> {
  const c = ctrl(plugin, "eventos");
  const e: WaEvento = { id: idNuevo(), iphone: iphone ?? null, campo: String(campo || "desconocido").slice(0, 60), jpayload: payload ?? null, fhcre: iso(Date.now()) };
  await c.post(c.pojo(e));
  return e;
}

/** El texto legible de un mensaje de Meta (texto, botón, lista, pie de foto, reacción o ubicación). */
function textoDe(m: Record<string, any>): string | null {
  const t = m["text"]?.body ?? m["button"]?.text ?? m["interactive"]?.button_reply?.title ?? m["interactive"]?.list_reply?.title ?? m["image"]?.caption ?? m["video"]?.caption ?? m["document"]?.caption ?? m["reaction"]?.emoji ?? m["location"]?.name ?? null;
  return t === null || t === undefined ? null : String(t);
}

/** Fecha ISO de un `timestamp` de Meta (segundos); ahora si no viene o no es válido. */
function fhDe(ts: unknown): string {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? iso(n * 1000) : iso(Date.now());
}

/** Recorre el JSON del webhook de Meta: evento crudo por cambio, entrantes (idempotentes) y estados. */
async function procesarWebhook(plugin: ServerPlugin, payload: unknown): Promise<WaWebhook> {
  const r: WaWebhook = { nuevos: [], entrantes: 0, estados: 0, eventos: 0 };
  const entradas = ((payload as { entry?: unknown[] } | null)?.entry ?? []) as Record<string, any>[];
  for (const entry of entradas) {
    for (const change of (entry?.["changes"] ?? []) as Record<string, any>[]) {
      const valor = (change?.["value"] ?? {}) as Record<string, any>;
      const iphone = valor["metadata"]?.phone_number_id ? String(valor["metadata"].phone_number_id) : null;
      await registrarEvento(plugin, String(change?.["field"] ?? "desconocido"), valor, iphone);
      r.eventos++;
      const contactos = (valor["contacts"] ?? []) as Record<string, any>[];
      for (const m of (valor["messages"] ?? []) as Record<string, any>[]) {
        if (!iphone || !m?.["from"] || !m?.["id"]) continue;
        const contacto = contactos.find((x) => x?.["wa_id"] === m["from"]) ?? contactos[0];
        const e = await registrarEntrante(plugin, { iphone, waid: String(m["from"]), wamid: String(m["id"]), nombre: contacto?.["profile"]?.name ?? null, tipo: String(m["type"] ?? "text"), texto: textoDe(m), payload: m, fh: fhDe(m["timestamp"]) });
        r.entrantes++;
        if (e.nuevo) r.nuevos.push(e);
      }
      for (const s of (valor["statuses"] ?? []) as Record<string, any>[]) {
        if (!s?.["id"] || !s?.["status"]) continue;
        const err = (s["errors"] ?? [])[0] as Record<string, any> | undefined;
        await actualizarEstado(plugin, { wamid: String(s["id"]), status: String(s["status"]), error: err ? `${err["code"] ?? ""} ${err["title"] ?? err["message"] ?? ""}`.trim() : null, fh: fhDe(s["timestamp"]) });
        r.estados++;
      }
    }
  }
  return r;
}

/** Las últimas conversaciones (de un número o de todos), por última actividad. */
async function conversaciones(plugin: ServerPlugin, iphone?: string, limite = 50): Promise<WaConversacion[]> {
  const where: Record<string, unknown> = {};
  if (iphone) where["iphone"] = iphone;
  return (await ctrl(plugin, "conversaciones").query({ where, orderBy: ["-fhult"], pageSize: Math.min(Math.max(limite, 1), 200) } as never)).map(fila) as WaConversacion[];
}

/** JSON del server de WhatsApp: `whatsappPlugin` + handlers + verbos de servidor + seed con la configuración. */
export const whatsappServer: ServerPluginDef = Obj.insert(whatsappPlugin, {
  cfg: ZWhatsappConfig,
  entities: {
    conversaciones: { indexes: [{ columns: ["icontacto", "iphone", "estado"], name: "ix_whatsapp_conversaciones_contacto" }] },
    mensajes: { indexes: [{ columns: ["iconversacion", "id"], name: "ix_whatsapp_mensajes_conversacion" }] },
  },
  irregularPaths: {
    conversaciones: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<WaConversacion[]> {
        return await conversaciones(this, i.query.get("iphone") ?? undefined, Number(i.query.get("limite") ?? 50) || 50);
      },
    },
    historial: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<WaTurno[]> {
        const iconversacion = i.query.get("iconversacion");
        if (!iconversacion) throw new ValidationError("Falta `iconversacion`");
        return await historial(this, iconversacion, Number(i.query.get("max") ?? 0) || undefined);
      },
    },
    vincular: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<WaNumero> {
        return await vincularNumero(this, i.body as WaNumeroInput);
      },
    },
  },
  /** En el server, los verbos son métodos directos (sin HTTP): sustituyen a los `ops` de cliente. */
  setup(this: ServerPlugin) {
    const v: VerbosWhatsapp = {
      vincularApp: (input) => vincularApp(this, input),
      vincularNumero: (input) => vincularNumero(this, input),
      numeros: () => numeros(this),
      appDeNumero: (iphone) => appDeNumero(this, iphone),
      registrarEntrante: (input) => registrarEntrante(this, input),
      abrirConversacion: (icontacto, iphone, entrante, fh) => abrirConversacion(this, icontacto, iphone, entrante, fh),
      guardarSaliente: (input) => guardarSaliente(this, input),
      actualizarEstado: (input) => actualizarEstado(this, input),
      historial: (iconversacion, max) => historial(this, iconversacion, max),
      ventanaAbierta: (iconversacion, fh) => ventanaAbierta(this, iconversacion, fh),
      registrarEvento: (campo, payload, iphone) => registrarEvento(this, campo, payload, iphone),
      procesarWebhook: (payload) => procesarWebhook(this, payload),
      conversaciones: (iphone, limite) => conversaciones(this, iphone, limite),
    };
    Object.assign(this, v);
  },
  /** Crea sus tablas (y les suma columnas nuevas) en cualquier motor y deja creadas las apps y números de `cfg`. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
    const cfg = cfgDe(this);
    for (const a of cfg.apps ?? []) await vincularApp(this, a);
    for (const n of cfg.numeros ?? []) await vincularNumero(this, n);
  },
}) as ServerPluginDef;

/** `createServer(whatsappServer, runtime)` con los verbos tipados. */
export function crearWhatsapp(runtime: ServerPluginRuntime): ServerPlugin & VerbosWhatsapp {
  return createServer(whatsappServer, runtime) as ServerPlugin & VerbosWhatsapp;
}
