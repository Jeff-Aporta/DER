/**
 * patches — motor de migraciones de esquema (los "patches" del ecosistema).
 *
 *   patches/NNNN-<nombre>.sql.ts
 *     export const id = "NNNN-<nombre>";
 *     export const descripcion = "...";
 *     export async function up(ctx) { /* usa controllers DER o SQL crudo *​/ }
 *
 * Tabla `_patches (id PK, hash, aplicado, por)`. `runPatches` aplica los pendientes EN ORDEN, cada uno
 * en transacción; si un patch ya aplicado fue EDITADO, lo reporta como `modificado` (no se re-aplica:
 * hay que agregar un patch nuevo). Las APIs NO ejecutan patches: `checkPatches` les dice cuáles faltan
 * para que avisen al agente; el agente los corre con `deno task patch` (backup antes).
 */
import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "@Jeff-Aporta/DER/src/02 controllers/server/database.ts";

export interface Patch {
  id: string;
  descripcion: string;
  up(ctx: PatchContext): Promise<void>;
}

export interface PatchContext {
  /** Kysely (transacción): `ctx.exec.schema.*`, `ctx.exec.insertInto(...)`, `ctx.exec.executeQuery(sql\`..\`)`. */
  exec: Kysely<any>;
}

export type PatchEstado = "aplicado" | "pendiente" | "modificado";

export interface PatchReport {
  id: string;
  estado: PatchEstado;
  hash: string;
  error?: string;
}

const TABLA = "_patches";

/** Hash del patch (id + descripción + fuente de `up`): detecta ediciones de un patch ya aplicado. */
export function patchHash(p: Patch): string {
  return createHash("sha256").update(`${p.id}\n${p.descripcion}\n${p.up.toString()}`).digest("hex");
}

async function ensureTable(db: Database): Promise<void> {
  await db.kysely.schema
    .createTable(TABLA)
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("hash", "text", (c) => c.notNull())
    .addColumn("aplicado", "text", (c) => c.notNull())
    .addColumn("por", "text", (c) => c.notNull())
    .ifNotExists()
    .execute();
}

async function aplicados(db: Database): Promise<Map<string, string>> {
  const rows = await db.kysely.selectFrom(TABLA).select(["id", "hash"]).execute();
  return new Map(rows.map((r) => [r.id as string, r.hash as string]));
}

export interface RunPatchesOptions {
  /** Quién aplica (auditoría en `_patches.por`). Default "agente". */
  por?: string;
  /** Solo reporta; no toca la base. */
  dryRun?: boolean;
}

/** Aplica los patches pendientes, en orden, cada uno en su transacción. */
export async function runPatches(db: Database, patches: Patch[], opts: RunPatchesOptions = {}): Promise<PatchReport[]> {
  await ensureTable(db);
  const por = opts.por ?? "agente";
  const aplicadas = await aplicados(db);
  const report: PatchReport[] = [];
  for (const p of patches) {
    const h = patchHash(p);
    if (aplicadas.has(p.id)) {
      const prev = aplicadas.get(p.id);
      if (prev !== h) {
        report.push({ id: p.id, estado: "modificado", hash: h, error: "patch ya aplicado fue editado; agrega uno nuevo (no edites éste)" });
      } else {
        report.push({ id: p.id, estado: "aplicado", hash: h });
      }
      continue;
    }
    if (opts.dryRun) { report.push({ id: p.id, estado: "pendiente", hash: h }); continue; }
    try {
      await db.transaction(async (tx) => {
        await p.up({ exec: tx.exec as unknown as Kysely<any> });
        await (tx.exec as any).insertInto(TABLA).values({ id: p.id, hash: h, aplicado: new Date().toISOString(), por }).execute();
      });
      report.push({ id: p.id, estado: "aplicado", hash: h });
    } catch (e) {
      report.push({ id: p.id, estado: "pendiente", hash: h, error: (e as Error).message });
    }
  }
  return report;
}

/** Patches pendientes (o editados): lo que la API avisa al arrancar, sin aplicarlos. */
export async function checkPatches(db: Database, patches: Patch[]): Promise<Patch[]> {
  await ensureTable(db);
  const aplicadas = await aplicados(db);
  return patches.filter((p) => aplicadas.get(p.id) !== patchHash(p));
}
