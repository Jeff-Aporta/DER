/**
 * Plugin de notificaciones: el JSON TRANSVERSAL. Avisos para un usuario (o para todos) con contador de no leídas, al
 * estilo de una red social (quién, qué, cuándo, visto o no), y suscripciones de push fuera de la app.
 *
 *   notificaciones_notificaciones (id, iusuario, iactor, actor, titulo, texto, tipo, enlace, tdespacio, iref, leida, fhcre)
 *   notificaciones_lecturas       (inotificacion, iusuario, fhcre)   ← lecturas de las notificaciones para todos (`*`)
 *   notificaciones_suscripciones  (id, iusuario, canal, endpoint, claves, agente, activa, fhcre) ← webpush / fcm
 *
 * Rutas (irregulares: las tablas nunca se publican por CRUD, cada quien ve solo lo suyo): `GET notificaciones/bandeja`,
 * `POST notificaciones/leer`, `POST notificaciones/notificar` (quién puede lo decide la puerta `permissions` del
 * consumidor), `POST notificaciones/suscribir` y `POST notificaciones/desuscribir`.
 *
 * ```ts
 * const notif = createClient(notificacionesPlugin, { baseUrl: "/api", headers: auth.headers });
 * const { items, noLeidas } = await notif.bandeja();
 * await notif.leer({ todas: true });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/notificaciones.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type Bandeja, type LeerInput, type Notificacion, type NotificarInput, type SuscribirInput, type SuscripcionPush, ZDesuscribir, ZLeer, ZNotificar, ZSuscribir } from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/schemas.ts";

/** JSON transversal de notificaciones: las entidades `notificaciones`, `lecturas` y `suscripciones` y sus paths. */
export const notificacionesPlugin: PluginDef = {
  name: "notificaciones",
  entities: {
    notificaciones: {
      name: "notificaciones.notificacion",
      singular: "notificacion",
      plural: "notificaciones",
      table: "notificaciones_notificaciones",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iusuario: { type: "string", length: 120, nullable: false },
          iactor: { type: "string", length: 120, nullable: true },
          actor: { type: "string", length: 120, nullable: true },
          titulo: { type: "string", length: 160, nullable: false },
          texto: { type: "text", nullable: true },
          tipo: { type: "string", length: 40, default: "info" },
          enlace: { type: "string", length: 300, nullable: true },
          tdespacio: { type: "string", length: 60, nullable: true },
          iref: { type: "string", length: 120, nullable: true },
          leida: { type: "datetime", nullable: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["id", "iusuario", "actor", "titulo", "tipo", "leida", "fhcre"],
    },
    lecturas: {
      name: "notificaciones.lectura",
      singular: "lectura",
      plural: "lecturas",
      table: "notificaciones_lecturas",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          inotificacion: { type: "string", pk: true, length: 40 },
          iusuario: { type: "string", pk: true, length: 120 },
          fhcre: { type: "datetime", nullable: false },
        },
      },
    },
    suscripciones: {
      name: "notificaciones.suscripcion",
      singular: "suscripcion",
      plural: "suscripciones",
      table: "notificaciones_suscripciones",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 64 },
          iusuario: { type: "string", length: 120, nullable: false },
          canal: { type: "string", enum: ["webpush", "fcm"], default: "webpush" },
          endpoint: { type: "string", length: 1000, nullable: false },
          claves: { type: "json", nullable: true },
          agente: { type: "string", length: 200, nullable: true },
          activa: { type: "bool", default: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
    },
  },
  irregularPaths: {
    bandeja: {
      method: "GET",
      path: "notificaciones/bandeja",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET notificaciones/bandeja`: las últimas de la sesión (propias y para todos) y cuántas no ha leído. */
        bandeja(this: ClientPlugin): Promise<Bandeja> {
          return this.call<Bandeja>("bandeja");
        },
      },
    },
    leer: {
      method: "POST",
      path: "notificaciones/leer",
      security: "protected",
      zod: ZLeer,
      returns: "json",
      ops: {
        /** `POST notificaciones/leer`: marca leídas unas (`ids`) o todas (`todas: true`). */
        leer(this: ClientPlugin, input: LeerInput): Promise<{ marcadas: number }> {
          return this.call<{ marcadas: number }>("leer", input);
        },
      },
    },
    notificar: {
      method: "POST",
      path: "notificaciones/notificar",
      security: "protected",
      zod: ZNotificar,
      returns: "json",
      ops: {
        /** `POST notificaciones/notificar`: crea una por destinatario (`*` = todos). */
        notificar(this: ClientPlugin, input: NotificarInput): Promise<Notificacion[]> {
          return this.call<Notificacion[]>("notificar", input);
        },
      },
    },
    suscribir: {
      method: "POST",
      path: "notificaciones/suscribir",
      security: "protected",
      zod: ZSuscribir,
      returns: "json",
      ops: {
        /** `POST notificaciones/suscribir`: guarda la suscripción de push de este navegador/dispositivo. */
        suscribir(this: ClientPlugin, input: SuscribirInput): Promise<SuscripcionPush> {
          return this.call<SuscripcionPush>("suscribir", input);
        },
      },
    },
    desuscribir: {
      method: "POST",
      path: "notificaciones/desuscribir",
      security: "protected",
      zod: ZDesuscribir,
      returns: "json",
      ops: {
        /** `POST notificaciones/desuscribir`: da de baja la suscripción de ese `endpoint`. */
        desuscribir(this: ClientPlugin, input: { endpoint: string }): Promise<{ bajas: number }> {
          return this.call<{ bajas: number }>("desuscribir", input);
        },
      },
    },
  },
};
