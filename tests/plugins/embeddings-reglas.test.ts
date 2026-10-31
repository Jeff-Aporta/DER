/**
 * Motor de reglas de embeddings y matemática de vectores, sin tocar datos de la caché: forma de la configuración (Zod), validación
 * contra la definición de las entidades, ausencia de SQL libre, proyección reproducible y compresión.
 */
import { assert, assertAlmostEquals, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { defineEntity } from "@Jeff-Aporta/DER/index.ts";
import { createServer, ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { d1Database } from "@Jeff-Aporta/DER/src/02-controllers/server/d1.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { codificar, coseno, decodificar, embeddingsServer, erroresContraEntidades, huellaDe, normalizarL2, normalizarTexto, proyectar, type Proyeccion, type ReglaPurga, ZEmbeddingsConfig, ZReglaPurga } from "@Jeff-Aporta/DER/tests/plugins/_embeddings.ts";
import { d1Simulado } from "@Jeff-Aporta/DER/tests/_util.ts";

const NotaEntity = defineEntity({ name: "pruebas.nota", singular: "nota", plural: "notas", schema: { columns: { inota: { type: "int", pk: true, autoincrement: true }, bactivo: { type: "bool", default: true }, titulo: { type: "string", length: 80 }, secreto: { type: "string" }, jdata: { type: "json" }, creado: { type: "datetime" }, doble: { type: "int", virtual: true } } } });
const DobleEntity = defineEntity({ name: "pruebas.doble", singular: "doble", plural: "dobles", schema: { columns: { a: { type: "int", pk: true }, b: { type: "int", pk: true } } } });

function base() {
  const db = sqliteDatabase();
  new ServerController(NotaEntity, { db, table: "notas", hidden: ["secreto"], computed: { doble: "{inota} * 2" } });
  new ServerController(DobleEntity, { db, table: "dobles" });
  return db;
}

const regla = (r: Partial<ReglaPurga>): ReglaPurga => ({ nombre: "r", alcance: { entidad: "notas" }, ...r });
const CFG = { modelos: { m: { id: "x/m", dims: 8, proveedor: "p" } } };

Deno.test("README: el JSON completo de ejemplo es una configuración válida", async () => {
  const readme = await Deno.readTextFile(new URL("../../README.md", import.meta.url));
  const json = /```json\n([\s\S]*?)```/.exec(readme)?.[1] ?? "";
  const r = ZEmbeddingsConfig.safeParse(JSON.parse(json));
  assert(r.success, r.success ? "" : r.error.message);
  assert(json.includes("mensajes-inactivos"));
});

Deno.test("reglas: la forma se valida con Zod (identificadores, claves extra, criterio obligatorio, reservados)", () => {
  const malas: unknown[] = [
    { nombre: "SQL libre", todo: true },
    { nombre: "x", sinHitsDias: 3, sql: "1=1" },
    { nombre: "x" },
    { nombre: "general", sinHitsDias: 3 },
    { nombre: "x", sinHitsDias: 0 },
    { nombre: "x", alcance: { entidad: "notas; drop table notas" }, sinHitsDias: 1 },
    { nombre: "x", alcance: { entidad: "notas" }, donde: [{ columna: "bactivo = 0 or 1", op: "eq", valor: false }] },
    { nombre: "x", alcance: { entidad: "notas" }, donde: [{ columna: "bactivo", op: "like", valor: "%" }] },
    { nombre: "x", alcance: { entidad: "notas" }, donde: [{ columna: "bactivo", op: "eq" }] },
    { nombre: "x", alcance: { entidad: "notas" }, donde: [{ columna: "bactivo", op: "nulo", valor: 1 }] },
    { nombre: "x", alcance: { entidad: "notas" }, donde: [{ columna: "inota", op: "in", valor: 1 }] },
    { nombre: "x", donde: [{ columna: "bactivo", op: "eq", valor: false }] },
    { nombre: "x", alcance: { entidad: "notas", tipo: "consulta" }, huerfanos: true },
    { nombre: "x", todo: true, sinHitsDias: 3 },
  ];
  for (const m of malas) assert(!ZReglaPurga.safeParse(m).success, JSON.stringify(m));
  assert(ZReglaPurga.safeParse({ nombre: "mensajes-inactivos", alcance: { entidad: "mensajes" }, sinHitsDias: 3, donde: [{ columna: "bactivo", op: "eq", valor: false }] }).success);
  assert(ZReglaPurga.safeParse({ nombre: "consultas", alcance: { tipo: "consulta" }, soloPresion: true }).success);
});

Deno.test("config: modelo por defecto, reducción coherente, orden de presión y presupuesto de parámetros", () => {
  const ok = (c: unknown) => ZEmbeddingsConfig.safeParse(c).success;
  assert(ok(CFG));
  assert(!ok({ ...CFG, otra: 1 }));
  assert(!ok({ modelos: {} }));
  assert(!ok({ ...CFG, modeloDefecto: "nadie" }));
  assert(!ok({ modelos: { a: CFG.modelos.m, b: CFG.modelos.m } }));
  assert(!ok({ modelos: { m: { ...CFG.modelos.m, reduccion: { dims: 8 } } } }));
  assert(!ok({ modelos: { m: { ...CFG.modelos.m, reduccion: { dims: 4, decimales: 9 } } } }));
  assert(ok({ modelos: { m: { ...CFG.modelos.m, reduccion: { metodo: "ninguna", decimales: 3 } } } }));
  assert(!ok({ ...CFG, purga: { presion: { objetivoPct: 80 } } }));
  assert(!ok({ ...CFG, purga: { presion: { maxFilas: 10, orden: ["nadie"] } } }));
  assert(!ok({ ...CFG, purga: { reglas: [{ nombre: "a", todo: true }, { nombre: "a", todo: true }] } }));
  const muchas = Array.from({ length: 10 }, (_, i) => ({ nombre: `r${i}`, alcance: { entidad: "notas" }, donde: [{ columna: "inota", op: "in", valor: Array.from({ length: 20 }, (_x, j) => j) }] }));
  assert(!ok({ ...CFG, purga: { reglas: muchas } }), "más de 90 parámetros");
});

Deno.test("reglas: identificadores contra la definición de la entidad", async () => {
  const db = base();
  const e = (r: Partial<ReglaPurga>) => erroresContraEntidades(regla(r), db).join(" | ");
  assertEquals(e({ donde: [{ columna: "bactivo", op: "eq", valor: false }] }), "");
  assertEquals(e({ huerfanos: true }), "");
  assertEquals(e({ sinHitsDias: 3, alcance: { entidad: "lo-que-sea" } }), "", "sin cruce no exige entidad");
  assert(e({ alcance: { entidad: "nadie" }, huerfanos: true }).includes("entidad desconocida"));
  assert(e({ alcance: { entidad: "dobles" }, huerfanos: true }).includes("pk compuesta"));
  assert(e({ donde: [{ columna: "nada", op: "eq", valor: 1 }] }).includes("no es una columna persistida"));
  assert(e({ donde: [{ columna: "doble", op: "eq", valor: 1 }] }).includes("no es una columna persistida"));
  assert(e({ donde: [{ columna: "secreto", op: "eq", valor: "x" }] }).includes("oculta"));
  assert(e({ donde: [{ columna: "jdata", op: "eq", valor: "x" }] }).includes("json"));
  assert(e({ donde: [{ columna: "bactivo", op: "lt", valor: true }] }).includes("solo eq y ne"));
  assert(e({ donde: [{ columna: "bactivo", op: "eq", valor: "no" }] }).includes("booleano"));
  assert(e({ donde: [{ columna: "inota", op: "eq", valor: "1" }] }).includes("número"));
  assert(e({ donde: [{ columna: "titulo", op: "masDeDias", valor: 3 }] }).includes("fecha"));
  assert(e({ donde: [{ columna: "creado", op: "gt", valor: "ayer" }] }).includes("fecha ISO"));
  await db.destroy();
});

Deno.test("reglas: una regla inválida frena seed y purga, y /reglas la explica sin lanzar", async () => {
  const db = base();
  const emb = createServer(embeddingsServer, { db, cfg: { ...CFG, purga: { reglas: [{ nombre: "mala", alcance: { entidad: "notas" }, donde: [{ columna: "nada", op: "eq", valor: 1 }] }] } } });
  for (const c of emb.list) await c.seed();
  await assertRejects(() => emb.seed(), Error, "no es una columna persistida");
  await assertRejects(() => emb["purgar"]({ simular: true }), Error, "no es una columna persistida");
  const x = await emb["reglas"]();
  assert(x.errores[0].includes("mala"));
  await db.destroy();
});

Deno.test("reglas: una entidad de otra base se rechaza con su motivo", async () => {
  const otra = sqliteDatabase();
  new ServerController(NotaEntity, { db: otra, table: "notas" });
  const db = sqliteDatabase();
  assert(erroresContraEntidades(regla({ huerfanos: true }), db)[0]!.includes("otra base"));
  await db.destroy();
  await otra.destroy();
});

Deno.test("createServer: config inválida falla al armar, también en D1", () => {
  const db = d1Database(d1Simulado(new DatabaseSync(":memory:")));
  assertThrows(() => createServer(embeddingsServer, { db, cfg: { modelos: {} } }), Error, "inválida");
});

const proy = (p: Partial<Proyeccion>): Proyeccion => ({ iproyeccion: crypto.randomUUID(), modelo: "m", dimsorigen: 64, dims: 16, decimales: null, metodo: "aleatoria", semilla: 7, version: 1, ...p });
const aleatorio = (n: number, s: number) => Array.from({ length: n }, (_, i) => Math.sin(i * 12.9898 + s) * 43758.5453 % 1);

Deno.test("vectores: texto canónico y huella estable", async () => {
  assertEquals(normalizarTexto("  Café\n  MOLIDO\t", true), "café molido");
  assertEquals(normalizarTexto("Ａ  b", false), "A b");
  assertEquals(await huellaDe("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

Deno.test("vectores: la proyección es determinista, no depende del isolate y su valor queda congelado", () => {
  const v = aleatorio(64, 1);
  const a = proyectar(v, proy({}));
  const b = proyectar(v, proy({}));
  assertEquals(a, b, "ids distintos, misma semilla: misma matriz");
  assert(a.some((x, i) => x !== proyectar(v, proy({ semilla: 8 }))[i]), "otra semilla, otro espacio");
  assertAlmostEquals(Math.hypot(...a), 1, 1e-9);
  // congela el PRNG: si esto cambia, hay que subir VERSION_PROYECCION
  assertEquals(proyectar(Array.from({ length: 8 }, (_, i) => i + 1), proy({ dimsorigen: 8, dims: 3, decimales: 3, semilla: 42 })), [-0.457, -0.61, 0.648]);
});

Deno.test("vectores: truncar y decimales", () => {
  assertEquals(proyectar([3, 4, 100, 100], proy({ dimsorigen: 4, dims: 2, metodo: "truncar", decimales: 2 })), [0.6, 0.8]);
  assertEquals(proyectar([1, 0], proy({ dimsorigen: 2, dims: 2, metodo: "ninguna" })), [1, 0]);
});

Deno.test("vectores: codificar ↔ decodificar en los tres anchos y ahorro de 1024 → 256 con 3 decimales", () => {
  const v = normalizarL2(aleatorio(1024, 2));
  for (const decimales of [1, 2, 3, 4]) {
    const r = proyectar(v, proy({ dimsorigen: 1024, dims: 1024, metodo: "ninguna", decimales }));
    assertEquals(decodificar(codificar(r, decimales), decimales), r, `decimales ${decimales}`);
  }
  const f = proyectar(v, proy({ dimsorigen: 1024, dims: 1024, metodo: "ninguna" }));
  assert(coseno(decodificar(codificar(f, null), null), f) > 0.999999);
  const reducido = proyectar(v, proy({ dimsorigen: 1024, dims: 256, decimales: 3 }));
  assertEquals(codificar(f, null).length, 5462);
  assertEquals(codificar(reducido, 3).length, 683, "12.5 % del original");
});

Deno.test("vectores: 1024 → 256 con 3 decimales conserva el vecino más cercano en datos sintéticos agrupados", () => {
  const p = proy({ dimsorigen: 1024, dims: 256, decimales: 3 });
  const centros = Array.from({ length: 20 }, (_, i) => normalizarL2(aleatorio(1024, i * 31 + 5)));
  const doc = (c: number, k: number) => normalizarL2(centros[c]!.map((x, j) => x + 0.6 * (aleatorio(1, c * 1000 + k * 37 + j)[0]! / Math.sqrt(1024))));
  const docs = Array.from({ length: 20 }, (_, c) => doc(c, 1));
  let aciertos = 0;
  for (let c = 0; c < 20; c++) {
    const q = proyectar(doc(c, 2), p);
    const top = docs.map((d, i) => [coseno(q, proyectar(d, p)), i] as const).sort((a, b) => b[0] - a[0])[0]!;
    if (top[1] === c) aciertos++;
  }
  assertEquals(aciertos, 20);
});
