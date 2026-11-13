/**
 * Plugin de canal para bots (server): publica con el autor de la sesión, versiona ediciones, da de baja lógica,
 * registra reacciones y conserva la ficha de los adjuntos R2 con su caducidad.
 *
 * ```ts
 * const canal = createServer(canalServer, { db, cfg: { ttlAdjuntosSeg: 72 * 60 * 60 } });
 * const router = createRouter(ctrls, { basePath: "/api", plugins: [canal] });
 * ```
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/canal.md
 */
import type { z } from "zod";
import { NotFoundError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { canalPlugin } from "@Jeff-Aporta/DER/src/03-plugins/canal/index.ts";
import { type AdjuntoCanal, type CanalConfig, type EditarCanalInput, type HistorialCanal, type ListarAdjuntosInput, type ListarCanalInput, type MensajeCanal, type PublicarCanalInput, type QuitarReaccionInput, type ReaccionarCanalInput, type ReaccionCanal, type RegistrarAdjuntoInput, ZCanalConfig, ZEditarCanal, ZListarAdjuntos, ZListarCanal, ZPublicarCanal, ZQuitarReaccion, ZReaccionarCanal, ZRegistrarAdjunto } from "@Jeff-Aporta/DER/src/03-plugins/canal/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/canal/index.ts";

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, valor: unknown): T {
  const r = zod.safeParse(valor);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

/** El bot de la sesión; un `de` explícito sólo puede ser el mismo. */
function autorDe(ctx: ServerCtx, declarado?: string | null): string {
  const id = ctx.session?.id ? String(ctx.session.id) : "";
  if (!id) throw new ValidationError("La operación requiere iniciar sesión");
  if (declarado && declarado !== id) throw new ValidationError("El autor debe ser el bot de la sesión");
  return id;
}

/** Fecha ISO de la versión; la externa se conserva y la ausente es la de ahora. */
function versionTs(externa?: string): string {
  return externa ?? new Date().toISOString();
}

/** Comprueba que los adjuntos existan y no hayan vencido. */
async function comprobarAdjuntos(ctrl: ServerController<any>, ids: string[]): Promise<void> {
  for (const id of ids) {
    const fila = await ctrl.get(ctrl.pojo({ idadjunto: id }), { include: {} }) as AdjuntoCanal | null;
    if (!fila) throw new ValidationError(`El adjunto ${id} no existe`);
    if (new Date(fila.fhexpira).getTime() <= Date.now()) throw new ValidationError(`El adjunto ${id} venció`);
  }
}

/** JSON del server del canal: `canalPlugin` más las operaciones propias. */
export const canalServer: ServerPluginDef = Obj.insert(canalPlugin, {
  cfg: ZCanalConfig,
  entities: {
    mensajes: {
      hooks: {
        /** Completa la versión inicial y la fecha si un CRUD las omite. */
        prePost(this: ServerController<any>, m: MensajeCanal, ctx: ServerCtx) {
          if (!m.ts) m.ts = new Date();
          if (!m.de && ctx.session?.id) m.de = String(ctx.session.id);
          if (!m.jcontenido?.length) {
            const ts = m.ts instanceof Date ? m.ts.toISOString() : String(m.ts);
            m.jcontenido = [{ texto: m.texto, ts, adjuntos: m.adjuntos ?? [] }];
          }
          return null;
        },
        /** Un PUT directo con texto nuevo agrega una versión; no pisa el historial. */
        async prePut(this: ServerController<any>, m: MensajeCanal, ctx: ServerCtx) {
          if (Array.isArray(m.jcontenido)) return null;
          const actual = await this.get(this.pojo({ idmensaje: m.idmensaje }), { ...ctx, include: {} }) as MensajeCanal | null;
          if (!actual || actual.texto === m.texto) return null;
          const historial: HistorialCanal = [...(actual.jcontenido ?? []), { texto: m.texto, ts: versionTs(), adjuntos: m.adjuntos ?? actual.adjuntos ?? [] }];
          m.jcontenido = historial;
          return null;
        },
      },
      actions: {
        /** La baja por CRUD es lógica: el mensaje queda con `bactivo` false. */
        async delete(this: ServerController<any>, m: MensajeCanal, ctx: ServerCtx) {
          const actual = await this.get(this.pojo({ idmensaje: m.idmensaje }), { ...ctx, include: {} }) as MensajeCanal | null;
          if (!actual) return null;
          return await this.put(this.pojo({ idmensaje: actual.idmensaje, bactivo: false }), ctx) as MensajeCanal | null;
        },
      },
      indexes: [{ columns: ["canal", "hilo", "ts"], name: "ix_canal_mensajes_hilo_ts" }],
      paths: {
        publicar: {
          /** Publica un mensaje; el autor y la fecha externa son los que se fijan. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<MensajeCanal> {
            const input = validado<PublicarCanalInput>(ZPublicarCanal, i.body);
            const de = autorDe(ctx, input.de);
            const ctrl = this.controllers["mensajes"]!;
            const adjuntos = input.adjuntos ?? [];
            await comprobarAdjuntos(this.controllers["adjuntos"]!, adjuntos);
            if (input.indexcita) {
              const citado = await ctrl.get(ctrl.pojo({ idmensaje: input.indexcita }), { ...ctx, include: {} }) as MensajeCanal | null;
              if (!citado || !citado.bactivo) throw new ValidationError(`El mensaje citado ${input.indexcita} no existe`);
            }
            const ts = versionTs(input.ts);
            const idmensaje = crypto.randomUUID();
            const guardado = await ctrl.post(ctrl.pojo({
              idmensaje,
              canal: input.canal,
              hilo: input.hilo ?? null,
              de,
              texto: input.texto,
              tipo: input.tipo ?? "texto",
              msgorigen: input.msgorigen ?? null,
              ts: new Date(ts),
              jcontenido: [{ texto: input.texto, ts, adjuntos }],
              indexcita: input.indexcita ?? null,
              bactivo: true,
              adjuntos,
            }), ctx) as MensajeCanal;
            const ctrlAdjuntos = this.controllers["adjuntos"]!;
            for (const idadjunto of adjuntos) {
              await ctrlAdjuntos.put(ctrlAdjuntos.pojo({ idadjunto, idmensaje }), ctx);
            }
            return guardado;
          },
        },
        listar: {
          /** Lista los mensajes del canal (y opcionalmente del hilo) desde una marca de tiempo. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<MensajeCanal[]> {
            const input = validado<ListarCanalInput>(ZListarCanal, Object.fromEntries(i.query));
            const where: Record<string, unknown> = { canal: input.canal, bactivo: true };
            if (input.hilo !== undefined) where["hilo"] = input.hilo;
            if (input.desde !== undefined) where["ts"] = { gte: new Date(input.desde) };
            return await this.controllers["mensajes"]!.query({
              where,
              orderBy: "ts",
              pageSize: input.limite ?? 100,
            }, { ...ctx, include: {} }) as MensajeCanal[];
          },
        },
        editar: {
          /** Agrega una versión: el texto anterior nunca se pierde. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<MensajeCanal> {
            const input = validado<EditarCanalInput>(ZEditarCanal, i.body);
            const idmensaje = String(i.pks?.[0] ?? "");
            const ctrl = this.controllers["mensajes"]!;
            const actual = await ctrl.get(ctrl.pojo({ idmensaje }), { ...ctx, include: {} }) as MensajeCanal | null;
            if (!actual || !actual.bactivo) throw new NotFoundError("El mensaje no existe");
            const de = autorDe(ctx);
            if (actual.de !== de) throw new ValidationError("Sólo el autor puede editar el mensaje");
            const adjuntos = input.adjuntos ?? actual.adjuntos ?? [];
            await comprobarAdjuntos(this.controllers["adjuntos"]!, adjuntos);
            const ts = versionTs(input.ts);
            const historial: HistorialCanal = [...(actual.jcontenido ?? []), { texto: input.texto, ts, adjuntos }];
            return await ctrl.put(ctrl.pojo({ idmensaje, texto: input.texto, jcontenido: historial, adjuntos }), ctx) as MensajeCanal;
          },
        },
        eliminar: {
          /** Baja lógica del mensaje. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<MensajeCanal> {
            const idmensaje = String(i.pks?.[0] ?? "");
            const ctrl = this.controllers["mensajes"]!;
            const actual = await ctrl.get(ctrl.pojo({ idmensaje }), { ...ctx, include: {} }) as MensajeCanal | null;
            if (!actual || !actual.bactivo) throw new NotFoundError("El mensaje no existe");
            const de = autorDe(ctx);
            if (actual.de !== de) throw new ValidationError("Sólo el autor puede eliminar el mensaje");
            return await ctrl.put(ctrl.pojo({ idmensaje, bactivo: false }), ctx) as MensajeCanal;
          },
        },
        reacciones: {
          /** Reacciones de un mensaje. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ReaccionCanal[]> {
            const idmensaje = String(i.pks?.[0] ?? "");
            return await this.controllers["reacciones"]!.query({ where: { idmensaje }, pageSize: 200 }, { ...ctx, include: {} }) as ReaccionCanal[];
          },
        },
      },
    },
    reacciones: {
      paths: {
        reaccionar: {
          /** Reacciona o cambia la reacción del bot de la sesión. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ReaccionCanal> {
            const input = validado<ReaccionarCanalInput>(ZReaccionarCanal, i.body);
            const de = autorDe(ctx);
            const ctrl = this.controllers["mensajes"]!;
            const mensaje = await ctrl.get(ctrl.pojo({ idmensaje: input.idmensaje }), { ...ctx, include: {} }) as MensajeCanal | null;
            if (!mensaje || !mensaje.bactivo) throw new NotFoundError("El mensaje no existe");
            const ctrlReaccion = this.controllers["reacciones"]!;
            const claves = { idmensaje: input.idmensaje, de };
            const actual = await ctrlReaccion.get(ctrlReaccion.pojo(claves), { ...ctx, include: {} }) as ReaccionCanal | null;
            const ts = new Date();
            if (actual) return await ctrlReaccion.put(ctrlReaccion.pojo({ ...claves, reaccion: input.reaccion, ts }), ctx) as ReaccionCanal;
            return await ctrlReaccion.post(ctrlReaccion.pojo({ ...claves, reaccion: input.reaccion, ts }), ctx) as ReaccionCanal;
          },
        },
        quitar: {
          /** Quita la reacción del bot de la sesión. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ReaccionCanal | null> {
            const input = validado<QuitarReaccionInput>(ZQuitarReaccion, i.body);
            const de = autorDe(ctx);
            const ctrl = this.controllers["reacciones"]!;
            return await ctrl.delete(ctrl.pojo({ idmensaje: input.idmensaje, de }), ctx) as ReaccionCanal | null;
          },
        },
      },
    },
    adjuntos: {
      paths: {
        registrar: {
          /** Registra la ficha de un objeto ya subido a R2; la caducidad es de 72 horas por defecto. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<AdjuntoCanal> {
            const input = validado<RegistrarAdjuntoInput>(ZRegistrarAdjunto, i.body);
            autorDe(ctx);
            if (input.idmensaje) {
              const mensaje = await this.controllers["mensajes"]!.get(this.controllers["mensajes"]!.pojo({ idmensaje: input.idmensaje }), { ...ctx, include: {} }) as MensajeCanal | null;
              if (!mensaje) throw new ValidationError(`El mensaje ${input.idmensaje} no existe`);
            }
            const ttlSeg = input.ttlSeg ?? (this.cfg as CanalConfig).ttlAdjuntosSeg;
            const ts = new Date();
            const ctrl = this.controllers["adjuntos"]!;
            return await ctrl.post(ctrl.pojo({
              idadjunto: crypto.randomUUID(),
              idmensaje: input.idmensaje ?? null,
              nombre: input.nombre ?? "archivo",
              mime: input.mime,
              bytes: input.bytes,
              clave: input.clave,
              fhexpira: new Date(ts.getTime() + ttlSeg * 1000),
              ts,
            }), ctx) as AdjuntoCanal;
          },
        },
        listar: {
          /** Lista los adjuntos, opcionalmente los de un mensaje. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<AdjuntoCanal[]> {
            const input = validado<ListarAdjuntosInput>(ZListarAdjuntos, Object.fromEntries(i.query));
            const where = input.idmensaje !== undefined ? { idmensaje: input.idmensaje } : {};
            return await this.controllers["adjuntos"]!.query({ where, pageSize: 200 }, { ...ctx, include: {} }) as AdjuntoCanal[];
          },
        },
      },
    },
  },
}) as ServerPluginDef;
