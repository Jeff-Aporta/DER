/**
 * Plugin de errores: el JSON TRANSVERSAL. Reportes de error de cualquier app, atendidos por agentes:
 *
 *   errores (ierror, titulo, descripcion, transcripcion, severidad, estado, ruta, url, html, contexto, atendido_por, ftoma, avance, + auditoría)
 *
 * Quien reporta: `reportarError` → `adjuntarError` por archivo → `errorListo`, y lo sigue con `seguimientoError`.
 * Quien atiende: `colaErrores` → `tomarError` (solo uno gana) → `avanceError`… → `DELETE errores` con los atendidos (o `soltarError`).
 *
 * ```ts
 * const errores = createClient(erroresPlugin, { baseUrl: "/api", headers: auth.headers });
 * const { ierror, token } = await errores.reportarError({ descripcion: "No guarda", ruta: "/crm", codigo, adjuntos: 1 });
 * await errores.adjuntarError(ierror, token, captura);
 * await errores.errorListo(ierror, token);
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/errores.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { COLUMNAS_AUDITORIA } from "@Jeff-Aporta/DER/src/03-plugins/common/auditoria.ts";
import { type AdjuntoResultado, type AvanceInput, type DetalleError, type ErrorReporte, type ReporteCreado, type ReportarInput, type SeguimientoError, type TomarInput, ZAvanceInput, ZReportarInput, ZTomarInput } from "@Jeff-Aporta/DER/src/03-plugins/errores/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/errores/schemas.ts";

/** Petición con el token de un reporte (sin sesión). */
async function conToken(p: ClientPlugin, ruta: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(await p.headers());
  new Headers(init.headers).forEach((v, k) => headers.set(k, v));
  headers.set("x-reporte-token", token);
  const base = String(p.config.baseUrl).replace(/\/+$/, "");
  const hacer = (p.config.fetch ?? fetch) as typeof fetch;
  const res = await hacer(`${base}/${ruta}`, { ...init, headers });
  const data = await res.json().catch(() => null) as { error?: string } | null;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

/** JSON transversal de errores: la entidad (CRUD para administrar; `DELETE errores` borra los atendidos) y sus paths. */
export const erroresPlugin: PluginDef = {
  name: "errores",
  entities: {
    errores: {
      name: "errores.error",
      singular: "error",
      plural: "errores",
      table: "errores",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          ierror: { type: "int", pk: true, autoincrement: true },
          titulo: { type: "string", length: 200, nullable: false },
          descripcion: { type: "text" },
          transcripcion: { type: "text" },
          severidad: { type: "string", length: 10 },
          estado: { type: "string", length: 12, nullable: false, default: "pendiente" },
          ruta: { type: "string", length: 1000 },
          url: { type: "string", length: 2000 },
          html: { type: "text" },
          contexto: { type: "json" },
          atendido_por: { type: "string", length: 120 },
          ftoma: { type: "datetime" },
          avance: { type: "json" },
          ...COLUMNAS_AUDITORIA,
        },
      },
      paths: {
        reportarError: {
          method: "POST",
          path: "reportar",
          prefix: "plural",
          security: false,
          zod: ZReportarInput,
          returns: "json",
          ops: {
            /** `POST errores/reportar`: con sesión confiable pasa directo; sin ella exige `codigo` y aplica penalizaciones. */
            reportarError(this: ClientPlugin, input: ReportarInput): Promise<ReporteCreado> {
              return this.call<ReporteCreado>("reportarError", input);
            },
          },
        },
        adjuntarError: {
          method: "POST",
          path: "adjuntos",
          prefix: "singular",
          pks: true,
          security: false,
          returns: "json",
          ops: {
            /** `POST error/{id}/adjuntos`: un archivo (captura, nota de voz…); lo que pase con él lo decide el proveedor de LLM del consumidor. */
            async adjuntarError(this: ClientPlugin, ierror: number, token: string, archivo: Blob, nombre?: string): Promise<AdjuntoResultado> {
              const n = nombre ?? (archivo as Blob & { name?: string }).name ?? "adjunto";
              const headers = { "content-type": "application/octet-stream", "x-archivo-mime": archivo.type || "application/octet-stream", "x-archivo-nombre": encodeURIComponent(n) };
              return await conToken(this, `error/${ierror}/adjuntos`, token, { method: "POST", headers, body: archivo }) as AdjuntoResultado;
            },
          },
        },
        errorListo: {
          method: "POST",
          path: "listo",
          prefix: "singular",
          pks: true,
          security: false,
          returns: "json",
          ops: {
            /** `POST error/{id}/listo`: ya subió todo; el reporte entra a la cola. */
            async errorListo(this: ClientPlugin, ierror: number, token: string): Promise<ReporteCreado> {
              return await conToken(this, `error/${ierror}/listo`, token, { method: "POST" }) as ReporteCreado;
            },
          },
        },
        seguimientoError: {
          method: "GET",
          path: "seguimiento",
          prefix: "singular",
          pks: true,
          security: false,
          returns: "json",
          ops: {
            /** `GET error/{id}/seguimiento`: estado y bitácora para quien reportó. */
            async seguimientoError(this: ClientPlugin, ierror: number, token: string): Promise<SeguimientoError> {
              return await conToken(this, `error/${ierror}/seguimiento`, token) as SeguimientoError;
            },
          },
        },
        colaErrores: {
          method: "GET",
          path: "cola",
          prefix: "plural",
          security: true,
          returns: "json",
          ops: {
            /** `GET errores/cola`: lo que se puede tomar ahora, los más viejos primero (sin el HTML). */
            colaErrores(this: ClientPlugin): Promise<ErrorReporte[]> {
              return this.call<ErrorReporte[]>("colaErrores");
            },
          },
        },
        detalleError: {
          method: "GET",
          path: "detalle",
          prefix: "singular",
          pks: true,
          security: true,
          returns: "json",
          ops: {
            /** `GET error/{id}/detalle`: la fila completa (HTML incluido) y sus archivos con URL. */
            detalleError(this: ClientPlugin, ierror: number): Promise<DetalleError> {
              return this.call<DetalleError>("detalleError", undefined, { ierror: String(ierror) });
            },
          },
        },
        tomarError: {
          method: "POST",
          path: "tomar",
          prefix: "singular",
          pks: true,
          security: true,
          zod: ZTomarInput,
          returns: "json",
          ops: {
            /** `POST error/{id}/tomar`: lo marca `en_proceso` de forma atómica; si otro agente lo tiene responde 409. */
            tomarError(this: ClientPlugin, ierror: number, input: TomarInput): Promise<ErrorReporte> {
              return this.call<ErrorReporte>("tomarError", input, { ierror: String(ierror) });
            },
          },
        },
        avanceError: {
          method: "POST",
          path: "avance",
          prefix: "singular",
          pks: true,
          security: true,
          zod: ZAvanceInput,
          returns: "json",
          ops: {
            /** `POST error/{id}/avance`: agrega a la bitácora y renueva la toma (latido del agente). */
            avanceError(this: ClientPlugin, ierror: number, input: AvanceInput): Promise<ErrorReporte> {
              return this.call<ErrorReporte>("avanceError", input, { ierror: String(ierror) });
            },
          },
        },
        soltarError: {
          method: "POST",
          path: "soltar",
          prefix: "singular",
          pks: true,
          security: true,
          zod: ZAvanceInput,
          returns: "json",
          ops: {
            /** `POST error/{id}/soltar`: no se pudo resolver; vuelve a `pendiente` con la nota en la bitácora. */
            soltarError(this: ClientPlugin, ierror: number, input: AvanceInput): Promise<ErrorReporte> {
              return this.call<ErrorReporte>("soltarError", input, { ierror: String(ierror) });
            },
          },
        },
      },
    },
  },
};
