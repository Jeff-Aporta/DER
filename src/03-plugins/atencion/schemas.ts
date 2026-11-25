/**
 * Tipos y Zod del plugin de atención conversacional omnicanal (WhatsApp y Telegram): canales del negocio (número o bot),
 * clientes finales con todo lo mapeable, chats con id + código de 4 dígitos, mensajes de todos los tipos (con quién lo
 * envió: cliente, usuario interno o bot), modo auto/entrenamiento con borradores que el humano corrige, envía o reporta,
 * y calificación del servicio por el cliente final (por mensaje, con motivos, dentro de un plazo configurable).
 * Es reutilizable: NO conoce al CRM; el aislamiento es por `iempresa` (cualquier inquilino) y el consumidor aporta la
 * sesión con `services.contexto`.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/atencion.md
 */
import { z } from "zod";

/** Canales soportados. */
export const CANALES_ATENCION = ["whatsapp", "telegram"] as const;

/** Tipos de mensaje (el catálogo de herramientas). */
export const TIPOS_MENSAJE = ["texto", "imagen", "audio", "video", "documento", "reaccion", "botones", "opciones", "lista", "encuesta", "ubicacion", "contacto", "plantilla", "sticker"] as const;

/** Quién originó un mensaje. */
export const ORIGENES = ["cliente", "usuario", "bot"] as const;

/** Modo de atención: `auto` (el bot responde solo) o `entrenamiento` (el bot propone, el humano decide). */
export const MODOS = ["auto", "entrenamiento"] as const;

/** Matriz canal × capacidad: qué tipos permite cada canal (Telegram no tiene plantillas ni listas; WhatsApp no tiene encuestas nativas). */
export const CAPACIDADES: Record<(typeof CANALES_ATENCION)[number], readonly (typeof TIPOS_MENSAJE)[number][]> = {
  whatsapp: ["texto", "imagen", "audio", "video", "documento", "reaccion", "botones", "opciones", "lista", "ubicacion", "contacto", "plantilla", "sticker"],
  telegram: ["texto", "imagen", "audio", "video", "documento", "reaccion", "botones", "opciones", "encuesta", "ubicacion", "contacto", "sticker"],
};

/** Días por defecto para calificar un mensaje. */
export const PLAZO_CALIFICACION_DIAS = 10;

/** Horas de la ventana de servicio de WhatsApp (fuera de ella solo plantillas). */
export const VENTANA_WA_HORAS = 24;

/** Canal. */
export type CanalAtencion = (typeof CANALES_ATENCION)[number];

/** Tipo de mensaje. */
export type TipoMensaje = (typeof TIPOS_MENSAJE)[number];

/** Origen de un mensaje. */
export type OrigenMensaje = (typeof ORIGENES)[number];

/** Modo de atención. */
export type ModoAtencion = (typeof MODOS)[number];

/** Número o bot del negocio que atiende; (`canal`, `icuenta`) pertenece a UNA sola empresa. */
export type Canal = { id: string; iempresa: string; canal: CanalAtencion; icuenta: string; nombre: string; cuenta: string | null; modo: ModoAtencion; bactivo: boolean; jdata: unknown; fhcre: string };

/** Cliente final tal como lo expone el canal. */
export type ClienteAtencion = { id: string; iempresa: string; icanal: string; iexterno: string; nombre: string | null; username: string | null; idioma: string | null; jetiquetas: string[] | null; icontacto: string | null; jdata: unknown; fhprimero: string; fhultimo: string };

/** Chat = un cliente en un canal; `codigo` (4 dígitos) con el id da acceso al enlace de calificación. `modo` null hereda el del canal. */
export type ChatAtencion = { id: string; iempresa: string; icanal: string; icliente: string; modo: ModoAtencion | null; codigo: string; estado: "abierto" | "cerrado"; fhventana: string | null; fhultimo: string; fhcre: string };

/** Mensaje. `iexterno` = id del canal (wamid, message_id): idempotencia. `ireply` cita otro mensaje. `jcontenido` = lo propio del tipo (media, botones, ubicación…). */
export type MensajeAtencion = { id: string; iempresa: string; ichat: string; direccion: "entrante" | "saliente"; origen: OrigenMensaje; iusuario: string | null; tipo: TipoMensaje; texto: string | null; jcontenido: unknown; ireply: string | null; iexterno: string | null; estado: string; error: string | null; fhcre: string };

/** Propuesta del bot en modo entrenamiento. */
export type Borrador = { id: string; iempresa: string; ichat: string; tipo: TipoMensaje; texto: string | null; jcontenido: unknown; estado: "pendiente" | "enviado" | "corregido" | "reportado" | "descartado"; iusuario: string | null; fhcre: string; fhresuelto: string | null };

/** Ejemplo de entrenamiento: lo propuesto, lo corregido o el error reportado, con el contexto de la conversación. */
export type Entrenamiento = { id: string; iempresa: string; ichat: string; iborrador: string; clase: "correccion" | "error_redaccion"; propuesto: string | null; corregido: string | null; motivo: string | null; jcontexto: unknown; iusuario: string; fhcre: string };

/** Calificación del cliente final a un mensaje (1 a 5) con motivos. */
export type CalificacionAtencion = { id: string; iempresa: string; ichat: string; imensaje: string; valor: number; jmotivos: string[] | null; comentario: string | null; fhcre: string };

/** Configuración del plugin. */
export type AtencionConfig = { plazoCalificacionDias?: number | undefined; ventanaHoras?: number | undefined; maxIntentosCodigo?: number | undefined; canales?: CanalInput[] | undefined };

/** Alta de un canal del negocio. */
export type CanalInput = { iempresa: string; canal: CanalAtencion; icuenta: string; nombre: string; cuenta?: string | null | undefined; modo?: ModoAtencion | undefined };

/** Un mensaje que llega del canal (lo entrega el gateway tras verificar la firma). */
export type EntranteInput = { canal: CanalAtencion; icuenta: string; cliente: { iexterno: string; nombre?: string | null | undefined; username?: string | null | undefined; idioma?: string | null | undefined }; mensaje: { iexterno: string; tipo?: TipoMensaje | undefined; texto?: string | null | undefined; contenido?: unknown; ireply?: string | null | undefined; fh?: string | undefined } };

/** Resultado de registrar un entrante: `canal` null si la cuenta no está vinculada (nada se guarda). */
export type EntranteResultado = { nuevo: boolean; canal: Canal | null; chat: ChatAtencion | null; mensaje: MensajeAtencion | null; modo: ModoAtencion | null };

/** Envío de un mensaje a un chat. `origen` `bot` solo en modo auto o al aprobar un borrador. */
export type EnviarAtencionInput = { ichat: string; tipo?: TipoMensaje | undefined; texto?: string | null | undefined; contenido?: unknown; ireply?: string | null | undefined; origen?: "usuario" | "bot" | undefined; iusuario?: string | null | undefined };

/** Propuesta del bot: en `auto` se envía sola; en `entrenamiento` queda como borrador. */
export type ProponerInput = { ichat: string; tipo?: TipoMensaje | undefined; texto?: string | null | undefined; contenido?: unknown };

/** Cómo resuelve el humano un borrador. */
export type ResolverBorradorInput = { id: string; accion: "enviar" | "corregir" | "reportar" | "descartar"; texto?: string | null | undefined; motivo?: string | null | undefined };

/** Cambio de modo por chat o por canal. */
export type ModoInput = { ichat?: string | undefined; icanal?: string | undefined; modo: ModoAtencion | null };

/** Lo que ve el cliente final en el enlace de calificación. */
export type VistaCalificacion = { ichat: string; plazoDias: number; mensajes: { id: string; texto: string | null; tipo: TipoMensaje; origen: OrigenMensaje; fhcre: string; calificacion: number | null; vigente: boolean }[] };

/** Calificación enviada por el cliente final. */
export type CalificarAtencionInput = { ichat: string; codigo: string; imensaje: string; valor: number; motivos?: string[] | undefined; comentario?: string | null | undefined };

/** Sesión aportada por el consumidor: quién es y en qué empresa actúa. */
export type ContextoAtencion = { iusuario: string; iempresa: string; rol?: string | undefined };

/** Servicios del consumidor: `contexto` resuelve la sesión HTTP; `entregar` manda al canal real (devuelve el id externo). */
export type AtencionServicios = { contexto?: ((req: Request, sesion: { id?: string } | null | undefined) => Promise<ContextoAtencion> | ContextoAtencion) | undefined; entregar?: ((canal: Canal, cliente: ClienteAtencion, mensaje: MensajeAtencion) => Promise<{ iexterno?: string | undefined } | void> | { iexterno?: string | undefined } | void) | undefined; alMensaje?: ((mensaje: MensajeAtencion, chat: ChatAtencion) => Promise<void> | void) | undefined };

/** Verbos de servidor del plugin armado. */
export type VerbosAtencion = { registrarCanal(input: CanalInput): Promise<Canal>; canalDe(canal: CanalAtencion, icuenta: string): Promise<Canal | null>; registrarEntrante(input: EntranteInput): Promise<EntranteResultado>; enviar(iempresa: string, input: EnviarAtencionInput): Promise<MensajeAtencion>; proponer(iempresa: string, input: ProponerInput): Promise<{ enviado: boolean; mensaje: MensajeAtencion | null; borrador: Borrador | null }>; resolverBorrador(iempresa: string, iusuario: string, input: ResolverBorradorInput): Promise<{ borrador: Borrador; mensaje: MensajeAtencion | null; entrenamiento: Entrenamiento | null }>; setModo(iempresa: string, input: ModoInput): Promise<{ actualizados: number }>; chats(iempresa: string, limite?: number): Promise<ChatAtencion[]>; mensajes(iempresa: string, ichat: string, limite?: number, antes?: string): Promise<MensajeAtencion[]>; borradores(iempresa: string, ichat?: string): Promise<Borrador[]>; entrenamientos(iempresa: string, limite?: number): Promise<Entrenamiento[]>; vistaCalificacion(ichat: string, codigo: string): Promise<VistaCalificacion>; calificar(input: CalificarAtencionInput): Promise<CalificacionAtencion> };

const id = z.string().min(1).max(40);

/** Zod del alta de un canal. */
export const ZCanalAtencion = z.strictObject({ iempresa: z.string().min(1).max(40), canal: z.enum(CANALES_ATENCION), icuenta: z.string().min(1).max(120), nombre: z.string().min(1).max(160), cuenta: z.string().max(160).nullish(), modo: z.enum(MODOS).optional() });

/** Zod de la configuración. */
export const ZAtencionConfig = z.strictObject({ plazoCalificacionDias: z.number().int().min(1).max(365).optional(), ventanaHoras: z.number().int().min(1).max(168).optional(), maxIntentosCodigo: z.number().int().min(1).max(20).optional(), canales: z.array(ZCanalAtencion).optional() });

/** Zod del entrante. */
export const ZEntrante = z.strictObject({ canal: z.enum(CANALES_ATENCION), icuenta: z.string().min(1).max(120), cliente: z.strictObject({ iexterno: z.string().min(1).max(120), nombre: z.string().max(160).nullish(), username: z.string().max(120).nullish(), idioma: z.string().max(20).nullish() }), mensaje: z.strictObject({ iexterno: z.string().min(1).max(200), tipo: z.enum(TIPOS_MENSAJE).optional(), texto: z.string().max(8000).nullish(), contenido: z.unknown().optional(), ireply: z.string().max(40).nullish(), fh: z.string().max(40).optional() }) });

/** Zod del envío. */
export const ZEnviarAtencion = z.strictObject({ ichat: id, tipo: z.enum(TIPOS_MENSAJE).optional(), texto: z.string().max(8000).nullish(), contenido: z.unknown().optional(), ireply: z.string().max(40).nullish(), origen: z.enum(["usuario", "bot"]).optional(), iusuario: z.string().max(120).nullish() });

/** Zod de la propuesta del bot. */
export const ZProponer = z.strictObject({ ichat: id, tipo: z.enum(TIPOS_MENSAJE).optional(), texto: z.string().max(8000).nullish(), contenido: z.unknown().optional() });

/** Zod de resolver un borrador. */
export const ZResolverBorrador = z.strictObject({ id, accion: z.enum(["enviar", "corregir", "reportar", "descartar"]), texto: z.string().max(8000).nullish(), motivo: z.string().max(2000).nullish() });

/** Zod del cambio de modo. */
export const ZModo = z.strictObject({ ichat: id.optional(), icanal: id.optional(), modo: z.enum(MODOS).nullable() });

/** Zod de la calificación del cliente final. */
export const ZCalificarAtencion = z.strictObject({ ichat: id, codigo: z.string().regex(/^\d{4}$/), imensaje: id, valor: z.number().int().min(1).max(5), motivos: z.array(z.string().max(80)).max(10).optional(), comentario: z.string().max(1000).nullish() });
