/**
 * patches — motor de migraciones de esquema (los "patches" del ecosistema).
 *
 *   patches/NNNN-<nombre>.sql.ts
 *     export const id = "NNNN-<nombre>";
 *     export const descripcion = "...";
 *     export async function up(ctx) { (usa controllers DER o SQL crudo) }
 *
 * Tabla `_patches (id PK, hash, aplicado, por)`. `runPatches` aplica los pendientes EN ORDEN, cada uno
 * en transacción; si un patch ya aplicado fue EDITADO, lo reporta como `modificado` (no se re-aplica:
 * hay que agregar un patch nuevo). Las APIs NO ejecutan patches: `checkPatches` les dice cuáles faltan
 * para que avisen al agente; el agente los corre con `deno task patch` (backup antes).
 *
 * Entry point: ver https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
import type { Kysely } from "kysely";
import type { Database } from "@Jeff-Aporta/DER/src/02 controllers/server/database.ts";
import type { Patch, PatchReport, RunPatchesOptions } from "@Jeff-Aporta/DER/src/03 plugins/patches/schemas.ts";
export type { Patch, PatchReport, RunPatchesOptions };

const TABLA = "_patches";

/** Hash del patch (id + descripción + fuente de `up`): detecta ediciones de un patch ya aplicado. */
export async function patchHash(p: Patch): Promise<string> {
  const data = new TextEncoder().encode(`${p.id}\n${p.descripcion}\n${p.up.toString()}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
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

/** Aplica los patches pendientes, en orden, cada uno en su transacción. */
export async function runPatches(db: Database, patches: Patch[], opts: RunPatchesOptions = {}): Promise<PatchReport[]> {
  await ensureTable(db);
  const por = opts.por ?? "agente";
  const aplicadas = await aplicados(db);
  const report: PatchReport[] = [];
  for (const p of patches) {
    const h = await patchHash(p);
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
  const out: Patch[] = [];
  for (const p of patches) {
    if (aplicadas.get(p.id) !== await patchHash(p)) out.push(p);
  }
  return out;
}
