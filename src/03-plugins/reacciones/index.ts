/**
 * Plugin de reacciones: el JSON TRANSVERSAL. Toda entidad puede recibir reacciones (publicaciones, comentarios,
 * tiquetes, mensajes…).
 *
 *   reacciones_reacciones (tdespacio, iref, iusuario, reaccion)
 *
 * La PK es (tdespacio, iref, iusuario): una reacción por usuario y entidad; el valor es el emoji (o clave corta).
 * Las métricas (reacciones más usadas, menos usadas y por usuario) se derivan de esta tabla.
 *
 * ```ts
 * const reacciones = createClient(reaccionesPlugin, { baseUrl: "/api", headers: auth.headers });
 * await reacciones.reaccionar({ tdespacio: "tks", iref: "42", reaccion: "🔥" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/reacciones.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { COLUMNAS_VOTO } from "@Jeff-Aporta/DER/src/03-plugins/common/social.ts";
import { type ReaccionarInput, type ReaccionFila, ZReaccionar } from "@Jeff-Aporta/DER/src/03-plugins/reacciones/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/reacciones/schemas.ts";

/** JSON transversal de reacciones: la entidad `reacciones` (CRUD) y el path `reaccionar`. */
export const reaccionesPlugin: PluginDef = {
  name: "reacciones",
  entities: {
    reacciones: {
      name: "reacciones.reaccion",
      singular: "reaccion",
      plural: "reacciones",
      table: "reacciones_reacciones",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          ...COLUMNAS_VOTO,
          reaccion: { type: "string", length: 64, nullable: false },
        },
      },
      listColumns: ["tdespacio", "iref", "iusuario", "reaccion"],
      paths: {
        reaccionar: {
          method: "POST",
          path: "reaccionar",
          prefix: "plural",
          zod: ZReaccionar,
          returns: "json",
          ops: {
            /** `POST reacciones/reaccionar`: reacciona (o cambia la reacción) sobre la entidad de la sesión. */
            reaccionar(this: ClientPlugin, input: ReaccionarInput): Promise<ReaccionFila> {
              return this.call<ReaccionFila>("reaccionar", input);
            },
          },
        },
      },
    },
  },
};
