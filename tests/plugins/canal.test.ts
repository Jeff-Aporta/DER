/**
 * Plugin de canal para bots: publicación, listado desde una marca, versiones, baja lógica, reacciones y adjuntos.
 */
import { assert, assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { canalServer, type AdjuntoCanal, type MensajeCanal, type ReaccionCanal } from "@Jeff-Aporta/DER/src/03-plugins/canal/server.ts";
import { call } from "@Jeff-Aporta/DER/tests/_util.ts";

/** Sesión de bot sin JWT: la cabecera dice quién es. */
function sesionDe(req: Request): { id: string; claims: Record<string, unknown> } | null {
  const usuario = req.headers.get("x-usuario");
  return usuario ? { id: usuario, claims: {} } : null;
}

/** API del canal sobre SQLite en memoria. */
async function montar() {
  registry.secure(null);
  const db = sqliteDatabase();
  const canal = createServer(canalServer, { db, cfg: {} });
  const router = createRouter([], { basePath: "/api", plugins: [canal] });
  registry.secure({ extract: sesionDe });
  await router.seed();
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { router, cerrar };
}

const como = (bot: string) => ({ "x-usuario": bot });

Deno.test("canal: publica canal, hilo, autor bot, tipo, origen, fecha y versión inicial", async () => {
  const { router, cerrar } = await montar();
  const respuesta = await call(router, "POST", "canal/mensajes/publicar", {
    headers: como("bot:ana"),
    body: {
      canal: "ops",
      hilo: "incidente-7",
      texto: "revisado",
      tipo: "estado",
      msgorigen: "telegram:123",
      ts: "2026-11-13T10:00:00.000Z",
    },
  });
  assertEquals(respuesta.status, 200, JSON.stringify(respuesta.data));
  const mensaje = respuesta.data as MensajeCanal;
  assertEquals(mensaje.de, "bot:ana");
  assertEquals(mensaje.canal, "ops");
  assertEquals(mensaje.hilo, "incidente-7");
  assertEquals(mensaje.tipo, "estado");
  assertEquals(mensaje.msgorigen, "telegram:123");
  assertEquals(mensaje.jcontenido?.[0]?.texto, "revisado");
  assertEquals(mensaje.jcontenido?.[0]?.ts, "2026-11-13T10:00:00.000Z");
  await cerrar();
});

Deno.test("canal: lista por hilo desde una marca de tiempo", async () => {
  const { router, cerrar } = await montar();
  for (const [hora, hilo] of [["10:00:00.000Z", "a"], ["11:00:00.000Z", "a"], ["12:00:00.000Z", "b"]]) {
    await call(router, "POST", "canal/mensajes/publicar", {
      headers: como("bot:ana"),
      body: { canal: "ops", hilo, texto: hora, ts: `2026-11-13T${hora}` },
    });
  }
  const respuesta = await call(router, "GET", "canal/mensajes/listar?canal=ops&hilo=a&desde=2026-11-13T11:00:00.000Z", {
    headers: como("bot:ana"),
  });
  assertEquals(respuesta.status, 200, JSON.stringify(respuesta.data));
  const mensajes = respuesta.data as MensajeCanal[];
  assertEquals(mensajes.length, 1);
  assertEquals(mensajes[0]?.texto, "11:00:00.000Z");
  await cerrar();
});

Deno.test("canal: editar conserva versiones y eliminar es baja lógica", async () => {
  const { router, cerrar } = await montar();
  const publicado = await call(router, "POST", "canal/mensajes/publicar", {
    headers: como("bot:ana"),
    body: { canal: "ops", texto: "primero" },
  });
  const id = (publicado.data as MensajeCanal).idmensaje;
  const editado = await call(router, "PUT", `canal/mensaje/${id}/editar`, {
    headers: como("bot:ana"),
    body: { texto: "segundo", ts: "2026-11-13T10:05:00.000Z" },
  });
  assertEquals(editado.status, 200, JSON.stringify(editado.data));
  assertEquals((editado.data as MensajeCanal).jcontenido?.length, 2);
  assertEquals((editado.data as MensajeCanal).jcontenido?.[0]?.texto, "primero");
  assertEquals((editado.data as MensajeCanal).jcontenido?.[1]?.texto, "segundo");
  const eliminado = await call(router, "DELETE", `canal/mensaje/${id}/eliminar`, { headers: como("bot:ana") });
  assertEquals(eliminado.status, 200, JSON.stringify(eliminado.data));
  assertEquals((eliminado.data as MensajeCanal).bactivo, false);
  const listar = await call(router, "GET", "canal/mensajes/listar?canal=ops", { headers: como("bot:ana") });
  assertEquals((listar.data as MensajeCanal[]).length, 0, "el mensaje dado de baja no se lista");
  await cerrar();
});

Deno.test("canal: una reacción por bot, se cambia y se puede quitar", async () => {
  const { router, cerrar } = await montar();
  const publicado = await call(router, "POST", "canal/mensajes/publicar", {
    headers: como("bot:ana"),
    body: { canal: "ops", texto: "hola" },
  });
  const id = (publicado.data as MensajeCanal).idmensaje;
  const primero = await call(router, "POST", "canal/reacciones/reaccionar", {
    headers: como("bot:ana"),
    body: { idmensaje: id, reaccion: "ok" },
  });
  assertEquals(primero.status, 200, JSON.stringify(primero.data));
  assertEquals((primero.data as ReaccionCanal).de, "bot:ana");
  const cambiado = await call(router, "POST", "canal/reacciones/reaccionar", {
    headers: como("bot:ana"),
    body: { idmensaje: id, reaccion: "👍" },
  });
  assertEquals((cambiado.data as ReaccionCanal).reaccion, "👍");
  const lista = await call(router, "GET", `canal/mensaje/${id}/reacciones`, { headers: como("bot:ana") });
  assertEquals((lista.data as ReaccionCanal[]).length, 1);
  const quitada = await call(router, "DELETE", "canal/reacciones/quitar", {
    headers: como("bot:ana"),
    body: { idmensaje: id },
  });
  assertEquals(quitada.status, 200, JSON.stringify(quitada.data));
  const despues = await call(router, "GET", `canal/mensaje/${id}/reacciones`, { headers: como("bot:ana") });
  assertEquals((despues.data as ReaccionCanal[]).length, 0);
  await cerrar();
});

Deno.test("canal: registra adjuntos R2 con 72 horas y los cuelga del mensaje", async () => {
  const { router, cerrar } = await montar();
  const antes = Date.now();
  const adjunto = await call(router, "POST", "canal/adjuntos/registrar", {
    headers: como("bot:ana"),
    body: { nombre: "captura.png", mime: "image/png", bytes: 1234, clave: "canal/2026/11/captura.png" },
  });
  assertEquals(adjunto.status, 200, JSON.stringify(adjunto.data));
  const ficha = adjunto.data as AdjuntoCanal;
  assertEquals(ficha.bytes, 1234);
  assertEquals(ficha.mime, "image/png");
  assertEquals(ficha.clave, "canal/2026/11/captura.png");
  assert(new Date(ficha.fhexpira).getTime() >= antes + 72 * 60 * 60 * 1000, "caduca en 72 horas");
  const publicado = await call(router, "POST", "canal/mensajes/publicar", {
    headers: como("bot:ana"),
    body: { canal: "ops", texto: "mira", adjuntos: [ficha.idadjunto] },
  });
  assertEquals((publicado.data as MensajeCanal).adjuntos, [ficha.idadjunto]);
  const lista = await call(router, "GET", `canal/adjuntos/listar?idmensaje=${(publicado.data as MensajeCanal).idmensaje}`, {
    headers: como("bot:ana"),
  });
  assertEquals((lista.data as AdjuntoCanal[]).length, 1);
  await cerrar();
});

Deno.test("canal: exige sesión y no permite publicar en nombre de otro bot", async () => {
  const { router, cerrar } = await montar();
  const anonimo = await call(router, "POST", "canal/mensajes/publicar", {
    body: { canal: "ops", texto: "hola" },
  });
  assertEquals(anonimo.status, 401);
  const suplantado = await call(router, "POST", "canal/mensajes/publicar", {
    headers: como("bot:ana"),
    body: { canal: "ops", texto: "hola", de: "bot:otro" },
  });
  assertEquals(suplantado.status, 400);
  await cerrar();
});
