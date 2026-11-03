/**
 * Tipos y Zod del plugin de penalizaciones.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/penalizaciones.md
 */
import { z } from "zod";

/** Configuración: minutos por intento fallido (el último se repite), umbral de ataque y ventanas. */
export const ZPenalizacionesConfig = z.strictObject({ escalaMin: z.array(z.number().nonnegative()).min(1).default([0, 0, 5, 10, 15, 20, 25, 30]), umbralGlobal: z.number().int().positive().default(10), ventanaGlobalMin: z.number().positive().default(60), ventanaMin: z.number().positive().default(1440), maxIntentos: z.number().int().positive().default(50) });
/** Configuración ya validada. */
export type PenalizacionesConfig = z.infer<typeof ZPenalizacionesConfig>;
/** Fila: un vector de intentos fallidos (`<ambito>:ip:<ip>` o `<ambito>:global`). */
export type Penalizacion = { id: string; intentos: number[]; fhmod: Date };
/** Vector que decide: el de la IP o el global. */
export type VectorActivo = "ip" | "global";
/** Quién intenta: el ámbito (qué se protege) y la IP si se conoce. */
export type Intento = { ambito: string; ip?: string | null | undefined };
/** Veredicto: si está penalizado, cuánto falta y qué vector decidió. */
export type Veredicto = { penalizado: boolean; restanteMs: number; vector: VectorActivo; fallidos: number };
