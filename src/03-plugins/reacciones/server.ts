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
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { reaccionesPlugin } from "@Jeff-Aporta/DER/src/03-plugins/reacciones/index.ts";
import { type PaginaVotantes, type ReaccionarInput, type ReaccionFila, type ResumenReacciones, type VerbosReacciones, ZReaccionar } from "@Jeff-Aporta/DER/src/03-plugins/reacciones/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/reacciones/index.ts";

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

const plano = <T>(f: unknown): T => ((f && typeof f === "object" && "toJSON" in f ? (f as { toJSON(): unknown }).toJSON() : f) as T);
const sinInclude = { include: {} } as never;

/** Reacciona (o cambia la reacción) de `usuario` sobre la entidad. */
async function reaccionar(plugin: ServerPlugin, usuario: string, i: ReaccionarInput): Promise<ReaccionFila> {
  const input = validado<ReaccionarInput>(ZReaccionar, i);
  if (!usuario) throw new ValidationError("Reaccionar requiere iniciar sesión");
  const ctrl = plugin.controllers["reacciones"]!;
  const claves = { tdespacio: input.tdespacio, iref: input.iref, iusuario: usuario };
  const actual = await ctrl.get(ctrl.pojo(claves), sinInclude);
  return plano<ReaccionFila>(actual ? await ctrl.put(ctrl.pojo({ ...claves, reaccion: input.reaccion })) : await ctrl.post(ctrl.pojo({ ...claves, reaccion: input.reaccion })));
}

/** Retira la reacción de `usuario` (la reacción, a diferencia de la calificación, se puede quitar). */
async function quitar(plugin: ServerPlugin, usuario: string, tdespacio: string, iref: string): Promise<boolean> {
  const ctrl = plugin.controllers["reacciones"]!;
  const claves = { tdespacio, iref, iusuario: usuario };
  if (!(await ctrl.get(ctrl.pojo(claves), sinInclude))) return false;
  await ctrl.delete(ctrl.pojo(claves));
  return true;
}

/** Resumen de VARIAS entidades en una sola consulta: total, por reacción y la de `usuario`. */
async function resumen(plugin: ServerPlugin, tdespacio: string, irefs: string[], usuario?: string | null): Promise<Record<string, ResumenReacciones>> {
  const out: Record<string, ResumenReacciones> = {};
  for (const r of irefs) out[r] = { total: 0, porReaccion: {}, mia: null };
  if (!irefs.length) return out;
  const ctrl = plugin.controllers["reacciones"]!;
  const filas = (await ctrl.query({ where: { tdespacio, iref: irefs.slice(0, 200) }, select: ["iref", "iusuario", "reaccion"], pageSize: ctrl.entity.maxPageSize }, sinInclude)).map((f) => plano<ReaccionFila>(f));
  for (const f of filas) {
    const r = out[f.iref] ??= { total: 0, porReaccion: {}, mia: null };
    r.total++;
    r.porReaccion[String(f.reaccion)] = (r.porReaccion[String(f.reaccion)] ?? 0) + 1;
    if (usuario && f.iusuario === usuario) r.mia = String(f.reaccion);
  }
  return out;
}

/** Quién reaccionó (paginado; opcionalmente solo una reacción): para el modal de votantes. */
async function votantes(plugin: ServerPlugin, tdespacio: string, iref: string, o: { reaccion?: string | null; page?: number; pageSize?: number } = {}): Promise<PaginaVotantes> {
  const ctrl = plugin.controllers["reacciones"]!;
  const page = Math.max(1, Math.trunc(Number(o.page ?? 1)) || 1);
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(o.pageSize ?? 20)) || 20));
  const where: Record<string, unknown> = { tdespacio, iref };
  if (o.reaccion) where["reaccion"] = o.reaccion;
  const filas = (await ctrl.query({ where, select: ["iusuario", "reaccion"], orderBy: ["iusuario"], pageSize: ctrl.entity.maxPageSize }, sinInclude)).map((f) => plano<ReaccionFila>(f));
  return { filas: filas.slice((page - 1) * pageSize, page * pageSize).map((f) => ({ iusuario: f.iusuario, reaccion: String(f.reaccion) })), total: filas.length, page, pageSize };
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
            return await reaccionar(this, ctx.session?.id ? String(ctx.session.id) : "", i.body as ReaccionarInput);
          },
        },
        resumen: {
          /** `?tdespacio=&irefs=a,b,c`: resumen de varias entidades a la vez (la de la sesión en `mia`). */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Record<string, ResumenReacciones>> {
            const irefs = (i.query.get("irefs") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
            return await resumen(this, i.query.get("tdespacio") ?? "", irefs, ctx.session?.id ? String(ctx.session.id) : null);
          },
        },
        votantes: {
          /** `?tdespacio=&iref=&reaccion=&page=&pageSize=`: quién reaccionó (no es anónimo). */
          async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<PaginaVotantes> {
            return await votantes(this, i.query.get("tdespacio") ?? "", i.query.get("iref") ?? "", { reaccion: i.query.get("reaccion"), page: Number(i.query.get("page") ?? 1), pageSize: Number(i.query.get("pageSize") ?? 20) });
          },
        },
      },
    },
  },
  /** En el server, los verbos son métodos directos (sin HTTP): el consumidor pone su sesión delante. */
  setup(this: ServerPlugin) {
    this["reaccionar"] = (usuario: string, input: ReaccionarInput) => reaccionar(this, usuario, input);
    this["quitar"] = (usuario: string, tdespacio: string, iref: string) => quitar(this, usuario, tdespacio, iref);
    this["resumen"] = (tdespacio: string, irefs: string[], usuario?: string | null) => resumen(this, tdespacio, irefs, usuario);
    this["votantes"] = (tdespacio: string, iref: string, opciones?: { reaccion?: string | null; page?: number; pageSize?: number }) => votantes(this, tdespacio, iref, opciones);
  },
  /** Crea sus tablas y les suma las columnas nuevas (idempotente): sirve también sin router. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
  },
}) as ServerPluginDef;

/** `createServer(reaccionesServer, runtime)` con los verbos tipados: reaccionar, quitar, resumen (varias), votantes. */
export function crearReacciones(runtime: ServerPluginRuntime): ServerPlugin & VerbosReacciones {
  return createServer(reaccionesServer, runtime) as ServerPlugin & VerbosReacciones;
}
