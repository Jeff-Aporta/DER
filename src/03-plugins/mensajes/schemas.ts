/**
 * Tipos y Zod del plugin de mensajes: el sistema de conversación transversal (comentarios, mensajes privados,
 * reseñas… es el mismo DER con otro componente).
 *
 * Un mensaje vive en un `tdespacio` (el tipo de contexto: `tks`, `privado`, `video`…) y apunta a una `iref` (el id de
 * la entidad comentada). Su `imensaje` es el índice en el hilo: `0`, `1`… en el primer nivel; la respuesta a `10` es
 * `10.0`, `10.1`… y la respuesta a `10.0` es `10.0.0`. El `jcontenido` guarda el historial de versiones (la última es
 * la vigente) y el `indexcita` el índice del mensaje citado.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/mensajes.md
 */
import { z } from "zod";
import type { ContenidoMensaje } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

/** Fila de un mensaje. */
export type Mensaje = { tdespacio: string; iref: string; imensaje: string; jcontenido: ContenidoMensaje | null; indexcita: string | null; bactivo: boolean; iusuario: string | null; qtotalrespuestas: number | null };

/** Mensaje con sus respuestas (el árbol que pinta el componente). */
export type MensajeNodo = Mensaje & { hijos: MensajeNodo[] };

/** Datos para publicar un mensaje. */
export type PublicarMensajeInput = { tdespacio: string; iref: string; contenido: string; indexcita?: string | null | undefined; adjuntos?: string[] | undefined; iusuario?: string | null | undefined; fhcre?: string | null | undefined };

/** Datos para editar un mensaje (se agrega una versión; lo anterior se conserva). */
export type EditarMensajeInput = { contenido: string; adjuntos?: string[] | undefined; fhcre?: string | null | undefined };

/** Fila de un adjunto (los bytes los mueve el almacén del consumidor; aquí solo la ficha). */
export type Adjunto = { iadjunto: string; nombre: string; mime: string | null; bytes: number | null; clave: string | null; url: string | null; fhcre: Date | null; iusuario: string | null; jmeta: unknown };

/** Datos para registrar un adjunto ya subido al almacén. */
export type AdjuntoInput = { nombre: string; mime?: string | null | undefined; bytes?: number | null | undefined; clave?: string | null | undefined; url?: string | null | undefined; jmeta?: unknown | undefined };

/** Zod de la fecha de una versión de mensaje (ISO: `2026-11-13T10:00:00.000Z`). */
export const ZFechaMensaje = z.string().min(4).max(40).regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/, "La fecha debe ser ISO (AAAA-MM-DDTHH:MM)");
/** Zod de la publicación de un mensaje. */
export const ZPublicarMensaje = z.strictObject({ tdespacio: z.string().min(1).max(60), iref: z.string().min(1).max(120), contenido: z.string().min(1).max(100000), indexcita: z.string().max(300).nullable().optional(), adjuntos: z.array(z.string().max(64)).max(20).optional(), iusuario: z.string().min(1).max(120).nullable().optional(), fhcre: ZFechaMensaje.nullable().optional() });
/** Zod de la edición de un mensaje. */
export const ZEditarMensaje = z.strictObject({ contenido: z.string().min(1).max(100000), adjuntos: z.array(z.string().max(64)).max(20).optional(), fhcre: ZFechaMensaje.nullable().optional() });
/** Zod del registro de un adjunto. */
export const ZAdjuntoInput = z.strictObject({ nombre: z.string().min(1).max(300), mime: z.string().max(120).nullable().optional(), bytes: z.number().int().nonnegative().nullable().optional(), clave: z.string().max(400).nullable().optional(), url: z.string().max(1000).nullable().optional(), jmeta: z.unknown().optional() });

/** Comentario de una página de raíces o de respuestas: el mensaje + cuántas respuestas directas tiene (para el «Ver N respuestas»). */
export type MensajeConRespuestas = Mensaje & { respuestas: number };

/** Página de mensajes (raíces o respuestas de un padre): carga por niveles, nunca el árbol entero. */
export type PaginaMensajes = { filas: MensajeConRespuestas[]; total: number; page: number; pageSize: number };

/** Opciones de paginación de raíces y respuestas. */
export type OpcionesPagina = { page?: number | undefined; pageSize?: number | undefined };

/** Verbos de servidor de mensajes (sin HTTP): el consumidor pone su propia sesión delante. */
export type VerbosMensajes = { publicar(input: PublicarMensajeInput): Promise<Mensaje>; raices(tdespacio: string, iref: string, opciones?: OpcionesPagina): Promise<PaginaMensajes>; respuestas(tdespacio: string, iref: string, padre: string, opciones?: OpcionesPagina): Promise<PaginaMensajes>; retirar(tdespacio: string, iref: string, imensaje: string): Promise<Mensaje | null>; mensaje(tdespacio: string, iref: string, imensaje: string): Promise<Mensaje | null> };
