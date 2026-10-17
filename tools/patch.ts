/**
 * tools/patch.ts — runner de patches (lo ejecuta el AGENTE, nunca la API).
 *
 *   deno run -A tools/patch.ts <db.sqlite> [--patches=./patches] [--dry-run] [--por=agente]
 *
 * Backup previo: copia <db>.sqlite → <db>.bak.<ISO> antes de aplicar (solo si hay pendientes).
 *
 * Los archivos de parches viven en `patches/NNNN-<nombre>.sql.ts` y exportan
 * `{ id, descripcion, up(ctx) }`. Se importan en orden de nombre (NNNN).
 */
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02 controllers/server/sqlite/mod.ts";
import { checkPatches, runPatches, type Patch } from "@Jeff-Aporta/DER/src/03 plugins/patches/mod.ts";

const args = Deno.args;
const dbPath = args[0];
if (!dbPath) {
  console.error("uso: tools/patch.ts <db.sqlite> [--patches=./patches] [--dry-run] [--por=agente]");
  Deno.exit(2);
}
const flag = (n: string) => args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
const val = (n: string, def: string) => flag(n)?.split("=")[1] ?? def;
const patchesDir = resolve(val("patches", "patches"));
const dryRun = flag("dry-run") !== undefined;
const por = val("por", "agente");

if (!existsSync(patchesDir)) { console.error(`✗ no existe ${patchesDir}`); Deno.exit(2); }

const files = readdirSync(patchesDir).filter((f) => f.endsWith(".sql.ts") || f.endsWith(".ts")).sort();
if (!files.length) { console.log("sin parches en " + patchesDir); Deno.exit(0); }

const patches: Patch[] = [];
for (const f of files) {
  const mod = await import(pathToFileURL(join(patchesDir, f)).href);
  if (!mod.id || !mod.up || typeof mod.up !== "function") {
    console.error(`✗ ${f} no exporta { id, descripcion, up }`);
    Deno.exit(2);
  }
  patches.push({ id: mod.id, descripcion: mod.descripcion ?? "", up: mod.up });
}

const db = sqliteDatabase(dbPath);
try {
  const pendientes = await checkPatches(db, patches);
  if (pendientes.length && !dryRun && existsSync(dbPath)) {
    const bak = dbPath + ".bak." + new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(dbPath, bak);
    console.log("backup: " + basename(bak));
  }
  const report = await runPatches(db, patches, { dryRun, por });
  for (const r of report) {
    const mark = r.estado === "aplicado" && !dryRun ? "✓" : r.estado === "modificado" ? "⚠" : "·";
    console.log(`${mark} ${r.id}  [${r.estado}]${r.error ? "  " + r.error : ""}`);
  }
  const bad = report.filter((r) => r.estado === "modificado" || r.error);
  if (bad.length) { console.error(`✗ ${bad.length} patches con problemas`); Deno.exit(1); }
  if (dryRun) console.log("--dry-run: nada aplicado");
  else console.log(`listo: ${report.filter((r) => r.estado === "aplicado").length} aplicados, ${report.filter((r) => r.estado === "pendiente").length} pendientes`);
} finally {
  db.destroy();
}
