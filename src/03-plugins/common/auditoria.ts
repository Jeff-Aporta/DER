/**
 * Auditoría común de las entidades con dueño (archivos, errores…): UNA definición de las columnas y de cómo se sellan.
 * `propietario_tipo` dice qué es el dueño (`usuario`, `pagina` con su ruta, o `ninguno`) y `propietario` lo identifica;
 * `apporigin`, `iporigin`, `fhcre` y `fhmod` dicen de dónde vino y cuándo se escribió.
 *
 * ```ts
 * schema: { columns: { ierror: { type: "int", pk: true, autoincrement: true }, ...COLUMNAS_AUDITORIA } }
 * const sello = selloAlta(ctx, { apporigin: "mi-app", pagina: "/panel" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
import type { BaseCtx, ColumnDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { DatosSello, Propietario, SelloAuditoria } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

/** Columnas de auditoría: se esparcen en el `schema.columns` de cada entidad con dueño. */
export const COLUMNAS_AUDITORIA: Record<string, ColumnDef> = {
  propietario_tipo: { type: "string", length: 20, nullable: false, default: "ninguno" },
  propietario: { type: "string", length: 400 },
  apporigin: { type: "string", length: 120 },
  iporigin: { type: "string", length: 64 },
  fhcre: { type: "datetime" },
  fhmod: { type: "datetime" },
};

/** Dueño de una escritura: la sesión si la hay; si no, la página indicada; si no, nadie. */
export function propietarioDe(session: { id?: string | number | undefined } | null | undefined, pagina?: string | null | undefined): Propietario {
  if (session?.id !== undefined && session.id !== null) return { propietario_tipo: "usuario", propietario: String(session.id) };
  if (pagina) return { propietario_tipo: "pagina", propietario: pagina.slice(0, 400) };
  return { propietario_tipo: "ninguno", propietario: null };
}

/** Sello de un alta: dueño, origen y fechas. La IP la aporta quien sella (ver `ipReal`, del lado servidor). */
export function selloAlta(ctx: Partial<BaseCtx>, datos: DatosSello = {}): SelloAuditoria {
  const ahora = new Date();
  return { ...propietarioDe(ctx.session as { id?: string } | null | undefined, datos.pagina), apporigin: datos.apporigin?.slice(0, 120) ?? null, iporigin: datos.ip?.slice(0, 64) ?? null, fhcre: ahora, fhmod: ahora };
}

/** Sello de un cambio: solo `fhmod`. */
export function selloCambio(): { fhmod: Date } {
  return { fhmod: new Date() };
}
