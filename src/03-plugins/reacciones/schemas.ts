/**
 * Tipos y Zod del plugin de reacciones: toda entidad puede recibir reacciones (publicaciones, comentarios, tiquetes).
 * Una reacción es un emoji (o clave corta) que un usuario pone sobre una entidad; con eso salen las métricas de
 * reacciones más y menos usadas, y las de cada usuario.
 * La PK es (tdespacio, iref, iusuario): un usuario reacciona una vez por entidad.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/reacciones.md
 */
import { z } from "zod";
import type { Reaccion } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

/** Fila de una reacción. */
export type ReaccionFila = { tdespacio: string; iref: string; iusuario: string; reaccion: Reaccion };

/** Datos para reaccionar (o cambiar la reacción) sobre una entidad. */
export type ReaccionarInput = { tdespacio: string; iref: string; reaccion: string };

/** Zod de la reacción sobre una entidad. */
export const ZReaccionar = z.strictObject({ tdespacio: z.string().min(1).max(60), iref: z.string().min(1).max(120), reaccion: z.string().min(1).max(64) });

/** Resumen de una entidad: total, cuántas por reacción y la de quien consulta (o null). */
export type ResumenReacciones = { total: number; porReaccion: Record<string, number>; mia: string | null };

/** Quién reaccionó y con qué (las reacciones no son anónimas: se pueden auditar). */
export type VotanteReaccion = { iusuario: string; reaccion: string };

/** Página de votantes de una entidad. */
export type PaginaVotantes = { filas: VotanteReaccion[]; total: number; page: number; pageSize: number };

/** Verbos de servidor de reacciones (sin HTTP): el consumidor pone su propia sesión delante. */
export type VerbosReacciones = { reaccionar(usuario: string, input: ReaccionarInput): Promise<ReaccionFila>; quitar(usuario: string, tdespacio: string, iref: string): Promise<boolean>; resumen(tdespacio: string, irefs: string[], usuario?: string | null): Promise<Record<string, ResumenReacciones>>; votantes(tdespacio: string, iref: string, opciones?: { reaccion?: string | null; page?: number; pageSize?: number }): Promise<PaginaVotantes> };
