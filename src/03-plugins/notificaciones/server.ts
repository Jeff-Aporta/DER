/**
 * Plugin de notificaciones (server): el transversal con las particularidades del servidor.
 *
 * - El destinatario de la bandeja y de `leer` es la sesión (`ctx.session.id`); el front no lo inventa.
 * - `*` = para todos: una sola fila, y la lectura se guarda por usuario en `notificaciones_lecturas`.
 * - Crear (`notificar`) queda tras la puerta `permissions` del consumidor (la ruta es `protected`).
 * - Tiempo real: si el consumidor pasa `services.alNotificar(filas)`, se llama tras crear (SSE, WebSocket…).
 * - Para APIs con rutas propias (sin las puertas del registro), el plugin armado trae los mismos verbos como
 *   métodos de servidor: `plugin.notificar(input)`, `plugin.bandeja(usuario, limite?)`, `plugin.leer(usuario, input)`
 *   y `plugin.noLeidas(usuario)`. Las tablas se crean con `router.seed()` (plugin en `plugins`) o `plugin.seed()`.
 *
 * ```ts
 * const notif = crearNotificaciones({ db, services: { alNotificar: (filas) => emitir(filas) } });   // = createServer(notificacionesServer, …) tipado
 * const router = createRouter(ctrls, { basePath: "/api", plugins: [notif] });
 * await notif.notificar({ destinatarios: ["*"], titulo: "Hay una noticia nueva" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/notificaciones.md
 */
import type { z } from "zod";
import { Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type {
  ExtraRouteInput,
  ServerCtx,
  ServerPlugin,
  ServerPluginDef,
  ServerPluginRuntime,
} from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { randomId } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { notificacionesPlugin } from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/index.ts";
import {
  type Bandeja,
  type LeerInput,
  type Notificacion,
  type NotificarInput,
  TODOS,
  type VerbosNotificaciones,
  ZLeer,
  ZNotificar,
} from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/index.ts";

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

const fila = (
  p: unknown,
): Record<
  string,
  unknown
> => (p && typeof p === "object" && "toJSON" in p && typeof (p as { toJSON: unknown }).toJSON === "function"
  ? (p as { toJSON(): Record<string, unknown> }).toJSON()
  : (p as Record<string, unknown>));

const usuarioDe = (ctx: ServerCtx): string => {
  const u = ctx.session?.id ? String(ctx.session.id) : "";
  if (!u) throw new ValidationError("Las notificaciones requieren iniciar sesión");
  return u;
};

/** Crea una notificación por destinatario y avisa al consumidor (`services.alNotificar`). */
async function notificar(plugin: ServerPlugin, input: NotificarInput): Promise<Notificacion[]> {
  const d = validado<NotificarInput>(ZNotificar, input);
  const ctrl = plugin.controllers["notificaciones"]!;
  const fhcre = new Date().toISOString();
  const creadas: Notificacion[] = [];
  for (const iusuario of [...new Set(d.destinatarios)]) {
    const n = {
      id: randomId(12),
      iusuario,
      titulo: d.titulo,
      texto: d.texto ?? null,
      tipo: d.tipo ?? "info",
      enlace: d.enlace ?? null,
      tdespacio: d.tdespacio ?? null,
      iref: d.iref ?? null,
      leida: null,
      fhcre,
    };
    await ctrl.post(ctrl.pojo(n));
    creadas.push(n);
  }
  const al = plugin.services?.["alNotificar"];
  if (typeof al === "function") await (al as (f: Notificacion[]) => unknown)(creadas);
  return creadas;
}

/** Las últimas `limite` del usuario (propias y para todos), con `leida` resuelta para él, y el contador. */
async function bandeja(plugin: ServerPlugin, usuario: string, limite = 50): Promise<Bandeja> {
  const ctrl = plugin.controllers["notificaciones"]!;
  const lecturas = plugin.controllers["lecturas"]!;
  const todas = (await ctrl.query(
    {
      where: { iusuario: [usuario, TODOS] },
      orderBy: ["-fhcre"],
      pageSize: Math.min(Math.max(limite, 1), 200),
    } as never,
  )).map(fila) as Notificacion[];
  const leidas = new Map(
    ((await lecturas.query({ where: { iusuario: usuario } } as never)).map(fila) as {
      inotificacion: string;
      fhcre: string;
    }[]).map((l) => [l.inotificacion, l.fhcre]),
  );
  const items = todas.map((n) => (n.iusuario === TODOS ? { ...n, leida: leidas.get(n.id) ?? null } : n));
  return { items, noLeidas: await noLeidas(plugin, usuario, leidas) };
}

/** Cuántas no ha leído el usuario (propias sin `leida` + para todos sin lectura suya). */
async function noLeidas(
  plugin: ServerPlugin,
  usuario: string,
  leidas?: Map<string, string>,
): Promise<number> {
  const ctrl = plugin.controllers["notificaciones"]!;
  const propias = await ctrl.query({ where: { iusuario: usuario, leida: null }, select: ["id"] } as never);
  const general = (await ctrl.query({ where: { iusuario: TODOS }, select: ["id"] } as never)).map(fila) as {
    id: string;
  }[];
  const mias = leidas ??
    new Map(
      ((await plugin.controllers["lecturas"]!.query({ where: { iusuario: usuario } } as never)).map(fila) as {
        inotificacion: string;
        fhcre: string;
      }[]).map((l) => [l.inotificacion, l.fhcre]),
    );
  return propias.length + general.filter((g) => !mias.has(g.id)).length;
}

/** Marca leídas unas (`ids`) o todas las del usuario. Solo toca las suyas y las de todos. */
async function leer(plugin: ServerPlugin, usuario: string, input: LeerInput): Promise<{ marcadas: number }> {
  const d = validado<LeerInput>(ZLeer, input ?? {});
  if (!d.todas && !d.ids?.length) throw new ValidationError("Indica `ids` o `todas: true`");
  const ctrl = plugin.controllers["notificaciones"]!;
  const lecturas = plugin.controllers["lecturas"]!;
  const where: Record<string, unknown> = { iusuario: [usuario, TODOS] };
  if (!d.todas) where["id"] = d.ids;
  const candidatas = (await ctrl.query({ where } as never)).map(fila) as Notificacion[];
  const ya = new Set(
    ((await lecturas.query({ where: { iusuario: usuario } } as never)).map(fila) as {
      inotificacion: string;
    }[]).map((l) => l.inotificacion),
  );
  const ahora = new Date().toISOString();
  let marcadas = 0;
  for (const n of candidatas) {
    if (n.iusuario === TODOS) {
      if (ya.has(n.id)) continue;
      await lecturas.post(lecturas.pojo({ inotificacion: n.id, iusuario: usuario, fhcre: ahora }));
      marcadas++;
    } else if (!n.leida) {
      await ctrl.put(ctrl.pojo({ id: n.id, leida: ahora }));
      marcadas++;
    }
  }
  return { marcadas };
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
  },
  /** En el server, los verbos son métodos directos (sin HTTP): sustituyen a los `ops` de cliente. */
  setup(this: ServerPlugin) {
    this["notificar"] = (input: NotificarInput) => notificar(this, input);
    this["bandeja"] = (usuario: string, limite?: number) => bandeja(this, usuario, limite);
    this["leer"] = (usuario: string, input: LeerInput) => leer(this, usuario, input);
    this["noLeidas"] = (usuario: string) => noLeidas(this, usuario);
  },
  /** Crea sus tablas (idempotente): sirve también sin router, para APIs con rutas propias. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) await c.seed();
  },
}) as ServerPluginDef;

/** `createServer(notificacionesServer, runtime)` con los verbos tipados (`services.alNotificar` opcional). */
export function crearNotificaciones(runtime: ServerPluginRuntime): ServerPlugin & VerbosNotificaciones {
  return createServer(notificacionesServer, runtime) as ServerPlugin & VerbosNotificaciones;
}
