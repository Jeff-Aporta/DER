/**
 * index.ts — el plugin JSON del canal propio: el ESQUEMA CANONICO del canal (las mismas tablas `canal_*` que tenia
 * D1 en el Worker `estudio-canal`) y las rutas del protocolo (las mismas que usaban los bots).
 *
 * - Las tablas son `canal_canales`, `canal_mensajes`, `canal_reacciones`, `canal_presencia` y `canal_adjuntos`.
 * - Los indices importan: `(canal, fhcre)` en los mensajes (el listado del canal), `(idmensaje)` en las reacciones y
 *   `(canal)` en los adjuntos.
 * - Las entidades van `exposed: false`: las rutas las define el protocolo (no el CRUD generico), igual que en el Worker.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/canal.md
 */
import type { PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/protocolo.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/schemas.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/almacen.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/realtime.ts";

/** El plugin del canal propio: el esquema canonico y las rutas del protocolo. */
export const canalVpsPlugin: PluginDef = {
  name: "canal-vps",
  entities: {
    canales: {
      name: "canal.canal",
      singular: "canal",
      plural: "canales",
      table: "canal_canales",
      exposed: false,
      administrable: true,
      schema: {
        columns: {
          canal: { type: "string", length: 60, pk: true },
          nombre: { type: "string", length: 120, nullable: false },
          descripcion: { type: "string", length: 300 },
          ambito: { type: "string", length: 40 },
          activo: { type: "bool", default: true },
          creado: { type: "datetime" },
          creadoPor: { type: "string", length: 120 },
        },
      },
      listColumns: ["canal", "nombre", "ambito", "activo", "creado"],
    },
    mensajes: {
      name: "canal.mensaje",
      singular: "mensaje",
      plural: "mensajes",
      table: "canal_mensajes",
      exposed: false,
      administrable: true,
      schema: {
        columns: {
          idmensaje: { type: "string", length: 40, pk: true },
          canal: { type: "string", length: 60, nullable: false },
          autor: { type: "string", length: 120, nullable: false },
          tipo: { type: "string", length: 30, default: "texto" },
          texto: { type: "text" },
          adjuntos: { type: "json" },
          para: { type: "json" },
          fhcre: { type: "datetime" },
          fhmod: { type: "datetime" },
          borrado: { type: "bool", default: false },
          caduca: { type: "datetime" },
          jmeta: { type: "json" },
        },
      },
      listColumns: ["idmensaje", "canal", "autor", "tipo", "fhcre", "borrado", "caduca"],
    },
    reacciones: {
      name: "canal.reaccion",
      singular: "reaccion",
      plural: "reacciones",
      table: "canal_reacciones",
      exposed: false,
      administrable: true,
      schema: {
        columns: {
          idreaccion: { type: "string", length: 40, pk: true },
          idmensaje: { type: "string", length: 40, nullable: false },
          bot: { type: "string", length: 120, nullable: false },
          emoji: { type: "string", length: 24, nullable: false },
          fhcre: { type: "datetime" },
        },
      },
      listColumns: ["idreaccion", "idmensaje", "bot", "emoji", "fhcre"],
    },
    presencias: {
      name: "canal.presencia",
      singular: "presencia",
      plural: "presencias",
      table: "canal_presencia",
      exposed: false,
      administrable: true,
      schema: {
        columns: {
          bot: { type: "string", length: 120, pk: true },
          canal: { type: "string", length: 60, pk: true },
          estado: { type: "string", length: 20, default: "conectado" },
          nodo: { type: "string", length: 60 },
          fhconexion: { type: "datetime" },
          fhultimo: { type: "datetime" },
        },
      },
      listColumns: ["bot", "canal", "estado", "nodo", "fhconexion", "fhultimo"],
    },
    adjuntos: {
      name: "canal.adjunto",
      singular: "adjunto",
      plural: "adjuntos",
      table: "canal_adjuntos",
      exposed: false,
      administrable: true,
      schema: {
        columns: {
          idadjunto: { type: "string", length: 40, pk: true },
          nombre: { type: "string", length: 200, nullable: false },
          mime: { type: "string", length: 120 },
          bytes: { type: "int" },
          clave: { type: "string", length: 400 },
          canal: { type: "string", length: 60 },
          propietario: { type: "string", length: 120 },
          fhcre: { type: "datetime" },
          caduca: { type: "datetime" },
          estado: { type: "string", length: 20, default: "vivo" },
        },
      },
      listColumns: [
        "idadjunto",
        "nombre",
        "mime",
        "bytes",
        "canal",
        "propietario",
        "fhcre",
        "caduca",
        "estado",
      ],
    },
  },
  irregularPaths: {
    salud: { method: "GET", path: "salud", security: "public" },
    protocolo: { method: "GET", path: "protocolo", security: "public" },
    instalar: { method: "POST", path: "instalar", security: "protected" },
    canales: { method: "GET", path: "canales", security: "protected" },
    crearCanal: { method: "POST", path: "canales", security: "protected" },
    mensajes: { method: "GET", path: "mensajes", security: "protected" },
    publicarMensaje: { method: "POST", path: "mensajes", security: "protected" },
    verMensaje: { method: "GET", path: "mensajes/{idmensaje}", security: "protected" },
    editarMensaje: { method: "PATCH", path: "mensajes/{idmensaje}", security: "protected" },
    bajaMensaje: { method: "DELETE", path: "mensajes/{idmensaje}", security: "protected" },
    reaccionar: { method: "POST", path: "reacciones", security: "protected" },
    reacciones: { method: "GET", path: "reacciones", security: "protected" },
    presencia: { method: "GET", path: "presencia", security: "protected" },
    latido: { method: "POST", path: "presencia/latido", security: "protected" },
    subirArchivo: { method: "POST", path: "archivos", security: "protected" },
    archivos: { method: "GET", path: "archivos", security: "protected" },
    descargarArchivo: { method: "GET", path: "archivos/{idadjunto}", security: "protected" },
    firmaArchivo: { method: "GET", path: "archivos/{idadjunto}/firma", security: "protected" },
    descargarFirmado: { method: "GET", path: "archivos/{idadjunto}/descarga", security: "public" },
  },
};
