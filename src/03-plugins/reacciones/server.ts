/**
 * Plugin de reacciones (server): el transversal con las particularidades del servidor.
 *
 * - Quien reacciona es la sesión; el `iusuario` de la fila es el de la sesión (el front no lo inventa).
 * - La reacción se puede retirar (borrar la fila): a diferencia de la calificación, no es un voto permanente.
 *
 * ```ts
 * const reacciones = createServer(reaccionesServer, { db, cfg: {} });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/reacciones.md
 */
import type { z } from "zod";
import { Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { reaccionesPlugin } from "@Jeff-Aporta/DER/src/03-plugins/reacciones/index.ts";
import { type ReaccionarInput, type ReaccionFila, ZReaccionar } from "@Jeff-Aporta/DER/src/03-plugins/reacciones/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/reacciones/index.ts";

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

/** JSON del server de reacciones: `reaccionesPlugin` + el autor de la sesión. */
export const reaccionesServer: ServerPluginDef = Obj.insert(reaccionesPlugin, {
  entities: {
    reacciones: {
      hooks: {
        /** Quien reacciona es la sesión. */
        prePost(this: ServerController<any>, r: ReaccionFila, ctx: ServerCtx) {
          if (!r.iusuario && ctx.session?.id) r.iusuario = String(ctx.session.id);
          return null;
        },
        /** En un cambio, la reacción sigue siendo de quien la puso. */
        prePut(this: ServerController<any>, r: ReaccionFila, ctx: ServerCtx) {
          if (!r.iusuario && ctx.session?.id) r.iusuario = String(ctx.session.id);
          return null;
        },
      },
      paths: {
        reaccionar: {
          /** Reacciona (o cambia la reacción) sobre la entidad: la reacción es de la sesión. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ReaccionFila> {
            const input = validado<ReaccionarInput>(ZReaccionar, i.body);
            const iusuario = ctx.session?.id ? String(ctx.session.id) : "";
            if (!iusuario) throw new ValidationError("Reaccionar requiere iniciar sesión");
            const ctrl = this.controllers["reacciones"]!;
            const claves = { tdespacio: input.tdespacio, iref: input.iref, iusuario };
            const actual = await ctrl.get(ctrl.pojo(claves), { ...ctx, include: {} }) as ReaccionFila | null;
            if (actual) return await ctrl.put(ctrl.pojo({ ...claves, reaccion: input.reaccion }), ctx) as ReaccionFila;
            return await ctrl.post(ctrl.pojo({ ...claves, reaccion: input.reaccion }), ctx) as ReaccionFila;
          },
        },
      },
    },
  },
}) as ServerPluginDef;
