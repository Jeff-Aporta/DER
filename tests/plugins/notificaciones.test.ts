/**
 * El plugin de notificaciones por dentro: la bandeja es de la sesión, las de `*` se leen por usuario, el contador
 * baja al leer, nadie marca las de otro y los verbos de servidor sirven sin router (APIs con rutas propias).
 */
import { assert, assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import {
  type Bandeja,
  crearNotificaciones,
  type Notificacion,
} from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { call } from "@Jeff-Aporta/DER/tests/_util.ts";

/** Sesión sin JWT: la cabecera `x-usuario` dice quién es. */
function sesionDe(req: Request): { id: string; claims: Record<string, unknown> } | null {
  const usuario = req.headers.get("x-usuario");
  if (!usuario) return null;
  return { id: usuario, claims: { roles: [], grupos: [] } };
}

async function montar() {
  registry.secure(null);
  const db = sqliteDatabase();
  const avisadas: Notificacion[][] = [];
  const notif = crearNotificaciones({
    db,
    services: { alNotificar: (f: Notificacion[]) => avisadas.push(f) },
  });
  const router = createRouter([], { basePath: "/api", plugins: [notif] });
  registry.secure({ extract: sesionDe });
  await router.seed();
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { router, notif, avisadas, cerrar };
}

const como = (usuario: string) => ({ "x-usuario": usuario });

Deno.test("notificaciones: notificar crea una por destinatario y avisa al consumidor", async () => {
  const { router, avisadas, cerrar } = await montar();
  const r = await call(router, "POST", "notificaciones/notificar", {
    body: { destinatarios: ["ana", "beto", "ana"], titulo: "Hola", tipo: "exito" },
    headers: como("admin"),
  });
  assertEquals(r.status, 200, JSON.stringify(r.data));
  assertEquals((r.data as Notificacion[]).length, 2, "los repetidos se ignoran");
  assertEquals(avisadas.length, 1);
  assertEquals(avisadas[0]?.map((n) => n.iusuario).sort(), ["ana", "beto"]);
  await cerrar();
});

Deno.test("notificaciones: la bandeja es de la sesión y suma las de todos", async () => {
  const { router, notif, cerrar } = await montar();
  await notif.notificar({ destinatarios: ["ana"], titulo: "Solo para Ana" });
  await notif.notificar({ destinatarios: ["beto"], titulo: "Solo para Beto" });
  await notif.notificar({ destinatarios: ["*"], titulo: "Para todos", enlace: "noticias:1" });
  const r = await call(router, "GET", "notificaciones/bandeja", { headers: como("ana") });
  const b = r.data as Bandeja;
  assertEquals(b.items.map((n) => n.titulo).sort(), ["Para todos", "Solo para Ana"]);
  assertEquals(b.noLeidas, 2);
  await cerrar();
});

Deno.test("notificaciones: leer baja el contador; las de todos se leen por usuario", async () => {
  const { router, notif, cerrar } = await montar();
  await notif.notificar({ destinatarios: ["ana"], titulo: "A" });
  const [general] = await notif.notificar({ destinatarios: ["*"], titulo: "G" });
  const r = await call(router, "POST", "notificaciones/leer", {
    body: { ids: [general!.id] },
    headers: como("ana"),
  });
  assertEquals((r.data as { marcadas: number }).marcadas, 1);
  assertEquals(await notif.noLeidas("ana"), 1, "Ana leyó la general");
  assertEquals(await notif.noLeidas("beto"), 1, "Beto todavía no");
  const todas = await call(router, "POST", "notificaciones/leer", {
    body: { todas: true },
    headers: como("ana"),
  });
  assertEquals((todas.data as { marcadas: number }).marcadas, 1);
  assertEquals(await notif.noLeidas("ana"), 0);
  const b = await notif.bandeja("ana");
  assert(b.items.every((n) => n.leida), "todas quedan con fecha de lectura");
  await cerrar();
});

Deno.test("notificaciones: nadie marca las de otro", async () => {
  const { router, notif, cerrar } = await montar();
  const [deBeto] = await notif.notificar({ destinatarios: ["beto"], titulo: "B" });
  const r = await call(router, "POST", "notificaciones/leer", {
    body: { ids: [deBeto!.id] },
    headers: como("ana"),
  });
  assertEquals((r.data as { marcadas: number }).marcadas, 0);
  assertEquals(await notif.noLeidas("beto"), 1);
  await cerrar();
});

Deno.test("notificaciones: sin sesión no hay bandeja; sin router, los verbos y la semilla bastan", async () => {
  const { router, cerrar } = await montar();
  const r = await call(router, "GET", "notificaciones/bandeja");
  assert(r.status === 401 || r.status === 403 || r.status === 400, `sin sesión: ${r.status}`);
  await cerrar();
  const db = sqliteDatabase();
  const solo = crearNotificaciones({ db });
  await solo.seed();
  await solo.notificar({ destinatarios: ["ana"], titulo: "Sin router" });
  assertEquals(await solo.noLeidas("ana"), 1);
  await db.destroy();
});

Deno.test("notificaciones: el actor no se notifica a sí mismo y la bandeja trae quién lo hizo", async () => {
  const { notif, cerrar } = await montar();
  await notif.notificar({ destinatarios: ["ana", "beto"], titulo: "Ana registró a Luz", iactor: "ana", actor: "Ana" });
  await notif.notificar({ destinatarios: ["*"], titulo: "Ana publicó una noticia", iactor: "ana", actor: "Ana" });
  assertEquals(await notif.noLeidas("ana"), 0, "ni la propia ni la general que ella originó");
  const b = await notif.bandeja("beto");
  assertEquals(b.noLeidas, 2);
  assertEquals(b.items[0]?.actor, "Ana");
  await cerrar();
});

Deno.test("notificaciones: suscripciones de push por usuario, sin duplicados, y enviarPush desactiva las caducadas", async () => {
  registry.secure(null);
  const db = sqliteDatabase();
  const enviados: string[] = [];
  const notif = crearNotificaciones({ db, services: { enviarPush: (s: { endpoint: string }) => (enviados.push(s.endpoint), s.endpoint.includes("vieja") ? "caducada" : "ok") } });
  await notif.seed();
  await notif.suscribir("ana", { canal: "webpush", endpoint: "https://push.example/ana-1", claves: { p256dh: "x", auth: "y" } });
  await notif.suscribir("ana", { canal: "webpush", endpoint: "https://push.example/ana-1", claves: { p256dh: "x", auth: "y" } });
  await notif.suscribir("ana", { canal: "fcm", endpoint: "token-fcm-vieja-123" });
  assertEquals((await notif.suscripciones("ana")).length, 2, "el mismo endpoint no se duplica");
  await notif.notificar({ destinatarios: ["ana"], titulo: "Hola" });
  assertEquals(enviados.length, 2);
  assertEquals((await notif.suscripciones("ana")).length, 1, "la caducada queda inactiva");
  assertEquals((await notif.desuscribir("ana", "https://push.example/ana-1")).bajas, 1);
  assertEquals((await notif.suscripciones("ana")).length, 0);
  await db.destroy();
});
