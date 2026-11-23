/**
 * Tipos y Zod del plugin de notificaciones: avisos para un usuario (o para todos) con contador de no leídas, al estilo
 * de una red social: quién lo hizo (`iactor` + `actor`, para el avatar), qué pasó, cuándo, visto o no, y a dónde lleva.
 * Una notificación tiene destinatario (`iusuario`, o `*` = todos), título, texto, tipo, un enlace libre que interpreta
 * el front y, opcional, la entidad de origen (`tdespacio` + `iref`). Las de `*` se marcan leídas POR USUARIO.
 * Push fuera de la app: suscripciones por usuario y canal (`webpush` del navegador con VAPID; `fcm` de Android con
 * Capacitor). DER guarda las suscripciones y llama a `services.enviarPush`; el envío real lo pone el consumidor.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/notificaciones.md
 */
import { z } from "zod";

/** Destinatario comodín: la notificación es para todos los usuarios. */
export const TODOS = "*";

/** Canales de push fuera de la app. */
export const CANALES_PUSH = ["webpush", "fcm"] as const;

/** Fila de una notificación. */
export type Notificacion = { id: string; iusuario: string; iactor: string | null; actor: string | null; titulo: string; texto: string | null; tipo: string; enlace: string | null; tdespacio: string | null; iref: string | null; leida: string | null; fhcre: string };

/** Fila de lectura de una notificación para todos (`*`). */
export type LecturaNotificacion = { inotificacion: string; iusuario: string; fhcre: string };

/** Datos para crear notificaciones (a uno o varios destinatarios). `iactor`/`actor` = quién lo hizo (avatar y nombre). */
export type NotificarInput = { destinatarios: string[]; titulo: string; texto?: string | null | undefined; tipo?: string | undefined; enlace?: string | null | undefined; tdespacio?: string | null | undefined; iref?: string | null | undefined; iactor?: string | null | undefined; actor?: string | null | undefined };

/** Marcar leídas: unas (`ids`) o todas las de la sesión (`todas`). */
export type LeerInput = { ids?: string[] | undefined; todas?: boolean | undefined };

/** Bandeja de un usuario: las últimas notificaciones (con `leida` resuelta para él) y el contador. */
export type Bandeja = { items: Notificacion[]; noLeidas: number };

/** Suscripción de push de un usuario (una por dispositivo/navegador). `claves` = p256dh/auth de Web Push. */
export type SuscripcionPush = { id: string; iusuario: string; canal: "webpush" | "fcm"; endpoint: string; claves: Record<string, string> | null; agente: string | null; activa: boolean; fhcre: string };

/** Alta de una suscripción: `webpush` trae `endpoint` + `claves` (de `PushSubscription.toJSON()`); `fcm` trae el token en `endpoint`. */
export type SuscribirInput = { canal: "webpush" | "fcm"; endpoint: string; claves?: Record<string, string> | null | undefined; agente?: string | null | undefined };

/** Envío de push que implementa el consumidor (Web Push con VAPID, FCM…). DER no envía nada por su cuenta. */
export type EnviarPush = (suscripcion: SuscripcionPush, notificacion: Notificacion) => Promise<"ok" | "caducada" | "error"> | "ok" | "caducada" | "error";

/** Verbos de servidor del plugin armado (sin HTTP). */
export type VerbosNotificaciones = { notificar(input: NotificarInput): Promise<Notificacion[]>; bandeja(usuario: string, limite?: number): Promise<Bandeja>; leer(usuario: string, input: LeerInput): Promise<{ marcadas: number }>; noLeidas(usuario: string): Promise<number>; suscribir(usuario: string, input: SuscribirInput): Promise<SuscripcionPush>; desuscribir(usuario: string, endpoint: string): Promise<{ bajas: number }>; suscripciones(usuario: string): Promise<SuscripcionPush[]> };

/** Zod de la creación. */
export const ZNotificar = z.strictObject({
  destinatarios: z.array(z.string().min(1).max(120)).min(1).max(500),
  titulo: z.string().min(1).max(160),
  texto: z.string().max(2000).nullish(),
  tipo: z.string().min(1).max(40).optional(),
  enlace: z.string().max(300).nullish(),
  tdespacio: z.string().max(60).nullish(),
  iref: z.string().max(120).nullish(),
  iactor: z.string().max(120).nullish(),
  actor: z.string().max(120).nullish(),
});

/** Zod de marcar leídas. */
export const ZLeer = z.strictObject({ ids: z.array(z.string().min(1).max(40)).max(500).optional(), todas: z.boolean().optional() });

/** Zod del alta de una suscripción de push. */
export const ZSuscribir = z.strictObject({
  canal: z.enum(CANALES_PUSH),
  endpoint: z.string().min(8).max(1000),
  claves: z.record(z.string(), z.string().max(400)).nullish(),
  agente: z.string().max(200).nullish(),
});

/** Zod de la baja de una suscripción. */
export const ZDesuscribir = z.strictObject({ endpoint: z.string().min(8).max(1000) });
