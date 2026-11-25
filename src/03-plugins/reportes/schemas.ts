/**
 * Tipos y Zod del plugin de reportes (observaciones): cualquier persona reporta o marca un error sobre CUALQUIER cosa
 * del sistema (un mensaje de un bot, un contacto, una pantalla…) con `origin` + `idorigin`, y un auditor o un agente
 * (humano o IA) lo atiende con la misma mecánica del plugin `errores`: toma atómica, bitácora, cierre. A diferencia de
 * `errores` (bugs de la app: la fila se borra al resolver), un reporte se CIERRA (`aplicada` o `descartada`) y se
 * conserva con quién lo aplicó, para alimentar la mejora del asistente por empresa y por ámbito (bot, canal…).
 * Aislamiento por `iempresa`; la sesión y el rol los aporta el consumidor con `services.contexto`.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/reportes.md
 */
import { z } from "zod";

/** Estados: `pendiente` → `en_proceso` (tomado) → `aplicada` | `descartada` (cerrados, se conservan). */
export const ESTADOS_REPORTE = ["pendiente", "en_proceso", "aplicada", "descartada"] as const;

/** Clases sugeridas de reporte (texto libre de hasta 40 caracteres también vale). */
export const TIPOS_REPORTE = ["error", "redaccion", "dato", "sugerencia"] as const;

/** Estado de un reporte. */
export type EstadoReporte = (typeof ESTADOS_REPORTE)[number];

/** Línea de la bitácora de quien atiende. */
export type AvanceReporte = { fh: string; agente: string; texto: string };

/** Fila de un reporte. `jcontexto` guarda lo que había cuando se reportó (el texto citado, la pantalla…). */
export type Reporte = { id: string; iempresa: string; origin: string; idorigin: string; ambito: string | null; tipo: string; motivo: string; correccion: string | null; severidad: string | null; jcontexto: unknown; autor: string; estado: EstadoReporte; atendido_por: string | null; ftoma: string | null; javance: AvanceReporte[] | null; iaplicador: string | null; resultado: string | null; fhcre: string; fhcierre: string | null };

/** Reporte nuevo: sobre qué (`origin` + `idorigin`), por qué y, si se sabe, la corrección sugerida. `ambito` agrupa (bot, canal, módulo). */
export type ReportarReporteInput = { origin: string; idorigin: string; ambito?: string | null | undefined; tipo?: string | undefined; motivo: string; correccion?: string | null | undefined; severidad?: "baja" | "media" | "alta" | undefined; contexto?: unknown };

/** Filtros de la cola y de las consultas. */
export type FiltroReportes = { estado?: EstadoReporte | undefined; origin?: string | undefined; idorigin?: string | undefined; ambito?: string | undefined; tipo?: string | undefined; autor?: string | undefined; limite?: number | undefined };

/** Cierre de un reporte por quien lo tomó. */
export type CerrarReporteInput = { id: string; resultado: "aplicada" | "descartada"; nota?: string | null | undefined };

/** Avance o suelta (con la nota) de un reporte tomado. */
export type AvanceReporteInput = { id: string; texto: string };

/** Quién es y en qué empresa actúa; `rol` decide si audita (`cfg.rolesAuditor`). */
export type ContextoReportes = { iusuario: string; iempresa: string; rol?: string | undefined };

/** Configuración: roles que auditan (atienden), vida de una toma en minutos y límite de bitácora. */
export type ReportesConfig = { rolesAuditor?: string[] | undefined; tomaMin?: number | undefined };

/** Servicios del consumidor: `contexto` resuelve la sesión HTTP; `alReportar` avisa que hay trabajo (webhook, cola, agente). */
export type ReportesServicios = { contexto?: ((req: Request, sesion: { id?: string } | null | undefined) => Promise<ContextoReportes> | ContextoReportes) | undefined; alReportar?: ((reporte: Reporte) => Promise<void> | void) | undefined };

/** Verbos de servidor del plugin armado (los usan los handlers y los agentes en proceso). */
export type VerbosReportes = { reportar(iempresa: string, autor: string, input: ReportarReporteInput): Promise<Reporte>; cola(iempresa: string, filtro?: FiltroReportes): Promise<Reporte[]>; reporte(iempresa: string, id: string): Promise<Reporte>; tomar(iempresa: string, id: string, agente: string): Promise<Reporte>; avance(iempresa: string, agente: string, input: AvanceReporteInput): Promise<Reporte>; soltar(iempresa: string, agente: string, input: AvanceReporteInput): Promise<Reporte>; cerrar(iempresa: string, agente: string, input: CerrarReporteInput): Promise<Reporte>; de(iempresa: string, origin: string, idorigin: string): Promise<Reporte[]> };

/** Zod de un reporte nuevo. */
export const ZReportarReporte = z.strictObject({ origin: z.string().trim().min(1).max(80), idorigin: z.string().trim().min(1).max(120), ambito: z.string().max(120).nullish(), tipo: z.string().trim().min(1).max(40).optional(), motivo: z.string().trim().min(1).max(4000), correccion: z.string().max(8000).nullish(), severidad: z.enum(["baja", "media", "alta"]).optional(), contexto: z.unknown().optional() });

/** Zod del avance o la suelta. */
export const ZAvanceReporte = z.strictObject({ id: z.string().min(1).max(40), texto: z.string().trim().min(1).max(4000) });

/** Zod del cierre. */
export const ZCerrarReporte = z.strictObject({ id: z.string().min(1).max(40), resultado: z.enum(["aplicada", "descartada"]), nota: z.string().max(4000).nullish() });

/** Zod de tomar. */
export const ZTomarReporte = z.strictObject({ id: z.string().min(1).max(40) });

/** Zod de la configuración. */
export const ZReportesConfig = z.strictObject({ rolesAuditor: z.array(z.string().min(1)).optional(), tomaMin: z.number().positive().optional() });
