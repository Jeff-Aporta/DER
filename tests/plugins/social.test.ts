/**
 * Lo social sin router (verbos de servidor): comentarios por NIVELES (raíces paginadas, respuestas de un padre aparte,
 * con su conteo), reacciones con resumen de varias entidades y votantes (no anónimos) y calificaciones con promedio.
 * Docs: ../../docs/050-Plugins/080-Mensajes.md · ../../docs/050-Plugins/090-Calificaciones-y-reacciones.md
 */
import { assert } from "@std/assert";
import { assertEquals } from "@std/assert";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { crearCalificaciones } from "@Jeff-Aporta/DER/src/03-plugins/calificaciones/server.ts";
import { crearMensajes } from "@Jeff-Aporta/DER/src/03-plugins/mensajes/server.ts";
import { crearReacciones } from "@Jeff-Aporta/DER/src/03-plugins/reacciones/server.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("mensajes por niveles: raíces paginadas (recientes primero) y respuestas de un padre aparte, con su conteo", opts, async () => {
  const db = sqliteDatabase();
  const m = crearMensajes({ db, cfg: {} });
  await m.seed?.();
  for (let i = 0; i < 12; i++) await m.publicar({ tdespacio: "noticia", iref: "7", contenido: `raíz ${i}`, iusuario: `u${i % 3}` });
  for (let i = 0; i < 5; i++) await m.publicar({ tdespacio: "noticia", iref: "7", contenido: `resp ${i}`, indexcita: "10", iusuario: "u9" });
  await m.publicar({ tdespacio: "noticia", iref: "7", contenido: "nieta", indexcita: "10.1", iusuario: "u1" });

  const p1 = await m.raices("noticia", "7", { page: 1, pageSize: 5 });
  assertEquals(p1.total, 12);
  assertEquals(p1.filas.map((f) => f.imensaje), ["11", "10", "9", "8", "7"], "lo más reciente primero, orden natural (10 > 9)");
  assertEquals(p1.filas.find((f) => f.imensaje === "10")?.respuestas, 5, "conteo de respuestas directas sin traerlas");
  assert(p1.filas.every((f) => !String(f.imensaje).includes(".")), "la página de raíces no trae respuestas");

  const r = await m.respuestas("noticia", "7", "10", { page: 1, pageSize: 3 });
  assertEquals(r.total, 5);
  assertEquals(r.filas.map((f) => f.imensaje), ["10.0", "10.1", "10.2"], "respuestas en orden de llegada, paginadas");
  assertEquals(r.filas.find((f) => f.imensaje === "10.1")?.respuestas, 1, "cada nivel trae el conteo del siguiente");
  assertEquals((await m.respuestas("noticia", "7", "10.1")).filas.map((f) => f.imensaje), ["10.1.0"], "el nivel siguiente se pide aparte");

  await m.retirar("noticia", "7", "10.2");
  assertEquals((await m.respuestas("noticia", "7", "10")).total, 4, "lo retirado no se lista (baja lógica)");
  assertEquals((await m.mensaje("noticia", "7", "10.2"))?.bactivo, false, "pero sigue en la base: auditable");
  await db.destroy();
});

Deno.test("reacciones: una por persona, resumen de varias entidades con la propia, votantes paginados y retirar", opts, async () => {
  const db = sqliteDatabase();
  const r = crearReacciones({ db, cfg: {} });
  await r.seed?.();
  await r.reaccionar("ana", { tdespacio: "noticia", iref: "1", reaccion: "👍" });
  await r.reaccionar("beto", { tdespacio: "noticia", iref: "1", reaccion: "❤️" });
  await r.reaccionar("caro", { tdespacio: "noticia", iref: "1", reaccion: "👍" });
  await r.reaccionar("ana", { tdespacio: "noticia", iref: "1", reaccion: "😮" });
  await r.reaccionar("ana", { tdespacio: "noticia", iref: "2", reaccion: "👍" });
  const res = await r.resumen("noticia", ["1", "2", "3"], "ana");
  assertEquals(res["1"], { total: 3, porReaccion: { "😮": 1, "❤️": 1, "👍": 1 }, mia: "😮" }, "cambiar la reacción no suma otra");
  assertEquals(res["2"]?.total, 1);
  assertEquals(res["3"], { total: 0, porReaccion: {}, mia: null }, "las que no tienen reacciones también vienen");
  const v = await r.votantes("noticia", "1", { pageSize: 2 });
  assertEquals(v.total, 3);
  assertEquals(v.filas.length, 2, "paginado");
  assertEquals((await r.votantes("noticia", "1", { reaccion: "👍" })).filas.map((f) => f.iusuario), ["caro"], "filtrar por reacción");
  assertEquals(await r.quitar("ana", "noticia", "1"), true);
  assertEquals((await r.resumen("noticia", ["1"], "ana"))["1"]?.mia, null, "retirada");
  await db.destroy();
});

Deno.test("calificaciones: promedio, la propia y quienes calificaron", opts, async () => {
  const db = sqliteDatabase();
  const c = crearCalificaciones({ db, cfg: {} });
  await c.seed?.();
  await c.calificar("ana", { tdespacio: "noticia", iref: "1", valor: 10 });
  await c.calificar("beto", { tdespacio: "noticia", iref: "1", valor: 5 });
  await c.calificar("ana", { tdespacio: "noticia", iref: "1", valor: 6 });
  const res = await c.resumen("noticia", ["1"], "ana");
  assertEquals(res["1"], { total: 2, promedio: 5.5, mia: 6 }, "recalificar reemplaza");
  assertEquals((await c.calificadores("noticia", "1")).filas.map((f) => f.iusuario), ["ana", "beto"]);
  await db.destroy();
});
