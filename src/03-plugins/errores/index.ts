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
 * const { ierror, token } = await errores["reportarError"]({ descripcion: "No guarda", ruta: "/crm", codigo, adjuntos: 1 });
 * await errores.adjuntarError(ierror, token, captura);
 * await errores.errorListo(ierror, token);
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/errores.md
 */
import type { ClientFail, ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { COLUMNAS_AUDITORIA } from "@Jeff-Aporta/DER/src/03-plugins/common/auditoria.ts";
import { type AdjuntoResultado, type AvanceInput, type DetalleError, type ErrorReporte, type LlaveDelDia, type ReporteCreado, type ReportarInput, type SeguimientoError, type TomarInput, ZAvanceInput, ZReportarInput, ZTomarInput } from "@Jeff-Aporta/DER/src/03-plugins/errores/schemas.ts";

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
          atendido: { type: "bool", default: false },
          solicitud: { type: "datetime" },
          solicitado_por: { type: "string", length: 120 },
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
        llaveReportes: {
          method: "GET",
          path: "llave",
          prefix: "plural",
          security: false,
          returns: "json",
          ops: {
            /** `GET errores/llave`: la llave pública del día que exigen los reportes anónimos (rota a medianoche UTC). */
            llaveReportes(this: ClientPlugin): Promise<LlaveDelDia> {
              return this.call<LlaveDelDia>("llaveReportes");
            },
          },
        },
        solicitarSolucion: {
          method: "POST",
          path: "solicitar",
          prefix: "singular",
          pks: true,
          security: true,
          returns: "json",
          ops: {
            /** `POST error/{id}/solicitar`: pide que se solucione (solo el rol auditor); lanza el agente del consumidor. Nunca se resuelve solo. */
            solicitarSolucion(this: ClientPlugin, ierror: number): Promise<ErrorReporte> {
              return this.call<ErrorReporte>("solicitarSolucion", {}, { ierror: String(ierror) });
            },
          },
        },
        atendidoError: {
          method: "POST",
          path: "atendido",
          prefix: "singular",
          pks: true,
          security: true,
          zod: ZAvanceInput,
          returns: "json",
          ops: {
            /** `POST error/{id}/atendido`: lo marca atendido (columna `atendido`); la purga programada lo borra a medianoche. */
            atendidoError(this: ClientPlugin, ierror: number, input: AvanceInput): Promise<ErrorReporte> {
              return this.call<ErrorReporte>("atendidoError", input, { ierror: String(ierror) });
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

/**
 * `onFail` listo para un controller o plugin de cliente: reporta a `errores` los fallos de la app (≥ 500 y errores de red;
 * los 4xx son del usuario y no se reportan). Sin sesión pide la llave pública del día. Máx. 5 por minuto, sin repetir el mismo
 * fallo en 60 s y sin reportar los de `errores/` (no se reporta a sí mismo). Nunca lanza.
 *
 * ```ts
 * const errores = createClient(erroresPlugin, { baseUrl: "/api", headers: auth.headers });
 * const crm = createClient(crmPlugin, { baseUrl: "/api", headers: auth.headers, onFail: reportarFallosCon(errores, { apporigin: "crm" }) });
 * ```
 */
export function reportarFallosCon(errores: ClientPlugin, opts: { apporigin?: string; ruta?: () => string } = {}): (fallo: ClientFail) => void {
  const vistos = new Map<string, number>();
  const envios: number[] = [];
  return (fallo) => {
    if (fallo.path.startsWith("errores/") || fallo.path.startsWith("error/")) return;
    if (fallo.status !== 0 && fallo.status < 500) return;
    const ahora = Date.now();
    const clave = `${fallo.method} ${fallo.path} ${fallo.status}`;
    while (envios.length && envios[0]! < ahora - 60_000) envios.shift();
    if (envios.length >= 5 || (vistos.get(clave) ?? 0) > ahora - 60_000) return;
    vistos.set(clave, ahora);
    envios.push(ahora);
    void (async () => {
      try {
        const llave = errores.token ? undefined : (await errores["llaveReportes"]()).llave;
        await errores["reportarError"]({ titulo: `${fallo.method} ${fallo.path} → ${fallo.status || "sin conexión"}`, descripcion: fallo.message, severidad: "alta", ruta: opts.ruta?.() ?? fallo.path, contexto: { origen: "client", metodo: fallo.method, status: fallo.status }, ...(opts.apporigin ? { apporigin: opts.apporigin } : {}), ...(llave ? { llave } : {}) });
      } catch { /* reportar un fallo nunca causa otro */ }
    })();
  };
}
