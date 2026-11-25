/**
 * Plugin de reportes (observaciones): el JSON TRANSVERSAL. Cualquiera marca un error sobre CUALQUIER cosa (`origin` +
 * `idorigin`, como archivos y mensajes) y un auditor o agente lo atiende: toma atómica, bitácora y cierre
 * (`aplicada` | `descartada`) que conserva quién lo aplicó. Hermano de `errores` (mismo ciclo, pero con empresa,
 * origen libre y cierre que no borra la fila).
 *
 *   reportes_reportes (id, iempresa, origin, idorigin, ambito, tipo, motivo, correccion, severidad, jcontexto, autor,
 *                      estado, atendido_por, ftoma, javance, iaplicador, resultado, fhcre, fhcierre)
 *
 * Rutas `protected` (empresa y rol salen de `services.contexto`): reportar lo hace cualquier miembro; la cola, tomar,
 * avance, soltar y cerrar son de quien audita (`cfg.rolesAuditor`).
 *
 * ```ts
 * const rep = createClient(reportesPlugin, { baseUrl: "/api", headers: auth.headers });
 * await rep.reportar({ origin: "atencion.mensaje", idorigin: ichat, ambito: "bot-ventas", motivo: "Tono muy formal", correccion: "Más cercano" });
 * const [r] = await rep.cola({ estado: "pendiente" });  await rep.tomar(r.id);  await rep.cerrar({ id: r.id, resultado: "aplicada", nota: "Contrato ajustado" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/reportes.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type AvanceReporteInput, type CerrarReporteInput, ESTADOS_REPORTE, type FiltroReportes, type ReportarReporteInput, type Reporte, ZAvanceReporte, ZCerrarReporte, ZReportarReporte, ZTomarReporte } from "@Jeff-Aporta/DER/src/03-plugins/reportes/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/reportes/schemas.ts";

/** Quita las claves vacías de una query. */
function limpio(q: object | undefined): Record<string, string> | undefined {
  if (!q) return undefined;
  const e = Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return e.length ? Object.fromEntries(e.map(([k, v]) => [k, String(v)])) : undefined;
}

/** JSON transversal de reportes: una entidad (no publicada por CRUD) y las rutas del ciclo de atención. */
export const reportesPlugin: PluginDef = {
  name: "reportes",
  entities: {
    reportes: {
      name: "reportes.reporte",
      singular: "reportes_reporte",
      plural: "reportes_reportes",
      table: "reportes_reportes",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          origin: { type: "string", length: 80, nullable: false },
          idorigin: { type: "string", length: 120, nullable: false },
          ambito: { type: "string", length: 120, nullable: true },
          tipo: { type: "string", length: 40, default: "error" },
          motivo: { type: "text", nullable: false },
          correccion: { type: "text", nullable: true },
          severidad: { type: "string", length: 10, nullable: true },
          jcontexto: { type: "json", nullable: true },
          autor: { type: "string", length: 120, nullable: false },
          estado: { type: "string", enum: ESTADOS_REPORTE, default: "pendiente" },
          atendido_por: { type: "string", length: 120, nullable: true },
          ftoma: { type: "datetime", nullable: true },
          javance: { type: "json", nullable: true },
          iaplicador: { type: "string", length: 120, nullable: true },
          resultado: { type: "text", nullable: true },
          fhcre: { type: "datetime", nullable: false },
          fhcierre: { type: "datetime", nullable: true },
        },
      },
      listColumns: ["id", "iempresa", "origin", "idorigin", "tipo", "estado", "fhcre"],
    },
  },
  irregularPaths: {
    reportar: {
      method: "POST",
      path: "reportes/reportar",
      security: "protected",
      zod: ZReportarReporte,
      returns: "json",
      ops: {
        /** `POST reportes/reportar`: marca un error sobre cualquier entidad (cualquier miembro de la empresa). */
        reportar(this: ClientPlugin, input: ReportarReporteInput): Promise<Reporte> {
          return this.call<Reporte>("reportar", input);
        },
      },
    },
    cola: {
      method: "GET",
      path: "reportes/cola",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET reportes/cola?estado=&origin=&idorigin=&ambito=&tipo=&autor=&limite=`: los reportes de la empresa (auditor); lo más viejo primero. */
        cola(this: ClientPlugin, filtro?: FiltroReportes): Promise<Reporte[]> {
          return this.call<Reporte[]>("cola", limpio(filtro));
        },
      },
    },
    de: {
      method: "GET",
      path: "reportes/de",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET reportes/de?origin=&idorigin=`: los reportes de una cosa (los ve quien audita; cualquiera ve los suyos). */
        de(this: ClientPlugin, query: { origin: string; idorigin: string }): Promise<Reporte[]> {
          return this.call<Reporte[]>("de", limpio(query));
        },
      },
    },
    tomar: {
      method: "POST",
      path: "reportes/tomar",
      security: "protected",
      zod: ZTomarReporte,
      returns: "json",
      ops: {
        /** `POST reportes/tomar`: toma atómica antes de trabajar (409 si otro lo tiene; una toma vencida se retoma). */
        tomar(this: ClientPlugin, id: string): Promise<Reporte> {
          return this.call<Reporte>("tomar", { id });
        },
      },
    },
    avance: {
      method: "POST",
      path: "reportes/avance",
      security: "protected",
      zod: ZAvanceReporte,
      returns: "json",
      ops: {
        /** `POST reportes/avance`: bitácora y latido de la toma (solo quien lo tiene). */
        avance(this: ClientPlugin, input: AvanceReporteInput): Promise<Reporte> {
          return this.call<Reporte>("avance", input);
        },
      },
    },
    soltar: {
      method: "POST",
      path: "reportes/soltar",
      security: "protected",
      zod: ZAvanceReporte,
      returns: "json",
      ops: {
        /** `POST reportes/soltar`: vuelve a `pendiente` con la nota (solo quien lo tiene). */
        soltar(this: ClientPlugin, input: AvanceReporteInput): Promise<Reporte> {
          return this.call<Reporte>("soltar", input);
        },
      },
    },
    cerrar: {
      method: "POST",
      path: "reportes/cerrar",
      security: "protected",
      zod: ZCerrarReporte,
      returns: "json",
      ops: {
        /** `POST reportes/cerrar`: `aplicada` o `descartada`; queda quién lo aplicó y la nota (solo quien lo tiene). */
        cerrar(this: ClientPlugin, input: CerrarReporteInput): Promise<Reporte> {
          return this.call<Reporte>("cerrar", input);
        },
      },
    },
  },
};
