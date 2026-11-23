/**
 * Plugin de notificaciones (server): el transversal con las particularidades del servidor.
 *
 * - El destinatario de la bandeja, de `leer` y de las suscripciones es la sesión (`ctx.session.id`).
 * - `*` = para todos: una sola fila, y la lectura se guarda por usuario en `notificaciones_lecturas`.
 * - Crear (`notificar`) queda tras la puerta `permissions` del consumidor (la ruta es `protected`).
 * - Tiempo real dentro de la app: `services.alNotificar(filas)` tras crear (SSE, WebSocket…).
 * - Push fuera de la app: `services.enviarPush(suscripcion, notificacion)` por cada suscripción activa del
 *   destinatario (las de `*` van a todas). El consumidor implementa el envío: Web Push con VAPID en el navegador,
 *   FCM (Capacitor) en Android. Si responde «caducada», la suscripción se desactiva. Sin el servicio, no se envía nada.
 * - Para APIs con rutas propias (sin las puertas del registro), `crearNotificaciones()` devuelve el plugin con los
 *   verbos como métodos: `notificar`, `bandeja`, `leer`, `noLeidas`, `suscribir`, `desuscribir`, `suscripciones`.
 *   Las tablas se crean (y se les suman columnas nuevas) con `router.seed()` o `plugin.seed()`.
 *
 * ```ts
 * const notif = crearNotificaciones({ db, services: { alNotificar: (filas) => emitir(filas), enviarPush } });
 * const router = createRouter(ctrls, { basePath: "/api", plugins: [notif] });
 * await notif.notificar({ destinatarios: ["*"], titulo: "Hay una noticia nueva", iactor: "u7", actor: "Ana" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/notificaciones.md
 */
import type { z } from "zod";
import { Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { randomId } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { notificacionesPlugin } from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/index.ts";
import { type Bandeja, type EnviarPush, type LeerInput, type Notificacion, type NotificarInput, type SuscribirInput, type SuscripcionPush, TODOS, type VerbosNotificaciones, ZDesuscribir, ZLeer, ZNotificar, ZSuscribir } from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/index.ts";

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

const fila = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && "toJSON" in p && typeof (p as { toJSON: unknown }).toJSON === "function" ? (p as { toJSON(): Record<string, unknown> }).toJSON() : (p as Record<string, unknown>));

const usuarioDe = (ctx: ServerCtx): string => {
  const u = ctx.session?.id ? String(ctx.session.id) : "";
  if (!u) throw new ValidationError("Las notificaciones requieren iniciar sesión");
  return u;
};

const ctrl = (plugin: ServerPlugin, nombre: string) => plugin.controllers[nombre]!;

/** sha256 en hex (id estable de una suscripción a partir de su endpoint). */
async function hashHex(texto: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Suscripciones activas de unos usuarios (`*` = todas). */
async function activasDe(plugin: ServerPlugin, usuarios: string[]): Promise<SuscripcionPush[]> {
  const where: Record<string, unknown> = { activa: true };
  if (!usuarios.includes(TODOS)) where["iusuario"] = usuarios;
  return (await ctrl(plugin, "suscripciones").query({ where } as never)).map(fila) as SuscripcionPush[];
}

/** Push fuera de la app (si el consumidor dio `services.enviarPush`). Nunca rompe la creación de la notificación. */
async function empujar(plugin: ServerPlugin, creadas: Notificacion[]): Promise<void> {
  const enviar = plugin.services?.["enviarPush"] as EnviarPush | undefined;
  if (typeof enviar !== "function" || !creadas.length) return;
  for (const n of creadas) {
    for (const s of await activasDe(plugin, [n.iusuario])) {
      try {
        if ((await enviar(s, n)) === "caducada") await ctrl(plugin, "suscripciones").put(ctrl(plugin, "suscripciones").pojo({ id: s.id, activa: false }));
      } catch { /* un dispositivo caído no frena a los demás */ }
    }
  }
}

/** Crea una notificación por destinatario, avisa al consumidor (`alNotificar`) y empuja el push (`enviarPush`). */
async function notificar(plugin: ServerPlugin, input: NotificarInput): Promise<Notificacion[]> {
  const d = validado<NotificarInput>(ZNotificar, input);
  const c = ctrl(plugin, "notificaciones");
  const fhcre = new Date().toISOString();
  const creadas: Notificacion[] = [];
  for (const iusuario of [...new Set(d.destinatarios)]) {
    // Nadie se notifica a sí mismo de lo que hizo (como en las redes sociales).
    if (d.iactor && iusuario === d.iactor) continue;
    const n: Notificacion = { id: randomId(12), iusuario, iactor: d.iactor ?? null, actor: d.actor ?? null, titulo: d.titulo, texto: d.texto ?? null, tipo: d.tipo ?? "info", enlace: d.enlace ?? null, tdespacio: d.tdespacio ?? null, iref: d.iref ?? null, leida: null, fhcre };
    await c.post(c.pojo(n));
    creadas.push(n);
  }
  const al = plugin.services?.["alNotificar"];
  if (typeof al === "function" && creadas.length) await (al as (f: Notificacion[]) => unknown)(creadas);
  await empujar(plugin, creadas);
  return creadas;
}

async function lecturasDe(plugin: ServerPlugin, usuario: string): Promise<Map<string, string>> {
  const filas = (await ctrl(plugin, "lecturas").query({ where: { iusuario: usuario } } as never)).map(fila) as { inotificacion: string; fhcre: string }[];
  return new Map(filas.map((l) => [l.inotificacion, l.fhcre]));
}

/** Las últimas `limite` del usuario (propias y para todos), con `leida` resuelta para él, y el contador. */
async function bandeja(plugin: ServerPlugin, usuario: string, limite = 50): Promise<Bandeja> {
  const todas = (await ctrl(plugin, "notificaciones").query({ where: { iusuario: [usuario, TODOS] }, orderBy: ["-fhcre"], pageSize: Math.min(Math.max(limite, 1), 200) } as never)).map(fila) as Notificacion[];
  const leidas = await lecturasDe(plugin, usuario);
  // Lo de `*` que hizo el propio usuario no se le muestra (él publicó la noticia).
  const items = todas.filter((n) => !(n.iusuario === TODOS && n.iactor === usuario)).map((n) => (n.iusuario === TODOS ? { ...n, leida: leidas.get(n.id) ?? null } : n));
  return { items, noLeidas: await noLeidas(plugin, usuario, leidas) };
}

/** Cuántas no ha leído el usuario (propias sin `leida` + para todos sin lectura suya, salvo las que él originó). */
async function noLeidas(plugin: ServerPlugin, usuario: string, leidas?: Map<string, string>): Promise<number> {
  const c = ctrl(plugin, "notificaciones");
  const propias = await c.query({ where: { iusuario: usuario, leida: null }, select: ["id"] } as never);
  const general = (await c.query({ where: { iusuario: TODOS }, select: ["id", "iactor"] } as never)).map(fila) as { id: string; iactor: string | null }[];
  const mias = leidas ?? await lecturasDe(plugin, usuario);
  return propias.length + general.filter((g) => g.iactor !== usuario && !mias.has(g.id)).length;
}

/** Marca leídas unas (`ids`) o todas las del usuario. Solo toca las suyas y las de todos. */
async function leer(plugin: ServerPlugin, usuario: string, input: LeerInput): Promise<{ marcadas: number }> {
  const d = validado<LeerInput>(ZLeer, input ?? {});
  if (!d.todas && !d.ids?.length) throw new ValidationError("Indica `ids` o `todas: true`");
  const c = ctrl(plugin, "notificaciones");
  const lecturas = ctrl(plugin, "lecturas");
  const where: Record<string, unknown> = { iusuario: [usuario, TODOS] };
  if (!d.todas) where["id"] = d.ids;
  const candidatas = (await c.query({ where } as never)).map(fila) as Notificacion[];
  const ya = await lecturasDe(plugin, usuario);
  const ahora = new Date().toISOString();
  let marcadas = 0;
  for (const n of candidatas) {
    if (n.iusuario === TODOS) {
      if (ya.has(n.id) || n.iactor === usuario) continue;
      await lecturas.post(lecturas.pojo({ inotificacion: n.id, iusuario: usuario, fhcre: ahora }));
      marcadas++;
    } else if (!n.leida) {
      await c.put(c.pojo({ id: n.id, leida: ahora }));
      marcadas++;
    }
  }
  return { marcadas };
}

/** Alta (o reactivación) de la suscripción de push de un dispositivo. El id es el hash del endpoint: sin duplicados. */
async function suscribir(plugin: ServerPlugin, usuario: string, input: SuscribirInput): Promise<SuscripcionPush> {
  const d = validado<SuscribirInput>(ZSuscribir, input);
  const c = ctrl(plugin, "suscripciones");
  const id = (await hashHex(d.endpoint)).slice(0, 64);
  const s: SuscripcionPush = { id, iusuario: usuario, canal: d.canal, endpoint: d.endpoint, claves: d.claves ?? null, agente: d.agente ?? null, activa: true, fhcre: new Date().toISOString() };
  const previa = await c.get(c.pojo({ id }), { include: {} } as never);
  if (previa) await c.put(c.pojo(s));
  else await c.post(c.pojo(s));
  return s;
}

/** Baja de la suscripción de ese endpoint (solo si es del usuario). */
async function desuscribir(plugin: ServerPlugin, usuario: string, endpoint: string): Promise<{ bajas: number }> {
  const d = validado<{ endpoint: string }>(ZDesuscribir, { endpoint });
  const c = ctrl(plugin, "suscripciones");
  const filas = (await c.query({ where: { iusuario: usuario, endpoint: d.endpoint, activa: true } } as never)).map(fila) as SuscripcionPush[];
  for (const f of filas) await c.put(c.pojo({ id: f.id, activa: false }));
  return { bajas: filas.length };
}

/** JSON del server de notificaciones: `notificacionesPlugin` + handlers con la sesión + verbos de servidor. */
export const notificacionesServer: ServerPluginDef = Obj.insert(notificacionesPlugin, {
  irregularPaths: {
    bandeja: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Bandeja> {
        return await bandeja(this, usuarioDe(ctx), Number(i.query.get("limite") ?? 50) || 50);
      },
    },
    leer: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<{ marcadas: number }> {
        return await leer(this, usuarioDe(ctx), i.body as LeerInput);
      },
    },
    notificar: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Notificacion[]> {
        usuarioDe(ctx);
        return await notificar(this, i.body as NotificarInput);
      },
    },
    suscribir: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<SuscripcionPush> {
        return await suscribir(this, usuarioDe(ctx), i.body as SuscribirInput);
      },
    },
    desuscribir: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<{ bajas: number }> {
        return await desuscribir(this, usuarioDe(ctx), String((i.body as { endpoint?: unknown } | null)?.endpoint ?? ""));
      },
    },
  },
  /** En el server, los verbos son métodos directos (sin HTTP): sustituyen a los `ops` de cliente. */
  setup(this: ServerPlugin) {
    this["notificar"] = (input: NotificarInput) => notificar(this, input);
    this["bandeja"] = (usuario: string, limite?: number) => bandeja(this, usuario, limite);
    this["leer"] = (usuario: string, input: LeerInput) => leer(this, usuario, input);
    this["noLeidas"] = (usuario: string) => noLeidas(this, usuario);
    this["suscribir"] = (usuario: string, input: SuscribirInput) => suscribir(this, usuario, input);
    this["desuscribir"] = (usuario: string, endpoint: string) => desuscribir(this, usuario, endpoint);
    this["suscripciones"] = (usuario: string) => activasDe(this, [usuario]);
  },
  /** Crea sus tablas y les suma las columnas nuevas (idempotente): sirve también sin router. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
  },
}) as ServerPluginDef;

/** `createServer(notificacionesServer, runtime)` con los verbos tipados (`services.alNotificar` y `enviarPush` opcionales). */
export function crearNotificaciones(runtime: ServerPluginRuntime): ServerPlugin & VerbosNotificaciones {
  return createServer(notificacionesServer, runtime) as ServerPlugin & VerbosNotificaciones;
}
