/**
 * Tipos y Zod del plugin de notificaciones: avisos para un usuario (o para todos) con contador de no leídas.
 * Una notificación tiene destinatario (`iusuario`, o `*` = todos), título, texto, tipo (info, exito, aviso,
 * peligro, campana…), un enlace libre que interpreta el front y, opcional, la entidad de origen (`tdespacio` + `iref`).
 * Las de `*` se marcan leídas POR USUARIO (tabla de lecturas), así una sola fila sirve para todos.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/notificaciones.md
 */
import { z } from "zod";

/** Destinatario comodín: la notificación es para todos los usuarios. */
export const TODOS = "*";

/** Fila de una notificación. */
export type Notificacion = {
  id: string;
  iusuario: string;
  titulo: string;
  texto: string | null;
  tipo: string;
  enlace: string | null;
  tdespacio: string | null;
  iref: string | null;
  leida: string | null;
  fhcre: string;
};

/** Fila de lectura de una notificación para todos (`*`). */
export type LecturaNotificacion = { inotificacion: string; iusuario: string; fhcre: string };

/** Datos para crear notificaciones (a uno o varios destinatarios). */
export type NotificarInput = {
  destinatarios: string[];
  titulo: string;
  texto?: string | null | undefined;
  tipo?: string | undefined;
  enlace?: string | null | undefined;
  tdespacio?: string | null | undefined;
  iref?: string | null | undefined;
};

/** Marcar leídas: unas (`ids`) o todas las de la sesión (`todas`). */
export type LeerInput = { ids?: string[] | undefined; todas?: boolean | undefined };

/** Bandeja de un usuario: las últimas notificaciones (con `leida` resuelta para él) y el contador. */
export type Bandeja = { items: Notificacion[]; noLeidas: number };

/** Zod de la creación. */
export const ZNotificar = z.strictObject({
  destinatarios: z.array(z.string().min(1).max(120)).min(1).max(500),
  titulo: z.string().min(1).max(160),
  texto: z.string().max(2000).nullish(),
  tipo: z.string().min(1).max(40).optional(),
  enlace: z.string().max(300).nullish(),
  tdespacio: z.string().max(60).nullish(),
  iref: z.string().max(120).nullish(),
});

/** Zod de marcar leídas. */
export const ZLeer = z.strictObject({
  ids: z.array(z.string().min(1).max(40)).max(500).optional(),
  todas: z.boolean().optional(),
});

/** Verbos de servidor del plugin armado (sin HTTP): notificar, bandeja, leer y noLeidas. */
export type VerbosNotificaciones = {
  notificar(input: NotificarInput): Promise<Notificacion[]>;
  bandeja(usuario: string, limite?: number): Promise<Bandeja>;
  leer(usuario: string, input: LeerInput): Promise<{ marcadas: number }>;
  noLeidas(usuario: string): Promise<number>;
};
