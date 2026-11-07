/**
 * Tipos y Zod del plugin de calificaciones: toda entidad puede ser calificada (tiquetes, mensajes, productos…).
 * Un entero de -10 (lo peor) a 10 (lo mejor); 0 es neutro. Con -10 y 10 se cubren el dislike y el like.
 * La PK es (tdespacio, iref, iusuario): un usuario califica una entidad una sola vez.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/calificaciones.md
 */
import { z } from "zod";
import { type ValorCalificacion, ZValorCalificacion } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

/** Fila de una calificación. */
export type Calificacion = { tdespacio: string; iref: string; iusuario: string; valor: ValorCalificacion };

/** Datos para calificar (o recalificar) una entidad. */
export type CalificarInput = { tdespacio: string; iref: string; valor: number };

/** Zod de la calificación de una entidad. */
export const ZCalificar = z.strictObject({ tdespacio: z.string().min(1).max(60), iref: z.string().min(1).max(120), valor: ZValorCalificacion });
