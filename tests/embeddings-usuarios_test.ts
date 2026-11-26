/**
 * Perfiles de usuario embebidos (`embeddings_usuarios`, en la base PRINCIPAL): se guardan, se actualizan, no caducan y solo pierden
 * el vector a los 720 días sin interacción; `similares` devuelve los N más parecidos por coseno. Cubre también las rutas nuevas.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { sql } from "kysely";
import { defineEntity } from "@Jeff-Aporta/DER/index.ts";
import { createClient } from "@Jeff-Aporta/DER/src/02-controllers/client/plugin.ts";
import { createRouter, createServer, ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import type { EmbeddingsConfig } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";
import { embeddings } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/index.ts";
import { cerrarDbEmbeddings, dbEmbeddingsDe, embeddingsServer, proveedorFalso } from "@Jeff-Aporta/DER/tests/plugins/_embeddings.ts";

const DIAS = 86_400_000;
const MODELO = { id: "@cf/baai/bge-m3", dims: 8, proveedor: "ai" };
const hace = (d: number) => new Date(Date.now() - d * DIAS).toISOString();

const NotaEntity = defineEntity({ name: "pruebas.nota", singular: "nota", plural: "notas", schema: { columns: { inota: { type: "int", pk: true, autoincrement: true }, titulo: { type: "string", length: 80 } } } });

/** Montaje con router (para las rutas) y base de embeddings en memoria. */
async function montar(cfg: Partial<EmbeddingsConfig> = {}) {
  const db = sqliteDatabase(":memory:");
  const notas = new ServerController(NotaEntity, { db, table: "notas" });
  const emb = createServer(embeddingsServer, { db, cfg: { modelos: { bge: MODELO }, ...cfg }, services: { ai: proveedorFalso(MODELO.dims) } });
  const router = createRouter([notas], { basePath: "/api", plugins: [emb] });
  await router.seed();
  const cliente = createClient(embeddings, { baseUrl: "http://t/api", fetch: (u: RequestInfo | URL, o?: RequestInit) => router.fetch(new Request(u, o)) });
  return { db, notas, emb, router, cliente, cerrar: async () => { await cerrarDbEmbeddings(emb); await db.destroy(); } };
}

/** Fila cruda del perfil en la base principal (el vector está oculto por API, aquí se lee para comprobar). */
async function perfil(m: { db: any }, iusuario: string): Promise<{ vector: string | null; dims: number; modelo: string | null; preferencias: unknown; fhactualizado: string | null; fhinteraccion: string | null } | null> {
  const r = await sql<any>`select vector, dims, modelo, preferencias, fhactualizado, fhinteraccion from embeddings_usuarios where iusuario = ${iusuario}`.execute(m.db.kysely);
  return r.rows[0] ?? null;
}

/** Mueve las marcas de tiempo del perfil (para simular el paso del tiempo). */
async function envejecer(m: { db: any }, iusuario: string, dias: number, tocaInteraccion = true): Promise<void> {
  const fecha = hace(dias);
  await sql`update embeddings_usuarios set fhactualizado = ${fecha}${tocaInteraccion ? sql`, fhinteraccion = ${fecha}` : sql``} where iusuario = ${iusuario}`.execute(m.db.kysely);
}

/** Vector crudo del modelo, avivado para que el coseno tenga sentido. */
const vec = (...v: number[]) => [...v, ...new Array(MODELO.dims - v.length).fill(0.001)];

Deno.test("perfiles: el perfil se guarda en la base PRINCIPAL y no en la de embeddings", async () => {
  const m = await montar();
  const r = await m.emb["perfil"]({ iusuario: "beto", textos: ["café molido de origen"], preferencias: { categoria: "café", compras: 3 } });
  assertEquals([r.iusuario, r.modelo, r.dims, r.actualizado], ["beto", MODELO.id, MODELO.dims, true]);
  const fila = await perfil(m, "beto");
  if (!fila) throw new Error("sin fila de perfil");
  assert(fila.vector, "guarda el vector");
  assertEquals([fila.dims, fila.modelo, fila.fhactualizado !== null, fila.fhinteraccion], [MODELO.dims, MODELO.id, true, fila.fhactualizado]);
  assertEquals(JSON.parse(fila.preferencias as string), { categoria: "café", compras: 3 });
  const emb = await sql<{ name: string }>`select name from sqlite_master where type = 'table'`.execute(dbEmbeddingsDe(m.emb).kysely);
  assert(!emb.rows.some((f) => f.name === "embeddings_usuarios"), "no hay tabla de usuarios en la base de embeddings");
  await m.cerrar();
});

Deno.test("perfiles: actualizar preferencias sin vector conserva el vector; un vector con dims equivocadas se rechaza", async () => {
  const m = await montar();
  const a = await m.emb["perfil"]({ iusuario: "ana", vector: vec(1) });
  const antes = await perfil(m, "ana");
  if (!antes) throw new Error("sin fila de perfil");
  await m.emb["perfil"]({ iusuario: "ana", preferencias: { categoria: "té" }, interaccion: false });
  const despues = await perfil(m, "ana");
  if (!despues) throw new Error("sin fila de perfil");
  assertEquals([despues.vector, despues.dims, despues.modelo], [antes.vector, antes.dims, antes.modelo]);
  assertEquals(JSON.parse(despues.preferencias as string), { categoria: "té" });
  assertEquals(despues.fhinteraccion, antes.fhinteraccion, "interaccion: false no toca la última interacción");
  assertEquals(a.dims, MODELO.dims);
  await assertRejects(async () => { await m.emb["perfil"]({ iusuario: "ana", vector: [1, 2, 3] }); }, Error, "8 dimensiones");
  await assertRejects(async () => { await m.emb["perfil"]({ iusuario: "ana" }); }, Error, "textos, vector o preferencias");
  await assertRejects(async () => { await m.emb["perfil"]({ iusuario: "ana", textos: ["a"], vector: vec(1) }); }, Error, "no ambos");
  await m.cerrar();
});

Deno.test("similares: los N usuarios más parecidos por coseno, sin incluirse y con sus preferencias", async () => {
  const m = await montar();
  await m.emb["perfil"]({ iusuario: "ana", vector: vec(1, 0), preferencias: { grupo: "café" } });
  await m.emb["perfil"]({ iusuario: "beto", vector: vec(0.9, 0.1), preferencias: { grupo: "café" } });
  await m.emb["perfil"]({ iusuario: "caro", vector: vec(0, 1), preferencias: { grupo: "té" } });
  await m.emb["perfil"]({ iusuario: "sin-vector", preferencias: { grupo: "nadie" } });
  const r = await m.emb["similares"]({ iusuario: "ana", limite: 5 });
  assertEquals(r.resultados.map((x: any) => x.iusuario), ["beto", "caro"]);
  assert(r.resultados[0].score > r.resultados[1].score, "ordenado por coseno");
  assertEquals(r.resultados[0].preferencias, { grupo: "café" });
  const soloCafe = await m.emb["similares"]({ iusuario: "ana", minimo: 0.5 });
  assertEquals(soloCafe.resultados.map((x: any) => x.iusuario), ["beto"]);
  assertEquals((await m.emb["similares"]({ iusuario: "ana", limite: 1 })).resultados.length, 1);
  assertEquals((await m.emb["similares"]({ iusuario: "sin-vector" })).resultados, []);
  await assertRejects(async () => { await m.emb["similares"]({ iusuario: "nadie" }); }, Error, "sin perfil embebido");
  await m.cerrar();
});

Deno.test("similares por HTTP: el cliente usa POST embeddings/usuarios/perfil y /similares", async () => {
  const m = await montar();
  await m.router.fetch(new Request("http://t/api/embeddings/usuarios/perfil", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ iusuario: "ana", vector: vec(1, 0), preferencias: { grupo: "café" } }) }));
  await m.router.fetch(new Request("http://t/api/embeddings/usuarios/perfil", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ iusuario: "beto", vector: vec(0.9, 0.1) }) }));
  const similares = await m.cliente["similares"]({ iusuario: "ana" });
  assertEquals(similares.resultados.map((x: any) => x.iusuario), ["beto"]);
  const creado = await m.cliente["perfil"]({ iusuario: "caro", vector: vec(0, 1) });
  assertEquals([creado.iusuario, creado.dims], ["caro", MODELO.dims]);
  await m.cerrar();
});

Deno.test("perfiles: sobreviven a la purga mientras haya interacción; a los 720 días sin interacción pierden el vector y conservan la fila", async () => {
  const m = await montar({ purga: { general: { sinHitsDias: 5000 }, reglas: [] } });
  await m.emb["perfil"]({ iusuario: "activo", vector: vec(1, 0), preferencias: { grupo: "café" } });
  await m.emb["perfil"]({ iusuario: "tibio", vector: vec(0.5, 0.5), preferencias: { grupo: "té" } });
  await m.emb["perfil"]({ iusuario: "olvidado", vector: vec(0, 1), preferencias: { grupo: "agua" } });
  await envejecer(m, "activo", 100);
  await envejecer(m, "tibio", 700);
  await envejecer(m, "olvidado", 800);
  const sim = await m.emb["purgar"]({ simular: true });
  assertEquals([sim.usuarios.dias, sim.usuarios.expirados], [720, 1]);
  assertEquals(sim.usuarios.muestra[0].iusuario, "olvidado");
  assertEquals((await perfil(m, "olvidado"))?.vector === null, false, "simular no borra el vector");
  const r = await m.emb["purgar"]();
  assertEquals(r.usuarios.expirados, 1);
  const viejo = await perfil(m, "olvidado");
  if (!viejo) throw new Error("la fila del perfil se conserva");
  assertEquals([viejo.vector, viejo.dims, viejo.modelo], [null, 0, null]);
  assertEquals(JSON.parse(viejo.preferencias as string), { grupo: "agua" }, "la fila y sus preferencias quedan");
  assert(await perfil(m, "activo"), "la fila sigue");
  assertEquals((await perfil(m, "activo"))?.vector === null, false);
  assertEquals((await perfil(m, "tibio"))?.vector === null, false);
  assertEquals((await idsUsuarios(m)), ["activo", "olvidado", "tibio"]);
  await m.cerrar();
});

Deno.test("perfiles: el paso usuarios se puede omitir con solo y tiene su propio TTL configurable", async () => {
  const m = await montar({ usuarios: { diasSinInteraccion: 30 } });
  await m.emb["perfil"]({ iusuario: "viejo", vector: vec(1, 0) });
  await envejecer(m, "viejo", 40);
  const sinPaso = await m.emb["purgar"]({ solo: ["general"] });
  assertEquals([sinPaso.usuarios.expirados, (await perfil(m, "viejo"))?.vector !== null], [0, true]);
  const conPaso = await m.emb["purgar"]({ solo: ["usuarios"] });
  assertEquals([conPaso.usuarios.dias, conPaso.usuarios.expirados], [30, 1]);
  assertEquals((await perfil(m, "viejo"))?.vector ?? null, null);
  await m.cerrar();
});

/** Usuarios con fila en `embeddings_usuarios`, ordenados. */
async function idsUsuarios(m: { db: any }): Promise<string[]> {
  const r = await sql<{ iusuario: string }>`select iusuario from embeddings_usuarios order by iusuario`.execute(m.db.kysely);
  return r.rows.map((f) => f.iusuario);
}