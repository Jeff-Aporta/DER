/**
 * Base PROPIA de los embeddings: la caché, proyecciones, contadores y cursores viven en su archivo SQLite (o memoria), no en la
 * base principal; las caducidades por defecto (embeddings a 180 días, entrada de caché sin hit a 15 días) y su simulación.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { sql } from "kysely";
import { defineEntity } from "@Jeff-Aporta/DER/index.ts";
import { createRouter, createServer, ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import type { EmbeddingsConfig, ProveedorEmbeddings } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";
import { cerrarDbEmbeddings, dbEmbeddingsDe, embeddingsServer, proveedorFalso } from "@Jeff-Aporta/DER/tests/plugins/_embeddings.ts";

const DIAS = 86_400_000;
const AHORA = new Date("2026-10-31T12:00:00.000Z");
const hace = (d: number) => new Date(AHORA.getTime() - d * DIAS).toISOString();
const MODELO = { id: "@cf/baai/bge-m3", dims: 8, proveedor: "ai" };

const NotaEntity = defineEntity({ name: "pruebas.nota", singular: "nota", plural: "notas", schema: { columns: { inota: { type: "int", pk: true, autoincrement: true }, titulo: { type: "string", length: 80 } } } });

/** Montaje mínimo: base principal en memoria + plugin (base de embeddings en memoria salvo cfg). */
async function montar(cfg: Partial<EmbeddingsConfig> = {}, prov: ProveedorEmbeddings = proveedorFalso(MODELO.dims)) {
  const db = sqliteDatabase(":memory:");
  const notas = new ServerController(NotaEntity, { db, table: "notas" });
  const emb = createServer(embeddingsServer, { db, cfg: { modelos: { bge: MODELO }, ...cfg }, services: { ai: prov } });
  await createRouter([notas], { plugins: [emb] }).seed();
  return { db, notas, emb, prov, cerrar: async () => { await cerrarDbEmbeddings(emb); await db.destroy(); } };
}

/** Nombres de tablas de una conexión. */
async function tablas(exec: { kysely: any }): Promise<string[]> {
  const r = await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`.execute(exec.kysely);
  return r.rows.map((f) => f.name);
}

/** Fila directa de la caché con fechas controladas (en la base de embeddings). */
async function fila(emb: any, o: { entidad: string; id?: string; tipo?: string; hits?: number; ultimo?: string | null; creado?: string }): Promise<void> {
  const vigente = (await emb["reglas"]()).proyecciones[0].iproyeccion;
  await sql`insert into embeddings_cache (huella, modelo, dims, iproyeccion, tipo, entidad, id, vector, bytes, hits, fultimohit, fcreado) values (${crypto.randomUUID().replaceAll("-", "")}, ${MODELO.id}, ${MODELO.dims}, ${vigente}, ${o.tipo ?? "documento"}, ${o.entidad}, ${o.id ?? ""}, ${"AA"}, ${100}, ${o.hits ?? 0}, ${o.ultimo ?? null}, ${o.creado ?? hace(1)})`.execute(dbEmbeddingsDe(emb).kysely);
}

/** Entidades de la caché ordenadas. */
async function ids(emb: any): Promise<string[]> {
  const r = await sql<{ entidad: string; id: string }>`select entidad, id from embeddings_cache order by icache`.execute(dbEmbeddingsDe(emb).kysely);
  return r.rows.map((f) => `${f.entidad}:${f.id}`);
}

Deno.test("base separada: las tablas de la caché van a su base y la principal solo guarda embeddings_usuarios", async () => {
  const m = await montar();
  await m.emb["embeber"]({ items: [{ texto: "café molido", entidad: "notas", id: 1 }] });
  assertEquals(await tablas(dbEmbeddingsDe(m.emb)), ["embeddings_cache", "embeddings_contadores", "embeddings_cursores", "embeddings_proyecciones"]);
  assertEquals(await tablas(m.db), ["embeddings_usuarios", "notas"]);
  await m.cerrar();
});

Deno.test("base separada: con ruta abre un archivo SQLite propio y lo reutiliza al volver a montar el plugin", async () => {
  const dir = await Deno.makeTempDir({ prefix: "der-embeddings-" });
  const ruta = `${dir}/embeddings.sqlite`;
  try {
    const db = sqliteDatabase(":memory:");
    const notas = new ServerController(NotaEntity, { db, table: "notas" });
    const llamadas: string[][] = [];
    const prov: ProveedorEmbeddings = { embeber: (t) => { llamadas.push(t); return Promise.resolve(t.map(() => new Array(MODELO.dims).fill(1))); } };
    const uno = createServer(embeddingsServer, { db, cfg: { ruta, modelos: { bge: MODELO } }, services: { ai: prov } });
    await createRouter([notas], { plugins: [uno] }).seed();
    await uno["embeber"]({ items: ["hola mundo"] });
    assertEquals(llamadas.length, 1);
    assert((await Deno.stat(ruta)).size > 0, "el archivo se creó");
    await cerrarDbEmbeddings(uno);
    // otro proceso/instancia: lee la caché del archivo y el hit no llama al modelo
    const dos = createServer(embeddingsServer, { db, cfg: { ruta, modelos: { bge: MODELO } }, services: { ai: prov } });
    await createRouter([notas], { plugins: [dos] }).seed();
    const r = await dos["embeber"]({ items: ["hola mundo"] });
    assertEquals([r.hits, r.misses, llamadas.length], [1, 0, 1]);
    await cerrarDbEmbeddings(dos);
    await db.destroy();
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => null);
  }
});

Deno.test("base separada: sin ruta trabaja en memoria y no toca la principal; la proyección se guarda igual", async () => {
  const m = await montar();
  const a = await m.emb["embeber"]({ items: ["texto uno"] });
  const b = await m.emb["embeber"]({ items: ["texto uno"] });
  assertEquals([a.misses, b.hits, b.vectores], [1, 1, a.vectores]);
  const [p] = (await sql<any>`select * from embeddings_proyecciones`.execute(dbEmbeddingsDe(m.emb).kysely)).rows;
  assertEquals([p.modelo, p.dimsorigen, p.dims], [MODELO.id, MODELO.dims, MODELO.dims]);
  await m.cerrar();
});

Deno.test("base separada: db y ruta a la vez se rechazan al armar el plugin", async () => {
  const db = sqliteDatabase(":memory:");
  await assertRejects(() => Promise.resolve().then(() => createServer(embeddingsServer, { db, cfg: { db: "a.sqlite", ruta: "b.sqlite", modelos: { bge: MODELO } } })), Error, "no ambos");
  await db.destroy();
});

Deno.test("caducidad: embeddings con más de 180 días se purgan; la caché sin hit a los 15 días y el hit refresca la ventana", async () => {
  const m = await montar();
  await fila(m.emb, { entidad: "notas", id: "viejo", creado: hace(200) });                                  // caducado (180)
  await fila(m.emb, { entidad: "notas", id: "sin-uso", creado: hace(30), ultimo: hace(20), hits: 1 });       // 15 días sin hit
  await fila(m.emb, { entidad: "notas", id: "usado", creado: hace(20), ultimo: hace(2), hits: 3 });         // ventana refrescada
  await fila(m.emb, { entidad: "notas", id: "usado-pero-viejo", creado: hace(500), ultimo: hace(1), hits: 9 }); // caducidad manda
  const ahora = AHORA.toISOString();
  const sim = await m.emb["purgar"]({ simular: true, ahora });
  const pasos = (r: any) => r.pasos.filter((p: any) => p.filas > 0).map((p: any) => [p.paso, p.filas]);
  assertEquals(pasos(sim), [["cache-sin-hit", 2], ["caducidad", 1]]);
  assertEquals((await ids(m.emb)).length, 4, "simular no borra");
  const r = await m.emb["purgar"]({ ahora });
  assertEquals(pasos(r), [["cache-sin-hit", 2], ["caducidad", 1]]);
  assertEquals(await ids(m.emb), ["notas:usado"]);
  assertEquals([r.usuarios.expirados, r.usuarios.dias], [0, 720]);
  await m.cerrar();
});

Deno.test("caducidad: el consumidor reemplaza o apaga una regla puesta usando su nombre", async () => {
  const m = await montar({ purga: { general: { sinHitsDias: 5000 }, reglas: [{ nombre: "cache-sin-hit", activa: false, sinHitsDias: 15 }, { nombre: "caducidad", edadDias: 400 }] } });
  await fila(m.emb, { entidad: "notas", id: "a", creado: hace(200) });   // 200 < 400: vive
  await fila(m.emb, { entidad: "notas", id: "b", creado: hace(500) });   // 500 > 400: caduca
  await fila(m.emb, { entidad: "notas", id: "c", creado: hace(20), ultimo: hace(18), hits: 0 }); // cache-sin-hit apagada
  const r = await m.emb["purgar"]({ ahora: AHORA.toISOString() });
  const conFilas = r.pasos.filter((p: any) => p.filas > 0).map((p: any) => [p.paso, p.filas]);
  assertEquals(conFilas.length, 1);
  assertEquals(conFilas[0]![0], "caducidad");
  assert((await ids(m.emb)).includes("notas:c"));
  await m.cerrar();
});