/**
 * Tipos y Zod del plugin de errores.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/errores.md
 */
import { z } from "zod";
import type { BaseCtx } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { ArchivoPublico } from "@Jeff-Aporta/DER/src/03-plugins/archivos/schemas.ts";
import type { SelloAuditoria } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

/** Estados de un error: `recibiendo` (faltan adjuntos), `pendiente` y `en_proceso`. Atendido = fila borrada. */
export const ESTADOS_ERROR = ["recibiendo", "pendiente", "en_proceso"] as const;
/** Estado de un error. */
export type EstadoError = (typeof ESTADOS_ERROR)[number];

/** Configuración: secreto de los tokens, código de los reportes sin sesión (mínimo 8, se comprueba ya resuelto el `env:`), vida de una toma y límites. */
export const ZErroresConfig = z.strictObject({ secret: z.string().min(1), codigo: z.string().min(1).optional(), tomaMin: z.number().positive().default(60), recibiendoMin: z.number().positive().default(10), maxHtmlKb: z.number().positive().default(512), maxAdjuntoMb: z.number().positive().default(20), maxAdjuntos: z.number().int().positive().default(10), tokenSeg: z.number().int().positive().default(3600) });
/** Configuración ya validada. */
export type ErroresConfig = z.infer<typeof ZErroresConfig>;
/** Cuerpo de `POST errores/reportar`. */
export const ZReportarInput = z.strictObject({ titulo: z.string().trim().min(1).max(200).optional(), descripcion: z.string().max(20000).default(""), severidad: z.enum(["baja", "media", "alta"]).optional(), ruta: z.string().max(1000).optional(), url: z.string().max(2000).optional(), html: z.string().optional(), contexto: z.record(z.string(), z.unknown()).optional(), apporigin: z.string().max(120).optional(), adjuntos: z.number().int().nonnegative().optional(), codigo: z.string().max(200).optional() });
/** Datos de un reporte. */
export type ReportarInput = z.input<typeof ZReportarInput>;
/** Cuerpo de `POST error/{id}/tomar`. */
export const ZTomarInput = z.strictObject({ agente: z.string().trim().min(1).max(120) });
/** Datos de una toma. */
export type TomarInput = z.infer<typeof ZTomarInput>;
/** Cuerpo de `POST error/{id}/avance` y `.../soltar`. */
export const ZAvanceInput = z.strictObject({ agente: z.string().trim().min(1).max(120), texto: z.string().trim().min(1).max(4000) });
/** Datos de un avance. */
export type AvanceInput = z.infer<typeof ZAvanceInput>;

/** Una línea de la bitácora del agente. */
export type LineaAvance = { fh: string; agente: string; texto: string };
/** Fila de error. */
export type ErrorReporte = SelloAuditoria & { ierror: number; titulo: string; descripcion: string | null; transcripcion: string | null; severidad: string | null; estado: EstadoError; ruta: string | null; url: string | null; html: string | null; contexto: Record<string, unknown> | null; atendido_por: string | null; ftoma: Date | null; avance: LineaAvance[] | null };
/** Respuesta de un reporte: el id y el token de corta vida para adjuntar y seguirlo. */
export type ReporteCreado = { ierror: number; estado: EstadoError; token: string };
/** Resultado de un adjunto: el texto si se transcribió, el archivo si se conservó. */
export type AdjuntoResultado = { texto: string | null; archivo: ArchivoPublico | null };
/** Error completo para quien lo atiende: la fila y sus archivos con URL. */
export type DetalleError = ErrorReporte & { archivos: ArchivoPublico[] };
/** Lo que ve quien reportó: estado y bitácora (`atendido` cuando la fila ya no existe). */
export type SeguimientoError = { estado: EstadoError | "atendido"; avance: LineaAvance[] };
/** Enlaces del consumidor: quién reporta sin código y qué hacer al recibir un reporte. Todo opcional. */
export type EnlacesErrores = { reportanteConfiable?(ctx: BaseCtx): Promise<boolean> | boolean; alReportar?(error: ErrorReporte, ctx: BaseCtx): Promise<void> | void };
