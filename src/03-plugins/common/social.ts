/**
 * Piezas comunes de los plugins "sociales" (mensajes, calificaciones, reacciones): las columnas que se repiten y la
 * lógica del índice de un hilo. Así los cuatro se comportan igual sin atarse entre sí: cada plugin es autónomo y el
 * consumidor puede instalar uno, todos o ninguno.
 *
 * - `COLUMNAS_ESPACIO`: la entidad referenciada (espacio + id), sin FK: la coherencia la mantiene el sistema.
 * - `COLUMNAS_VOTO`: lo de un voto por usuario (calificaciones y reacciones).
 * - `COLUMNAS_MENSAJE`: lo de un mensaje (índice en el hilo, historial, cita, autor).
 * - Índice: `x`, `x.y`, `x.y.z`…; el padre de `10.0` es `10` y el de `10` no existe.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
import type { ColumnDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { Asignados, PerfilAsignado } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

/** Columnas que apuntan a la entidad referenciada: el espacio y su id (definiciones abiertas, sin restricciones). */
export const COLUMNAS_ESPACIO: Record<string, ColumnDef> = {
  tdespacio: { type: "string", pk: true, length: 60, nullable: false },
  iref: { type: "string", pk: true, length: 120, nullable: false },
};

/** Columnas de un voto por usuario (calificaciones y reacciones): la PK es espacio + referencia + usuario. */
export const COLUMNAS_VOTO: Record<string, ColumnDef> = {
  ...COLUMNAS_ESPACIO,
  iusuario: { type: "string", pk: true, length: 120, nullable: false },
};

/** Columnas de un mensaje: su índice en el hilo, el historial de contenido, la cita y el autor. */
export const COLUMNAS_MENSAJE: Record<string, ColumnDef> = {
  imensaje: { type: "string", pk: true, length: 300, nullable: false },
  jcontenido: { type: "json" },
  indexcita: { type: "string", length: 300 },
  bactivo: { type: "bool", default: true },
  iusuario: { type: "string", length: 120 },
};

/** Segmentos numéricos de un índice (`10.0.1` → `[10, 0, 1]`). Un índice inválido da `[]`. */
export function segmentosIndice(indice: string): number[] {
  if (!/^\d+(\.\d+)*$/.test(indice)) return [];
  return indice.split(".").map((s) => Number(s));
}

/** Índice padre de un índice (`10.0.1` → `10.0`; `10` → `null`). */
export function indicePadre(indice: string): string | null {
  const segs = segmentosIndice(indice);
  if (segs.length < 2) return null;
  return segs.slice(0, -1).join(".");
}

/** Índice hijo `n` de un padre (`10` + 0 → `10.0`; sin padre → `0`). */
export function indiceHijo(padre: string | null, n: number): string {
  return padre ? `${padre}.${n}` : String(n);
}

/** Compara dos índices por sus segmentos (numérico): el de más niveles va después. */
export function compararIndices(a: string, b: string): number {
  const sa = segmentosIndice(a);
  const sb = segmentosIndice(b);
  const n = Math.min(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    const d = (sa[i] ?? 0) - (sb[i] ?? 0);
    if (d !== 0) return d;
  }
  return sa.length - sb.length;
}

/** ¿`indice` es descendiente de `prefijo`? (`10.0.1` lo es de `10` y de `10.0`). */
export function esDescendiente(indice: string, prefijo: string): boolean {
  if (!indice.startsWith(`${prefijo}.`)) return false;
  return segmentosIndice(indice).length > segmentosIndice(prefijo).length;
}

/**
 * ¿El perfil de la sesión tiene acceso por las asignaciones? `*` en grupos significa todos.
 * Sin asignación (o sin ninguna que coincida) no hay acceso: el creador lo tiene aparte.
 */
export function coincideAsignado(asignados: Asignados | null | undefined, perfil: PerfilAsignado): boolean {
  if (!asignados) return false;
  const grupos = asignados.grupos ?? [];
  if (grupos.includes("*")) return true;
  if ((asignados.usuarios ?? []).includes(perfil.usuario)) return true;
  if ((asignados.roles ?? []).some((r) => (perfil.roles ?? []).includes(r))) return true;
  if (grupos.some((g) => (perfil.grupos ?? []).includes(g))) return true;
  return false;
}
