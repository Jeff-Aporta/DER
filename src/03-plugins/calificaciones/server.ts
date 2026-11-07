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
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { calificacionesPlugin } from "@Jeff-Aporta/DER/src/03-plugins/calificaciones/index.ts";
import { type Calificacion, type CalificarInput, ZCalificar } from "@Jeff-Aporta/DER/src/03-plugins/calificaciones/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/calificaciones/index.ts";

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
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
}) as ServerPluginDef;
