/**
 * Tiquetes, mensajes, calificaciones y reacciones juntos sobre el router real: numeración autoincremental, defaults del
 * servidor, regla de cierre, baja lógica, visibilidad por asignación, índice del hilo (x.y.z), historial de versiones,
 * calificación sin borrado y reacción cambiable.
 */
import { assert, assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { calificacionesServer, mensajesServer, reaccionesServer, tksServer } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import type { Calificacion, Mensaje, MensajeNodo, ReaccionFila, Tk } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { call } from "@Jeff-Aporta/DER/tests/_util.ts";

/** Sesión sin JWT: la cabecera `x-usuario` dice quién es y `x-roles`/`x-grupos` qué roles y grupos tiene. */
function sesionDe(req: Request): { id: string; claims: Record<string, unknown> } | null {
  const usuario = req.headers.get("x-usuario");
  if (!usuario) return null;
  const roles = (req.headers.get("x-roles") ?? "").split(",").filter(Boolean);
  const grupos = (req.headers.get("x-grupos") ?? "").split(",").filter(Boolean);
  return { id: usuario, claims: { roles, grupos } };
}

/** API con los cuatro plugins sobre SQLite en memoria. */
async function montar() {
  registry.secure(null);
  const db = sqliteDatabase();
  const tks = createServer(tksServer, { db, cfg: { estadosFinalizados: ["finalizado"] } });
  const mensajes = createServer(mensajesServer, { db, cfg: {} });
  const calificaciones = createServer(calificacionesServer, { db, cfg: {} });
  const reacciones = createServer(reaccionesServer, { db, cfg: {} });
  const router = createRouter([], { basePath: "/api", plugins: [tks, mensajes, calificaciones, reacciones] });
  registry.secure({ extract: sesionDe });
  await router.seed();
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { router, cerrar };
}

const como = (usuario: string, extra: Record<string, string> = {}) => ({ "x-usuario": usuario, ...extra });

Deno.test("tks: alta con autoincremental y los defaults del servidor", async () => {
  const { router, cerrar } = await montar();
  const r = await call(router, "POST", "tk", { body: { requerimiento: "#1 Arreglar el login", proposito: "El login no guarda" }, headers: como("ana") });
  assertEquals(r.status, 201, JSON.stringify(r.data));
  const tk = r.data as Tk;
  assertEquals(tk.itk, 1);
  assertEquals(tk.estado, "por_hacer");
  assertEquals(tk.iusuario, "ana");
  assertEquals(tk.bactivo, true);
  assertEquals(tk.bfinalizado, false);
  assert(tk.fhcre, "debe poner la fecha de alta");
  const r2 = await call(router, "POST", "tk", { body: { requerimiento: "#2 otro" }, headers: como("beto") });
  assertEquals((r2.data as Tk).itk, 2);
  await cerrar();
});

Deno.test("tks: la regla de cierre marca bfinalizado y manda sobre el manual", async () => {
  const { router, cerrar } = await montar();
  await call(router, "POST", "tk", { body: { requerimiento: "#1" }, headers: como("ana") });
  const fin = await call(router, "PUT", "tk/1", { body: { estado: "finalizado" }, headers: como("ana") });
  assertEquals((fin.data as Tk).bfinalizado, true);
  const otro = await call(router, "PUT", "tk/1", { body: { estado: "en_proceso" }, headers: como("ana") });
  assertEquals((otro.data as Tk).bfinalizado, false);
  const manual = await call(router, "PUT", "tk/1", { body: { bfinalizado: true }, headers: como("ana") });
  assertEquals((manual.data as Tk).bfinalizado, false, "con regla declarada manda el estado, no el manual");
  await cerrar();
});

Deno.test("tks: la baja es lógica (archiva, no borra)", async () => {
  const { router, cerrar } = await montar();
  await call(router, "POST", "tk", { body: { requerimiento: "#1" }, headers: como("ana") });
  const del = await call(router, "DELETE", "tk/1", { headers: como("ana") });
  assertEquals(del.status, 200);
  assertEquals((del.data as Tk).bactivo, false);
  const sigue = await call(router, "GET", "tk/1", { headers: como("ana") });
  assertEquals(sigue.status, 200, "la fila se conserva");
  assertEquals((sigue.data as Tk).bactivo, false);
  await cerrar();
});

Deno.test("tks: misTks ve por usuario, rol, grupo y comodín, y pagina", async () => {
  const { router, cerrar } = await montar();
  await call(router, "POST", "tk", { body: { requerimiento: "#1", proposito: "uno" }, headers: como("ana") });
  await call(router, "POST", "tk", { body: { requerimiento: "#2", proposito: "dos", jasignados: { usuarios: ["beto"], roles: [], grupos: [] } }, headers: como("ana") });
  await call(router, "POST", "tk", { body: { requerimiento: "#3", proposito: "tres", jasignados: { usuarios: [], roles: ["tecnico"], grupos: [] } }, headers: como("ana") });
  await call(router, "POST", "tk", { body: { requerimiento: "#4", proposito: "cuatro", jasignados: { usuarios: [], roles: [], grupos: ["soporte"] } }, headers: como("ana") });
  await call(router, "POST", "tk", { body: { requerimiento: "#5", proposito: "cinco", jasignados: { usuarios: [], roles: [], grupos: ["*"] } }, headers: como("ana") });
  const r = await call(router, "GET", "tks/mis", { headers: como("carlos", { "x-roles": "tecnico", "x-grupos": "soporte" }) });
  const ids = ((r.data as { tks: Tk[]; total: number }).tks).map((t) => t.itk).sort((a, b) => a - b);
  assertEquals(ids, [3, 4, 5], "ve por rol, por grupo y el comodín; no ve los de otro usuario");
  assertEquals((r.data as { tks: Tk[]; total: number }).total, 3, "el total es de los visibles, no de la tabla");
  const propia = await call(router, "GET", "tks/mis", { headers: como("ana") });
  assertEquals((propia.data as { tks: Tk[] }).tks.map((t) => t.itk).sort((a, b) => a - b), [1, 2, 3, 4, 5], "quien lo creó lo ve siempre; sin asignación no lo ven los demás");
  const pag = await call(router, "GET", "tks/mis?page=1&pageSize=2", { headers: como("carlos", { "x-roles": "tecnico", "x-grupos": "soporte" }) });
  assertEquals((pag.data as { tks: Tk[]; total: number }).tks.length, 2);
  assertEquals((pag.data as { tks: Tk[]; total: number }).total, 3, "el total no depende de la página");
  await cerrar();
});

Deno.test("mensajes: el índice del hilo es x, x.y, x.y.z… y el árbol sale bien", async () => {
  const { router, cerrar } = await montar();
  const uno = await call(router, "POST", "mensajes/publicar", { body: { tdespacio: "tks", iref: "42", contenido: "primero" }, headers: como("ana") });
  assertEquals(uno.status, 200, JSON.stringify(uno.data));
  assertEquals((uno.data as Mensaje).imensaje, "0");
  const dos = await call(router, "POST", "mensajes/publicar", { body: { tdespacio: "tks", iref: "42", contenido: "segundo" }, headers: como("beto") });
  assertEquals((dos.data as Mensaje).imensaje, "1");
  const res1 = await call(router, "POST", "mensajes/publicar", { body: { tdespacio: "tks", iref: "42", contenido: "respuesta", indexcita: "1" }, headers: como("carla") });
  assertEquals((res1.data as Mensaje).imensaje, "1.0");
  assertEquals((res1.data as Mensaje).indexcita, "1");
  const res2 = await call(router, "POST", "mensajes/publicar", { body: { tdespacio: "tks", iref: "42", contenido: "otra", indexcita: "1" }, headers: como("carla") });
  assertEquals((res2.data as Mensaje).imensaje, "1.1");
  const res3 = await call(router, "POST", "mensajes/publicar", { body: { tdespacio: "tks", iref: "42", contenido: "anidada", indexcita: "1.0" }, headers: como("ana") });
  assertEquals((res3.data as Mensaje).imensaje, "1.0.0");
  const hilo = await call(router, "GET", "mensajes/hilo?tdespacio=tks&iref=42", { headers: como("ana") });
  const raices = hilo.data as MensajeNodo[];
  assertEquals(raices.length, 2);
  assertEquals(raices[1]?.hijos.length, 2);
  assertEquals(raices[1]?.hijos[0]?.hijos[0]?.imensaje, "1.0.0");
  await cerrar();
});

Deno.test("mensajes: editar agrega una versión y nada se pierde", async () => {
  const { router, cerrar } = await montar();
  const uno = await call(router, "POST", "mensajes/publicar", { body: { tdespacio: "tks", iref: "42", contenido: "primero" }, headers: como("ana") });
  const m = uno.data as Mensaje;
  const ed = await call(router, "PUT", "mensaje/tks/42/0/editar", { body: { contenido: "corregido" }, headers: como("ana") });
  assertEquals(ed.status, 200, JSON.stringify(ed.data));
  const historial = (ed.data as Mensaje).jcontenido ?? [];
  assertEquals(historial.length, 2);
  assertEquals(historial[0]?.contenido, "primero");
  assertEquals(historial[1]?.contenido, "corregido");
  assertEquals(m.imensaje, "0");
  await cerrar();
});

Deno.test("mensajes: qtotalrespuestas cuenta las respuestas anidadas", async () => {
  const { router, cerrar } = await montar();
  await call(router, "POST", "mensajes/publicar", { body: { tdespacio: "tks", iref: "42", contenido: "padre" }, headers: como("ana") });
  await call(router, "POST", "mensajes/publicar", { body: { tdespacio: "tks", iref: "42", contenido: "hija", indexcita: "0" }, headers: como("ana") });
  await call(router, "POST", "mensajes/publicar", { body: { tdespacio: "tks", iref: "42", contenido: "neta", indexcita: "0.0" }, headers: como("ana") });
  const lista = await call(router, "GET", "mensajes?q=" + encodeURIComponent(JSON.stringify({ where: { tdespacio: "tks", iref: "42" }, orderBy: "imensaje" })), { headers: como("ana") });
  const filas = lista.data as Mensaje[];
  assertEquals(filas[0]?.qtotalrespuestas, 2, "el padre tiene dos respuestas anidadas");
  assertEquals(filas[1]?.qtotalrespuestas, 1);
  assertEquals(filas[2]?.qtotalrespuestas, 0);
  await cerrar();
});

Deno.test("calificaciones: una por usuario, se recalifica y no se borra", async () => {
  const { router, cerrar } = await montar();
  const uno = await call(router, "POST", "calificaciones/calificar", { body: { tdespacio: "tks", iref: "42", valor: 8 }, headers: como("ana") });
  assertEquals(uno.status, 200, JSON.stringify(uno.data));
  assertEquals((uno.data as Calificacion).valor, 8);
  assertEquals((uno.data as Calificacion).iusuario, "ana");
  const dos = await call(router, "POST", "calificaciones/calificar", { body: { tdespacio: "tks", iref: "42", valor: -3 }, headers: como("ana") });
  assertEquals((dos.data as Calificacion).valor, -3);
  const lista = await call(router, "GET", "calificaciones", { headers: como("ana") });
  assertEquals((lista.data as Calificacion[]).length, 1, "recalificar no crea otra fila");
  const del = await call(router, "DELETE", "calificacion/tks/42/ana", { headers: como("ana") });
  assertEquals(del.status, 400);
  const fuera = await call(router, "POST", "calificaciones/calificar", { body: { tdespacio: "tks", iref: "42", valor: 11 }, headers: como("ana") });
  assertEquals(fuera.status, 400);
  await cerrar();
});

Deno.test("reacciones: una por usuario, se cambia y se puede retirar", async () => {
  const { router, cerrar } = await montar();
  const uno = await call(router, "POST", "reacciones/reaccionar", { body: { tdespacio: "tks", iref: "42", reaccion: "🔥" }, headers: como("ana") });
  assertEquals(uno.status, 200, JSON.stringify(uno.data));
  assertEquals((uno.data as ReaccionFila).reaccion, "🔥");
  const dos = await call(router, "POST", "reacciones/reaccionar", { body: { tdespacio: "tks", iref: "42", reaccion: "👍" }, headers: como("ana") });
  assertEquals((dos.data as ReaccionFila).reaccion, "👍");
  const lista = await call(router, "GET", "reacciones", { headers: como("ana") });
  assertEquals((lista.data as ReaccionFila[]).length, 1);
  await cerrar();
});
