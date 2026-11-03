/**
 * Plugin de errores (server). Solo define datos y rutas: lo externo llega por enlaces del consumidor. `services.enlaces` (quién es
 * confiable, IP real, qué hacer al recibir un reporte), `archivos` y `penalizaciones` (los otros plugins) y `llm` (controller de
 * proveedor: decide qué pasa con cada adjunto), más `ipDe` (IP real según el host). Cada uno se busca en `services` y luego en el singleton `servicios`.
 *
 * ```ts
 * const errores = createServer(erroresServer, { db, cfg: { secret: "env:JWT_SECRET", codigo: "env:ERRORES_CODIGO" }, services: { archivos, penalizaciones: multas, enlaces } });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/errores.md
 */
import { sql } from "kysely";
import type { z } from "zod";
import { HttpError, NotFoundError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { leerBinario } from "@Jeff-Aporta/DER/src/03-plugins/archivos/server.ts";
import { selloAlta, selloCambio } from "@Jeff-Aporta/DER/src/03-plugins/common/auditoria.ts";
import { firmarHmac, verificarHmac } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import type { ProveedorLlm } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";
import { ipReal, servicioDe } from "@Jeff-Aporta/DER/src/03-plugins/common/servicios.ts";
import { erroresPlugin } from "@Jeff-Aporta/DER/src/03-plugins/errores/index.ts";
import { type AdjuntoResultado, type DetalleError, type EnlacesErrores, type ErrorReporte, type ErroresConfig, type LineaAvance, type ReporteCreado, type SeguimientoError, ZAvanceInput, ZErroresConfig, ZReportarInput, ZTomarInput } from "@Jeff-Aporta/DER/src/03-plugins/errores/schemas.ts";
import type { Veredicto } from "@Jeff-Aporta/DER/src/03-plugins/penalizaciones/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/errores/index.ts";

const AMBITO = "errores";
const MINUTO = 60_000;
const MEGA = 1024 * 1024;
const MAX_BITACORA = 200;
/** Plugin dueño del controller, para los hooks. */
const plugins = new WeakMap<object, ServerPlugin>();

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T, any>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

const controlDe = (p: ServerPlugin): ServerController<any> => p.controllers["errores"]!;
const enlacesDe = (p: ServerPlugin): EnlacesErrores => servicioDe<EnlacesErrores>(p, "enlaces") ?? {};
const idDe = (i: ExtraRouteInput): number => Number(i.params["ierror"]);

/** Columna json como arreglo (puede llegar como texto). */
function bitacora(v: unknown): LineaAvance[] {
  const dato = typeof v === "string" ? JSON.parse(v) : v;
  return Array.isArray(dato) ? dato as LineaAvance[] : [];
}

/** Token de un reporte: `<exp>.<firma>`. */
async function firmarToken(p: ServerPlugin, ierror: number): Promise<string> {
  const cfg = p.cfg as ErroresConfig;
  const exp = Math.floor(Date.now() / 1000) + cfg.tokenSeg;
  return `${exp}.${await firmarHmac(cfg.secret, `reporte:${ierror}:${exp}`)}`;
}

/** Exige el token del reporte en `x-reporte-token`. */
async function exigirToken(p: ServerPlugin, i: ExtraRouteInput): Promise<void> {
  const [exp, sig] = (i.request.headers.get("x-reporte-token") ?? "").split(".");
  const vigente = Number(exp) >= Math.floor(Date.now() / 1000);
  if (!exp || !sig || !vigente || !(await verificarHmac((p.cfg as ErroresConfig).secret, `reporte:${idDe(i)}:${exp}`, sig))) throw new HttpError(401, "Token del reporte inválido o vencido");
}

/** Sin sesión confiable: penalizaciones y código. Lanza o responde 429 si no pasa. */
async function exigirCodigo(p: ServerPlugin, codigo: string | undefined, req: Request | undefined): Promise<Response | null> {
  const cfg = p.cfg as ErroresConfig;
  if (!cfg.codigo) throw new HttpError(401, "Reportar requiere iniciar sesión");
  const multas = servicioDe<ServerPlugin>(p, "penalizaciones");
  if (!multas) throw new HttpError(503, "Penalizaciones no disponibles");
  const intento = { ambito: AMBITO, ip: ipReal(p, req) };
  const v = await multas["verificar"](intento) as Veredicto;
  if (v.penalizado) {
    const seg = Math.ceil(v.restanteMs / 1000);
    return Response.json({ error: `Demasiados intentos: espera ${Math.ceil(seg / 60)} min`, vector: v.vector }, { status: 429, headers: { "retry-after": String(seg) } });
  }
  // se comparan firmas: el largo del código tampoco se filtra
  const dado = await firmarHmac(cfg.secret, codigo ?? "");
  if (!(await verificarHmac(cfg.secret, cfg.codigo, dado))) {
    await multas["fallo"](intento);
    throw new HttpError(403, "Código de reporte incorrecto");
  }
  await multas["acierto"](intento);
  return null;
}

/** Título por defecto: el comienzo de la descripción o la ruta. */
function tituloDe(titulo: string | undefined, descripcion: string, ruta: string | undefined): string {
  return (titulo ?? (descripcion.trim().split("\n")[0] || `Reporte en ${ruta ?? "la app"}`)).slice(0, 200);
}

/** Avisa al consumidor sin tumbar el reporte: el dato ya quedó guardado. */
async function avisar(p: ServerPlugin, fila: ErrorReporte, ctx: Partial<ServerCtx>): Promise<void> {
  try {
    await enlacesDe(p).alReportar?.(fila, ctx);
  } catch (err) {
    console.error("[errores] alReportar", err instanceof Error ? err.message : String(err));
  }
}

/** La fila o 404. */
async function exigirFila(p: ServerPlugin, ierror: number, ctx?: Partial<ServerCtx>): Promise<ErrorReporte> {
  const fila = await controlDe(p).get({ ierror }, { ...ctx, include: {} }) as ErrorReporte | null;
  if (!fila) throw new NotFoundError(`El error ${ierror} no existe`);
  return fila;
}

/** Borra los archivos de los errores eliminados. */
async function olvidarArchivos(ctrl: ServerController<any>, ids: number[]): Promise<void> {
  const p = plugins.get(ctrl);
  const archivos = p ? servicioDe<ServerPlugin>(p, "archivos") : null;
  if (archivos && ids.length) await archivos["olvidarDe"](AMBITO, ids);
}

/** JSON del server de errores: `erroresPlugin` + handlers. */
export const erroresServer: ServerPluginDef = Obj.insert(erroresPlugin, {
  cfg: ZErroresConfig,
  entities: {
    errores: {
      hooks: {
        /** Un error borrado (atendido) se lleva sus archivos. */
        async afterDelete(this: ServerController<any>, fila: ErrorReporte) {
          await olvidarArchivos(this, [Number(fila.ierror)]);
        },
        /** Igual en el borrado en plural (`DELETE errores`), la forma normal de cerrar lo atendido. */
        async afterDeleteList(this: ServerController<any>, filas: ErrorReporte[]) {
          await olvidarArchivos(this, filas.map((f) => Number(f.ierror)));
        },
      },
      indexes: [{ columns: ["estado", "fhcre"], name: "ix_errores_estado" }],
      paths: {
        reportarError: {
          /** Reporte de sesión confiable o con código válido. El HTML se recorta al máximo configurado. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ReporteCreado | Response> {
            const input = validado(ZReportarInput, i.body);
            const cfg = this.cfg as ErroresConfig;
            const enlaces = enlacesDe(this);
            const confiable = enlaces.reportanteConfiable ? await enlaces.reportanteConfiable(ctx) : Boolean(ctx.session);
            if (!confiable) {
              const rechazo = await exigirCodigo(this, input.codigo, i.request);
              if (rechazo) return rechazo;
            }
            const conAdjuntos = (input.adjuntos ?? 0) > 0;
            const ctrl = controlDe(this);
            const fila = await ctrl.post(ctrl.pojo({
              ...selloAlta(confiable ? ctx : { ...ctx, session: null }, { apporigin: input.apporigin, pagina: input.ruta, ip: ipReal(this, i.request) }),
              titulo: tituloDe(input.titulo, input.descripcion, input.ruta),
              descripcion: input.descripcion || null,
              severidad: input.severidad ?? null,
              estado: conAdjuntos ? "recibiendo" : "pendiente",
              ruta: input.ruta ?? null,
              url: input.url ?? null,
              html: input.html?.slice(0, cfg.maxHtmlKb * 1024) ?? null,
              contexto: input.contexto ?? null,
              avance: [],
            }), ctx) as ErrorReporte;
            const ierror = Number(fila.ierror);
            if (!conAdjuntos) await avisar(this, fila, ctx);
            return { ierror, estado: fila.estado, token: await firmarToken(this, ierror) };
          },
        },
        adjuntarError: {
          /** Lo que indique el proveedor de LLM del consumidor (p. ej. audio → texto); lo que no se pueda procesar se conserva, nada se pierde. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<AdjuntoResultado> {
            await exigirToken(this, i);
            const cfg = this.cfg as ErroresConfig;
            const ierror = idDe(i);
            const fila = await exigirFila(this, ierror, ctx);
            const archivos = servicioDe<ServerPlugin>(this, "archivos");
            const maxBytes = cfg.maxAdjuntoMb * MEGA;
            if (Number(i.request.headers.get("content-length") ?? 0) > maxBytes + 64 * 1024) throw new HttpError(413, `El adjunto supera ${cfg.maxAdjuntoMb} MB`);
            const cabecera = i.request.headers.get("x-archivo-nombre");
            const { bytes, nombre, mime } = await leerBinario(i.request, cabecera ? decodeURIComponent(cabecera) : undefined);
            const llm = servicioDe<ProveedorLlm>(this, "llm");
            const regla = llm?.planPara(mime) ?? null;
            let texto: string | null = null;
            if (llm && regla?.accion && llm.disponible(regla.accion)) {
              try {
                texto = await llm.ejecutar(regla.accion, { bytes, mime, nombre });
              } catch (err) {
                console.error("[errores] acción de adjunto", regla.accion, err instanceof Error ? err.message : String(err));
              }
            }
            if (texto) {
              const ctrl = controlDe(this);
              const previa = fila.transcripcion ? `${fila.transcripcion}\n\n` : "";
              await ctrl.put(ctrl.pojo({ ierror, transcripcion: `${previa}[${nombre}] ${texto}`, ...selloCambio() }), ctx);
              if (regla && !regla.conservar) return { texto, archivo: null };
            }
            if (!archivos) throw new HttpError(503, "Gestión de archivos no disponible");
            const previos = await archivos["archivosDe"](AMBITO, [ierror]) as unknown[];
            if (previos.length >= cfg.maxAdjuntos) throw new HttpError(413, `Máximo ${cfg.maxAdjuntos} adjuntos por reporte`);
            const guardado = await archivos["guardar"]({ bytes, nombre, mime, origin: AMBITO, idorigin: String(ierror), apporigin: fila.apporigin, pagina: fila.ruta, ip: fila.iporigin, maxBytes }, { ...ctx, session: fila.propietario_tipo === "usuario" ? ctx.session : null });
            return { texto, archivo: await archivos["publico"](guardado, ctx) };
          },
        },
        errorListo: {
          /** Todo subido: entra a la cola y se avisa al consumidor. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ReporteCreado> {
            await exigirToken(this, i);
            const ierror = idDe(i);
            const ctrl = controlDe(this);
            let fila = await exigirFila(this, ierror, ctx);
            if (fila.estado === "recibiendo") {
              fila = await ctrl.put(ctrl.pojo({ ierror, estado: "pendiente", ...selloCambio() }), ctx) as ErrorReporte;
              await avisar(this, fila, ctx);
            }
            return { ierror, estado: fila.estado, token: i.request.headers.get("x-reporte-token") ?? "" };
          },
        },
        seguimientoError: {
          /** Estado y bitácora; sin fila, ya se atendió. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<SeguimientoError> {
            await exigirToken(this, i);
            const fila = await controlDe(this).get({ ierror: idDe(i) }, { ...ctx, include: {} }) as ErrorReporte | null;
            return fila ? { estado: fila.estado, avance: bitacora(fila.avance) } : { estado: "atendido", avance: [] };
          },
        },
        colaErrores: {
          /** Lo tomable: pendientes, recibiendo que se quedaron a medias y tomas vencidas. */
          async handler(this: ServerPlugin, _i: ExtraRouteInput, ctx: ServerCtx): Promise<ErrorReporte[]> {
            const cfg = this.cfg as ErroresConfig;
            const ctrl = controlDe(this);
            const ahora = Date.now();
            const columnas = Object.keys(ctrl.entity.meta.columns).filter((c) => c !== "html");
            return await ctrl.query({ select: columnas, where: { $or: [{ estado: "pendiente" }, { estado: "recibiendo", fhcre: { lt: new Date(ahora - cfg.recibiendoMin * MINUTO) } }, { estado: "en_proceso", ftoma: { lt: new Date(ahora - cfg.tomaMin * MINUTO) } }] }, orderBy: "fhcre", pageSize: ctrl.entity.maxPageSize }, { ...ctx, include: {} }) as ErrorReporte[];
          },
        },
        detalleError: {
          /** Fila completa y archivos con URL. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<DetalleError> {
            const ierror = idDe(i);
            const fila = await exigirFila(this, ierror, ctx);
            const archivos = servicioDe<ServerPlugin>(this, "archivos");
            const filas = archivos ? await archivos["archivosDe"](AMBITO, [ierror]) as Record<string, unknown>[] : [];
            return { ...(fila as unknown as { toJSON(): ErrorReporte }).toJSON(), avance: bitacora(fila.avance), archivos: await Promise.all(filas.map((f) => archivos!["publico"](f, ctx))) };
          },
        },
        tomarError: {
          /** UPDATE condicional: entre dos agentes solo uno afecta la fila; una toma vencida se puede retomar. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ErrorReporte> {
            const { agente } = validado(ZTomarInput, i.body);
            const cfg = this.cfg as ErroresConfig;
            const ierror = idDe(i);
            const ctrl = controlDe(this);
            const ahora = Date.now();
            const col = (f: string) => ctrl.col(null, f);
            const fecha = (campo: string, ms: number) => ctrl.toDb(campo, new Date(ms));
            const r = await sql`update ${sql.table(ctrl.table)} set ${col("estado")} = ${"en_proceso"}, ${col("atendido_por")} = ${agente}, ${col("ftoma")} = ${fecha("ftoma", ahora)}, ${col("fhmod")} = ${fecha("fhmod", ahora)} where ${col("ierror")} = ${ierror} and (${col("estado")} = ${"pendiente"} or (${col("estado")} = ${"recibiendo"} and ${col("fhcre")} < ${fecha("fhcre", ahora - cfg.recibiendoMin * MINUTO)}) or (${col("estado")} = ${"en_proceso"} and ${col("ftoma")} < ${fecha("ftoma", ahora - cfg.tomaMin * MINUTO)}))`.execute(ctrl.db.kysely);
            if (Number(r.numAffectedRows ?? 0) === 0) {
              const fila = await exigirFila(this, ierror, ctx);
              throw new HttpError(409, `El error ${ierror} ya lo atiende ${fila.atendido_por ?? "otro agente"}`);
            }
            return await exigirFila(this, ierror, ctx);
          },
        },
        avanceError: {
          /** Bitácora + latido: renueva la toma. Solo quien la tiene. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ErrorReporte> {
            const { agente, texto } = validado(ZAvanceInput, i.body);
            const ierror = idDe(i);
            const fila = await exigirFila(this, ierror, ctx);
            if (fila.estado !== "en_proceso" || fila.atendido_por !== agente) throw new HttpError(409, `El error ${ierror} no está tomado por ${agente}`);
            const ctrl = controlDe(this);
            const linea: LineaAvance = { fh: new Date().toISOString(), agente, texto };
            return await ctrl.put(ctrl.pojo({ ierror, avance: [...bitacora(fila.avance), linea].slice(-MAX_BITACORA), ftoma: new Date(), ...selloCambio() }), ctx) as ErrorReporte;
          },
        },
        soltarError: {
          /** Vuelve a `pendiente` con la nota. Solo quien la tiene. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ErrorReporte> {
            const { agente, texto } = validado(ZAvanceInput, i.body);
            const ierror = idDe(i);
            const fila = await exigirFila(this, ierror, ctx);
            if (fila.estado !== "en_proceso" || fila.atendido_por !== agente) throw new HttpError(409, `El error ${ierror} no está tomado por ${agente}`);
            const ctrl = controlDe(this);
            const linea: LineaAvance = { fh: new Date().toISOString(), agente, texto: `Soltado: ${texto}` };
            return await ctrl.put(ctrl.pojo({ ierror, estado: "pendiente", atendido_por: null, ftoma: null, avance: [...bitacora(fila.avance), linea].slice(-MAX_BITACORA), ...selloCambio() }), ctx) as ErrorReporte;
          },
        },
      },
    },
  },
  setup(this: ServerPlugin) {
    const codigo = (this.cfg as ErroresConfig).codigo;
    if (codigo !== undefined && codigo.length < 8) throw new Error("El código de reportes debe tener mínimo 8 caracteres");
    for (const c of this.list) plugins.set(c, this);
  },
}) as ServerPluginDef;
