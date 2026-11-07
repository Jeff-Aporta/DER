/**
 * Plugin de mensajes (server): el transversal con las particularidades del servidor.
 *
 * - `publicar` calcula el índice siguiente del hilo (el hijo libre de la cita) y guarda la primera versión.
 * - `editar` agrega una versión al historial: lo anterior nunca se pierde (la última es la vigente).
 * - `hilo` devuelve el árbol del hilo (primer nivel y respuestas anidadas).
 * - La baja es lógica: `DELETE` marca `bactivo` false y la fila se conserva.
 * - `qtotalrespuestas` cuenta las respuestas anidadas de cada mensaje (columna virtual).
 *
 * ```ts
 * const mensajes = createServer(mensajesServer, { db, cfg: {} });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/mensajes.md
 */
import type { z } from "zod";
import { NotFoundError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { ContenidoMensaje, VersionMensaje } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";
import { compararIndices, indiceHijo, indicePadre, segmentosIndice } from "@Jeff-Aporta/DER/src/03-plugins/common/social.ts";
import { mensajesPlugin } from "@Jeff-Aporta/DER/src/03-plugins/mensajes/index.ts";
import { type Adjunto, type AdjuntoInput, type EditarMensajeInput, type Mensaje, type MensajeNodo, type PublicarMensajeInput, ZAdjuntoInput, ZEditarMensaje, ZPublicarMensaje } from "@Jeff-Aporta/DER/src/03-plugins/mensajes/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/mensajes/index.ts";

/** Métrica: cuántas respuestas anidadas tiene un mensaje (las que cuelgan de su índice). */
const SQL_RESPUESTAS = {
  sqlite: "(select count(*) from mensajes_mensajes m where m.tdespacio = {tdespacio} and m.iref = {iref} and m.imensaje like {imensaje} || '.%')",
  pg: "(select count(*) from mensajes_mensajes m where m.tdespacio = {tdespacio} and m.iref = {iref} and m.imensaje like {imensaje} || '.%')",
  mysql: "(select count(*) from mensajes_mensajes m where m.tdespacio = {tdespacio} and m.iref = {iref} and m.imensaje like concat({imensaje}, '.%'))",
  mssql: "(select count(*) from mensajes_mensajes m where m.tdespacio = {tdespacio} and m.iref = {iref} and m.imensaje like {imensaje} + '.%')",
};

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

/** Las filas del hilo (espacio + referencia), en el orden del índice. */
async function filasDelHilo(ctrl: ServerController<any>, tdespacio: string, iref: string, ctx: Partial<ServerCtx>): Promise<Mensaje[]> {
  const filas = await ctrl.query({ where: { tdespacio, iref }, pageSize: ctrl.entity.maxPageSize }, { ...ctx, include: {} }) as Mensaje[];
  return [...filas].sort((a, b) => compararIndices(String(a.imensaje), String(b.imensaje)));
}

/** El índice siguiente: el primer nivel usa 0, 1, 2… y una respuesta cuelga del padre (10 → 10.0, 10.1…). */
async function siguienteIndice(ctrl: ServerController<any>, tdespacio: string, iref: string, padre: string | null, ctx: Partial<ServerCtx>): Promise<string> {
  const filas = await filasDelHilo(ctrl, tdespacio, iref, ctx);
  const nivel = padre ? segmentosIndice(padre).length : 0;
  let mayor = -1;
  for (const f of filas) {
    const segs = segmentosIndice(String(f.imensaje));
    if (segs.length !== nivel + 1) continue;
    if (padre && segs.slice(0, nivel).join(".") !== padre) continue;
    mayor = Math.max(mayor, segs[nivel] ?? 0);
  }
  return indiceHijo(padre, mayor + 1);
}

/** Normaliza el contenido: un texto suelto se convierte en la primera versión del historial. */
function historialDe(valor: unknown, adjuntos: string[] = []): ContenidoMensaje {
  const ahora = new Date().toISOString();
  if (typeof valor === "string") return [{ contenido: valor, fhcre: ahora, adjuntos }];
  if (Array.isArray(valor)) return valor.map((v) => (typeof v === "string" ? { contenido: v, fhcre: ahora, adjuntos: [] } : v as VersionMensaje));
  return [];
}

/** JSON del server de mensajes: `mensajesPlugin` + el hilo, las versiones y los adjuntos. */
export const mensajesServer: ServerPluginDef = Obj.insert(mensajesPlugin, {
  entities: {
    mensajes: {
      hooks: {
        /** Un texto suelto se guarda como la primera versión del historial. */
        prePost(this: ServerController<any>, m: Mensaje) {
          if (typeof m.jcontenido === "string") m.jcontenido = historialDe(m.jcontenido);
          if (!m.jcontenido?.length) return "Falta el contenido del mensaje";
          return null;
        },
        /** Editar por CRUD: si llega un texto, se agrega como versión nueva (lo anterior se conserva). */
        async prePut(this: ServerController<any>, m: Mensaje, ctx: ServerCtx) {
          if (typeof m.jcontenido !== "string") return null;
          const actual = await this.get(this.pojo({ tdespacio: m.tdespacio, iref: m.iref, imensaje: m.imensaje }), { ...ctx, include: {} }) as Mensaje | null;
          const previo = actual?.jcontenido ?? [];
          m.jcontenido = [...previo, ...historialDe(m.jcontenido)];
          return null;
        },
      },
      actions: {
        /** La baja es lógica: el mensaje se oculta (`bactivo` false) y la fila se conserva. */
        async delete(this: ServerController<any>, m: Mensaje, ctx: ServerCtx) {
          const claves = { tdespacio: m.tdespacio, iref: m.iref, imensaje: m.imensaje };
          const actual = await this.get(this.pojo(claves), { ...ctx, include: {} }) as Mensaje | null;
          if (!actual) return null;
          return await this.put(this.pojo({ ...claves, bactivo: false }), ctx) as Mensaje | null;
        },
      },
      computed: { qtotalrespuestas: SQL_RESPUESTAS },
      indexes: [{ columns: ["tdespacio", "iref"], name: "ix_mensajes_hilo" }],
      paths: {
        publicar: {
          /** Publica un mensaje: el servidor calcula el índice siguiente del hilo. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Mensaje> {
            const input = validado<PublicarMensajeInput>(ZPublicarMensaje, i.body);
            const ctrl = this.controllers["mensajes"]!;
            const padre = input.indexcita ?? null;
            const imensaje = await siguienteIndice(ctrl, input.tdespacio, input.iref, padre, ctx);
            return await ctrl.post(ctrl.pojo({
              tdespacio: input.tdespacio,
              iref: input.iref,
              imensaje,
              jcontenido: [{ contenido: input.contenido, fhcre: new Date().toISOString(), adjuntos: input.adjuntos ?? [] }],
              indexcita: padre,
              bactivo: true,
              iusuario: ctx.session?.id ? String(ctx.session.id) : null,
            }), ctx) as Mensaje;
          },
        },
        editar: {
          /** Agrega una versión al historial del mensaje. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Mensaje> {
            const input = validado<EditarMensajeInput>(ZEditarMensaje, i.body);
            const pks = i.pks ?? [];
            const tdespacio = String(pks[0] ?? "");
            const iref = String(pks[1] ?? "");
            const imensaje = String(pks[2] ?? "");
            const ctrl = this.controllers["mensajes"]!;
            const actual = await ctrl.get(ctrl.pojo({ tdespacio, iref, imensaje }), { ...ctx, include: {} }) as Mensaje | null;
            if (!actual) throw new NotFoundError("El mensaje no existe");
            const historial: ContenidoMensaje = [...(actual.jcontenido ?? []), { contenido: input.contenido, fhcre: new Date().toISOString(), adjuntos: input.adjuntos ?? [] }];
            return await ctrl.put(ctrl.pojo({ tdespacio, iref, imensaje, jcontenido: historial }), ctx) as Mensaje;
          },
        },
        hilo: {
          /** El hilo completo en árbol: el primer nivel y las respuestas anidadas. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<MensajeNodo[]> {
            const tdespacio = i.query.get("tdespacio") ?? "";
            const iref = i.query.get("iref") ?? "";
            if (!tdespacio || !iref) throw new ValidationError("Faltan tdespacio o iref");
            const ctrl = this.controllers["mensajes"]!;
            const filas = await filasDelHilo(ctrl, tdespacio, iref, ctx);
            const nodos = new Map<string, MensajeNodo>();
            for (const f of filas) {
              const datos = (f as unknown as { toJSON(): Mensaje }).toJSON();
              nodos.set(String(datos.imensaje), { ...datos, hijos: [] });
            }
            const raices: MensajeNodo[] = [];
            for (const nodo of nodos.values()) {
              const padre = indicePadre(nodo.imensaje);
              const contenedor = padre ? nodos.get(padre) : undefined;
              if (contenedor) contenedor.hijos.push(nodo);
              else raices.push(nodo);
            }
            return raices;
          },
        },
      },
    },
    adjuntos: {
      hooks: {
        /** La fecha de alta la pone el servidor. */
        prePost(this: ServerController<any>, a: Adjunto, ctx: ServerCtx) {
          if (!a.fhcre) a.fhcre = new Date();
          if (!a.iusuario && ctx.session?.id) a.iusuario = String(ctx.session.id);
          return null;
        },
      },
      paths: {
        registrarAdjunto: {
          /** Ficha de un adjunto ya subido al almacén del consumidor (R2): el plugin no mueve bytes. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Adjunto> {
            const input = validado<AdjuntoInput>(ZAdjuntoInput, i.body);
            const ctrl = this.controllers["adjuntos"]!;
            return await ctrl.post(ctrl.pojo({
              iadjunto: crypto.randomUUID(),
              nombre: input.nombre,
              mime: input.mime ?? null,
              bytes: input.bytes ?? null,
              clave: input.clave ?? null,
              url: input.url ?? null,
              fhcre: new Date(),
              iusuario: ctx.session?.id ? String(ctx.session.id) : null,
              jmeta: input.jmeta ?? null,
            }), ctx) as Adjunto;
          },
        },
      },
    },
  },
}) as ServerPluginDef;
