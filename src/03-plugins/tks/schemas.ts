/**
 * Tipos y Zod del plugin de tiquetes (tks): el tablero transversal que toda app puede montar encima.
 * Un tk es un número autoincremental con su requerimiento (html|md), su propósito, sus pendientes, su columna kanban
 * (`estado`), su regla de cierre (`bfinalizado`) y a quién se asignó (`jasignados`: usuarios, roles y grupos).
 *
 * El `estado` es un texto libre (STR): las columnas por defecto son en MAYÚSCULAS snake_case (`POR_HACER`,
 * `EN_PROCESO`, `EN_REVISION`, `FINALIZADO`), pero la regla de cierre compara sin distinguir mayúsculas.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/tks.md
 */
import { z } from "zod";
import type { Asignados, Pendientes } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";
import { ZAsignados, ZPendiente } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

/** Columnas del tablero por defecto (los estados los configura el consumidor; no son datos, son la vista). */
export const ESTADOS_TK = ["POR_HACER", "EN_PROCESO", "EN_REVISION", "FINALIZADO"] as const;

/** Configuración del plugin de tks: qué estados cierran un tk y si se puede finalizar a mano. */
export const ZTksConfig = z.strictObject({ estadosFinalizados: z.array(z.string().min(1)).default(["FINALIZADO"]), permitirFinalizadoManual: z.boolean().default(true) });
/** Configuración ya validada. */
export type TksConfig = z.infer<typeof ZTksConfig>;

/**
 * Fila de un tk (tiquete).
 *
 * `itk` es TEXTO: la numeración la quema una secuencia en base 36 con relleno de ceros a 4 dígitos
 * (`0001`, `0002`… `000a`, `0010`…), así el número admite letras y cada empresa puede adaptarlo con
 * su propio controller (otra base, otro relleno o un prefijo).
 */
export type Tk = { itk: string; requerimiento: string; proposito: string | null; jtodo: Pendientes | null; estado: string; bfinalizado: boolean; fhcre: Date | null; bactivo: boolean; iusuario: string | null; jasignados: Asignados | null; qtotalmensajes: number | null; qcalificacion: number | null };

/** Datos para crear o cambiar un tk (lo que el front envía). */
export type TkInput = { requerimiento?: string | undefined; proposito?: string | null | undefined; jtodo?: Pendientes | null | undefined; estado?: string | undefined; bfinalizado?: boolean | undefined; iusuario?: string | null | undefined; jasignados?: Asignados | null | undefined };

/** Zod de la entrada de un tk. */
export const ZTkInput = z.strictObject({ requerimiento: z.string().min(1).max(200000).optional(), proposito: z.string().max(300).nullable().optional(), jtodo: z.array(ZPendiente).nullable().optional(), estado: z.string().min(1).max(40).optional(), bfinalizado: z.boolean().optional(), iusuario: z.string().max(120).nullable().optional(), jasignados: ZAsignados.nullable().optional() });
