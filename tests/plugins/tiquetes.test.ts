/**
 * Pruebas de caja negra del plugin de tiquetes sobre el router real: alta con catalogo, adoptar/asignar, maquina de estados,
 * aislamiento por empresa, catalogo declarativo por empresa, integracion con el bot (desde-chat / estado-chat), comentarios,
 * baja logica y la discriminacion determinista TIQUETE vs ERROR del sistema (contra la cola del plugin errores).
 */
import { assert, assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { clasificarReporte, erroresServer, tiquetesServer } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import type { Clasificacion, DetalleTiquete, PaginaTiquetes, Tiquete, TipoTiqueteFila } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { call, SECRET } from "@Jeff-Aporta/DER/tests/_util.ts";

/** Sesion sin JWT: `x-usuario` dice quien es y `x-empresa` en que empresa actua. */
function sesionDe(req: Request): { id: string; claims: Record<string, unknown> } | null {
  const usuario = req.headers.get("x-usuario");
  if (!usuario) return null;
  return { id: usuario, claims: { iempresa: req.headers.get("x-empresa") ?? "" } };
}

/** API con tiquetes y errores sobre SQLite en memoria (la cola de errores es la existente). */
async function montar() {
  registry.secure(null);
  const db = sqliteDatabase();
  const tiquetes = createServer(tiquetesServer, { db, cfg: {} });
  const errores = createServer(erroresServer, { db, cfg: { secret: SECRET } });
  const router = createRouter([], { basePath: "/api", plugins: [tiquetes, errores] });
  registry.secure({ extract: sesionDe });
  await router.seed();
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { router, cerrar };
}

const como = (usuario: string, empresa: string) => ({ "x-usuario": usuario, "x-empresa": empresa });

/** Crea un tiquete y falla el test si la respuesta no es 200. */
async function crear(router: Awaited<ReturnType<typeof montar>>["router"], empresa: string, usuario: string, body: Record<string, unknown>): Promise<Tiquete> {
  const r = await call(router, "POST", "tiquetes", { body, headers: como(usuario, empresa) });
  assertEquals(r.status, 200, JSON.stringify(r.data));
  return r.data as Tiquete;
}

Deno.test("tiquetes: alta con defaults del servidor, datos del tipo e historial", async () => {
  const { router, cerrar } = await montar();
  const t = await crear(router, "acme", "ana", { tipo: "pedido", titulo: "Domicilio 310", datos: { direccion: "Calle 1 #2-3", platos: ["Bandeja", "Jugo"] } });
  assert(t.id, "debe tener id");
  assertEquals(t.estado, "nuevo");
  assertEquals(t.prioridad, "media");
  assertEquals(t.iusuarioCreador, "ana");
  assertEquals(t.iusuarioAsignado, null);
  assert(t.fcha, "debe poner la fecha del tiquete");
  assertEquals((t.datos as { direccion?: string }).direccion, "Calle 1 #2-3");
  const det = await call(router, "GET", `tiquetes/${t.id}`, { headers: como("ana", "acme") });
  assertEquals(det.status, 200, JSON.stringify(det.data));
  const d = det.data as DetalleTiquete;
  assertEquals(d.eventos.length, 1);
  assertEquals(d.eventos[0]?.clase, "creado");
  const lista = await call(router, "GET", "tiquetes", { headers: como("ana", "acme") });
  const p = lista.data as PaginaTiquetes;
  assertEquals(p.total, 1);
  assertEquals(p.tiquetes[0]?.id, t.id);
  await cerrar();
});

Deno.test("tiquetes: adoptar (el WRKR toma) y asignar, con 409 si ya lo tiene otro", async () => {
  const { router, cerrar } = await montar();
  const uno = await crear(router, "acme", "ana", { tipo: "solicitud", titulo: "Uno" });
  const dos = await crear(router, "acme", "ana", { tipo: "solicitud", titulo: "Dos" });
  const adopta = await call(router, "POST", `tiquetes/${uno.id}/adoptar`, { headers: como("beto", "acme") });
  assertEquals(adopta.status, 200, JSON.stringify(adopta.data));
  assertEquals((adopta.data as Tiquete).iusuarioAsignado, "beto");
  assertEquals((adopta.data as Tiquete).estado, "asignado");
  const otro = await call(router, "POST", `tiquetes/${uno.id}/adoptar`, { headers: como("carla", "acme") });
  assertEquals(otro.status, 409, "ya lo tiene beto");
  const asignado = await call(router, "POST", `tiquetes/${dos.id}/asignar`, { body: { iusuarioAsignado: "beto" }, headers: como("ana", "acme") });
  assertEquals(asignado.status, 200, JSON.stringify(asignado.data));
  assertEquals((asignado.data as Tiquete).iusuarioAsignado, "beto");
  const mias = await call(router, "GET", "tiquetes?asignado=mi", { headers: como("beto", "acme") });
  assertEquals((mias.data as PaginaTiquetes).total, 2);
  const libres = await call(router, "GET", "tiquetes?sinAsignar=true", { headers: como("beto", "acme") });
  assertEquals((libres.data as PaginaTiquetes).total, 0);
  const traza = await call(router, "GET", `tiquetes/${uno.id}`, { headers: como("ana", "acme") });
  const clases = (traza.data as DetalleTiquete).eventos.map((e) => e.clase);
  assertEquals(clases.includes("adoptado"), true);
  await cerrar();
});

Deno.test("tiquetes: la maquina de estados rechaza saltos y deja un evento por cambio", async () => {
  const { router, cerrar } = await montar();
  const t = await crear(router, "acme", "ana", { tipo: "pedido", titulo: "Con estados" });
  const salto = await call(router, "POST", `tiquetes/${t.id}/estado`, { body: { estado: "entregado" }, headers: como("ana", "acme") });
  assertEquals(salto.status, 400, "de nuevo no se salta a entregado");
  for (const estado of ["en_proceso", "listo", "entregado", "cerrado"]) {
    const r = await call(router, "POST", `tiquetes/${t.id}/estado`, { body: { estado, comentario: `paso a ${estado}` }, headers: como("ana", "acme") });
    assertEquals(r.status, 200, JSON.stringify(r.data));
    assertEquals((r.data as Tiquete).estado, estado);
  }
  const reabrir = await call(router, "POST", `tiquetes/${t.id}/estado`, { body: { estado: "en_proceso" }, headers: como("ana", "acme") });
  assertEquals(reabrir.status, 400, "cerrado es terminal");
  const det = await call(router, "GET", `tiquetes/${t.id}`, { headers: como("ana", "acme") });
  const cambios = (det.data as DetalleTiquete).eventos.filter((e) => e.clase === "estado");
  assertEquals(cambios.length, 4);
  assertEquals(cambios[0]?.estadoAnterior, "nuevo");
  assertEquals(cambios[3]?.estado, "cerrado");
  await cerrar();
});

Deno.test("tiquetes: aislamiento por empresa (lista, detalle, adopcion y catalogo)", async () => {
  const { router, cerrar } = await montar();
  const t = await crear(router, "acme", "ana", { tipo: "pedido", titulo: "Solo de acme" });
  const listaBeta = await call(router, "GET", "tiquetes", { headers: como("ana", "beta") });
  assertEquals((listaBeta.data as PaginaTiquetes).total, 0, "beta no ve tiquetes de acme");
  const detalleBeta = await call(router, "GET", `tiquetes/${t.id}`, { headers: como("ana", "beta") });
  assertEquals(detalleBeta.status, 404);
  const adoptaBeta = await call(router, "POST", `tiquetes/${t.id}/adoptar`, { headers: como("ana", "beta") });
  assertEquals(adoptaBeta.status, 404);
  const tipo = await call(router, "PUT", "tiquetes/catalogo/mantenimiento", { body: { nombre: "Mantenimiento", estados: ["nuevo", "en_proceso", "cerrado"], campos: [{ clave: "equipo", etiqueta: "Equipo", tipo: "texto", requerido: true }] }, headers: como("ana", "acme") });
  assertEquals(tipo.status, 200, JSON.stringify(tipo.data));
  const catalogoAcme = await call(router, "GET", "tiquetes/catalogo", { headers: como("ana", "acme") });
  const catalogoBeta = await call(router, "GET", "tiquetes/catalogo", { headers: como("ana", "beta") });
  const tiposAcme = (catalogoAcme.data as TipoTiqueteFila[]).map((x) => x.tipo);
  const tiposBeta = (catalogoBeta.data as TipoTiqueteFila[]).map((x) => x.tipo);
  assertEquals(tiposAcme.includes("mantenimiento"), true);
  assertEquals(tiposBeta.includes("mantenimiento"), false, "el catalogo es por empresa");
  assertEquals(tiposBeta.includes("pedido"), true, "los tipos de fabrica estan en todas");
  const sinEquipo = await call(router, "POST", "tiquetes", { body: { tipo: "mantenimiento", titulo: "Revisar aire" }, headers: como("ana", "acme") });
  assertEquals(sinEquipo.status, 400, "falta un campo requerido del tipo");
  const conEquipo = await call(router, "POST", "tiquetes", { body: { tipo: "mantenimiento", titulo: "Revisar aire", datos: { equipo: "Aire 2" } }, headers: como("ana", "acme") });
  assertEquals(conEquipo.status, 200, JSON.stringify(conEquipo.data));
  await cerrar();
});

Deno.test("tiquetes: catalogo de fabrica por tipo (restaurante y hotel) y campos por empresa", async () => {
  const { router, cerrar } = await montar();
  const cat = await call(router, "GET", "tiquetes/catalogo", { headers: como("ana", "hotel") });
  const tipos = cat.data as TipoTiqueteFila[];
  const pedido = tipos.find((t) => t.tipo === "pedido");
  const reserva = tipos.find((t) => t.tipo === "reserva");
  assertEquals(pedido?.campos?.map((c) => c.clave).includes("direccion"), true);
  assertEquals(pedido?.campos?.map((c) => c.clave).includes("platos"), true);
  assertEquals(reserva?.campos?.map((c) => c.clave).includes("habitacion"), true);
  assertEquals(reserva?.campos?.map((c) => c.clave).includes("fechaFin"), true);
  const hotel = await call(router, "POST", "tiquetes", { body: { tipo: "reserva", titulo: "Habitacion 7", datos: { habitacion: "7", personas: 2, fechaInicio: "2026-12-01T15:00:00Z", fechaFin: "2026-12-03T11:00:00Z" }, fcha: "2026-12-01T15:00:00Z", fchaFin: "2026-12-03T11:00:00Z" }, headers: como("ana", "hotel") });
  assertEquals(hotel.status, 200, JSON.stringify(hotel.data));
  const t = hotel.data as Tiquete;
  assertEquals(t.tipo, "reserva");
  assertEquals((t.datos as { habitacion?: string }).habitacion, "7");
  const malo = await call(router, "POST", "tiquetes", { body: { tipo: "reserva", titulo: "Fechas al reves", fcha: "2026-12-03T11:00:00Z", fchaFin: "2026-12-01T11:00:00Z" }, headers: como("ana", "hotel") });
  assertEquals(malo.status, 400);
  await cerrar();
});

Deno.test("tiquetes: el bot crea desde el chat (idempotente), consulta y cambia el estado", async () => {
  const { router, cerrar } = await montar();
  const cuerpo = { ichat: "chat-1", tipo: "reserva", titulo: "Reserva del chat", datos: { habitacion: "3" }, fcha: "2026-12-01T15:00:00Z", fchaFin: "2026-12-02T11:00:00Z", iexterno: "wa-1" };
  const uno = await call(router, "POST", "tiquetes/desde-chat", { body: cuerpo, headers: como("bot", "hotel") });
  assertEquals(uno.status, 200, JSON.stringify(uno.data));
  const t = uno.data as Tiquete;
  assertEquals(t.ichat, "chat-1");
  assertEquals(t.iexterno, "wa-1");
  const dos = await call(router, "POST", "tiquetes/desde-chat", { body: cuerpo, headers: como("bot", "hotel") });
  assertEquals((dos.data as Tiquete).id, t.id, "idempotente por iexterno");
  const chat = await call(router, "GET", "tiquetes/chat?ichat=chat-1", { headers: como("bot", "hotel") });
  assertEquals(chat.status, 200, JSON.stringify(chat.data));
  assertEquals((chat.data as { tiquetes: Tiquete[] }).tiquetes.length, 1);
  const estado = await call(router, "POST", "tiquetes/estado-chat", { body: { id: t.id, ichat: "chat-1", estado: "asignado" }, headers: como("bot", "hotel") });
  assertEquals(estado.status, 200, JSON.stringify(estado.data));
  assertEquals((estado.data as Tiquete).estado, "asignado");
  const ajeno = await call(router, "POST", "tiquetes/estado-chat", { body: { id: t.id, ichat: "chat-2", estado: "en_proceso" }, headers: como("bot", "hotel") });
  assertEquals(ajeno.status, 404, "el tiquete no es de ese chat");
  await cerrar();
});

Deno.test("tiquetes: discriminacion determinista TIQUETE vs ERROR del sistema (cola de errores existente)", async () => {
  const { router, cerrar } = await montar();
  assertEquals(clasificarReporte("La app no carga y sale error 500 en el login").destino, "error");
  assertEquals(clasificarReporte("Quiero reservar una habitacion para el fin de semana").destino, "tiquete");
  assertEquals(clasificarReporte("Necesito una cotizacion").destino, "tiquete");
  assertEquals(clasificarReporte("Mi pedido no llego").destino, "tiquete", "un fallo del negocio lo resuelve un humano");
  assertEquals(clasificarReporte("No se que pasa", { codigoHttp: 502 }).destino, "error", "la telemetria 5xx manda");
  assertEquals(clasificarReporte("error").reglas.length > 0, true);
  const errorR = await call(router, "POST", "tiquetes/clasificar", { body: { texto: "La pagina web no carga, sale error 500 en el formulario de pago", ichat: "chat-9" }, headers: como("ana", "acme") });
  assertEquals(errorR.status, 200, JSON.stringify(errorR.data));
  const claseError = errorR.data as Clasificacion;
  assertEquals(claseError.destino, "error");
  assert(claseError.ierror !== null, "el reporte entra a la cola de errores");
  assertEquals(claseError.tiquete, null);
  const cola = await call(router, "GET", "errores", { headers: como("ana", "acme") });
  assertEquals(cola.status, 200, JSON.stringify(cola.data));
  assertEquals((cola.data as { ierror: number }[]).length, 1, "se creo en la cola existente");
  const humano = await call(router, "POST", "tiquetes/clasificar", { body: { texto: "Quiero cambiar la direccion de mi pedido", ichat: "chat-9" }, headers: como("ana", "acme") });
  const claseHumano = humano.data as Clasificacion;
  assertEquals(claseHumano.destino, "tiquete");
  assert(claseHumano.tiquete !== null, "el reporte humano crea un tiquete");
  assertEquals(claseHumano.ierror, null);
  const sinCrear = await call(router, "POST", "tiquetes/clasificar", { body: { texto: "Quiero pedir una pizza", crear: false }, headers: como("ana", "acme") });
  assertEquals((sinCrear.data as Clasificacion).destino, "tiquete");
  assertEquals((sinCrear.data as Clasificacion).tiquete, null);
  await cerrar();
});

Deno.test("tiquetes: comentar, cambiar datos y baja logica", async () => {
  const { router, cerrar } = await montar();
  const t = await crear(router, "acme", "ana", { tipo: "solicitud", titulo: "Con comentarios" });
  const comentario = await call(router, "POST", `tiquetes/${t.id}/comentar`, { body: { texto: "Llamado al cliente" }, headers: como("beto", "acme") });
  assertEquals(comentario.status, 200, JSON.stringify(comentario.data));
  const cambio = await call(router, "PUT", `tiquetes/${t.id}`, { body: { titulo: "Con comentarios y prioridad", prioridad: "alta" }, headers: como("ana", "acme") });
  assertEquals(cambio.status, 200, JSON.stringify(cambio.data));
  assertEquals((cambio.data as Tiquete).prioridad, "alta");
  const alta = await call(router, "GET", "tiquetes?prioridad=alta", { headers: como("ana", "acme") });
  assertEquals((alta.data as PaginaTiquetes).total, 1);
  const baja = await call(router, "DELETE", `tiquetes/${t.id}`, { headers: como("ana", "acme") });
  assertEquals(baja.status, 200, JSON.stringify(baja.data));
  assertEquals((baja.data as Tiquete).bactivo, false);
  const lista = await call(router, "GET", "tiquetes", { headers: como("ana", "acme") });
  assertEquals((lista.data as PaginaTiquetes).total, 0);
  const conArchivados = await call(router, "GET", "tiquetes?incluirArchivados=true", { headers: como("ana", "acme") });
  assertEquals((conArchivados.data as PaginaTiquetes).total, 1);
  const det = await call(router, "GET", `tiquetes/${t.id}`, { headers: como("ana", "acme") });
  const clases = (det.data as DetalleTiquete).eventos.map((e) => e.clase);
  assertEquals(clases.includes("comentario"), true);
  assertEquals(clases.includes("actualizado"), true);
  assertEquals(clases.includes("archivado"), true);
  await cerrar();
});
