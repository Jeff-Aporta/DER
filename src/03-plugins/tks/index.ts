/**
 * Plugin de tiquetes (tks): el JSON TRANSVERSAL. El tablero que toda app puede montar sin conditionally nada:
 *
 *   tks_tks (itk, requerimiento, proposito, jtodo, estado, bfinalizado, fhcre, bactivo, iusuario, jasignados)
 *
 * `itk` es un autoincremental (1, 2, 3…), `requerimiento` el contenido (html|md), `proposito` la idea resumida,
 * `jtodo` los pendientes (cada uno con su `hecho`, su contenido y su última edición), `estado` la columna del
 * tablero, `bfinalizado` la regla de cierre, `fhcre` desde cuándo está abierto, `bactivo` la baja lógica y
 * `jasignados` quién lo ve (usuarios, roles y grupos; `*` en grupos = todos).
 *
 * ```ts
 * const tks = createClient(tksPlugin, { baseUrl: "/api", headers: auth.headers });
 * const fila = await tks.controllers.tks.post({ requerimiento: "#42", proposito: "Arreglar el login" });
 * await tks.misTks();
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/tks.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type Tk, type TkInput, ZTkInput } from "@Jeff-Aporta/DER/src/03-plugins/tks/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/tks/schemas.ts";

/** JSON transversal de tiquetes: la entidad `tks` (CRUD completo) y los paths `misTks` y `crearTk`. */
export const tksPlugin: PluginDef = {
  name: "tks",
  entities: {
    tks: {
      name: "tks.tk",
      singular: "tk",
      plural: "tks",
      table: "tks_tks",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          itk: { type: "string", pk: true, length: 12, sequence: { name: "tks_itk", start: 1, increment: 1, base: 36, as: "string", pattern: "{n:4}" } },
          requerimiento: { type: "text", nullable: false },
          proposito: { type: "string", length: 300 },
          jtodo: { type: "json" },
          estado: { type: "string", length: 40, nullable: false, default: "por_hacer" },
          bfinalizado: { type: "bool", default: false },
          fhcre: { type: "datetime" },
          bactivo: { type: "bool", default: true },
          iusuario: { type: "string", length: 120 },
          jasignados: { type: "json" },
          qtotalmensajes: { type: "int", virtual: true },
          qcalificacion: { type: "float", virtual: true },
        },
      },
      listColumns: ["itk", "proposito", "estado", "bfinalizado", "fhcre", "iusuario", "bactivo"],
      paths: {
        misTks: {
          method: "GET",
          path: "mis",
          prefix: "plural",
          returns: "json",
          ops: {
            /** `GET tks/mis`: los tks que la sesión puede ver (creador, asignados por usuario, rol o grupo). */
            misTks(this: ClientPlugin): Promise<{ tks: Tk[]; total: number }> {
              return this.call<{ tks: Tk[]; total: number }>("misTks");
            },
          },
        },
        crearTk: {
          method: "POST",
          path: "crear",
          prefix: "plural",
          zod: ZTkInput,
          returns: "json",
          ops: {
            /** `POST tks/crear`: crea un tk con los valores por defecto del servidor (estado, fecha y autor). */
            crearTk(this: ClientPlugin, input: TkInput): Promise<Tk> {
              return this.call<Tk>("crearTk", input);
            },
          },
        },
      },
    },
  },
};
