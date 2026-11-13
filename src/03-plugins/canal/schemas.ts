/**
 * Tipos y Zod del plugin de canal para bots: mensajes versionados, reacciones y adjuntos con caducidad.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/canal.md
 */
import { z } from "zod";

/** Configuración del canal: vida predeterminada de los adjuntos (72 horas). */
export type CanalConfig = { ttlAdjuntosSeg: number };
/** Una versión del texto de un mensaje; la última es la vigente. */
export type VersionCanal = { texto: string; ts: string; adjuntos: string[] };
/** Historial lógico de versiones de un mensaje. */
export type HistorialCanal = VersionCanal[];
/** Mensaje publicado en un canal o hilo de bots. */
export type MensajeCanal = { idmensaje: string; canal: string; hilo: string | null; de: string; texto: string; tipo: string; msgorigen: string | null; ts: Date; jcontenido: HistorialCanal | null; indexcita: string | null; bactivo: boolean; adjuntos: string[] | null };
/** Reacción de un bot a un mensaje. */
export type ReaccionCanal = { idmensaje: string; de: string; reaccion: string; ts: Date };
/** Ficha de un adjunto almacenado en R2. */
export type AdjuntoCanal = { idadjunto: string; idmensaje: string | null; nombre: string; mime: string; bytes: number; clave: string; fhexpira: Date; ts: Date };
/** Entrada para publicar un mensaje. */
export type PublicarCanalInput = { canal: string; hilo?: string | null | undefined; texto: string; tipo?: string | undefined; msgorigen?: string | null | undefined; ts?: string | undefined; indexcita?: string | null | undefined; adjuntos?: string[] | undefined; de?: string | null | undefined };
/** Entrada para editar un mensaje (agrega una versión). */
export type EditarCanalInput = { texto: string; adjuntos?: string[] | undefined; ts?: string | undefined };
/** Entrada para reaccionar a un mensaje. */
export type ReaccionarCanalInput = { idmensaje: string; reaccion: string };
/** Entrada para quitar la reacción del bot actual. */
export type QuitarReaccionInput = { idmensaje: string };
/** Entrada para registrar un adjunto ya subido al almacén. */
export type RegistrarAdjuntoInput = { nombre?: string | undefined; mime: string; bytes: number; clave: string; idmensaje?: string | null | undefined; ttlSeg?: number | undefined };
/** Filtros para listar mensajes de un canal desde una marca de tiempo. */
export type ListarCanalInput = { canal: string; hilo?: string | undefined; desde?: string | undefined; limite?: number | undefined };
/** Filtro de adjuntos de un mensaje. */
export type ListarAdjuntosInput = { idmensaje?: string | undefined };

/** Zod de configuración del canal. */
export const ZCanalConfig = z.strictObject({ ttlAdjuntosSeg: z.number().int().positive().default(72 * 60 * 60) });
/** Zod de la fecha ISO usada por mensajes y adjuntos. */
export const ZFechaCanal = z.string().min(4).max(40).regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/, "La fecha debe ser ISO (AAAA-MM-DDTHH:MM)");
/** Zod de publicación en el canal. */
export const ZPublicarCanal = z.strictObject({ canal: z.string().min(1).max(160), hilo: z.string().min(1).max(160).nullable().optional(), texto: z.string().min(1).max(100000), tipo: z.string().min(1).max(40).default("texto"), msgorigen: z.string().min(1).max(240).nullable().optional(), ts: ZFechaCanal.optional(), indexcita: z.string().min(1).max(64).nullable().optional(), adjuntos: z.array(z.string().min(1).max(64)).max(20).optional(), de: z.string().min(1).max(120).nullable().optional() });
/** Zod de edición de un mensaje. */
export const ZEditarCanal = z.strictObject({ texto: z.string().min(1).max(100000), adjuntos: z.array(z.string().min(1).max(64)).max(20).optional(), ts: ZFechaCanal.optional() });
/** Zod de reacción a un mensaje. */
export const ZReaccionarCanal = z.strictObject({ idmensaje: z.string().min(1).max(64), reaccion: z.string().min(1).max(64) });
/** Zod para quitar la reacción del bot actual. */
export const ZQuitarReaccion = z.strictObject({ idmensaje: z.string().min(1).max(64) });
/** Zod de registro de un adjunto. */
export const ZRegistrarAdjunto = z.strictObject({ nombre: z.string().min(1).max(300).default("archivo"), mime: z.string().min(1).max(120), bytes: z.number().int().nonnegative(), clave: z.string().min(1).max(400), idmensaje: z.string().min(1).max(64).nullable().optional(), ttlSeg: z.number().int().positive().optional() });
/** Zod del listado de mensajes. */
export const ZListarCanal = z.strictObject({ canal: z.string().min(1).max(160), hilo: z.string().min(1).max(160).optional(), desde: ZFechaCanal.optional(), limite: z.coerce.number().int().min(1).max(200).default(100) });
/** Zod del listado de adjuntos. */
export const ZListarAdjuntos = z.strictObject({ idmensaje: z.string().min(1).max(64).optional() });
