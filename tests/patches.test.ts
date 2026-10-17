import { assertEquals } from "jsr:@std/assert@1";
import { sqliteDatabase } from "../src/02 controllers/server/sqlite/mod.ts";
import { checkPatches, runPatches, type Patch } from "../src/03 plugins/patches/mod.ts";

const crearTabla = (nombre: string) => ({
  id: nombre,
  descripcion: "crea la tabla " + nombre,
  async up(ctx: any) {
    await ctx.exec.schema.createTable(nombre).addColumn("x", "text").execute();
  },
});

Deno.test("patches: aplica pendientes y registra en _patches", async () => {
  const db = sqliteDatabase(":memory:");
  try {
    const p1 = crearTabla("uno");
    const p2 = crearTabla("dos");
    const report = await runPatches(db, [p1, p2]);
    assertEquals(report.map((r) => r.estado), ["aplicado", "aplicado"]);

    // ambas tablas existen
    const tablas = await db.kysely.selectFrom("sqlite_master").select("name").where("type", "=", "table").execute();
    const names = tablas.map((t: any) => t.name);
    assertEquals(names.includes("uno"), true);
    assertEquals(names.includes("dos"), true);
    assertEquals(names.includes("_patches"), true);

    // re-correr: nada pendiente
    const report2 = await runPatches(db, [p1, p2]);
    assertEquals(report2.map((r) => r.estado), ["aplicado", "aplicado"]);
    assertEquals((await checkPatches(db, [p1, p2])).length, 0);
  } finally {
    db.destroy();
  }
});

Deno.test("patches: detecta patch editado y no lo re-aplica", async () => {
  const db = sqliteDatabase(":memory:");
  try {
    const p1 = crearTabla("uno");
    await runPatches(db, [p1]);

    // editar el patch ya aplicado
    const editado: Patch = { ...p1, descripcion: p1.descripcion + " (editado)" };
    const report = await runPatches(db, [editado]);
    assertEquals(report[0]!.estado, "modificado");

    // checkPatches lo marca como pendiente de atención
    assertEquals((await checkPatches(db, [editado])).length, 1);
  } finally {
    db.destroy();
  }
});

Deno.test("patches: dry-run no toca la base", async () => {
  const db = sqliteDatabase(":memory:");
  try {
    const p1 = crearTabla("uno");
    const report = await runPatches(db, [p1], { dryRun: true });
    assertEquals(report[0]!.estado, "pendiente");
    const tablas = await db.kysely.selectFrom("sqlite_master").select("name").where("type", "=", "table").execute();
    const names = tablas.map((t: any) => t.name);
    assertEquals(names.includes("uno"), false);
  } finally {
    db.destroy();
  }
});
