/**
 * Caché de embeddings y purga sobre D1 simulado (`node:sqlite` con el límite de 100 parámetros) y, para el SQL de otro motor, sobre
 * PGlite: hit por huella, referencias, cambio de texto, proyección guardada, estadísticas, reglas por alcance, condición combinada,
 * huérfanos, tiempo general, simulación fiel, presión por prioridad, tandas y búsqueda exacta antes que embeddings.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { defineEntity } from "@Jeff-Aporta/DER/index.ts";
import { createClient } from "@Jeff-Aporta/DER/src/02-controllers/client/plugin.ts";
import { createRouter, createServer, type Database, ServerController, sql } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { d1Database } from "@Jeff-Aporta/DER/src/02-controllers/server/d1.ts";
import { pgliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/pglite.ts";
import { embeddings, embeddingsServer, type EmbeddingsConfig, proveedorFalso, vectorizeIndice, workersAi } from "@Jeff-Aporta/DER/tests/plugins/_embeddings.ts";
import { d1Simulado } from "@Jeff-Aporta/DER/tests/_util.ts";

const MensajeEntity = defineEntity({ name: "pruebas.mensaje", singular: "mensaje", plural: "mensajes", schema: { columns: { imensaje: { type: "int", pk: true, autoincrement: true }, contenido: { type: "text" }, bactivo: { type: "bool", default: true }, iempresa: { type: "int" }, editado: { type: "datetime" } } } });
const ArticuloEntity = defineEntity({ name: "pruebas.articulo", singular: "articulo", plural: "articulos", schema: { columns: { iarticulo: { type: "string", pk: true, length: 20 }, nombre: { type: "string", length: 80 }, sku: { type: "string", length: 20 } } } });

const DIAS = 86_400_000;
const AHORA = new Date("2026-10-31T12:00:00.000Z");
const hace = (d: number) => new Date(AHORA.getTime() - d * DIAS).toISOString();
const MODELO = { id: "@cf/baai/bge-m3", dims: 64, proveedor: "ai", lote: 3 };

type Montaje = { db: Database; emb: any; prov: ReturnType<typeof proveedorFalso>; mensajes: ServerController<any>; articulos: ServerController<any>; log: string[]; cerrar(): Promise<void> };

async function montar(cfg: Partial<EmbeddingsConfig> = {}, modelo: Record<string, unknown> = MODELO, conProveedor = true): Promise<Montaje> {
  const log: string[] = [];
  const db = d1Database(d1Simulado(new DatabaseSync(":memory:"), log));
  const mensajes = new ServerController(MensajeEntity, { db, table: "avatar_mensajes" });
  const articulos = new ServerController(ArticuloEntity, { db, table: "avatar_articulos" });
  const prov = proveedorFalso(Number(modelo["dims"]));
  const emb = createServer(embeddingsServer, { db, cfg: { modelos: { bge: modelo }, ...cfg }, services: conProveedor ? { ai: prov } : {} });
  const router = createRouter([mensajes, articulos], { plugins: [emb] });
  await router.seed();
  return { db, emb, prov, mensajes, articulos, log, cerrar: () => db.destroy() };
}

/** Fila directa con fechas controladas. */
async function fila(m: Montaje, o: { entidad: string; id?: string; tipo?: string; hits?: number; ultimo?: string | null; creado?: string; bytes?: number; huella?: string; modelo?: string; iproyeccion?: string }): Promise<void> {
  const huella = o.huella ?? crypto.randomUUID().replaceAll("-", "");
  const vigente = o.iproyeccion ?? (await m.emb.reglas()).proyecciones[0].iproyeccion;
  await sql`insert into embeddings_cache (huella, modelo, dims, iproyeccion, tipo, entidad, id, vector, bytes, hits, fultimohit, fcreado) values (${huella}, ${o.modelo ?? MODELO.id}, ${64}, ${vigente}, ${o.tipo ?? "documento"}, ${o.entidad}, ${o.id ?? ""}, ${"AA"}, ${o.bytes ?? 100}, ${o.hits ?? 0}, ${o.ultimo ?? null}, ${o.creado ?? hace(100)})`.execute(m.db.kysely);
}

async function filas(m: Montaje): Promise<{ entidad: string; id: string; hits: number; bytes: number; fultimohit: string | null; huella: string; dims: number }[]> {
  return (await sql<any>`select * from embeddings_cache order by icache`.execute(m.db.kysely)).rows;
}

const ids = async (m: Montaje) => (await filas(m)).map((f) => `${f.entidad}:${f.id}`).sort();

Deno.test("cache: un hit incrementa y devuelve sin llamar al modelo; hit y miss devuelven lo mismo", async () => {
  const m = await montar();
  const a = await m.emb.embeber({ items: ["Hola   Mundo"] });
  assertEquals([a.hits, a.misses, m.prov.llamadas.length], [0, 1, 1]);
  assertEquals(m.prov.llamadas[0], ["hola mundo"], "el modelo recibe el texto canónico");
  const b = await m.emb.embeber({ items: [" hola mundo "] });
  assertEquals([b.hits, b.misses, m.prov.llamadas.length], [1, 0, 1]);
  assertEquals(b.vectores, a.vectores);
  const [f] = await filas(m);
  assertEquals([f!.hits, f!.entidad, f!.id, f!.dims], [1, "*", "", 64]);
  assert(f!.fultimohit);
  assertEquals(f!.huella.length, 64);
  assert(!m.log.some((s) => /hola mundo/i.test(s)), "el texto no viaja en el SQL");
  await m.cerrar();
});

Deno.test("cache: lotes del modelo, duplicados y más filas que el límite de parámetros de D1", async () => {
  const m = await montar();
  const textos = Array.from({ length: 40 }, (_, i) => `texto numero ${i}`);
  const r = await m.emb.embeber({ items: [...textos, ...textos] });
  assertEquals([r.misses, r.hits, r.vectores.length], [40, 0, 80]);
  assertEquals(m.prov.llamadas.map((l) => l.length).reduce((a, b) => a + b, 0), 40);
  assert(m.prov.llamadas.every((l) => l.length <= 3), "respeta lote");
  assertEquals((await filas(m)).length, 40);
  await m.cerrar();
});

Deno.test("cache: dos referencias del mismo texto comparten modelo pero no fila; un texto editado reemplaza la suya", async () => {
  const m = await montar();
  await m.emb.embeber({ items: [{ texto: "ok", entidad: "mensajes", id: 1 }] });
  const b = await m.emb.embeber({ items: [{ texto: "ok", entidad: "mensajes", id: 2 }] });
  assertEquals([b.hits, b.misses, m.prov.llamadas.length], [1, 0, 1]);
  assertEquals(await ids(m), ["mensajes:1", "mensajes:2"]);
  await m.emb.embeber({ items: [{ texto: "editado", entidad: "mensajes", id: 1 }] });
  assertEquals(await ids(m), ["mensajes:1", "mensajes:2"]);
  assertEquals(m.prov.llamadas.length, 2);
  assertEquals((await m.emb.olvidar("mensajes", [1, 2])), 2);
  assertEquals(await ids(m), []);
  await m.cerrar();
});

Deno.test("cache: sin proveedor un hit funciona y un miss responde 503; respuesta incoherente del proveedor falla", async () => {
  const m = await montar({}, MODELO, false);
  await assertRejects(() => m.emb.embeber({ items: ["x"] }), Error, "Proveedor de embeddings no disponible");
  await m.cerrar();
  const n = await montar();
  n.emb.services.ai = { embeber: () => Promise.resolve([[1, 2]]) };
  await assertRejects(() => n.emb.embeber({ items: ["x"] }), Error, "2 dimensiones");
  await assertRejects(() => n.emb.embeber({ items: ["   "] }), Error, "Texto vacío");
  await assertRejects(() => n.emb.embeber({ items: [{ texto: "x", tipo: "documento" }] }), Error, "requiere entidad e id");
  await n.cerrar();
});

Deno.test("reducción: la proyección se guarda, consultas y documentos caen en el mismo espacio y dims queda en columna", async () => {
  const cfg = { ...MODELO, reduccion: { metodo: "aleatoria", dims: 16, decimales: 3, semilla: 11 } };
  const m = await montar({}, cfg);
  const doc = await m.emb.embeber({ items: [{ texto: "cafe molido de origen", entidad: "mensajes", id: 1 }] });
  assertEquals(doc.dims, 16);
  assertEquals(doc.vectores[0].length, 16);
  const [p] = (await sql<any>`select * from embeddings_proyecciones`.execute(m.db.kysely)).rows;
  assertEquals([p.dimsorigen, p.dims, p.decimales, p.metodo, p.semilla, p.iproyeccion], [64, 16, 3, "aleatoria", 11, doc.iproyeccion]);
  const consulta = await m.emb.embeber({ items: ["cafe molido de origen"] });
  assertEquals(consulta.vectores[0], doc.vectores[0], "misma proyección para la consulta");
  const [f] = await filas(m);
  assertEquals([f!.dims, f!.bytes], [16, 43], "16 × int16 en base64url");
  // otro isolate: lee la proyección de la tabla y obtiene el mismo vector sin llamar al modelo de nuevo
  const emb2 = createServer(embeddingsServer, { db: m.db, cfg: { modelos: { bge: cfg } }, services: { ai: m.prov } });
  const otra = await emb2["embeber"]({ items: ["cafe molido de origen"] });
  assertEquals([otra.vectores[0], otra.misses], [doc.vectores[0], 0]);
  await m.cerrar();
});

Deno.test("reducción: cambiar la proyección deja obsoletas las filas viejas y la purga las retira", async () => {
  const m = await montar();
  await m.emb.embeber({ items: [{ texto: "a b", entidad: "mensajes", id: 1 }] });
  const nuevo = { ...MODELO, reduccion: { dims: 16 } };
  const emb2 = createServer(embeddingsServer, { db: m.db, cfg: { modelos: { bge: nuevo } }, services: { ai: m.prov } });
  await emb2["embeber"]({ items: [{ texto: "a b", entidad: "mensajes", id: 2 }] });
  assertEquals(m.prov.llamadas.length, 2, "otro espacio: es miss");
  assertEquals((await filas(m)).length, 2);
  const r = await emb2["purgar"]();
  assertEquals(r.pasos[0], { paso: "obsoletas", fase: "regla", filas: 1, bytes: r.pasos[0].bytes, estimado: false, muestra: r.pasos[0].muestra });
  assertEquals(await ids(m), ["mensajes:2"]);
  await m.cerrar();
});

Deno.test("estadísticas: hits, tasa y tamaño por modelo y referencia; lo acumulado sobrevive a la purga", async () => {
  const m = await montar({ purga: { reglas: [{ nombre: "todo-mensajes", alcance: { entidad: "mensajes" }, todo: true }] } });
  await m.emb.embeber({ items: [{ texto: "uno", entidad: "mensajes", id: 1 }, { texto: "dos", entidad: "mensajes", id: 2 }] });
  await m.emb.embeber({ items: [{ texto: "uno", entidad: "mensajes", id: 1 }] });
  await m.emb.embeber({ items: [{ texto: "busco algo", entidad: "articulos", tipo: "consulta" }] });
  const e = await m.emb.estadisticas();
  assertEquals([e.total.filas, e.total.hits, e.total.misses], [3, 1, 3]);
  assertEquals(e.total.tasa, 0.25);
  assertEquals(e.porModelo.map((x: any) => [x.modelo, x.dims, x.filas]), [[MODELO.id, 64, 3]]);
  const ref = (t: string, n: string) => e.porReferencia.find((x: any) => x.tipo === t && x.entidad === n);
  assertEquals([ref("documento", "mensajes").filas, ref("documento", "mensajes").hits, ref("consulta", "articulos").filas], [2, 1, 1]);
  assert(e.total.bytes > 0);
  await m.emb.purgar();
  const d = await m.emb.estadisticas();
  assertEquals([d.total.filas, d.total.hits, d.total.misses, d.total.purgadas], [1, 1, 3, 2]);
  await m.cerrar();
});

Deno.test("purga: el ejemplo del pedido, mensajes bactivo false con más de 3 días sin hits", async () => {
  const m = await montar({ purga: { reglas: [{ nombre: "mensajes-inactivos", alcance: { entidad: "mensajes" }, sinHitsDias: 3, donde: [{ columna: "bactivo", op: "eq", valor: false }] }] } });
  const inactivo = await m.mensajes.post(m.mensajes.pojo({ contenido: "a", bactivo: false }));
  const reciente = await m.mensajes.post(m.mensajes.pojo({ contenido: "b", bactivo: false }));
  const activo = await m.mensajes.post(m.mensajes.pojo({ contenido: "c", bactivo: true }));
  await fila(m, { entidad: "mensajes", id: String(inactivo.imensaje), ultimo: hace(4), creado: hace(50) });
  await fila(m, { entidad: "mensajes", id: String(reciente.imensaje), ultimo: hace(1), creado: hace(50) });
  await fila(m, { entidad: "mensajes", id: String(activo.imensaje), ultimo: hace(10), creado: hace(50) });
  await fila(m, { entidad: "articulos", id: String(inactivo.imensaje), ultimo: hace(10) });
  await fila(m, { entidad: "mensajes", tipo: "consulta", ultimo: hace(10) });
  const sim = await m.emb.purgar({ simular: true, ahora: AHORA.toISOString() });
  const paso = sim.pasos.find((p: any) => p.paso === "mensajes-inactivos");
  assertEquals([sim.simulacion, paso.filas, paso.muestra[0].id], [true, 1, String(inactivo.imensaje)]);
  assertEquals((await filas(m)).length, 5, "simular no borra");
  const r = await m.emb.purgar({ ahora: AHORA.toISOString() });
  assertEquals(r.pasos.find((p: any) => p.paso === "mensajes-inactivos").filas, 1);
  assertEquals((await filas(m)).length, 4);
  assert(!(await ids(m)).includes(`mensajes:${inactivo.imensaje}`));
  await m.cerrar();
});

Deno.test("purga: una fecha sin hits usa la creación; alcances por entidad y tipo; pk de texto; operadores", async () => {
  const m = await montar();
  await m.articulos.post(m.articulos.pojo({ iarticulo: "A1", nombre: "Café", sku: "CAF" }));
  await m.articulos.post(m.articulos.pojo({ iarticulo: "A2", nombre: "Té", sku: "TE" }));
  const viejo = await m.mensajes.post(m.mensajes.pojo({ contenido: "x", bactivo: true, editado: new Date(hace(40)) }));
  await fila(m, { entidad: "articulos", id: "A1", creado: hace(1) });
  await fila(m, { entidad: "articulos", id: "A2", creado: hace(1) });
  await fila(m, { entidad: "articulos", tipo: "consulta", creado: hace(9), ultimo: null });
  await fila(m, { entidad: "articulos", tipo: "consulta", creado: hace(1), ultimo: null });
  await fila(m, { entidad: "usuarios", id: "ana", creado: hace(9) });
  await fila(m, { entidad: "mensajes", id: String(viejo.imensaje), creado: hace(1) });
  const correr = (reglas: unknown[]) => m.emb.purgar({ simular: true, reglas, ahora: AHORA.toISOString(), solo: reglas.map((r: any) => r.nombre) });
  const n = async (r: Record<string, unknown>) => (await correr([{ nombre: "r", ...r }])).pasos[0].filas;
  assertEquals(await n({ alcance: { entidad: "articulos", tipo: "consulta" }, sinHitsDias: 3 }), 1);
  assertEquals(await n({ alcance: { entidad: "usuarios" }, sinHitsDias: 3 }), 1);
  assertEquals(await n({ alcance: { tipo: "consulta" }, todo: true }), 2);
  assertEquals(await n({ alcance: { entidad: "articulos" }, donde: [{ columna: "sku", op: "in", valor: ["CAF", "XX"] }] }), 1);
  assertEquals(await n({ alcance: { entidad: "articulos" }, donde: [{ columna: "nombre", op: "ne", valor: "Té" }] }), 1);
  assertEquals(await n({ alcance: { entidad: "mensajes" }, donde: [{ columna: "editado", op: "masDeDias", valor: 30 }] }), 1);
  assertEquals(await n({ alcance: { entidad: "mensajes" }, donde: [{ columna: "editado", op: "masDeDias", valor: 60 }] }), 0);
  assertEquals(await n({ alcance: { entidad: "mensajes" }, donde: [{ columna: "bactivo", op: "ne", valor: true }] }), 0);
  assertEquals(await n({ alcance: { entidad: "mensajes" }, donde: [{ columna: "iempresa", op: "nulo" }] }), 1);
  assertEquals(await n({ edadDias: 5 }), 2);
  assertEquals(await n({ hitsMenorQue: 1, alcance: { entidad: "usuarios" } }), 1);
  await m.cerrar();
});

Deno.test("purga: huérfanos solos y combinados con donde (O)", async () => {
  const m = await montar();
  const vivo = await m.mensajes.post(m.mensajes.pojo({ contenido: "a", bactivo: true }));
  const inactivo = await m.mensajes.post(m.mensajes.pojo({ contenido: "b", bactivo: false }));
  await fila(m, { entidad: "mensajes", id: String(vivo.imensaje) });
  await fila(m, { entidad: "mensajes", id: String(inactivo.imensaje) });
  await fila(m, { entidad: "mensajes", id: "9999" });
  const r = await m.emb.purgar({ reglas: [{ nombre: "h", alcance: { entidad: "mensajes" }, huerfanos: true }], solo: ["h"] });
  assertEquals(r.pasos[0].filas, 1);
  const s = await m.emb.purgar({ simular: true, reglas: [{ nombre: "o", alcance: { entidad: "mensajes" }, huerfanos: true, donde: [{ columna: "bactivo", op: "eq", valor: false }] }], solo: ["o"] });
  assertEquals(s.pasos[0].filas, 1);
  await m.cerrar();
});

Deno.test("purga: tiempo general personalizable, con alcances que se excluyen", async () => {
  const m = await montar({ purga: { general: { sinHitsDias: 30 }, reglas: [{ nombre: "usuarios-largo", alcance: { entidad: "usuarios" }, sinHitsDias: 365, excluirDeGeneral: true }, { nombre: "productos-protegidos", alcance: { entidad: "productos" }, excluirDeGeneral: true, soloPresion: true }] } });
  await fila(m, { entidad: "usuarios", id: "ana", ultimo: hace(40) });
  await fila(m, { entidad: "usuarios", id: "beto", ultimo: hace(400) });
  await fila(m, { entidad: "productos", id: "1", ultimo: hace(40) });
  await fila(m, { entidad: "mensajes", id: "1", ultimo: hace(40) });
  await fila(m, { entidad: "mensajes", id: "2", ultimo: hace(10) });
  const r = await m.emb.purgar({ ahora: AHORA.toISOString() });
  assertEquals(r.pasos.map((p: any) => [p.paso, p.filas]), [["obsoletas", 0], ["usuarios-largo", 1], ["general", 1]].map(([a, b]) => [a, b]));
  assertEquals(await ids(m), ["mensajes:2", "productos:1", "usuarios:ana"]);
  await m.cerrar();
});

Deno.test("purga: la simulación informa exactamente lo que la corrida real borra, aunque las reglas se solapen", async () => {
  const m = await montar({ purga: { general: { sinHitsDias: 5 }, reglas: [{ nombre: "a", prioridad: 1, alcance: { entidad: "mensajes" }, sinHitsDias: 2 }, { nombre: "b", prioridad: 2, alcance: { tipo: "documento" }, sinHitsDias: 2 }] } });
  for (let i = 0; i < 6; i++) await fila(m, { entidad: i % 2 ? "mensajes" : "usuarios", id: String(i), ultimo: hace(3 + i) });
  await fila(m, { entidad: "usuarios", tipo: "consulta", ultimo: hace(9) });
  await fila(m, { entidad: "usuarios", id: "fresco", ultimo: hace(1) });
  const ahora = AHORA.toISOString();
  const sim = await m.emb.purgar({ simular: true, ahora });
  const real = await m.emb.purgar({ ahora });
  const resumen = (r: any) => r.pasos.map((p: any) => [p.paso, p.filas, p.bytes]);
  assertEquals(resumen(sim), resumen(real));
  assertEquals(sim.final, real.final);
  assertEquals(resumen(real), [["obsoletas", 0, 0], ["a", 3, 300], ["b", 3, 300], ["general", 1, 100]]);
  await m.cerrar();
});

Deno.test("presión: bajo umbral no actúa; sobre él sigue el orden de prioridad hasta el objetivo y al final LRU", async () => {
  const presion = { maxFilas: 10, objetivoPct: 50, orden: ["consultas", "mensajes-frios"], ultimoRecurso: "lru" as const };
  const m = await montar({ purga: { obsoletas: false, reglas: [{ nombre: "mensajes-frios", soloPresion: true, alcance: { entidad: "mensajes" }, hitsMenorQue: 2 }, { nombre: "consultas", soloPresion: true, alcance: { tipo: "consulta" } }], presion } });
  for (let i = 0; i < 3; i++) await fila(m, { entidad: "articulos", tipo: "consulta", ultimo: hace(i + 1) });
  for (let i = 0; i < 3; i++) await fila(m, { entidad: "mensajes", id: String(i), hits: 0, ultimo: hace(i + 1) });
  for (let i = 0; i < 6; i++) await fila(m, { entidad: "usuarios", id: String(i), hits: 5, ultimo: hace(i + 1) });
  const sim = await m.emb.purgar({ simular: true });
  assertEquals(sim.presion, { activada: true, maxFilas: 10, maxBytes: null, objetivoFilas: 5, objetivoBytes: null });
  assertEquals(sim.pasos.map((p: any) => [p.paso, p.fase, p.filas]), [["consultas", "presion", 3], ["mensajes-frios", "presion", 3], ["lru", "presion", 1]]);
  assertEquals(sim.final.filas, 5);
  const r = await m.emb.purgar();
  assertEquals(r.pasos.map((p: any) => [p.paso, p.filas]), [["consultas", 3], ["mensajes-frios", 3], ["lru", 1]]);
  assertEquals((await filas(m)).length, 5);
  assert(!(await ids(m)).includes("usuarios:5"), "LRU saca el de uso más viejo");
  const otra = await m.emb.purgar();
  assertEquals([otra.presion.activada, otra.pasos.length], [false, 0]);
  await m.cerrar();
});

Deno.test("presión: por bytes y deteniéndose dentro de una regla sin tocar lo demás; simulación estima la parte", async () => {
  const m = await montar({ purga: { obsoletas: false, reglas: [{ nombre: "consultas", soloPresion: true, alcance: { tipo: "consulta" } }], presion: { maxBytes: 500, objetivoPct: 80, ultimoRecurso: "ninguno" } } });
  for (let i = 0; i < 6; i++) await fila(m, { entidad: "x", tipo: "consulta", huella: `h${i}`, ultimo: hace(i + 1), bytes: 100 });
  const sim = await m.emb.purgar({ simular: true });
  assertEquals([sim.pasos[0].filas, sim.pasos[0].estimado, sim.final.bytes], [2, true, 400]);
  const r = await m.emb.purgar();
  assertEquals([r.pasos[0].filas, r.final.bytes], [2, 400]);
  assertEquals((await filas(m)).map((f) => f.huella).sort(), ["h0", "h1", "h2", "h3"], "desaloja los menos usados");
  await m.cerrar();
});

Deno.test("purga: tandas acotadas por corrida; pendiente avisa y la siguiente corrida termina; caben en D1", async () => {
  const m = await montar({ purga: { obsoletas: false, lote: 120, maxLotes: 1, reglas: [{ nombre: "todo", alcance: { entidad: "x" }, todo: true }] } });
  for (let i = 0; i < 150; i++) await fila(m, { entidad: "x", id: String(i) });
  const r = await m.emb.purgar();
  assertEquals([r.pasos[0].filas, r.pendiente, (await filas(m)).length], [120, true, 30]);
  const s = await m.emb.purgar();
  assertEquals([s.pasos[0].filas, s.pendiente, (await filas(m)).length], [30, false, 0]);
  await m.cerrar();
});

Deno.test("buscar: exacta primero, luego contenida, luego embeddings; filtros acotan a un inquilino en todas las fuentes", async () => {
  const m = await montar({ busqueda: { exactas: { articulos: ["nombre", "sku"] }, minScore: 0.1 } });
  await m.articulos.post(m.articulos.pojo({ iarticulo: "A1", nombre: "cafe", sku: "C1" }));
  await m.articulos.post(m.articulos.pojo({ iarticulo: "A2", nombre: "cafe molido", sku: "C2" }));
  await m.articulos.post(m.articulos.pojo({ iarticulo: "A3", nombre: "te verde", sku: "T1" }));
  await m.emb.embeber({ items: [{ texto: "taza de cafe caliente", entidad: "articulos", id: "A4" }, { texto: "cafe", entidad: "articulos", id: "A5" }, { texto: "zapatos rojos grandes", entidad: "articulos", id: "A6" }] });
  const r = await m.emb.buscar({ q: "cafe" });
  assertEquals(r.semantica, true);
  assertEquals(r.resultados.map((x: any) => [x.id, x.origen]), [["A1", "exacta"], ["A5", "exacta"], ["A2", "contiene"], ["A4", "embedding"]]);
  await m.cerrar();
  const n = await montar({ busqueda: { exactas: { mensajes: ["contenido"] }, minScore: 0.1 } });
  const uno = await n.mensajes.post(n.mensajes.pojo({ contenido: "reunion", iempresa: 1 }));
  const dos = await n.mensajes.post(n.mensajes.pojo({ contenido: "reunion", iempresa: 2 }));
  await n.emb.embeber({ items: [{ texto: "reunion lunes", entidad: "mensajes", id: uno.imensaje }, { texto: "reunion martes", entidad: "mensajes", id: dos.imensaje }] });
  const f = await n.emb.buscar({ q: "reunion", filtros: { mensajes: { iempresa: 1 } } });
  assertEquals(f.resultados.map((x: any) => x.id), [String(uno.imensaje)]);
  await n.cerrar();
});

Deno.test("buscar: sin proveedor degrada a texto; la consulta queda en caché con su entidad y no repite modelo", async () => {
  const m = await montar({ busqueda: { exactas: { articulos: ["nombre"] } } }, MODELO, false);
  await m.articulos.post(m.articulos.pojo({ iarticulo: "A1", nombre: "cafe", sku: "C" }));
  const r = await m.emb.buscar({ q: "cafe" });
  assertEquals([r.semantica, r.resultados.length], [false, 1]);
  await m.cerrar();
  const n = await montar();
  await n.emb.buscar({ q: "algo nuevo", entidades: ["productos"] });
  await n.emb.buscar({ q: "algo nuevo", entidades: ["productos"] });
  assertEquals(n.prov.llamadas.length, 1);
  const [f] = await filas(n);
  assertEquals([f!.entidad, f!.hits], ["productos", 1]);
  await n.cerrar();
});

Deno.test("adaptadores: Workers AI y Vectorize; índice externo con dims incompatibles se rechaza", async () => {
  const vistos: string[][] = [];
  const prov = workersAi({ run(_m, i) {
    vistos.push(i.text);
    return Promise.resolve({ data: i.text.map(() => new Array(64).fill(1)) });
  } });
  assertEquals((await prov.embeber(["a"], "@cf/baai/bge-m3"))[0]!.length, 64);
  await assertRejects(() => workersAi({ run: () => Promise.resolve({}) }).embeber(["a"], "m"), Error, "Respuesta inesperada");
  const subidos: unknown[] = [];
  const binding = { query: () => Promise.resolve({ matches: [{ id: "mensajes:7", score: 0.9 }] }), upsert: (v: unknown[]) => Promise.resolve(subidos.push(...v)), deleteByIds: () => Promise.resolve(1) };
  const db = d1Database(d1Simulado(new DatabaseSync(":memory:")));
  const m = createServer(embeddingsServer, { db, cfg: { modelos: { bge: MODELO }, busqueda: { indice: "v" } }, services: { ai: prov, v: vectorizeIndice(binding, { dims: 64 }) } });
  for (const c of m.list) await c.seed();
  await m["indexar"]([{ texto: "hola", entidad: "mensajes", id: 7, metadata: { iempresa: 3 } }]);
  assertEquals((subidos[0] as any).id, "mensajes:7");
  assertEquals((subidos[0] as any).metadata.iempresa, 3);
  assertEquals((await m["buscar"]({ q: "algo" })).resultados, [{ entidad: "mensajes", id: "7", score: 0.9, origen: "embedding" }]);
  const mal = createServer(embeddingsServer, { db, cfg: { modelos: { bge: MODELO }, busqueda: { indice: "v" } }, services: { ai: prov, v: vectorizeIndice(binding, { dims: 1024 }) } });
  await assertRejects(() => mal["buscar"]({ q: "algo" }), Error, "1024 dimensiones");
  await db.destroy();
});

Deno.test("alimentar: tandas por cursor guardado, solo lo nuevo, lo repetido no llama al modelo", async () => {
  const m = await montar({ alimentacion: { articulos: { columnas: ["nombre", "sku"], etiquetas: { nombre: "Producto" }, lote: 2 } } });
  for (const [i, n] of ["cafe", "te", "cacao"].entries()) await m.articulos.post(m.articulos.pojo({ iarticulo: `A${i}`, nombre: n, sku: `S${i}` }));
  const a = await m.emb.alimentar();
  assertEquals([a.avances[0].procesados, a.avances[0].cursor, a.avances[0].terminado], [2, "A1", false]);
  assertEquals(m.prov.llamadas[0], ["producto: cafe. s0", "producto: te. s1"]);
  const b = await m.emb.alimentar();
  assertEquals([b.avances[0].procesados, b.avances[0].cursor, b.avances[0].terminado], [1, "A2", true]);
  const c = await m.emb.alimentar();
  assertEquals([c.avances[0].procesados, c.avances[0].cursor], [0, "A2"]);
  const d = await m.emb.alimentar({ reiniciar: true, lote: 3 });
  assertEquals([d.avances[0].procesados, d.avances[0].misses, d.avances[0].hits], [3, 0, 3]);
  await assertRejects(() => m.emb.alimentar({ entidad: "nadie" }), Error, "Sin alimentación");
  await m.cerrar();
});

Deno.test("HTTP y JSON de DER: paths de operación, entradas de solo lectura sin vector, depuración por query y reglas", async () => {
  const m = await montar({ purga: { reglas: [{ nombre: "viejas", alcance: { entidad: "mensajes" }, sinHitsDias: 3 }] } });
  const router = createRouter([m.mensajes], { basePath: "/api", plugins: [m.emb] });
  const emb = createClient(embeddings, { baseUrl: "http://t/api", fetch: (u: RequestInfo | URL, o?: RequestInit) => router.fetch(new Request(u, o)) });
  await emb["embeber"]({ items: [{ texto: "hola", entidad: "mensajes", id: 1 }] });
  await emb["embeber"]({ items: [{ texto: "hola", entidad: "mensajes", id: 1 }] });
  const entradas = await emb.controllers["cache"]!.query({ where: { entidad: "mensajes", hits: { gt: 0 } }, orderBy: "-hits" });
  assertEquals(entradas.length, 1);
  assertEquals((entradas[0] as any).toJSON().vector, undefined, "el vector nunca sale");
  assertEquals((await router.fetch(new Request("http://t/api/embeddings/entrada", { method: "POST", body: "{}" }))).status, 404);
  const e = await emb["estadisticas"]();
  assertEquals(e.total.hits, 1);
  const x = await emb["reglas"]();
  assertEquals([x.orden, x.errores, x.proyecciones[0].modelo], [["obsoletas", "viejas"], [], MODELO.id]);
  const s = await emb["purgar"]({ simular: true });
  assertEquals(s.simulacion, true);
  const mala = await router.fetch(new Request("http://t/api/embeddings/purgar", { method: "POST", body: JSON.stringify({ reglas: [{ nombre: "x", sql: "1=1" }] }) }));
  assertEquals(mala.status, 400);
  await m.cerrar();
});

Deno.test("PGlite: la caché, los contadores y el cruce con pk numérica y bool también compilan en PostgreSQL", async () => {
  const db = pgliteDatabase();
  const mensajes = new ServerController(MensajeEntity, { db, table: "pg_mensajes" });
  const prov = proveedorFalso(64);
  const emb = createServer(embeddingsServer, { db, cfg: { modelos: { bge: MODELO }, purga: { general: { sinHitsDias: 1 }, reglas: [{ nombre: "inactivos", alcance: { entidad: "mensajes" }, sinHitsDias: 3, donde: [{ columna: "bactivo", op: "eq", valor: false }, { columna: "editado", op: "masDeDias", valor: 1 }] }] } }, services: { ai: prov } });
  await createRouter([mensajes], { plugins: [emb] }).seed();
  const uno = await mensajes.post(mensajes.pojo({ contenido: "x", bactivo: false, editado: new Date("2020-01-01T00:00:00.000Z") }));
  await emb["embeber"]({ items: [{ texto: "x", entidad: "mensajes", id: uno.imensaje }] });
  await emb["embeber"]({ items: [{ texto: "x", entidad: "mensajes", id: uno.imensaje }] });
  await emb["embeber"]({ items: [{ texto: "una consulta", entidad: "mensajes", tipo: "consulta" }] });
  assertEquals((await emb["estadisticas"]()).total.hits, 1);
  const ahora = new Date(Date.now() + 10 * DIAS).toISOString();
  const sim = await emb["purgar"]({ simular: true, ahora });
  assertEquals(sim.pasos.map((p: any) => [p.paso, p.filas]), [["obsoletas", 0], ["inactivos", 1], ["general", 1]]);
  const r = await emb["purgar"]({ ahora });
  assertEquals([r.pasos[1].filas, r.pasos[2].filas], [1, 1]);
  assertEquals((await emb["estadisticas"]()).total.filas, 0);
  const b = await emb["buscar"]({ q: "x" });
  assertEquals(b.semantica, true);
  await db.destroy();
});
