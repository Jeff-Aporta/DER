/**
 * El plugin de mensajes por dentro: el autor y la fecha los puede fijar quien publica (un chat que llega de
 * otro sitio conserva su hora), las versiones se acumulan sin perder lo anterior, la baja es lógica y el hilo
 * es un árbol (x, x.y, x.y.z…).
 */
import { assert, assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { type Mensaje, type MensajeNodo, mensajesServer } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { call } from "@Jeff-Aporta/DER/tests/_util.ts";

/** Sesión sin JWT: la cabecera `x-usuario` dice quién es. */
function sesionDe(req: Request): { id: string; claims: Record<string, unknown> } | null {
  const usuario = req.headers.get("x-usuario");
  if (!usuario) return null;
  return { id: usuario, claims: { roles: [], grupos: [] } };
}

/** API con el plugin de mensajes sobre SQLite en memoria. */
async function montar() {
  registry.secure(null);
  const db = sqliteDatabase();
  const mensajes = createServer(mensajesServer, { db, cfg: {} });
  const router = createRouter([], { basePath: "/api", plugins: [mensajes] });
  registry.secure({ extract: sesionDe });
  await router.seed();
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { router, cerrar };
}

const como = (usuario: string) => ({ "x-usuario": usuario });

Deno.test("mensajes: publicar puede fijar el autor y la fecha de la versión", async () => {
  const { router, cerrar } = await montar();
  const r = await call(router, "POST", "mensajes/publicar", {
    body: {
      tdespacio: "telegram",
      iref: "-100123:7",
      contenido: "hola",
      iusuario: "tg:4242",
      fhcre: "2026-11-13T10:00:00.000Z",
    },
    headers: como("ana"),
  });
  assertEquals(r.status, 200, JSON.stringify(r.data));
  const m = r.data as Mensaje;
  assertEquals(m.iusuario, "tg:4242", "el autor lo fija quien publica");
  assertEquals(m.imensaje, "0");
  assertEquals(m.jcontenido?.[0]?.fhcre, "2026-11-13T10:00:00.000Z", "la fecha original se conserva");
  await cerrar();
});

Deno.test("mensajes: sin autor ni fecha, mandan la sesión y la hora de ahora", async () => {
  const { router, cerrar } = await montar();
  const antes = new Date().toISOString();
  const r = await call(router, "POST", "mensajes/publicar", {
    body: { tdespacio: "telegram", iref: "-100123:7", contenido: "hola" },
    headers: como("ana"),
  });
  const m = r.data as Mensaje;
  assertEquals(m.iusuario, "ana", "sin autor explícito, es la sesión");
  assert((m.jcontenido?.[0]?.fhcre ?? "") >= antes, "sin fecha explícita, es la de ahora");
  await cerrar();
});

Deno.test("mensajes: una fecha que no es ISO se rechaza", async () => {
  const { router, cerrar } = await montar();
  const r = await call(router, "POST", "mensajes/publicar", {
    body: { tdespacio: "telegram", iref: "-100123:7", contenido: "hola", fhcre: "ayer" },
    headers: como("ana"),
  });
  assertEquals(r.status, 400);
  await cerrar();
});

Deno.test("mensajes: editar puede fijar la fecha de la versión nueva y no pierde lo anterior", async () => {
  const { router, cerrar } = await montar();
  const uno = await call(router, "POST", "mensajes/publicar", {
    body: { tdespacio: "telegram", iref: "-100123:7", contenido: "pensando", fhcre: "2026-11-13T10:00:00.000Z" },
    headers: como("ana"),
  });
  const ed = await call(router, "PUT", "mensaje/telegram/-100123:7/0/editar", {
    body: { contenido: "respondido", fhcre: "2026-11-13T10:00:05.000Z" },
    headers: como("ana"),
  });
  assertEquals(ed.status, 200, JSON.stringify(ed.data));
  const historial = (ed.data as Mensaje).jcontenido ?? [];
  assertEquals(historial.length, 2);
  assertEquals(historial[0]?.contenido, "pensando");
  assertEquals(historial[0]?.fhcre, "2026-11-13T10:00:00.000Z");
  assertEquals(historial[1]?.contenido, "respondido");
  assertEquals(historial[1]?.fhcre, "2026-11-13T10:00:05.000Z");
  assertEquals((uno.data as Mensaje).imensaje, "0");
  await cerrar();
});

Deno.test("mensajes: la baja es lógica (la fila se conserva)", async () => {
  const { router, cerrar } = await montar();
  await call(router, "POST", "mensajes/publicar", {
    body: { tdespacio: "telegram", iref: "-100123:7", contenido: "hola" },
    headers: como("ana"),
  });
  const del = await call(router, "DELETE", "mensaje/telegram/-100123:7/0", { headers: como("ana") });
  assertEquals(del.status, 200, JSON.stringify(del.data));
  assertEquals((del.data as Mensaje).bactivo, false);
  const sigue = await call(router, "GET", "mensaje/telegram/-100123:7/0", { headers: como("ana") });
  assertEquals(sigue.status, 200, "la fila se conserva");
  assertEquals((sigue.data as Mensaje).bactivo, false);
  await cerrar();
});

Deno.test("mensajes: el hilo es un árbol y las respuestas se anidan", async () => {
  const { router, cerrar } = await montar();
  await call(router, "POST", "mensajes/publicar", {
    body: { tdespacio: "telegram", iref: "-100123:7", contenido: "pregunta" },
    headers: como("ana"),
  });
  await call(router, "POST", "mensajes/publicar", {
    body: { tdespacio: "telegram", iref: "-100123:7", contenido: "respuesta", indexcita: "0" },
    headers: como("ana"),
  });
  const anidada = await call(router, "POST", "mensajes/publicar", {
    body: { tdespacio: "telegram", iref: "-100123:7", contenido: "otra", indexcita: "0.0" },
    headers: como("ana"),
  });
  assertEquals((anidada.data as Mensaje).imensaje, "0.0.0");
  const hilo = await call(router, "GET", "mensajes/hilo?tdespacio=telegram&iref=-100123:7", { headers: como("ana") });
  const raices = hilo.data as MensajeNodo[];
  assertEquals(raices.length, 1);
  assertEquals(raices[0]?.hijos.length, 1);
  assertEquals(raices[0]?.hijos[0]?.hijos[0]?.imensaje, "0.0.0");
  await cerrar();
});

Deno.test("mensajes: un adjunto se registra y se cuelga de la versión", async () => {
  const { router, cerrar } = await montar();
  const adj = await call(router, "POST", "adjuntos/registrar", {
    body: { nombre: "nota.ogg", mime: "audio/ogg", bytes: 1234, clave: "tg/file/1", jmeta: { duracion: 3 } },
    headers: como("ana"),
  });
  assertEquals(adj.status, 200, JSON.stringify(adj.data));
  const id = (adj.data as { iadjunto: string }).iadjunto;
  const pub = await call(router, "POST", "mensajes/publicar", {
    body: { tdespacio: "telegram", iref: "-100123:7", contenido: "nota de voz", adjuntos: [id] },
    headers: como("ana"),
  });
  assertEquals((pub.data as Mensaje).jcontenido?.[0]?.adjuntos?.[0], id);
  await cerrar();
});
