/**
 * Plugin de mensajes: el JSON TRANSVERSAL. El sistema de conversación que toda entidad puede usar (tiquetes,
 * comentarios de un video, mensajes privados, reseñas de un producto…): el DER es el mismo y lo que cambia es el
 * componente y las reglas del controlador.
 *
 *   mensajes_mensajes (tdespacio, iref, imensaje, jcontenido, indexcita, bactivo, iusuario)
 *   mensajes_adjuntos (iadjunto, nombre, mime, bytes, clave, url, fhcre, iusuario, jmeta)
 *
 * El `imensaje` es el índice en el hilo (`0`, `1`, `10.0`, `10.0.1`…) y el `jcontenido` el historial de versiones
 * (la última es la vigente). Las llaves son abiertas: no hay FK, el sistema mantiene la coherencia.
 *
 * ```ts
 * const mensajes = createClient(mensajesPlugin, { baseUrl: "/api", headers: auth.headers });
 * const fila = await mensajes.publicar({ tdespacio: "tks", iref: "42", contenido: "Voy en camino" });
 * await mensajes.hilo("tks", "42");
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/mensajes.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { COLUMNAS_ESPACIO, COLUMNAS_MENSAJE } from "@Jeff-Aporta/DER/src/03-plugins/common/social.ts";
import { type Adjunto, type EditarMensajeInput, type Mensaje, type MensajeNodo, type PublicarMensajeInput, ZEditarMensaje, ZPublicarMensaje } from "@Jeff-Aporta/DER/src/03-plugins/mensajes/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/mensajes/schemas.ts";

/** JSON transversal de mensajes: la entidad `mensajes` (con su hilo) y la de `adjuntos` (fichas de R2). */
export const mensajesPlugin: PluginDef = {
  name: "mensajes",
  entities: {
    mensajes: {
      name: "mensajes.mensaje",
      singular: "mensaje",
      plural: "mensajes",
      table: "mensajes_mensajes",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          ...COLUMNAS_ESPACIO,
          ...COLUMNAS_MENSAJE,
          qtotalrespuestas: { type: "int", virtual: true },
        },
      },
      listColumns: ["tdespacio", "iref", "imensaje", "indexcita", "bactivo", "iusuario"],
      paths: {
        publicar: {
          method: "POST",
          path: "publicar",
          prefix: "plural",
          zod: ZPublicarMensaje,
          returns: "json",
          ops: {
            /** `POST mensajes/publicar`: publica un mensaje; el servidor calcula el índice siguiente del hilo. */
            publicar(this: ClientPlugin, input: PublicarMensajeInput): Promise<Mensaje> {
              return this.call<Mensaje>("publicar", input);
            },
          },
        },
        editar: {
          method: "PUT",
          path: "editar",
          prefix: "singular",
          pks: true,
          zod: ZEditarMensaje,
          returns: "json",
          ops: {
            /** `PUT mensaje/{tdespacio}/{iref}/{imensaje}/editar`: agrega una versión; lo anterior se conserva. */
            editar(this: ClientPlugin, tdespacio: string, iref: string, imensaje: string, input: EditarMensajeInput): Promise<Mensaje> {
              return this.call<Mensaje>("editar", input, { tdespacio, iref, imensaje });
            },
          },
        },
        hilo: {
          method: "GET",
          path: "hilo",
          prefix: "plural",
          returns: "json",
          ops: {
            /** `GET mensajes/hilo?tdespacio=&iref=`: el hilo completo en árbol (primer nivel y respuestas). */
            hilo(this: ClientPlugin, tdespacio: string, iref: string): Promise<MensajeNodo[]> {
              return this.call<MensajeNodo[]>("hilo", { tdespacio, iref });
            },
          },
        },
      },
    },
    adjuntos: {
      name: "mensajes.adjunto",
      singular: "adjunto",
      plural: "adjuntos",
      table: "mensajes_adjuntos",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          iadjunto: { type: "string", pk: true, length: 64 },
          nombre: { type: "string", length: 300, nullable: false },
          mime: { type: "string", length: 120 },
          bytes: { type: "int" },
          clave: { type: "string", length: 400 },
          url: { type: "string", length: 1000 },
          fhcre: { type: "datetime" },
          iusuario: { type: "string", length: 120 },
          jmeta: { type: "json" },
        },
      },
      listColumns: ["iadjunto", "nombre", "mime", "bytes", "fhcre", "iusuario"],
      paths: {
        registrarAdjunto: {
          method: "POST",
          path: "registrar",
          prefix: "plural",
          returns: "json",
          ops: {
            /** `POST adjuntos/registrar`: ficha de un adjunto ya subido al almacén (R2); devuelve el id. */
            registrarAdjunto(this: ClientPlugin, adjunto: { nombre: string; mime?: string | null | undefined; bytes?: number | null | undefined; clave?: string | null | undefined; url?: string | null | undefined }): Promise<Adjunto> {
              return this.call<Adjunto>("registrarAdjunto", adjunto);
            },
          },
        },
      },
    },
  },
};
