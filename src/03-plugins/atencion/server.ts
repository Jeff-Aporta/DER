/**
 * Plugin de atención omnicanal (server): el transversal con el comportamiento de la bandeja conversacional.
 *
 * - Aislamiento: cada fila lleva `iempresa`; todo verbo la recibe y NUNCA lee otra (un chat, borrador o mensaje de otra
 *   empresa es 404). Una cuenta del canal (`canal` + `icuenta`) pertenece a UNA sola empresa: de ahí sale a qué empresa
 *   cae cada entrante. En HTTP la empresa y el usuario salen de `services.contexto` (la pone el consumidor, p. ej. el CRM).
 * - `registrarEntrante` es idempotente por `iexterno` (wamid / message_id) y arma cliente, chat (con su código de 4
 *   dígitos) y la ventana de 24 h de WhatsApp.
 * - `enviar` valida el tipo contra la matriz canal × capacidad y la ventana de WhatsApp (fuera de ella solo plantilla);
 *   entrega con `services.entregar` y deja el estado (`enviado` / `fallido` / `pendiente`).
 * - Modo por chat (o el del canal): `auto` = `proponer` envía solo; `entrenamiento` = `proponer` deja un borrador y el
 *   humano lo envía, lo corrige (se guarda el ejemplo), reporta un error de redacción con contexto o lo descarta.
 * - Calificación del cliente final: enlace con id de chat + código de 4 dígitos (comparación en tiempo constante y
 *   bloqueo tras `maxIntentosCodigo` fallos), por mensaje (1 a 5 con motivos) dentro de `plazoCalificacionDias` (10).
 *
 * ```ts
 * const at = crearAtencion({ db, cfg: { canales: [{ iempresa: "acme", canal: "whatsapp", icuenta: "1522115", nombre: "Soporte" }] }, services: { contexto, entregar } });
 * await at.seed();
 * const { chat, mensaje, modo } = await at.registrarEntrante({ canal: "whatsapp", icuenta: "1522115", cliente: { iexterno: "57300…" }, mensaje: { iexterno: "wamid.1", texto: "Hola" } });
 * await at.proponer("acme", { ichat: chat!.id, texto: "¡Hola! ¿En qué te ayudo?" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/atencion.md
 */
import { HttpError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { atencionPlugin } from "@Jeff-Aporta/DER/src/03-plugins/atencion/index.ts";
import { type AtencionConfig, type AtencionServicios, type Borrador, type CalificacionAtencion, type CalificarAtencionInput, CAPACIDADES, type Canal, type CanalAtencion, type CanalInput, type ChatAtencion, type ClienteAtencion, type ContextoAtencion, type Entrenamiento, type EntranteInput, type EntranteResultado, type EnviarAtencionInput, type MensajeAtencion, type ModoInput, PLAZO_CALIFICACION_DIAS, type ProponerInput, type ResolverBorradorInput, type SalienteInput, VENTANA_WA_HORAS, type VerbosAtencion, type VistaCalificacion, ZAtencionConfig, ZCalificarAtencion, ZCanalAtencion, ZEntrante, ZEnviarAtencion, ZModo, ZProponer, ZResolverBorrador, ZSaliente } from "@Jeff-Aporta/DER/src/03-plugins/atencion/schemas.ts";
import { timingSafeEqual } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { ahora, filas, guardar, idNuevo, isoDe, ms, porPk, validado } from "@Jeff-Aporta/DER/src/03-plugins/common/tablas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/atencion/index.ts";

const cfgDe = (p: ServerPlugin): AtencionConfig => (p.cfg ?? {}) as AtencionConfig;
const servicios = (p: ServerPlugin): AtencionServicios => (p.services ?? {}) as AtencionServicios;
const noExiste = (): never => {
  throw new HttpError(404, "No existe");
};

/** Un registro de ESTA empresa (404 si no existe o es de otra: nunca se distingue). */
async function propio<T extends { iempresa: string }>(p: ServerPlugin, entidad: string, iempresa: string, id: string): Promise<T> {
  const r = await porPk<T>(p, entidad, { id });
  if (!r || r.iempresa !== iempresa) return noExiste();
  return r;
}

/** Código numérico de 4 dígitos para el enlace de calificación. */
function codigoNuevo(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 10000;
  return String(n).padStart(4, "0");
}

/** Cuenta del negocio por canal y cuenta externa. */
async function canalDe(p: ServerPlugin, canal: CanalAtencion, icuenta: string): Promise<Canal | null> {
  return (await filas<Canal>(p, "canales", { where: { canal, icuenta } }))[0] ?? null;
}

/** Alta o cambio de un canal; una cuenta ya vinculada a otra empresa se rechaza. */
async function registrarCanal(p: ServerPlugin, input: CanalInput): Promise<Canal> {
  const d = validado<CanalInput>(ZCanalAtencion, input);
  const previo = await canalDe(p, d.canal, d.icuenta);
  if (previo && previo.iempresa !== d.iempresa) throw new ValidationError("Esa cuenta ya está vinculada a otra empresa");
  return await guardar<Canal>(p, "canales", { id: previo?.id ?? idNuevo() }, { iempresa: d.iempresa, canal: d.canal, icuenta: d.icuenta, nombre: d.nombre, cuenta: d.cuenta ?? previo?.cuenta ?? null, modo: d.modo ?? previo?.modo ?? "entrenamiento", bactivo: previo?.bactivo ?? true, fhcre: previo?.fhcre ?? ahora() });
}

/** Registra un entrante: cliente, chat y mensaje (idempotente por `iexterno`); una cuenta sin vincular no guarda nada. */
async function registrarEntrante(p: ServerPlugin, input: EntranteInput): Promise<EntranteResultado> {
  const d = validado<EntranteInput>(ZEntrante, input);
  const canal = await canalDe(p, d.canal, d.icuenta);
  if (!canal || canal.bactivo === false) return { nuevo: false, canal: null, chat: null, mensaje: null, modo: null };
  const previo = (await filas<MensajeAtencion>(p, "mensajes", { where: { iempresa: canal.iempresa, iexterno: d.mensaje.iexterno } }))[0];
  if (previo) {
    const chat = await porPk<ChatAtencion>(p, "chats", { id: previo.ichat });
    return { nuevo: false, canal, chat, mensaje: previo, modo: chat?.modo ?? canal.modo };
  }
  const fh = d.mensaje.fh ?? ahora();
  const ahoraIso = ahora();
  const c0 = (await filas<ClienteAtencion>(p, "clientes", { where: { icanal: canal.id, iexterno: d.cliente.iexterno } }))[0];
  const cliente = await guardar<ClienteAtencion>(p, "clientes", { id: c0?.id ?? idNuevo() }, { iempresa: canal.iempresa, icanal: canal.id, iexterno: d.cliente.iexterno, nombre: d.cliente.nombre ?? c0?.nombre ?? null, username: d.cliente.username ?? c0?.username ?? null, idioma: d.cliente.idioma ?? c0?.idioma ?? null, fhprimero: c0?.fhprimero ?? ahoraIso, fhultimo: fh });
  const ventana = d.canal === "whatsapp" ? new Date(ms(fh) + (cfgDe(p).ventanaHoras ?? VENTANA_WA_HORAS) * 3600_000).toISOString() : null;
  const h0 = (await filas<ChatAtencion>(p, "chats", { where: { icliente: cliente.id } }))[0];
  const chat = await guardar<ChatAtencion>(p, "chats", { id: h0?.id ?? idNuevo() }, { iempresa: canal.iempresa, icanal: canal.id, icliente: cliente.id, modo: h0?.modo ?? null, codigo: h0?.codigo ?? codigoNuevo(), estado: "abierto", fhventana: ventana ?? h0?.fhventana ?? null, fhultimo: fh, fhcre: h0?.fhcre ?? ahoraIso });
  const mensaje = await guardar<MensajeAtencion>(p, "mensajes", { id: idNuevo() }, { iempresa: canal.iempresa, ichat: chat.id, direccion: "entrante", origen: "cliente", iusuario: null, tipo: d.mensaje.tipo ?? "texto", texto: d.mensaje.texto ?? null, jcontenido: d.mensaje.contenido ?? null, ireply: d.mensaje.ireply ?? null, iexterno: d.mensaje.iexterno, estado: "recibido", error: null, fhcre: fh });
  await servicios(p).alMensaje?.(mensaje, chat);
  return { nuevo: true, canal, chat, mensaje, modo: chat.modo ?? canal.modo };
}

/**
 * Registra un mensaje SALIENTE que el canal ya envió (el bot respondió): lo deja en la conversación con su
 * identificador externo (el wamid), para que su estado (entregado, visto) se pegue a él.
 *
 * Es idempotente por `iexterno`: si el mismo wamid llega dos veces, no lo duplica.
 */
async function registrarSaliente(p: ServerPlugin, input: SalienteInput): Promise<{ nuevo: boolean; mensaje: MensajeAtencion | null }> {
  const d = validado<SalienteInput>(ZSaliente, input);
  const canal = await canalDe(p, d.canal, d.icuenta);
  if (!canal || canal.bactivo === false) return { nuevo: false, mensaje: null };
  const previo = (await filas<MensajeAtencion>(p, "mensajes", { where: { iempresa: canal.iempresa, iexterno: d.mensaje.iexterno } }))[0];
  if (previo) return { nuevo: false, mensaje: previo };
  const fh = ahora();
  const c0 = (await filas<ClienteAtencion>(p, "clientes", { where: { icanal: canal.id, iexterno: d.cliente.iexterno } }))[0];
  const cliente = await guardar<ClienteAtencion>(p, "clientes", { id: c0?.id ?? idNuevo() }, { iempresa: canal.iempresa, icanal: canal.id, iexterno: d.cliente.iexterno, nombre: d.cliente.nombre ?? c0?.nombre ?? null, username: d.cliente.username ?? c0?.username ?? null, idioma: d.cliente.idioma ?? c0?.idioma ?? null, fhprimero: c0?.fhprimero ?? fh, fhultimo: fh });
  const h0 = (await filas<ChatAtencion>(p, "chats", { where: { icliente: cliente.id } }))[0];
  const chat = await guardar<ChatAtencion>(p, "chats", { id: h0?.id ?? idNuevo() }, { iempresa: canal.iempresa, icanal: canal.id, icliente: cliente.id, modo: h0?.modo ?? null, codigo: h0?.codigo ?? codigoNuevo(), estado: "abierto", fhventana: h0?.fhventana ?? null, fhultimo: fh, fhcre: h0?.fhcre ?? fh });
  const mensaje = await guardar<MensajeAtencion>(p, "mensajes", { id: idNuevo() }, { iempresa: canal.iempresa, ichat: chat.id, direccion: "saliente", origen: d.mensaje.origen ?? "bot", iusuario: null, tipo: d.mensaje.tipo ?? "texto", texto: d.mensaje.texto ?? null, jcontenido: d.mensaje.contenido ?? null, ireply: null, iexterno: d.mensaje.iexterno, estado: "enviado", error: null, fhcre: fh });
  await servicios(p).alMensaje?.(mensaje, chat);
  return { nuevo: true, mensaje };
}

/** Envía un mensaje a un chat de la empresa: valida capacidad del canal y ventana de WhatsApp; la entrega real es del consumidor. */
async function enviar(p: ServerPlugin, iempresa: string, input: EnviarAtencionInput): Promise<MensajeAtencion> {
  const d = validado<EnviarAtencionInput>(ZEnviarAtencion, input);
  const chat = await propio<ChatAtencion>(p, "chats", iempresa, d.ichat);
  const canal = (await porPk<Canal>(p, "canales", { id: chat.icanal }))!;
  const cliente = (await porPk<ClienteAtencion>(p, "clientes", { id: chat.icliente }))!;
  const tipo = d.tipo ?? "texto";
  if (!CAPACIDADES[canal.canal].includes(tipo)) throw new ValidationError(`${canal.canal} no permite mensajes de tipo «${tipo}»`);
  if (tipo === "texto" && !d.texto?.trim()) throw new ValidationError("Escribe el texto del mensaje");
  if (tipo !== "texto" && d.contenido == null && !d.texto) throw new ValidationError(`Un mensaje de tipo «${tipo}» necesita su contenido`);
  if (canal.canal === "whatsapp" && tipo !== "plantilla" && (!chat.fhventana || ms(chat.fhventana) < Date.now())) throw new ValidationError("La ventana de servicio de WhatsApp (24 h) está cerrada: solo se puede enviar una plantilla");
  const origen = d.origen ?? "usuario";
  if (origen === "usuario" && !d.iusuario) throw new ValidationError("Falta el usuario que envía");
  let m = await guardar<MensajeAtencion>(p, "mensajes", { id: idNuevo() }, { iempresa, ichat: chat.id, direccion: "saliente", origen, iusuario: d.iusuario ?? null, tipo, texto: d.texto ?? null, jcontenido: d.contenido ?? null, ireply: d.ireply ?? null, iexterno: null, estado: "pendiente", error: null, fhcre: ahora() });
  const entregar = servicios(p).entregar;
  if (entregar) {
    try {
      const r = await entregar(canal, cliente, m);
      m = await guardar<MensajeAtencion>(p, "mensajes", { id: m.id }, { estado: "enviado", iexterno: (r && r.iexterno) || null });
    } catch (e) {
      m = await guardar<MensajeAtencion>(p, "mensajes", { id: m.id }, { estado: "fallido", error: (e as Error).message.slice(0, 500) });
    }
  }
  await guardar(p, "chats", { id: chat.id }, { fhultimo: m.fhcre });
  await servicios(p).alMensaje?.(m, chat);
  return m;
}

/** Propuesta del bot: en `auto` se envía; en `entrenamiento` queda como borrador pendiente. */
async function proponer(p: ServerPlugin, iempresa: string, input: ProponerInput): Promise<{ enviado: boolean; mensaje: MensajeAtencion | null; borrador: Borrador | null }> {
  const d = validado<ProponerInput>(ZProponer, input);
  const chat = await propio<ChatAtencion>(p, "chats", iempresa, d.ichat);
  const canal = (await porPk<Canal>(p, "canales", { id: chat.icanal }))!;
  if ((chat.modo ?? canal.modo) === "auto") return { enviado: true, mensaje: await enviar(p, iempresa, { ichat: chat.id, tipo: d.tipo, texto: d.texto, contenido: d.contenido, origen: "bot" }), borrador: null };
  const borrador = await guardar<Borrador>(p, "borradores", { id: idNuevo() }, { iempresa, ichat: chat.id, tipo: d.tipo ?? "texto", texto: d.texto ?? null, jcontenido: d.contenido ?? null, estado: "pendiente", iusuario: null, fhcre: ahora(), fhresuelto: null });
  return { enviado: false, mensaje: null, borrador };
}

/** Resuelve un borrador: enviar, corregir (con ejemplo), reportar error de redacción (con contexto) o descartar. */
async function resolverBorrador(p: ServerPlugin, iempresa: string, iusuario: string, input: ResolverBorradorInput): Promise<{ borrador: Borrador; mensaje: MensajeAtencion | null; entrenamiento: Entrenamiento | null }> {
  const d = validado<ResolverBorradorInput>(ZResolverBorrador, input);
  const b = await propio<Borrador>(p, "borradores", iempresa, d.id);
  if (b.estado !== "pendiente") throw new ValidationError("Ese borrador ya se resolvió");
  const contexto = (await filas<MensajeAtencion>(p, "mensajes", { where: { iempresa, ichat: b.ichat }, orderBy: ["-id"], pageSize: 10 })).reverse().map((m) => ({ id: m.id, origen: m.origen, tipo: m.tipo, texto: m.texto }));
  const ejemplo = (clase: "correccion" | "error_redaccion", corregido: string | null, motivo: string | null) => guardar<Entrenamiento>(p, "entrenamientos", { id: idNuevo() }, { iempresa, ichat: b.ichat, iborrador: b.id, clase, propuesto: b.texto, corregido, motivo, jcontexto: contexto, iusuario, fhcre: ahora() });
  let mensaje: MensajeAtencion | null = null;
  let entrenamiento: Entrenamiento | null = null;
  let estado: Borrador["estado"] = "enviado";
  if (d.accion === "enviar") {
    mensaje = await enviar(p, iempresa, { ichat: b.ichat, tipo: b.tipo, texto: b.texto, contenido: b.jcontenido, origen: "bot", iusuario });
  } else if (d.accion === "corregir") {
    if (!d.texto?.trim()) throw new ValidationError("Escribe el texto corregido");
    mensaje = await enviar(p, iempresa, { ichat: b.ichat, tipo: b.tipo, texto: d.texto, contenido: b.jcontenido, origen: "usuario", iusuario });
    entrenamiento = await ejemplo("correccion", d.texto, d.motivo ?? null);
    estado = "corregido";
  } else if (d.accion === "reportar") {
    if (!d.motivo?.trim()) throw new ValidationError("Cuéntale al bot qué estuvo mal (motivo)");
    entrenamiento = await ejemplo("error_redaccion", d.texto ?? null, d.motivo);
    estado = "reportado";
  } else {
    estado = "descartado";
  }
  const borrador = await guardar<Borrador>(p, "borradores", { id: b.id }, { estado, iusuario, fhresuelto: ahora() });
  return { borrador, mensaje, entrenamiento };
}

/** Cambia el modo de un chat (null = hereda) o de todo un canal. */
async function setModo(p: ServerPlugin, iempresa: string, input: ModoInput): Promise<{ actualizados: number }> {
  const d = validado<ModoInput>(ZModo, input);
  if (d.ichat) {
    await propio<ChatAtencion>(p, "chats", iempresa, d.ichat);
    await guardar(p, "chats", { id: d.ichat }, { modo: d.modo });
    return { actualizados: 1 };
  }
  if (!d.icanal || !d.modo) throw new ValidationError("Indica `ichat`, o `icanal` con un modo");
  await propio<Canal>(p, "canales", iempresa, d.icanal);
  await guardar(p, "canales", { id: d.icanal }, { modo: d.modo });
  return { actualizados: 1 };
}

/** Anota un intento fallido de código; bloquea el chat tras `maxIntentosCodigo` (15 minutos). */
function fallo(p: ServerPlugin, ichat: string): never {
  const mapa = ((p.state["intentos"] ??= new Map<string, { n: number; hasta: number }>()) as Map<string, { n: number; hasta: number }>);
  const e = mapa.get(ichat) ?? { n: 0, hasta: 0 };
  e.n++;
  if (e.n >= (cfgDe(p).maxIntentosCodigo ?? 5)) {
    e.hasta = Date.now() + 15 * 60_000;
    e.n = 0;
  }
  mapa.set(ichat, e);
  throw new HttpError(404, "Enlace inválido");
}

/** Verifica id de chat + código de 4 dígitos (tiempo constante, con bloqueo por fuerza bruta) y devuelve el chat. */
async function verificar(p: ServerPlugin, ichat: string, codigo: string): Promise<ChatAtencion> {
  const mapa = ((p.state["intentos"] ??= new Map<string, { n: number; hasta: number }>()) as Map<string, { n: number; hasta: number }>);
  if ((mapa.get(ichat)?.hasta ?? 0) > Date.now()) throw new HttpError(429, "Demasiados intentos: espera unos minutos");
  const chat = await porPk<ChatAtencion>(p, "chats", { id: ichat });
  const a = new TextEncoder().encode(codigo);
  const b = new TextEncoder().encode(chat?.codigo ?? "0000");
  if (!chat || a.length !== b.length || !timingSafeEqual(a, b)) return fallo(p, ichat);
  return chat;
}

/** Vista del enlace de calificación: mensajes enviados por usuarios o bot, cada uno con su estado de plazo y su nota. */
async function vistaCalificacion(p: ServerPlugin, ichat: string, codigo: string): Promise<VistaCalificacion> {
  const chat = await verificar(p, ichat, codigo);
  const plazoDias = cfgDe(p).plazoCalificacionDias ?? PLAZO_CALIFICACION_DIAS;
  const limite = Date.now() - plazoDias * 86_400_000;
  const salientes = (await filas<MensajeAtencion>(p, "mensajes", { where: { iempresa: chat.iempresa, ichat, direccion: "saliente" }, orderBy: ["-id"], pageSize: 100 })).reverse();
  const notas = new Map((await filas<CalificacionAtencion>(p, "calificaciones", { where: { iempresa: chat.iempresa, ichat } })).map((c) => [c.imensaje, c.valor]));
  return { ichat, plazoDias, mensajes: salientes.map((m) => ({ id: m.id, texto: m.texto, tipo: m.tipo, origen: m.origen, fhcre: isoDe(m.fhcre), calificacion: notas.get(m.id) ?? null, vigente: ms(m.fhcre) >= limite })) };
}

/** Califica un mensaje saliente del chat dentro del plazo; calificar de nuevo reemplaza la nota. */
async function calificar(p: ServerPlugin, input: CalificarAtencionInput): Promise<CalificacionAtencion> {
  const d = validado<CalificarAtencionInput>(ZCalificarAtencion, input);
  const chat = await verificar(p, d.ichat, d.codigo);
  const m = await porPk<MensajeAtencion>(p, "mensajes", { id: d.imensaje });
  if (!m || m.ichat !== chat.id || m.direccion !== "saliente") throw new HttpError(404, "Ese mensaje no se puede calificar");
  const plazoDias = cfgDe(p).plazoCalificacionDias ?? PLAZO_CALIFICACION_DIAS;
  if (ms(m.fhcre) < Date.now() - plazoDias * 86_400_000) throw new ValidationError(`El plazo para calificar este mensaje (${plazoDias} días) venció`);
  const previa = (await filas<CalificacionAtencion>(p, "calificaciones", { where: { iempresa: chat.iempresa, imensaje: m.id } }))[0];
  return await guardar<CalificacionAtencion>(p, "calificaciones", { id: previa?.id ?? idNuevo() }, { iempresa: chat.iempresa, ichat: chat.id, imensaje: m.id, valor: d.valor, jmotivos: d.motivos ?? null, comentario: d.comentario ?? null, fhcre: ahora() });
}

/** Sesión HTTP resuelta por el consumidor; sin `services.contexto` las rutas protegidas no pueden decidir la empresa. */
async function contextoHttp(p: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ContextoAtencion> {
  const f = servicios(p).contexto;
  if (!f) throw new Error("El plugin atencion necesita el servicio `contexto` (sesión → { iusuario, iempresa })");
  return await f(i.request, ctx.session);
}

const lim = (i: ExtraRouteInput, def: number) => Number(i.query.get("limite") ?? def) || def;

/** JSON del server de atención: `atencionPlugin` + handlers + verbos + seed. */
export const atencionServer: ServerPluginDef = Obj.insert(atencionPlugin, {
  cfg: ZAtencionConfig,
  entities: {
    canales: { indexes: [{ columns: ["canal", "icuenta"], unique: true, name: "ux_atencion_canales_cuenta" }] },
    clientes: { indexes: [{ columns: ["icanal", "iexterno"], name: "ix_atencion_clientes_externo" }] },
    chats: { indexes: [{ columns: ["iempresa", "fhultimo"], name: "ix_atencion_chats_empresa" }, { columns: ["icliente"], name: "ix_atencion_chats_cliente" }] },
    mensajes: { indexes: [{ columns: ["ichat", "id"], name: "ix_atencion_mensajes_chat" }, { columns: ["iempresa", "iexterno"], name: "ix_atencion_mensajes_externo" }] },
    borradores: { indexes: [{ columns: ["iempresa", "ichat", "estado"], name: "ix_atencion_borradores_chat" }] },
    calificaciones: { indexes: [{ columns: ["imensaje"], name: "ix_atencion_calificaciones_mensaje" }] },
  },
  irregularPaths: {
    capacidades: {
      handler() {
        return CAPACIDADES;
      },
    },
    chats: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ChatAtencion[]> {
        return await chats(this, (await contextoHttp(this, i, ctx)).iempresa, lim(i, 50));
      },
    },
    mensajes: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<MensajeAtencion[]> {
        const c = await contextoHttp(this, i, ctx);
        return await mensajes(this, c.iempresa, i.query.get("ichat") ?? "", lim(i, 50), i.query.get("antes") ?? undefined);
      },
    },
    enviar: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<MensajeAtencion> {
        const c = await contextoHttp(this, i, ctx);
        const d = i.body as EnviarAtencionInput;
        return await enviar(this, c.iempresa, { ...d, origen: "usuario", iusuario: c.iusuario });
      },
    },
    borradores: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Borrador[]> {
        return await borradores(this, (await contextoHttp(this, i, ctx)).iempresa, i.query.get("ichat") ?? undefined);
      },
    },
    resolver: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
        const c = await contextoHttp(this, i, ctx);
        return await resolverBorrador(this, c.iempresa, c.iusuario, i.body as ResolverBorradorInput);
      },
    },
    modo: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<{ actualizados: number }> {
        return await setModo(this, (await contextoHttp(this, i, ctx)).iempresa, i.body as ModoInput);
      },
    },
    entrenamientos: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Entrenamiento[]> {
        return await entrenamientos(this, (await contextoHttp(this, i, ctx)).iempresa, lim(i, 50));
      },
    },
    calificacion: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<VistaCalificacion> {
        return await vistaCalificacion(this, i.query.get("ichat") ?? "", i.query.get("codigo") ?? "");
      },
    },
    calificar: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<CalificacionAtencion> {
        return await calificar(this, i.body as CalificarAtencionInput);
      },
    },
  },
  /** En el server, los verbos son métodos directos (sin HTTP). */
  setup(this: ServerPlugin) {
    const v: VerbosAtencion = {
      registrarCanal: (input) => registrarCanal(this, input),
      canalDe: (canal, icuenta) => canalDe(this, canal, icuenta),
      registrarEntrante: (input) => registrarEntrante(this, input),
      registrarSaliente: (input) => registrarSaliente(this, input),
      enviar: (iempresa, input) => enviar(this, iempresa, input),
      proponer: (iempresa, input) => proponer(this, iempresa, input),
      resolverBorrador: (iempresa, iusuario, input) => resolverBorrador(this, iempresa, iusuario, input),
      setModo: (iempresa, input) => setModo(this, iempresa, input),
      chats: (iempresa, limite) => chats(this, iempresa, limite),
      mensajes: (iempresa, ichat, limite, antes) => mensajes(this, iempresa, ichat, limite, antes),
      borradores: (iempresa, ichat) => borradores(this, iempresa, ichat),
      entrenamientos: (iempresa, limite) => entrenamientos(this, iempresa, limite),
      vistaCalificacion: (ichat, codigo) => vistaCalificacion(this, ichat, codigo),
      calificar: (input) => calificar(this, input),
    };
    Object.assign(this, v);
  },
  /** Crea sus tablas (y les suma columnas nuevas) en cualquier motor y deja vinculados los canales de `cfg`. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
    for (const c of cfgDe(this).canales ?? []) await registrarCanal(this, c);
  },
}) as ServerPluginDef;

/** Chats de la empresa, el más reciente primero. */
async function chats(p: ServerPlugin, iempresa: string, limite = 50): Promise<ChatAtencion[]> {
  return await filas<ChatAtencion>(p, "chats", { where: { iempresa }, orderBy: ["-fhultimo"], pageSize: Math.min(Math.max(limite, 1), 200) });
}

/** Mensajes de un chat de la empresa en orden cronológico (los últimos `limite`, o los anteriores a `antes`). */
async function mensajes(p: ServerPlugin, iempresa: string, ichat: string, limite = 50, antes?: string): Promise<MensajeAtencion[]> {
  await propio<ChatAtencion>(p, "chats", iempresa, ichat);
  const where: Record<string, unknown> = { iempresa, ichat };
  if (antes) where["id"] = { lt: antes };
  return (await filas<MensajeAtencion>(p, "mensajes", { where, orderBy: ["-id"], pageSize: Math.min(Math.max(limite, 1), 200) })).reverse();
}

/** Borradores pendientes de la empresa (de un chat o de todos). */
async function borradores(p: ServerPlugin, iempresa: string, ichat?: string): Promise<Borrador[]> {
  const where: Record<string, unknown> = { iempresa, estado: "pendiente" };
  if (ichat) where["ichat"] = ichat;
  return await filas<Borrador>(p, "borradores", { where, orderBy: ["id"], pageSize: 200 });
}

/** Ejemplos de entrenamiento de la empresa, los más recientes primero. */
async function entrenamientos(p: ServerPlugin, iempresa: string, limite = 50): Promise<Entrenamiento[]> {
  return await filas<Entrenamiento>(p, "entrenamientos", { where: { iempresa }, orderBy: ["-id"], pageSize: Math.min(Math.max(limite, 1), 200) });
}

/** `createServer(atencionServer, runtime)` con los verbos tipados (`services`: `contexto`, `entregar`, `alMensaje`). */
export function crearAtencion(runtime: ServerPluginRuntime): ServerPlugin & VerbosAtencion {
  return createServer(atencionServer, runtime) as ServerPlugin & VerbosAtencion;
}
