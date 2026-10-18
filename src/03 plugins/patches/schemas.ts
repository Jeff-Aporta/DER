/**
 * Contratos del plugin `patches` (tipos/interfaces).
 * Por la regla de arquitectura, los tipos viven aquí (no en mod.ts).
 * Ver: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */

/** Un patch: archivo `patches/NNNN-<nombre>.sql.ts` con `id`, `descripcion` y `up(ctx)`. */
export interface Patch {
  id: string;
  descripcion: string;
  up(ctx: PatchContext): Promise<void>;
}

/** Contexto que recibe `up`: Kysely en transacción. */
export interface PatchContext {
  /** Kysely (transacción): `ctx.exec.schema.*`, `ctx.exec.insertInto(...)`, `ctx.exec.executeQuery(sql..)`. */
  exec: import("kysely").Kysely<any>;
}

/** Estado de un patch frente a la base. */
export type PatchEstado = "aplicado" | "pendiente" | "modificado";

/** Reporte por patch (lo que devuelve `runPatches` / `checkPatches`). */
export interface PatchReport {
  id: string;
  estado: PatchEstado;
  hash: string;
  error?: string;
}

/** Opciones de `runPatches`. */
export interface RunPatchesOptions {
  /** Quién aplica (auditoría en `_patches.por`). Default "agente". */
  por?: string;
  /** Solo reporta; no toca la base. */
  dryRun?: boolean;
}
