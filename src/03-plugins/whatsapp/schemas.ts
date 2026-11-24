/**
 * Tipos y Zod del plugin de WhatsApp (Cloud API de Meta): un gateway con VARIOS números de una sola app de Meta.
 * Cada número (`phone_number_id`) se vincula a una app (contrato, perfil del bot, autorespuesta); cada contacto
 * (`wa_id`) tiene una conversación por número con su ventana de servicio de 24 h; los mensajes se guardan una sola
 * vez por `wamid` (Meta reintenta los webhooks) y sus estados llegan en inglés (`sent`, `delivered`, `read`,
 * `failed`) y se guardan en español sin retroceder (un `delivered` tardío no pisa un `read`).
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/whatsapp.md
 */
import { z } from "zod";

/** Estados de un mensaje (en español). `pendiente` = saliente en cola, aún sin respuesta de Meta. */
export const ESTADOS_WA = ["recibido", "pendiente", "enviado", "entregado", "leido", "fallido"] as const;

/** Traducción de los estados de Meta (inglés) a los de la tabla (español). Lo desconocido es `fallido`. */
export const ESTADOS_META: Record<string, WaEstado> = { sent: "enviado", delivered: "entregado", read: "leido", failed: "fallido" };

/** Orden de avance de un estado: uno menor nunca pisa a uno mayor (los webhooks llegan desordenados). */
export const ORDEN_ESTADOS: Record<WaEstado, number> = { recibido: 0, pendiente: 1, enviado: 2, entregado: 3, leido: 4, fallido: 3 };

/** Horas de la ventana de servicio de Meta (texto libre solo dentro de ella; fuera, plantillas). */
export const VENTANA_HORAS = 24;

/** Estado de un mensaje. */
export type WaEstado = typeof ESTADOS_WA[number];

/** Dirección de un mensaje. */
export type WaDireccion = "entrante" | "saliente";

/** Una app que atiende números: contrato (system prompt), perfil del bot y si contesta sola. */
export type WaApp = { slug: string; nombre: string; perfil: string | null; contrato: string | null; jconfig: Record<string, unknown> | null; bautorespuesta: boolean; bactivo: boolean; fhcre: string };

/** Un número de WhatsApp (Phone Number ID de Meta) vinculado a una app. */
export type WaNumero = { iphone: string; app: string; display: string | null; nombre: string | null; tipo: "prueba" | "produccion"; bactivo: boolean; fhcre: string };

/** Un contacto (el `wa_id` del usuario de WhatsApp, E.164 sin `+`). */
export type WaContacto = { id: string; waid: string; nombre: string | null; fhcre: string; fhult: string | null };

/** Una conversación de un contacto con UN número; `fhventana` = fin de la ventana de servicio de 24 h. */
export type WaConversacion = { id: string; icontacto: string; iphone: string; app: string | null; estado: "abierta" | "cerrada"; fhventana: string | null; fhabierta: string; fhult: string | null };

/** Un mensaje entrante o saliente; `wamid` es el id de Meta (único: base de la idempotencia). */
export type WaMensaje = { id: string; wamid: string | null; iconversacion: string; direccion: WaDireccion; tipo: string; texto: string | null; estado: WaEstado; error: string | null; jpayload: unknown; fhcre: string; fhestado: string | null };

/** Un evento crudo del webhook (auditoría: se guarda todo lo que llega). */
export type WaEvento = { id: string; iphone: string | null; campo: string; jpayload: unknown; fhcre: string };

/** Alta o cambio de una app. */
export type WaAppInput = { slug: string; nombre?: string | undefined; perfil?: string | null | undefined; contrato?: string | null | undefined; jconfig?: Record<string, unknown> | null | undefined; bautorespuesta?: boolean | undefined; bactivo?: boolean | undefined };

/** Alta o cambio de un número (vincularlo a una app). */
export type WaNumeroInput = { iphone: string; app: string; display?: string | null | undefined; nombre?: string | null | undefined; tipo?: "prueba" | "produccion" | undefined; bactivo?: boolean | undefined };

/** Un mensaje entrante ya extraído del webhook. `fh` = cuándo (ISO; por defecto ahora). */
export type WaEntranteInput = { iphone: string; waid: string; wamid: string; nombre?: string | null | undefined; tipo?: string | undefined; texto?: string | null | undefined; payload?: unknown; fh?: string | undefined };

/** Resultado de registrar un entrante: `nuevo` false = repetido por un reintento de Meta (no se responde otra vez). */
export type WaEntrante = { nuevo: boolean; mensaje: WaMensaje; conversacion: WaConversacion; contacto: WaContacto; app: WaApp | null };

/** Un saliente: en cola (`pendiente`), aceptado por Meta (`enviado` + `wamid`) o `fallido` con su `error`. */
export type WaSalienteInput = { iconversacion: string; texto?: string | null | undefined; tipo?: string | undefined; wamid?: string | null | undefined; estado?: WaEstado | undefined; error?: string | null | undefined; payload?: unknown };

/** Un estado de Meta para un `wamid` (en inglés, como llega). */
export type WaEstadoInput = { wamid: string; status: string; error?: string | null | undefined; fh?: string | undefined };

/** Un turno para el modelo (historial en orden cronológico). */
export type WaTurno = { role: "user" | "assistant"; content: string };

/** Lo que dejó un webhook: los entrantes nuevos (para responder), cuántos entrantes, estados y eventos hubo. */
export type WaWebhook = { nuevos: WaEntrante[]; entrantes: number; estados: number; eventos: number };

/** Configuración del plugin: ventana, tamaño del historial y las apps/números que el seed deja creados. */
export type WhatsappConfig = { ventanaHoras?: number | undefined; historial?: number | undefined; apps?: WaAppInput[] | undefined; numeros?: WaNumeroInput[] | undefined };

/** Verbos de servidor del plugin armado (sin HTTP). */
export type VerbosWhatsapp = { vincularApp(input: WaAppInput): Promise<WaApp>; vincularNumero(input: WaNumeroInput): Promise<WaNumero>; numeros(): Promise<WaNumero[]>; appDeNumero(iphone: string): Promise<WaApp | null>; registrarEntrante(input: WaEntranteInput): Promise<WaEntrante>; abrirConversacion(icontacto: string, iphone: string, entrante?: boolean, fh?: string): Promise<WaConversacion>; guardarSaliente(input: WaSalienteInput): Promise<WaMensaje>; actualizarEstado(input: WaEstadoInput): Promise<WaMensaje | null>; historial(iconversacion: string, max?: number): Promise<WaTurno[]>; ventanaAbierta(iconversacion: string, fh?: string): Promise<boolean>; registrarEvento(campo: string, payload: unknown, iphone?: string | null): Promise<WaEvento>; procesarWebhook(payload: unknown): Promise<WaWebhook>; conversaciones(iphone?: string, limite?: number): Promise<WaConversacion[]> };

/** Zod de una app. */
export const ZWaApp = z.strictObject({
  slug: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9-]*$/),
  nombre: z.string().min(1).max(120).optional(),
  perfil: z.string().max(120).nullish(),
  contrato: z.string().max(60000).nullish(),
  jconfig: z.record(z.string(), z.unknown()).nullish(),
  bautorespuesta: z.boolean().optional(),
  bactivo: z.boolean().optional(),
});

/** Zod de un número. */
export const ZWaNumero = z.strictObject({
  iphone: z.string().min(1).max(40).regex(/^[0-9]+$/),
  app: z.string().min(1).max(60),
  display: z.string().max(40).nullish(),
  nombre: z.string().max(120).nullish(),
  tipo: z.enum(["prueba", "produccion"]).optional(),
  bactivo: z.boolean().optional(),
});

/** Zod de un entrante. */
export const ZWaEntrante = z.strictObject({
  iphone: z.string().min(1).max(40),
  waid: z.string().min(1).max(32),
  wamid: z.string().min(1).max(160),
  nombre: z.string().max(160).nullish(),
  tipo: z.string().min(1).max(40).optional(),
  texto: z.string().max(8000).nullish(),
  payload: z.unknown().optional(),
  fh: z.string().optional(),
});

/** Zod de un saliente. */
export const ZWaSaliente = z.strictObject({
  iconversacion: z.string().min(1).max(40),
  texto: z.string().max(8000).nullish(),
  tipo: z.string().min(1).max(40).optional(),
  wamid: z.string().max(160).nullish(),
  estado: z.enum(ESTADOS_WA).optional(),
  error: z.string().max(4000).nullish(),
  payload: z.unknown().optional(),
});

/** Zod de un estado de Meta. */
export const ZWaEstado = z.strictObject({ wamid: z.string().min(1).max(160), status: z.string().min(1).max(40), error: z.string().max(4000).nullish(), fh: z.string().optional() });

/** Zod de la configuración. */
export const ZWhatsappConfig = z.strictObject({
  ventanaHoras: z.number().positive().max(168).optional(),
  historial: z.number().int().min(1).max(200).optional(),
  apps: z.array(ZWaApp).optional(),
  numeros: z.array(ZWaNumero).optional(),
});
