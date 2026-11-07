/**
 * Plugin de calificaciones: el JSON TRANSVERSAL. Toda entidad puede ser calificada con un entero de -10 a 10.
 *
 *   calificaciones_calificaciones (tdespacio, iref, iusuario, valor)
 *
 * La PK es (tdespacio, iref, iusuario): una calificación por usuario y entidad. No hay borrado: quien califica
 * puede cambiar de opinión (hasta poner 0, que es neutro) pero el registro no se borra.
 *
 * ```ts
 * const calificaciones = createClient(calificacionesPlugin, { baseUrl: "/api", headers: auth.headers });
 * await calificaciones.calificar({ tdespacio: "tks", iref: "42", valor: 8 });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/calificaciones.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { ZValorCalificacion } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";
import { COLUMNAS_VOTO } from "@Jeff-Aporta/DER/src/03-plugins/common/social.ts";
import { type Calificacion, type CalificarInput, ZCalificar } from "@Jeff-Aporta/DER/src/03-plugins/calificaciones/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/calificaciones/schemas.ts";

/** JSON transversal de calificaciones: la entidad `calificaciones` (CRUD) y el path `calificar`. */
export const calificacionesPlugin: PluginDef = {
  name: "calificaciones",
  entities: {
    calificaciones: {
      name: "calificaciones.calificacion",
      singular: "calificacion",
      plural: "calificaciones",
      table: "calificaciones_calificaciones",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          ...COLUMNAS_VOTO,
          valor: { type: "int", nullable: false, zod: ZValorCalificacion },
        },
      },
      listColumns: ["tdespacio", "iref", "iusuario", "valor"],
      paths: {
        calificar: {
          method: "POST",
          path: "calificar",
          prefix: "plural",
          zod: ZCalificar,
          returns: "json",
          ops: {
            /** `POST calificaciones/calificar`: califica (o recalifica) la entidad de la sesión. */
            calificar(this: ClientPlugin, input: CalificarInput): Promise<Calificacion> {
              return this.call<Calificacion>("calificar", input);
            },
          },
        },
      },
    },
  },
};
