/**
 * Plugin de WhatsApp: el JSON TRANSVERSAL. Gateway de la Cloud API de Meta con VARIOS números: cada número se vincula
 * a una app (contrato + perfil del bot), cada contacto tiene una conversación por número con su ventana de 24 h y
 * cada mensaje se guarda una sola vez por `wamid` (Meta reintenta los webhooks).
 *
 *   whatsapp_apps            (slug, nombre, perfil, contrato, jconfig, bautorespuesta, bactivo, fhcre)
 *   whatsapp_numeros         (iphone, app, display, nombre, tipo, bactivo, fhcre)          ← un número → una app
 *   whatsapp_contactos       (id, waid, nombre, fhcre, fhult)
 *   whatsapp_conversaciones  (id, icontacto, iphone, app, estado, fhventana, fhabierta, fhult)
 *   whatsapp_mensajes        (id, wamid, iconversacion, direccion, tipo, texto, estado, error, jpayload, fhcre, fhestado)
 *   whatsapp_eventos         (id, iphone, campo, jpayload, fhcre)                         ← todo lo que llega, crudo
 *
 * Rutas (irregulares y `protected`: las tablas nunca se publican por CRUD): `GET whatsapp/conversaciones`,
 * `GET whatsapp/historial` y `POST whatsapp/vincular`. El webhook NO es una ruta del plugin: la firma de Meta se
 * verifica sobre el cuerpo crudo, así que lo atiende el gateway y le pasa el JSON a `procesarWebhook`.
 *
 * ```ts
 * const wa = createClient(whatsappPlugin, { baseUrl: "/api", headers: auth.headers });
 * const convs = await wa.conversaciones({ iphone: "1522115044307992" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/whatsapp.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { ESTADOS_WA, type WaConversacion, type WaNumero, type WaNumeroInput, type WaTurno, ZWaNumero } from "@Jeff-Aporta/DER/src/03-plugins/whatsapp/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/whatsapp/schemas.ts";

/** JSON transversal de WhatsApp: apps, números, contactos, conversaciones, mensajes y eventos, y sus paths. */
export const whatsappPlugin: PluginDef = {
  name: "whatsapp",
  entities: {
    apps: {
      name: "whatsapp.app",
      singular: "app",
      plural: "apps",
      table: "whatsapp_apps",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          slug: { type: "string", pk: true, length: 60 },
          nombre: { type: "string", length: 120, nullable: false },
          perfil: { type: "string", length: 120, nullable: true },
          contrato: { type: "text", nullable: true },
          jconfig: { type: "json", nullable: true },
          bautorespuesta: { type: "bool", default: true },
          bactivo: { type: "bool", default: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["slug", "nombre", "perfil", "bautorespuesta", "bactivo"],
    },
    numeros: {
      name: "whatsapp.numero",
      singular: "numero",
      plural: "numeros",
      table: "whatsapp_numeros",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          iphone: { type: "string", pk: true, length: 40 },
          app: { type: "string", length: 60, nullable: false },
          display: { type: "string", length: 40, nullable: true },
          nombre: { type: "string", length: 120, nullable: true },
          tipo: { type: "string", enum: ["prueba", "produccion"], default: "prueba" },
          bactivo: { type: "bool", default: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["iphone", "app", "display", "tipo", "bactivo"],
    },
    contactos: {
      name: "whatsapp.contacto",
      singular: "contacto",
      plural: "contactos",
      table: "whatsapp_contactos",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          waid: { type: "string", length: 32, nullable: false, unique: true },
          nombre: { type: "string", length: 160, nullable: true },
          fhcre: { type: "datetime", nullable: false },
          fhult: { type: "datetime", nullable: true },
        },
      },
      listColumns: ["id", "waid", "nombre", "fhult"],
    },
    conversaciones: {
      name: "whatsapp.conversacion",
      singular: "conversacion",
      plural: "conversaciones",
      table: "whatsapp_conversaciones",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          icontacto: { type: "string", length: 40, nullable: false },
          iphone: { type: "string", length: 40, nullable: false },
          app: { type: "string", length: 60, nullable: true },
          estado: { type: "string", enum: ["abierta", "cerrada"], default: "abierta" },
          fhventana: { type: "datetime", nullable: true },
          fhabierta: { type: "datetime", nullable: false },
          fhult: { type: "datetime", nullable: true },
        },
      },
      listColumns: ["id", "icontacto", "iphone", "app", "estado", "fhventana", "fhult"],
    },
    mensajes: {
      name: "whatsapp.mensaje",
      singular: "mensaje",
      plural: "mensajes",
      table: "whatsapp_mensajes",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          wamid: { type: "string", length: 160, nullable: true, unique: true },
          iconversacion: { type: "string", length: 40, nullable: false },
          direccion: { type: "string", enum: ["entrante", "saliente"], nullable: false },
          tipo: { type: "string", length: 40, default: "text" },
          texto: { type: "text", nullable: true },
          estado: { type: "string", enum: ESTADOS_WA, default: "recibido" },
          error: { type: "text", nullable: true },
          jpayload: { type: "json", nullable: true },
          fhcre: { type: "datetime", nullable: false },
          fhestado: { type: "datetime", nullable: true },
        },
      },
      listColumns: ["id", "wamid", "iconversacion", "direccion", "tipo", "estado", "fhcre"],
    },
    eventos: {
      name: "whatsapp.evento",
      singular: "evento",
      plural: "eventos",
      table: "whatsapp_eventos",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iphone: { type: "string", length: 40, nullable: true },
          campo: { type: "string", length: 60, nullable: false },
          jpayload: { type: "json", nullable: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["id", "iphone", "campo", "fhcre"],
    },
  },
  irregularPaths: {
    conversaciones: {
      method: "GET",
      path: "whatsapp/conversaciones",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET whatsapp/conversaciones?iphone=&limite=`: las últimas conversaciones (de un número o de todos). */
        conversaciones(this: ClientPlugin, query: { iphone?: string; limite?: number } = {}): Promise<WaConversacion[]> {
          return this.call<WaConversacion[]>("conversaciones", query);
        },
      },
    },
    historial: {
      method: "GET",
      path: "whatsapp/historial",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET whatsapp/historial?iconversacion=&max=`: los turnos de una conversación en orden cronológico. */
        historial(this: ClientPlugin, query: { iconversacion: string; max?: number }): Promise<WaTurno[]> {
          return this.call<WaTurno[]>("historial", query);
        },
      },
    },
    vincular: {
      method: "POST",
      path: "whatsapp/vincular",
      security: "protected",
      zod: ZWaNumero,
      returns: "json",
      ops: {
        /** `POST whatsapp/vincular`: vincula (o mueve) un número a una app existente. */
        vincular(this: ClientPlugin, input: WaNumeroInput): Promise<WaNumero> {
          return this.call<WaNumero>("vincular", input);
        },
      },
    },
  },
};
