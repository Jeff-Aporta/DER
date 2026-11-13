/**
 * Plugin de canal para bots: el JSON TRANSVERSAL. Un mensaje tiene canal, hilo opcional, autor bot, texto, tipo,
 * mensaje de origen, fecha y versiones; las reacciones y los adjuntos son datos del mismo dominio.
 *
 * ATENCION: las tablas llevan el prefijo `der_canal_*` (`der_canal_mensajes`, `der_canal_reacciones`,
 * `der_canal_adjuntos`) porque el **Worker del estudio** (`estudio-canal`) ya tiene vivo el esquema canonico del
 * canal en `canal_*`. Este plugin es la implementacion de REFERENCIA (para migrar despues, con controllers de DER y
 * sin SQL crudo): la tabla de equivalencias columna a columna y la via de migracion estan en `skills/canal.md` y en
 * `docs/050-Plugins/100-Canal.md`.
 *
 * ```ts
 * const canal = createClient(canalPlugin, { baseUrl: "/api", headers: auth.headers });
 * await canal.publicar({ canal: "ops", texto: "listo" });
 * await canal.listar("ops", undefined, "2026-11-13T10:00:00.000Z");
 * ```
 *
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/canal.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type AdjuntoCanal, type EditarCanalInput, type ListarAdjuntosInput, type MensajeCanal, type PublicarCanalInput, type QuitarReaccionInput, type ReaccionarCanalInput, type ReaccionCanal, type RegistrarAdjuntoInput, ZEditarCanal, ZListarAdjuntos, ZListarCanal, ZPublicarCanal, ZQuitarReaccion, ZReaccionarCanal, ZRegistrarAdjunto } from "@Jeff-Aporta/DER/src/03-plugins/canal/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/canal/schemas.ts";

/** JSON transversal del canal de bots: mensajes, reacciones y adjuntos. */
export const canalPlugin: PluginDef = {
  name: "canal",
  entities: {
    mensajes: {
      name: "der_canal.mensaje",
      singular: "canal/mensaje",
      plural: "canal/mensajes",
      table: "der_canal_mensajes",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          idmensaje: { type: "string", pk: true, length: 64 },
          canal: { type: "string", length: 160, nullable: false },
          hilo: { type: "string", length: 160 },
          de: { type: "string", length: 120, nullable: false },
          texto: { type: "text", nullable: false },
          tipo: { type: "string", length: 40, default: "texto" },
          msgorigen: { type: "string", length: 240 },
          ts: { type: "datetime", nullable: false },
          jcontenido: { type: "json" },
          indexcita: { type: "string", length: 64 },
          bactivo: { type: "bool", default: true },
          adjuntos: { type: "json" },
        },
      },
      listColumns: ["idmensaje", "canal", "hilo", "de", "texto", "tipo", "msgorigen", "ts", "indexcita", "bactivo"],
      paths: {
        publicar: {
          method: "POST",
          path: "publicar",
          prefix: "plural",
          security: "protected",
          zod: ZPublicarCanal,
          returns: "json",
          ops: {
            /** `POST canal/mensajes/publicar`: publica con el autor de la sesión. */
            publicar(this: ClientPlugin, input: PublicarCanalInput): Promise<MensajeCanal> {
              return this.call<MensajeCanal>("publicar", input);
            },
          },
        },
        listar: {
          method: "GET",
          path: "listar",
          prefix: "plural",
          security: "protected",
          zod: ZListarCanal,
          returns: "json",
          ops: {
            /** `GET canal/mensajes/listar?canal=&hilo=&desde=&limite=`: mensajes desde una marca de tiempo. */
            listar(this: ClientPlugin, canal: string, hilo?: string, desde?: string, limite?: number): Promise<MensajeCanal[]> {
              return this.call<MensajeCanal[]>("listar", { canal, ...(hilo !== undefined ? { hilo } : {}), ...(desde !== undefined ? { desde } : {}), ...(limite !== undefined ? { limite } : {}) });
            },
          },
        },
        editar: {
          method: "PUT",
          path: "editar",
          prefix: "singular",
          pks: true,
          security: "protected",
          zod: ZEditarCanal,
          returns: "json",
          ops: {
            /** `PUT canal/mensaje/{idmensaje}/editar`: agrega una versión del mensaje. */
            editar(this: ClientPlugin, idmensaje: string, input: EditarCanalInput): Promise<MensajeCanal> {
              return this.call<MensajeCanal>("editar", input, { idmensaje });
            },
          },
        },
        eliminar: {
          method: "DELETE",
          path: "eliminar",
          prefix: "singular",
          pks: true,
          security: "protected",
          returns: "json",
          ops: {
            /** `DELETE canal/mensaje/{idmensaje}/eliminar`: baja lógica. */
            eliminar(this: ClientPlugin, idmensaje: string): Promise<MensajeCanal> {
              return this.call<MensajeCanal>("eliminar", undefined, { idmensaje });
            },
          },
        },
        reacciones: {
          method: "GET",
          path: "reacciones",
          prefix: "singular",
          pks: true,
          security: "protected",
          returns: "json",
          ops: {
            /** `GET canal/mensaje/{idmensaje}/reacciones`: reacciones del mensaje. */
            reacciones(this: ClientPlugin, idmensaje: string): Promise<ReaccionCanal[]> {
              return this.call<ReaccionCanal[]>("reacciones", undefined, { idmensaje });
            },
          },
        },
      },
    },
    reacciones: {
      name: "der_canal.reaccion",
      singular: "canal/reaccion",
      plural: "canal/reacciones",
      table: "der_canal_reacciones",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          idmensaje: { type: "string", pk: true, length: 64 },
          de: { type: "string", pk: true, length: 120 },
          reaccion: { type: "string", length: 64, nullable: false },
          ts: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["idmensaje", "de", "reaccion", "ts"],
      paths: {
        reaccionar: {
          method: "POST",
          path: "reaccionar",
          prefix: "plural",
          security: "protected",
          zod: ZReaccionarCanal,
          returns: "json",
          ops: {
            /** `POST canal/reacciones/reaccionar`: la reacción pertenece al bot de la sesión. */
            reaccionar(this: ClientPlugin, input: ReaccionarCanalInput): Promise<ReaccionCanal> {
              return this.call<ReaccionCanal>("reaccionar", input);
            },
          },
        },
        quitar: {
          method: "DELETE",
          path: "quitar",
          prefix: "plural",
          security: "protected",
          zod: ZQuitarReaccion,
          returns: "json",
          ops: {
            /** `DELETE canal/reacciones/quitar`: quita la reacción del bot de la sesión. */
            quitar(this: ClientPlugin, input: QuitarReaccionInput): Promise<ReaccionCanal | null> {
              return this.call<ReaccionCanal | null>("quitar", input);
            },
          },
        },
      },
    },
    adjuntos: {
      name: "der_canal.adjunto",
      singular: "canal/adjunto",
      plural: "canal/adjuntos",
      table: "der_canal_adjuntos",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          idadjunto: { type: "string", pk: true, length: 64 },
          idmensaje: { type: "string", length: 64 },
          nombre: { type: "string", length: 300, nullable: false },
          mime: { type: "string", length: 120, nullable: false },
          bytes: { type: "int", nullable: false },
          clave: { type: "string", length: 400, nullable: false },
          fhexpira: { type: "datetime", nullable: false },
          ts: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["idadjunto", "idmensaje", "nombre", "mime", "bytes", "clave", "fhexpira", "ts"],
      paths: {
        registrar: {
          method: "POST",
          path: "registrar",
          prefix: "plural",
          security: "protected",
          zod: ZRegistrarAdjunto,
          returns: "json",
          ops: {
            /** `POST canal/adjuntos/registrar`: ficha de un objeto ya subido a R2. */
            registrar(this: ClientPlugin, input: RegistrarAdjuntoInput): Promise<AdjuntoCanal> {
              return this.call<AdjuntoCanal>("registrar", input);
            },
          },
        },
        listar: {
          method: "GET",
          path: "listar",
          prefix: "plural",
          security: "protected",
          zod: ZListarAdjuntos,
          returns: "json",
          ops: {
            /** `GET canal/adjuntos/listar?idmensaje=`: adjuntos de un mensaje. */
            listar(this: ClientPlugin, input: ListarAdjuntosInput = {}): Promise<AdjuntoCanal[]> {
              return this.call<AdjuntoCanal[]>("listar", input);
            },
          },
        },
      },
    },
  },
};
