/**
 * Plugin de notificaciones: el JSON TRANSVERSAL. Avisos para un usuario (o para todos) con contador de no leídas.
 *
 *   notificaciones_notificaciones (id, iusuario, titulo, texto, tipo, enlace, tdespacio, iref, leida, fhcre)
 *   notificaciones_lecturas       (inotificacion, iusuario, fhcre)   ← lecturas de las notificaciones para todos (`*`)
 *
 * Rutas (irregulares: la tabla nunca se publica por CRUD, cada quien ve solo lo suyo): `GET notificaciones/bandeja` (las de la sesión + contador), `POST notificaciones/leer` (unas o todas) y
 * `POST notificaciones/notificar` (crear; quién puede lo decide la puerta `permissions` del consumidor).
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
import {
  type Bandeja,
  type LeerInput,
  type Notificacion,
  type NotificarInput,
  ZLeer,
  ZNotificar,
} from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/schemas.ts";

/** JSON transversal de notificaciones: las entidades `notificaciones` y `lecturas` y sus paths. */
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
      listColumns: ["id", "iusuario", "titulo", "tipo", "leida", "fhcre"],
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
  },
};
