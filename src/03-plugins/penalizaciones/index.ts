/**
 * Plugin de penalizaciones: el JSON TRANSVERSAL. Una tabla con un id y los últimos intentos fallidos en JSON:
 *
 *   penalizaciones (id, intentos, fhmod)     id = `<ambito>:ip:<ip>` | `<ambito>:global`
 *
 * Solo lectura por API; la lógica vive en las `ops` del server (`verificar`, `fallo`, `acierto`), que usa quien protege algo.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/penalizaciones.md
 */
import type { PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/penalizaciones/schemas.ts";

/** JSON transversal de penalizaciones: una entidad de solo lectura. */
export const penalizaciones: PluginDef = {
  name: "penalizaciones",
  entities: {
    penalizaciones: {
      name: "penalizaciones.penalizacion",
      singular: "penalizacion",
      plural: "penalizaciones",
      table: "penalizaciones",
      exposed: true,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 200 },
          intentos: { type: "json", nullable: false },
          fhmod: { type: "datetime" },
        },
      },
    },
  },
};
