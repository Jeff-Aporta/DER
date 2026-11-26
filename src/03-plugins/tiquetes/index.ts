/**
 * Plugin de tiquetes: el JSON TRANSVERSAL de la entidad ABSTRACTA del sistema. Un tiquete sirve para pedidos, entregas,
 * reservas y solicitudes segun el TIPO DE EMPRESA; el catalogo de tipos y de campos es declarativo (JSON por empresa).
 *
 *   tiquetes_tiquetes  (id, iempresa, tipo, estado, titulo, descripcion, datos, fcha, fchaFin, prioridad, iusuarioCreador, iusuarioAsignado, ichat, iexterno, fhcre, fhact, bactivo)
 *   tiquetes_tipos     (iempresa, tipo, nombre, descripcion, estados, cierran, campos, bactivo, fhcre, fhact)
 *   tiquetes_eventos   (id, iempresa, itiquete, clase, estadoAnterior, estado, iusuario, texto, datos, fhcre)
 *
 * CRUD, asignar/adoptar (el WRKR toma el tiquete), cambiar estado, comentar, listar con filtros y aislamiento por empresa.
 * Rutas del BOT: crear desde una conversacion (`ichat`), consultar y actualizar su estado, y clasificar un reporte.
 *
 * ```ts
 * const tq = createClient(tiquetesPlugin, { baseUrl: "/api", headers: auth.headers });
 * const pedido = await tq.crearTiquete({ tipo: "pedido", titulo: "Domicilio 310", datos: { direccion: "Calle 1", platos: ["Bandeja"] } });
 * await tq.adoptarTiquete(pedido.id);
 * await tq.cambiarEstado(pedido.id, { estado: "en_proceso" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/tiquetes.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type AsignarInput, type ChatTiquetes, type Clasificacion, type ClasificarInput, type ComentarInput, type DesdeChatInput, type DetalleTiquete, type EstadoChatInput, type EstadoInput, type EventoTiquete, type ListaFiltros, type PaginaTiquetes, type Tiquete, type TiqueteCambio, type TiqueteInput, type TipoTiqueteFila, type TipoTiqueteInput, ZAsignar, ZClasificar, ZComentar, ZDesdeChat, ZEstado, ZEstadoChat, ZTiqueteCambio, ZTiqueteInput, ZTipoCatalogoTiquete } from "@Jeff-Aporta/DER/src/03-plugins/tiquetes/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/tiquetes/schemas.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/tiquetes/clasificacion.ts";

/** Quita las claves vacias (una query `?x=undefined` romperia el filtro) y vuelve texto el resto. */
function limpio(q: object | undefined): Record<string, string> | undefined {
  if (!q) return undefined;
  const e = Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return e.length ? Object.fromEntries(e.map(([k, v]) => [k, String(v)])) : undefined;
}

/** JSON transversal de tiquetes: la entidad abstracta con sus rutas (CRUD, estados, historial, catalogo y bot). */
export const tiquetesPlugin: PluginDef = {
  name: "tiquetes",
  entities: {
    tiquetes: {
      name: "tiquetes.tiquete",
      singular: "tiquetes_tiquete",
      plural: "tiquetes_tiquetes",
      table: "tiquetes_tiquetes",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          tipo: { type: "string", length: 40, nullable: false },
          estado: { type: "string", enum: ["nuevo", "asignado", "en_proceso", "esperando", "listo", "entregado", "cerrado", "cancelado"], nullable: false, default: "nuevo" },
          titulo: { type: "string", length: 200, nullable: false },
          descripcion: { type: "text", nullable: true },
          datos: { type: "json", nullable: true },
          fcha: { type: "datetime", nullable: false },
          fchaFin: { type: "datetime", nullable: true },
          prioridad: { type: "string", enum: ["baja", "media", "alta", "urgente"], nullable: false, default: "media" },
          iusuarioCreador: { type: "string", length: 120, nullable: false },
          iusuarioAsignado: { type: "string", length: 120, nullable: true },
          ichat: { type: "string", length: 40, nullable: true },
          iexterno: { type: "string", length: 200, nullable: true },
          fhcre: { type: "datetime", nullable: false },
          fhact: { type: "datetime", nullable: true },
          bactivo: { type: "bool", default: true },
        },
      },
      listColumns: ["id", "iempresa", "tipo", "estado", "titulo", "prioridad", "iusuarioAsignado", "fcha", "fhcre"],
    },
    tipos: {
      name: "tiquetes.tipo",
      singular: "tiquetes_tipo",
      plural: "tiquetes_tipos",
      table: "tiquetes_tipos",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          iempresa: { type: "string", pk: true, length: 40 },
          tipo: { type: "string", pk: true, length: 40 },
          nombre: { type: "string", length: 160, nullable: false },
          descripcion: { type: "text", nullable: true },
          estados: { type: "json", nullable: true },
          cierran: { type: "json", nullable: true },
          campos: { type: "json", nullable: true },
          bactivo: { type: "bool", default: true },
          fhcre: { type: "datetime", nullable: false },
          fhact: { type: "datetime", nullable: true },
        },
      },
      listColumns: ["iempresa", "tipo", "nombre", "bactivo"],
    },
    eventos: {
      name: "tiquetes.evento",
      singular: "tiquetes_evento",
      plural: "tiquetes_eventos",
      table: "tiquetes_eventos",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          itiquete: { type: "string", length: 40, nullable: false },
          clase: { type: "string", length: 40, nullable: false },
          estadoAnterior: { type: "string", length: 40, nullable: true },
          estado: { type: "string", length: 40, nullable: true },
          iusuario: { type: "string", length: 120, nullable: true },
          texto: { type: "text", nullable: true },
          datos: { type: "json", nullable: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["id", "iempresa", "itiquete", "clase", "estado", "fhcre"],
    },
  },
  irregularPaths: {
    listarTiquetes: {
      method: "GET",
      path: "tiquetes",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET tiquetes?estado=&tipo=&asignado=mi|usuario&sinAsignar=&desde=&hasta=&q=&page=&pageSize=`: la pagina filtrada de la empresa. */
        listarTiquetes(this: ClientPlugin, filtros?: ListaFiltros): Promise<PaginaTiquetes> {
          return this.call<PaginaTiquetes>("listarTiquetes", limpio(filtros));
        },
      },
    },
    crearTiquete: {
      method: "POST",
      path: "tiquetes",
      security: "protected",
      zod: ZTiqueteInput,
      returns: "json",
      ops: {
        /** `POST tiquetes`: crea un tiquete (los defaults los pone el servidor: estado, prioridad, fecha y autor). */
        crearTiquete(this: ClientPlugin, input: TiqueteInput): Promise<Tiquete> {
          return this.call<Tiquete>("crearTiquete", input);
        },
      },
    },
    detalleTiquete: {
      method: "GET",
      path: "tiquetes/{id}",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET tiquetes/{id}`: el tiquete y su historial de eventos, en orden de llegada. */
        detalleTiquete(this: ClientPlugin, id: string): Promise<DetalleTiquete> {
          return this.call<DetalleTiquete>("detalleTiquete", undefined, { id });
        },
      },
    },
    cambiarTiquete: {
      method: "PUT",
      path: "tiquetes/{id}",
      security: "protected",
      zod: ZTiqueteCambio,
      returns: "json",
      ops: {
        /** `PUT tiquetes/{id}`: cambia titulo, descripcion, datos, fechas, prioridad o responsable (el estado va por su ruta). */
        cambiarTiquete(this: ClientPlugin, id: string, cambio: TiqueteCambio): Promise<Tiquete> {
          return this.call<Tiquete>("cambiarTiquete", cambio, { id });
        },
      },
    },
    archivarTiquete: {
      method: "DELETE",
      path: "tiquetes/{id}",
      security: "protected",
      returns: "json",
      ops: {
        /** `DELETE tiquetes/{id}`: baja logica (archiva; la fila y su historial se conservan). */
        archivarTiquete(this: ClientPlugin, id: string): Promise<Tiquete> {
          return this.call<Tiquete>("archivarTiquete", undefined, { id });
        },
      },
    },
    asignarTiquete: {
      method: "POST",
      path: "tiquetes/{id}/asignar",
      security: "protected",
      zod: ZAsignar,
      returns: "json",
      ops: {
        /** `POST tiquetes/{id}/asignar`: le pone responsable (WRKR) y lo pasa a `asignado` si estaba `nuevo`. */
        asignarTiquete(this: ClientPlugin, id: string, input: AsignarInput): Promise<Tiquete> {
          return this.call<Tiquete>("asignarTiquete", input, { id });
        },
      },
    },
    adoptarTiquete: {
      method: "POST",
      path: "tiquetes/{id}/adoptar",
      security: "protected",
      returns: "json",
      ops: {
        /** `POST tiquetes/{id}/adoptar`: el WRKR de la sesion toma el tiquete (sin responsable o ya suyo). */
        adoptarTiquete(this: ClientPlugin, id: string): Promise<Tiquete> {
          return this.call<Tiquete>("adoptarTiquete", undefined, { id });
        },
      },
    },
    cambiarEstado: {
      method: "POST",
      path: "tiquetes/{id}/estado",
      security: "protected",
      zod: ZEstado,
      returns: "json",
      ops: {
        /** `POST tiquetes/{id}/estado`: mueve el tiquete por la maquina de estados y deja el comentario en el historial. */
        cambiarEstado(this: ClientPlugin, id: string, input: EstadoInput): Promise<Tiquete> {
          return this.call<Tiquete>("cambiarEstado", input, { id });
        },
      },
    },
    comentarTiquete: {
      method: "POST",
      path: "tiquetes/{id}/comentar",
      security: "protected",
      zod: ZComentar,
      returns: "json",
      ops: {
        /** `POST tiquetes/{id}/comentar`: agrega un comentario al historial. */
        comentarTiquete(this: ClientPlugin, id: string, input: ComentarInput): Promise<{ evento: EventoTiquete }> {
          return this.call<{ evento: EventoTiquete }>("comentarTiquete", input, { id });
        },
      },
    },
    catalogo: {
      method: "GET",
      path: "tiquetes/catalogo",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET tiquetes/catalogo`: los tipos de la empresa con sus estados y sus campos (lo declarativo). */
        catalogo(this: ClientPlugin): Promise<TipoTiqueteFila[]> {
          return this.call<TipoTiqueteFila[]>("catalogo");
        },
      },
    },
    definirTipo: {
      method: "PUT",
      path: "tiquetes/catalogo/{tipo}",
      security: "protected",
      zod: ZTipoCatalogoTiquete,
      returns: "json",
      ops: {
        /** `PUT tiquetes/catalogo/{tipo}`: define o cambia un tipo de la empresa sin tocar codigo. */
        definirTipo(this: ClientPlugin, tipo: string, input: TipoTiqueteInput): Promise<TipoTiqueteFila> {
          return this.call<TipoTiqueteFila>("definirTipo", input, { tipo });
        },
      },
    },
    desdeChat: {
      method: "POST",
      path: "tiquetes/desde-chat",
      security: "protected",
      zod: ZDesdeChat,
      returns: "json",
      ops: {
        /** `POST tiquetes/desde-chat`: el BOT crea un tiquete desde una conversacion (idempotente por `iexterno`). */
        desdeChat(this: ClientPlugin, input: DesdeChatInput): Promise<Tiquete> {
          return this.call<Tiquete>("desdeChat", input);
        },
      },
    },
    chat: {
      method: "GET",
      path: "tiquetes/chat",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET tiquetes/chat?ichat=`: los tiquetes de esa conversacion, el mas reciente primero. */
        chat(this: ClientPlugin, ichat: string): Promise<ChatTiquetes> {
          return this.call<ChatTiquetes>("chat", { ichat });
        },
      },
    },
    estadoChat: {
      method: "POST",
      path: "tiquetes/estado-chat",
      security: "protected",
      zod: ZEstadoChat,
      returns: "json",
      ops: {
        /** `POST tiquetes/estado-chat`: el BOT consulta/actualiza el estado de un tiquete de SU conversacion. */
        estadoChat(this: ClientPlugin, input: EstadoChatInput): Promise<Tiquete> {
          return this.call<Tiquete>("estadoChat", input);
        },
      },
    },
    clasificar: {
      method: "POST",
      path: "tiquetes/clasificar",
      security: "protected",
      zod: ZClasificar,
      returns: "json",
      ops: {
        /** `POST tiquetes/clasificar`: decide TIQUETE vs ERROR del sistema y crea lo que corresponda (el bot la llama). */
        clasificar(this: ClientPlugin, input: ClasificarInput): Promise<Clasificacion> {
          return this.call<Clasificacion>("clasificar", input);
        },
      },
    },
  },
};
