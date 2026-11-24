/**
 * Plugin de calificaciones (server): el transversal con las particularidades del servidor.
 *
 * - Quien califica es la sesión; el `iusuario` de la fila es el de la sesión (el front no lo inventa).
 * - No hay borrado: una calificación se cambia (hasta 0, que es neutro) pero nunca se elimina.
 *
 * ```ts
 * const calificaciones = createServer(calificacionesServer, { db, cfg: {} });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/calificaciones.md
 */
import type { z } from "zod";
import { Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { calificacionesPlugin } from "@Jeff-Aporta/DER/src/03-plugins/calificaciones/index.ts";
import { type Calificacion, type CalificarInput, type PaginaCalificadores, type ResumenCalificaciones, type VerbosCalificaciones, ZCalificar } from "@Jeff-Aporta/DER/src/03-plugins/calificaciones/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/calificaciones/index.ts";

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

const plano = <T>(f: unknown): T => ((f && typeof f === "object" && "toJSON" in f ? (f as { toJSON(): unknown }).toJSON() : f) as T);
const sinInclude = { include: {} } as never;

/** Califica (o recalifica) la entidad como `usuario`. */
async function calificar(plugin: ServerPlugin, usuario: string, i: CalificarInput): Promise<Calificacion> {
  const input = validado<CalificarInput>(ZCalificar, i);
  if (!usuario) throw new ValidationError("Calificar requiere iniciar sesión");
  const ctrl = plugin.controllers["calificaciones"]!;
  const claves = { tdespacio: input.tdespacio, iref: input.iref, iusuario: usuario };
  const actual = await ctrl.get(ctrl.pojo(claves), sinInclude);
  return plano<Calificacion>(actual ? await ctrl.put(ctrl.pojo({ ...claves, valor: input.valor })) : await ctrl.post(ctrl.pojo({ ...claves, valor: input.valor })));
}

/** Resumen de varias entidades: cuántos, el promedio y la de `usuario`. */
async function resumen(plugin: ServerPlugin, tdespacio: string, irefs: string[], usuario?: string | null): Promise<Record<string, ResumenCalificaciones>> {
  const out: Record<string, ResumenCalificaciones> = {};
  const sumas: Record<string, number> = {};
  for (const r of irefs) {
    out[r] = { total: 0, promedio: null, mia: null };
    sumas[r] = 0;
  }
  if (!irefs.length) return out;
  const ctrl = plugin.controllers["calificaciones"]!;
  const filas = (await ctrl.query({ where: { tdespacio, iref: irefs.slice(0, 200) }, select: ["iref", "iusuario", "valor"], pageSize: ctrl.entity.maxPageSize }, sinInclude)).map((f) => plano<Calificacion>(f));
  for (const f of filas) {
    const r = out[f.iref] ??= { total: 0, promedio: null, mia: null };
    r.total++;
    sumas[f.iref] = (sumas[f.iref] ?? 0) + Number(f.valor);
    if (usuario && f.iusuario === usuario) r.mia = Number(f.valor);
  }
  for (const [k, r] of Object.entries(out)) r.promedio = r.total ? Math.round(((sumas[k] ?? 0) / r.total) * 10) / 10 : null;
  return out;
}

/** Quién calificó (paginado; no es anónimo). */
async function calificadores(plugin: ServerPlugin, tdespacio: string, iref: string, o: { page?: number; pageSize?: number } = {}): Promise<PaginaCalificadores> {
  const ctrl = plugin.controllers["calificaciones"]!;
  const page = Math.max(1, Math.trunc(Number(o.page ?? 1)) || 1);
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(o.pageSize ?? 20)) || 20));
  const filas = (await ctrl.query({ where: { tdespacio, iref }, select: ["iusuario", "valor"], orderBy: ["iusuario"], pageSize: ctrl.entity.maxPageSize }, sinInclude)).map((f) => plano<Calificacion>(f));
  return { filas: filas.slice((page - 1) * pageSize, page * pageSize).map((f) => ({ iusuario: f.iusuario, valor: Number(f.valor) })), total: filas.length, page, pageSize };
}

/** JSON del server de calificaciones: `calificacionesPlugin` + el autor de la sesión y la regla de no borrar. */
export const calificacionesServer: ServerPluginDef = Obj.insert(calificacionesPlugin, {
  entities: {
    calificaciones: {
      hooks: {
        /** Quien califica es la sesión. */
        prePost(this: ServerController<any>, c: Calificacion, ctx: ServerCtx) {
          if (!c.iusuario && ctx.session?.id) c.iusuario = String(ctx.session.id);
          return null;
        },
        /** En un cambio, la calificación sigue siendo de quien la puso. */
        prePut(this: ServerController<any>, c: Calificacion, ctx: ServerCtx) {
          if (!c.iusuario && ctx.session?.id) c.iusuario = String(ctx.session.id);
          return null;
        },
      },
      actions: {
        /** Las calificaciones no se borran: se cambian (0 = neutro). */
        delete(this: ServerController<any>) {
          throw new ValidationError("Las calificaciones no se borran: ponle 0 (neutro)");
        },
        deleteList(this: ServerController<any>) {
          throw new ValidationError("Las calificaciones no se borran: ponle 0 (neutro)");
        },
      },
      paths: {
        calificar: {
          /** Califica (o recalifica) la entidad: el valor es el de la sesión. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Calificacion> {
            const input = validado<CalificarInput>(ZCalificar, i.body);
            const iusuario = ctx.session?.id ? String(ctx.session.id) : "";
            if (!iusuario) throw new ValidationError("Calificar requiere iniciar sesión");
            const ctrl = this.controllers["calificaciones"]!;
            const claves = { tdespacio: input.tdespacio, iref: input.iref, iusuario };
            const actual = await ctrl.get(ctrl.pojo(claves), { ...ctx, include: {} }) as Calificacion | null;
            if (actual) return await ctrl.put(ctrl.pojo({ ...claves, valor: input.valor }), ctx) as Calificacion;
            return await ctrl.post(ctrl.pojo({ ...claves, valor: input.valor }), ctx) as Calificacion;
          },
        },
      },
    },
  },
  /** En el server, los verbos son métodos directos (sin HTTP). */
  setup(this: ServerPlugin) {
    this["calificar"] = (usuario: string, input: CalificarInput) => calificar(this, usuario, input);
    this["resumen"] = (tdespacio: string, irefs: string[], usuario?: string | null) => resumen(this, tdespacio, irefs, usuario);
    this["calificadores"] = (tdespacio: string, iref: string, opciones?: { page?: number; pageSize?: number }) => calificadores(this, tdespacio, iref, opciones);
  },
  /** Crea sus tablas y les suma las columnas nuevas (idempotente): sirve también sin router. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
  },
}) as ServerPluginDef;

/** `createServer(calificacionesServer, runtime)` con los verbos tipados: calificar, resumen (varias), calificadores. */
export function crearCalificaciones(runtime: ServerPluginRuntime): ServerPlugin & VerbosCalificaciones {
  return createServer(calificacionesServer, runtime) as ServerPlugin & VerbosCalificaciones;
}
