/**
 * Plugin de tiquetes (server): el comportamiento de la entidad abstracta del sistema.
 *
 * - Aislamiento: cada fila lleva iempresa; todo verbo la recibe y NUNCA lee otra (un tiquete de otra empresa es 404).
 *   En HTTP la empresa y el usuario salen de services.contexto; sin ese servicio, de la sesion y de la cabecera
 *   X-Empresa (el consumidor decide como validarla).
 * - Catalogo DECLARATIVO: cfg.tipos y PUT tiquetes/catalogo/{tipo} definen, por empresa, que tipos existen, que estados
 *   usan y que campos propios lleva datos (un restaurante: pedidos con direccion y platos; un hotel: reservas con
 *   habitacion y fechas). Un tipo nuevo no toca codigo.
 * - Alta: pone fecha, autor, prioridad y estado por defecto y valida datos contra los campos del tipo (requeridos y tipos).
 * - Asignar/adoptar: el WRKR toma el tiquete; adoptar es idempotente para el mismo usuario y 409 si ya lo tiene otro.
 * - Estado: maquina de estados unica (TRANSICIONES_TIQUETE), con comentario opcional; cada cambio deja un evento.
 * - Historial: todo (alta, asignacion, adopcion, estado, comentario, cambios y baja) queda en tiquetes_eventos.
 * - Bot: desde-chat (idempotente por iexterno, fechas administradas por el bot), chat (consulta) y estado-chat (cambio).
 * - Discriminacion: clasificar usa la funcion determinista clasificarReporte: TIQUETE (lo resuelve un humano) o ERROR del
 *   sistema, que entra a la cola del plugin errores si esta instalado en la misma base.
 *
 * ```ts
 * const tq = crearTiquetes({ db, cfg: { tipos: [{ iempresa: "hotel", tipo: "reserva", nombre: "Reserva", campos: [{ clave: "habitacion", etiqueta: "Habitacion", tipo: "texto", requerido: true }] }] }, services: { contexto } });
 * const reserva = await tq.crearTiquete("hotel", "ana", { tipo: "reserva", titulo: "Habitacion 12", datos: { habitacion: "12" }, fcha: "2026-12-01T15:00:00Z" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/tiquetes.md
 */
import { HttpError, NotFoundError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { findController } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { selloAlta } from "@Jeff-Aporta/DER/src/03-plugins/common/auditoria.ts";
import { ahora, ctrl, fila, filas, guardar, idNuevo, porPk, sinIndefinidos, validado } from "@Jeff-Aporta/DER/src/03-plugins/common/tablas.ts";
import { clasificarReporte } from "@Jeff-Aporta/DER/src/03-plugins/tiquetes/clasificacion.ts";
import { tiquetesPlugin } from "@Jeff-Aporta/DER/src/03-plugins/tiquetes/index.ts";
import { type AsignarInput, CATALOGO_POR_DEFECTO, type CampoTiquete, type Clasificacion, type ClasificarInput, type ComentarInput, type ContextoTiquetes, type DesdeChatInput, type DetalleTiquete, ESTADOS_CIERRE, ESTADOS_TIQUETE, type EstadoChatInput, type EstadoInput, type EstadoTiquete, type EventoTiquete, type ListaFiltros, type PaginaTiquetes, type PrioridadTiquete, TRANSICIONES_TIQUETE, type Tiquete, type TiqueteCambio, type TiqueteInput, type TiquetesConfig, type TiquetesServicios, type TipoCampoTiquete, type TipoTiqueteFila, type TipoTiqueteInput, type VerbosTiquetes, ZAsignar, ZClasificar, ZComentar, ZDesdeChat, ZEstado, ZEstadoChat, ZTiqueteCambio, ZTiqueteInput, ZTipoCatalogoTiquete, ZTiquetesConfig } from "@Jeff-Aporta/DER/src/03-plugins/tiquetes/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/tiquetes/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/tiquetes/clasificacion.ts";

const cfgDe = (p: ServerPlugin): TiquetesConfig => (p.cfg ?? {}) as TiquetesConfig;
const servicios = (p: ServerPlugin): TiquetesServicios => (p.services ?? {}) as TiquetesServicios;

/** Texto normalizado del tipo: minusculas, sin espacios y con _ (asi "Mi Tipo" y "mi_tipo" son el mismo). */
function normalizaTipo(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40);
}

/** Fecha ISO valida (o null); una fecha invalida es 400 de validacion. */
function fechaISO(v: string | null | undefined, campo: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new ValidationError("«" + campo + "» no es una fecha valida");
  return new Date(t).toISOString();
}

/** Titulo corto a partir de un texto libre (para el clasificador). */
function tituloDe(texto: string): string {
  const primera = texto.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return (primera || "Reporte del cliente").slice(0, 160);
}

/** Sesion de la peticion: el servicio contexto del consumidor; si no esta, la sesion + la cabecera X-Empresa. */
async function contextoHttp(p: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ContextoTiquetes> {
  const f = servicios(p).contexto;
  if (f) return await f(i.request, ctx.session);
  const claims = (ctx.session?.claims ?? {}) as { iempresa?: unknown };
  const iempresa = (i.request.headers.get("x-empresa") ?? String(claims.iempresa ?? "")).trim().slice(0, 40);
  const iusuario = String(ctx.session?.id ?? "").trim().slice(0, 120);
  if (!iusuario) throw new HttpError(401, "Falta la sesion");
  if (!iempresa) throw new HttpError(400, "Falta la empresa: usa services.contexto o la cabecera X-Empresa");
  return { iusuario, iempresa };
}

/** Los estados que admite un tipo (los suyos o, si no declaro, todos). */
function estadosDe(t: TipoTiqueteFila): EstadoTiquete[] {
  return Array.isArray(t.estados) && t.estados.length ? t.estados : [...ESTADOS_TIQUETE];
}

/** Los estados que cierran un tipo (los suyos o los de fabrica). */
function cierranDe(t: TipoTiqueteFila): EstadoTiquete[] {
  return Array.isArray(t.cierran) && t.cierran.length ? t.cierran : [...ESTADOS_CIERRE];
}

/** Catalogo vivo de la empresa: lo declarado en la base + los tipos de fabrica que no haya sobrescrito. */
async function catalogoDe(p: ServerPlugin, iempresa: string): Promise<TipoTiqueteFila[]> {
  const propias = await filas<TipoTiqueteFila>(p, "tipos", { where: { iempresa }, pageSize: 200 });
  const porTipo = new Map(propias.map((t) => [t.tipo, t]));
  const fabrica: TipoTiqueteFila[] = CATALOGO_POR_DEFECTO.filter((b) => !porTipo.has(b.tipo)).map((b) => ({ iempresa, tipo: b.tipo, nombre: b.nombre, descripcion: b.descripcion, estados: b.estados, cierran: b.cierran, campos: b.campos, bactivo: true, fhcre: ahora(), fhact: null }));
  return [...propias, ...fabrica].filter((t) => t.bactivo !== false).sort((a, b) => a.tipo.localeCompare(b.tipo));
}

/** El tipo de la empresa o 400 de validacion si no existe. */
async function tipoDe(p: ServerPlugin, iempresa: string, tipo: string): Promise<TipoTiqueteFila> {
  const t = (await catalogoDe(p, iempresa)).find((x) => x.tipo === tipo);
  if (!t) throw new ValidationError("La empresa no tiene el tipo de tiquete «" + tipo + "»");
  return t;
}

/** Un valor encaja con el tipo declarado del campo. */
function cumpleTipo(tipo: TipoCampoTiquete, v: unknown): boolean {
  switch (tipo) {
    case "texto":
      return typeof v === "string";
    case "numero":
      return typeof v === "number" && Number.isFinite(v);
    case "booleano":
      return typeof v === "boolean";
    case "fecha":
    case "fechaHora":
      return typeof v === "string" && !Number.isNaN(Date.parse(v));
    case "lista":
      return Array.isArray(v);
    case "json":
      return typeof v === "object" && v !== null;
    default:
      return false;
  }
}

/** Valida datos contra los campos del tipo: los requeridos existen y cada valor respeta el tipo (y sus opciones). */
function validarDatos(campos: CampoTiquete[] | null, datos: unknown): Record<string, unknown> {
  const d = datos ?? {};
  if (typeof d !== "object" || d === null || Array.isArray(d)) throw new ValidationError("datos debe ser un objeto JSON");
  const props = d as Record<string, unknown>;
  for (const campo of campos ?? []) {
    const v = props[campo.clave];
    if (campo.requerido && (v === undefined || v === null || v === "")) throw new ValidationError("Falta «" + campo.clave + "» (" + campo.etiqueta + ")");
    if (v === undefined || v === null) continue;
    if (!cumpleTipo(campo.tipo, v)) throw new ValidationError("«" + campo.clave + "» debe ser " + campo.tipo);
    const opciones = campo.opciones ?? [];
    if (opciones.length && campo.tipo === "texto" && !opciones.includes(String(v))) throw new ValidationError("«" + campo.clave + "» solo admite: " + opciones.join(", "));
    if (opciones.length && campo.tipo === "lista" && !(v as unknown[]).every((x) => opciones.includes(String(x)))) throw new ValidationError("«" + campo.clave + "» solo admite: " + opciones.join(", "));
  }
  return props;
}

/** Un evento del historial (tambien los comentarios) y el aviso al consumidor. */
async function anotar(p: ServerPlugin, ev: { iempresa: string; itiquete: string; clase: string; estadoAnterior?: EstadoTiquete | null | undefined; estado?: EstadoTiquete | null | undefined; iusuario?: string | null | undefined; texto?: string | null | undefined; datos?: unknown }): Promise<EventoTiquete> {
  const c = ctrl(p, "eventos");
  const creado = await c.post(c.pojo({ id: idNuevo(), iempresa: ev.iempresa, itiquete: ev.itiquete, clase: ev.clase, estadoAnterior: ev.estadoAnterior ?? null, estado: ev.estado ?? null, iusuario: ev.iusuario ?? null, texto: ev.texto ?? null, datos: ev.datos ?? null, fhcre: ahora() }));
  const evento = fila(creado) as EventoTiquete;
  const t = await porPk<Tiquete>(p, "tiquetes", { id: ev.itiquete });
  if (t) await servicios(p).alEvento?.(evento, t);
  return evento;
}

/** El tiquete de ESTA empresa (404 si no existe o es de otra: nunca se distingue). */
async function leer(p: ServerPlugin, iempresa: string, id: string): Promise<Tiquete> {
  const t = await porPk<Tiquete>(p, "tiquetes", { id });
  if (!t || t.iempresa !== iempresa) throw new NotFoundError("Ese tiquete no existe");
  return t;
}

/** Crea un tiquete: valida el tipo y los datos, pone defaults y deja el alta (y la asignacion) en el historial. */
async function crearTiquete(p: ServerPlugin, iempresa: string, iusuario: string, input: TiqueteInput): Promise<Tiquete> {
  const d = validado<TiqueteInput>(ZTiqueteInput, input);
  const tipo = normalizaTipo(d.tipo);
  const def = await tipoDe(p, iempresa, tipo);
  const estado = d.estado ?? "nuevo";
  if (!estadosDe(def).includes(estado)) throw new ValidationError("El tipo «" + tipo + "» no admite el estado «" + estado + "»");
  const datos = validarDatos(def.campos, d.datos ?? {});
  const fcha = fechaISO(d.fcha, "fcha") ?? ahora();
  const fchaFin = fechaISO(d.fchaFin, "fchaFin");
  if (fchaFin && Date.parse(fchaFin) < Date.parse(fcha)) throw new ValidationError("fchaFin no puede ser anterior a fcha");
  const prioridad = d.prioridad ?? cfgDe(p).prioridadPorDefecto ?? "media";
  const c = ctrl(p, "tiquetes");
  const creado = await c.post(c.pojo({ id: idNuevo(), iempresa, tipo, estado, titulo: d.titulo, descripcion: d.descripcion ?? null, datos, fcha, fchaFin, prioridad, iusuarioCreador: iusuario, iusuarioAsignado: d.iusuarioAsignado ?? null, ichat: d.ichat ?? null, iexterno: d.iexterno ?? null, fhcre: ahora(), fhact: null, bactivo: true }));
  const t = fila(creado) as Tiquete;
  await anotar(p, { iempresa, itiquete: t.id, clase: "creado", estado: t.estado, iusuario, texto: "Alta del tiquete", datos: { tipo: t.tipo } });
  if (t.iusuarioAsignado) await anotar(p, { iempresa, itiquete: t.id, clase: "asignado", estadoAnterior: t.estado, estado: t.estado, iusuario, texto: "Asignado a " + t.iusuarioAsignado, datos: { iusuarioAsignado: t.iusuarioAsignado } });
  return t;
}

/** Pagina filtrada de tiquetes de la empresa (el total es de lo que cumple los filtros). */
async function listarTiquetes(p: ServerPlugin, iempresa: string, iusuario: string, filtros: ListaFiltros = {}): Promise<PaginaTiquetes> {
  const page = Math.max(1, Math.floor(filtros.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(filtros.pageSize ?? 50)));
  const where: Record<string, unknown> = { iempresa };
  if (!filtros.incluirArchivados) where["bactivo"] = true;
  if (filtros.estado) where["estado"] = filtros.estado;
  if (filtros.tipo) where["tipo"] = normalizaTipo(filtros.tipo);
  if (filtros.prioridad) where["prioridad"] = filtros.prioridad;
  if (filtros.sinAsignar) where["iusuarioAsignado"] = null;
  else if (filtros.asignado) where["iusuarioAsignado"] = filtros.asignado === "mi" ? iusuario : filtros.asignado;
  const desde = fechaISO(filtros.desde, "desde");
  const hasta = fechaISO(filtros.hasta, "hasta");
  if (desde || hasta) where["fcha"] = { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) };
  const q = filtros.q?.trim();
  if (q) where["$or"] = [{ titulo: { contains: q } }, { descripcion: { contains: q } }, { id: { contains: q } }];
  const c = ctrl(p, "tiquetes");
  const todos = await c.query({ select: ["id"], where, pageSize: c.entity.maxPageSize } as never);
  const pagina = await c.query({ where, orderBy: ["-fhcre"], page, pageSize } as never);
  return { tiquetes: pagina.map((x: unknown) => fila(x) as Tiquete), total: todos.length, page, pageSize };
}

/** El tiquete con su historial completo, en orden de llegada. */
async function detalleTiquete(p: ServerPlugin, iempresa: string, id: string): Promise<DetalleTiquete> {
  const t = await leer(p, iempresa, id);
  const eventos = await filas<EventoTiquete>(p, "eventos", { where: { iempresa, itiquete: id }, orderBy: "id", pageSize: 1000 });
  return { tiquete: t, eventos };
}

/** Cambia los datos editables (el tipo no cambia y el estado va por su ruta). */
async function cambiarTiquete(p: ServerPlugin, iempresa: string, iusuario: string, id: string, cambio: TiqueteCambio): Promise<Tiquete> {
  const d = validado<TiqueteCambio>(ZTiqueteCambio, cambio);
  const t = await leer(p, iempresa, id);
  const def = await tipoDe(p, iempresa, t.tipo);
  const datos = d.datos === undefined ? undefined : validarDatos(def.campos, d.datos);
  const fcha = d.fcha === undefined ? undefined : fechaISO(d.fcha, "fcha");
  const fchaFin = d.fchaFin === undefined ? undefined : fechaISO(d.fchaFin, "fchaFin");
  const nuevaFcha = fcha ?? t.fcha;
  const nuevaFin = fchaFin === undefined ? t.fchaFin : fchaFin;
  if (nuevaFin && Date.parse(nuevaFin) < Date.parse(nuevaFcha)) throw new ValidationError("fchaFin no puede ser anterior a fcha");
  const cambios = sinIndefinidos({ titulo: d.titulo, descripcion: d.descripcion, datos, fcha, fchaFin, prioridad: d.prioridad, iusuarioAsignado: d.iusuarioAsignado, fhact: ahora() });
  const guardado = await guardar<Tiquete>(p, "tiquetes", { id: t.id }, cambios);
  await anotar(p, { iempresa, itiquete: t.id, clase: "actualizado", estado: t.estado, iusuario, texto: "Cambio de datos", datos: Object.keys(cambios) });
  return guardado;
}

/** Baja logica: archiva el tiquete (la fila y su historial se conservan). */
async function archivarTiquete(p: ServerPlugin, iempresa: string, iusuario: string, id: string): Promise<Tiquete> {
  const t = await leer(p, iempresa, id);
  const archivado = await guardar<Tiquete>(p, "tiquetes", { id: t.id }, { bactivo: false, fhact: ahora() });
  await anotar(p, { iempresa, itiquete: t.id, clase: "archivado", estado: t.estado, iusuario, texto: "Baja logica del tiquete" });
  return archivado;
}

/** Los estados terminales no admiten asignacion ni adopcion. */
function exigirAbierto(t: Tiquete): void {
  if (t.estado === "cerrado" || t.estado === "cancelado") throw new HttpError(409, "El tiquete esta cerrado o cancelado");
}

/** Asigna el tiquete a un WRKR (si estaba nuevo, pasa a asignado). */
async function asignarTiquete(p: ServerPlugin, iempresa: string, iusuario: string, id: string, input: AsignarInput): Promise<Tiquete> {
  const d = validado<AsignarInput>(ZAsignar, input);
  const t = await leer(p, iempresa, id);
  exigirAbierto(t);
  const estado: EstadoTiquete = t.estado === "nuevo" ? "asignado" : t.estado;
  const guardado = await guardar<Tiquete>(p, "tiquetes", { id: t.id }, { iusuarioAsignado: d.iusuarioAsignado, estado, fhact: ahora() });
  await anotar(p, { iempresa, itiquete: t.id, clase: "asignado", estadoAnterior: t.estado, estado, iusuario, texto: d.nota ?? "Asignado a " + d.iusuarioAsignado, datos: { iusuarioAsignado: d.iusuarioAsignado } });
  return guardado;
}

/** El WRKR de la sesion toma el tiquete (si no tiene responsable o ya es suyo). */
async function adoptarTiquete(p: ServerPlugin, iempresa: string, iusuario: string, id: string): Promise<Tiquete> {
  const t = await leer(p, iempresa, id);
  exigirAbierto(t);
  if (t.iusuarioAsignado && t.iusuarioAsignado !== iusuario) throw new HttpError(409, "Ese tiquete ya lo tiene " + t.iusuarioAsignado);
  const estado: EstadoTiquete = t.estado === "nuevo" ? "asignado" : t.estado;
  const guardado = await guardar<Tiquete>(p, "tiquetes", { id: t.id }, { iusuarioAsignado: iusuario, estado, fhact: ahora() });
  await anotar(p, { iempresa, itiquete: t.id, clase: "adoptado", estadoAnterior: t.estado, estado, iusuario, texto: "Tomado por " + iusuario });
  return guardado;
}

/** Mueve el tiquete por la maquina de estados; el comentario (si viene) queda en el historial. */
async function cambiarEstado(p: ServerPlugin, iempresa: string, iusuario: string, id: string, input: EstadoInput): Promise<Tiquete> {
  const d = validado<EstadoInput>(ZEstado, input);
  const t = await leer(p, iempresa, id);
  if (t.estado === d.estado) return t;
  const def = await tipoDe(p, iempresa, t.tipo);
  if (!estadosDe(def).includes(d.estado)) throw new ValidationError("El estado «" + d.estado + "» no pertenece al tipo «" + t.tipo + "»");
  const permitidos = TRANSICIONES_TIQUETE[t.estado] ?? [];
  if (!permitidos.includes(d.estado)) throw new ValidationError("No se puede pasar de «" + t.estado + "» a «" + d.estado + "»");
  const guardado = await guardar<Tiquete>(p, "tiquetes", { id: t.id }, { estado: d.estado, fhact: ahora() });
  const cierra = cierranDe(def).includes(d.estado);
  await anotar(p, { iempresa, itiquete: t.id, clase: "estado", estadoAnterior: t.estado, estado: d.estado, iusuario, texto: d.comentario ?? (cierra ? "Cierre del tiquete" : "Cambio de estado"), datos: { cierra } });
  return guardado;
}

/** Agrega un comentario al historial. */
async function comentarTiquete(p: ServerPlugin, iempresa: string, iusuario: string, id: string, input: ComentarInput): Promise<EventoTiquete> {
  const d = validado<ComentarInput>(ZComentar, input);
  const t = await leer(p, iempresa, id);
  return await anotar(p, { iempresa, itiquete: t.id, clase: "comentario", estado: t.estado, iusuario, texto: d.texto });
}

/** Define o cambia un tipo del catalogo de la empresa (declarativo, sin codigo). */
async function definirTipo(p: ServerPlugin, iempresa: string, tipo: string, input: TipoTiqueteInput): Promise<TipoTiqueteFila> {
  const d = validado<TipoTiqueteInput>(ZTipoCatalogoTiquete, input);
  const clave = normalizaTipo(tipo);
  const previo = await porPk<TipoTiqueteFila>(p, "tipos", { iempresa, tipo: clave });
  const estados = d.estados ?? previo?.estados ?? [...ESTADOS_TIQUETE];
  const cierran = d.cierran ?? previo?.cierran ?? [...ESTADOS_CIERRE].filter((e) => estados.includes(e));
  const fuera = cierran.filter((e) => !estados.includes(e));
  if (fuera.length) throw new ValidationError("Los estados de cierre no pertenecen al tipo: " + fuera.join(", "));
  const campos = d.campos ?? previo?.campos ?? [];
  return await guardar<TipoTiqueteFila>(p, "tipos", { iempresa, tipo: clave }, { nombre: d.nombre, descripcion: d.descripcion ?? previo?.descripcion ?? null, estados, cierran, campos, bactivo: d.bactivo ?? previo?.bactivo ?? true, fhcre: previo?.fhcre ?? ahora(), fhact: previo ? ahora() : null });
}

/** Alta desde una conversacion del bot: idempotente por iexterno y con las fechas que administra el bot. */
async function desdeChat(p: ServerPlugin, iempresa: string, iusuario: string, input: DesdeChatInput): Promise<Tiquete> {
  const d = validado<DesdeChatInput>(ZDesdeChat, input);
  const externo = d.iexterno?.trim();
  if (externo) {
    const previo = (await filas<Tiquete>(p, "tiquetes", { where: { iempresa, iexterno: externo }, pageSize: 1 }))[0];
    if (previo) return previo;
  }
  return await crearTiquete(p, iempresa, iusuario, { tipo: d.tipo ?? "solicitud", titulo: d.titulo, descripcion: d.descripcion ?? null, datos: d.datos ?? {}, fcha: d.fcha ?? null, fchaFin: d.fchaFin ?? null, prioridad: d.prioridad, iusuarioAsignado: d.iusuarioAsignado ?? null, ichat: d.ichat, iexterno: externo ?? null });
}

/** Tiquetes de una conversacion (lo que el bot consulta), el mas reciente primero. */
async function tiquetesDeChat(p: ServerPlugin, iempresa: string, ichat: string): Promise<Tiquete[]> {
  return await filas<Tiquete>(p, "tiquetes", { where: { iempresa, ichat, bactivo: true }, orderBy: ["-fhcre"], pageSize: 200 });
}

/** Cambio de estado pedido desde la conversacion: el tiquete tiene que ser de ese ichat. */
async function estadoDesdeChat(p: ServerPlugin, iempresa: string, iusuario: string, input: EstadoChatInput): Promise<Tiquete> {
  const d = validado<EstadoChatInput>(ZEstadoChat, input);
  const t = await leer(p, iempresa, d.id);
  if (t.ichat !== d.ichat) throw new NotFoundError("Ese tiquete no pertenece a la conversacion");
  return await cambiarEstado(p, iempresa, iusuario, t.id, { estado: d.estado, comentario: d.comentario ?? null });
}

/** Un reporte del sistema entra a la cola del plugin errores si esta instalado en la misma base. */
async function registrarEnErrores(p: ServerPlugin, iempresa: string, iusuario: string, texto: string, d: ClasificarInput, clasificacion: Clasificacion): Promise<number | null> {
  if (cfgDe(p).registrarEnErrores === false) return null;
  const c = findController("errores");
  if (!c || c.db !== ctrl(p, "tiquetes").db) return null;
  const filaError = await c.post(c.pojo({ ...selloAlta({ session: { id: iusuario } }, { apporigin: "tiquetes", pagina: d.contexto?.ruta ?? null, ip: null }), titulo: tituloDe(d.titulo ?? texto).slice(0, 200), descripcion: texto.slice(0, 20000), severidad: "alta", estado: "pendiente", ruta: d.contexto?.ruta ?? null, contexto: { origen: "tiquetes", iempresa, ichat: d.ichat ?? null, clasificacion: { motivo: clasificacion.motivo, senales: clasificacion.senales } }, avance: [] }));
  return Number(fila(filaError)["ierror"]);
}

/** Clasifica un reporte y crea lo que corresponda: un tiquete o un reporte en la cola de errores. */
async function clasificar(p: ServerPlugin, iempresa: string, iusuario: string, input: ClasificarInput): Promise<Clasificacion> {
  const d = validado<ClasificarInput>(ZClasificar, input);
  const veredicto = clasificarReporte(d.texto, d.contexto ?? {});
  const salida: Clasificacion = { ...veredicto, tiquete: null, ierror: null };
  if (d.crear === false) return salida;
  if (veredicto.destino === "error") {
    salida.ierror = await registrarEnErrores(p, iempresa, iusuario, d.texto, d, salida);
    return salida;
  }
  salida.tiquete = await crearTiquete(p, iempresa, iusuario, { tipo: d.tipo ?? "solicitud", titulo: d.titulo ?? tituloDe(d.texto), descripcion: d.texto, datos: { reporte: d.texto, clasificacion: { motivo: veredicto.motivo, senales: veredicto.senales } }, ichat: d.ichat ?? null });
  return salida;
}

/** Filtros de la lista a partir de la query HTTP. */
function filtrosDeQuery(i: ExtraRouteInput): ListaFiltros {
  const texto = (k: string): string | undefined => i.query.get(k) ?? undefined;
  const numero = (k: string): number | undefined => {
    const n = Number(i.query.get(k));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const bandera = (k: string): boolean => i.query.get(k) === "true" || i.query.get(k) === "1";
  return { estado: texto("estado") as EstadoTiquete | undefined, tipo: texto("tipo"), prioridad: texto("prioridad") as PrioridadTiquete | undefined, asignado: texto("asignado"), sinAsignar: bandera("sinAsignar"), desde: texto("desde"), hasta: texto("hasta"), q: texto("q"), incluirArchivados: bandera("incluirArchivados"), page: numero("page"), pageSize: numero("pageSize") };
}

/** JSON del server de tiquetes: tiquetesPlugin + handlers + verbos + seed. */
export const tiquetesServer: ServerPluginDef = Obj.insert(tiquetesPlugin, {
  cfg: ZTiquetesConfig,
  entities: {
    tiquetes: { indexes: [{ columns: ["iempresa", "estado", "fhcre"], name: "ix_tiquetes_estado" }, { columns: ["iempresa", "iusuarioAsignado"], name: "ix_tiquetes_asignado" }, { columns: ["iempresa", "tipo"], name: "ix_tiquetes_tipo" }, { columns: ["iempresa", "iexterno"], name: "ix_tiquetes_externo" }] },
    eventos: { indexes: [{ columns: ["itiquete", "id"], name: "ix_tiquetes_eventos_tiquete" }] },
  },
  irregularPaths: {
    listarTiquetes: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<PaginaTiquetes> {
        const c = await contextoHttp(this, i, ctx);
        return await listarTiquetes(this, c.iempresa, c.iusuario, filtrosDeQuery(i));
      },
    },
    crearTiquete: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Tiquete> {
        const c = await contextoHttp(this, i, ctx);
        return await crearTiquete(this, c.iempresa, c.iusuario, i.body as TiqueteInput);
      },
    },
    detalleTiquete: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<DetalleTiquete> {
        const c = await contextoHttp(this, i, ctx);
        return await detalleTiquete(this, c.iempresa, i.params["id"] ?? "");
      },
    },
    cambiarTiquete: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Tiquete> {
        const c = await contextoHttp(this, i, ctx);
        return await cambiarTiquete(this, c.iempresa, c.iusuario, i.params["id"] ?? "", i.body as TiqueteCambio);
      },
    },
    archivarTiquete: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Tiquete> {
        const c = await contextoHttp(this, i, ctx);
        return await archivarTiquete(this, c.iempresa, c.iusuario, i.params["id"] ?? "");
      },
    },
    asignarTiquete: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Tiquete> {
        const c = await contextoHttp(this, i, ctx);
        return await asignarTiquete(this, c.iempresa, c.iusuario, i.params["id"] ?? "", i.body as AsignarInput);
      },
    },
    adoptarTiquete: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Tiquete> {
        const c = await contextoHttp(this, i, ctx);
        return await adoptarTiquete(this, c.iempresa, c.iusuario, i.params["id"] ?? "");
      },
    },
    cambiarEstado: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Tiquete> {
        const c = await contextoHttp(this, i, ctx);
        return await cambiarEstado(this, c.iempresa, c.iusuario, i.params["id"] ?? "", i.body as EstadoInput);
      },
    },
    comentarTiquete: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<{ evento: EventoTiquete }> {
        const c = await contextoHttp(this, i, ctx);
        return { evento: await comentarTiquete(this, c.iempresa, c.iusuario, i.params["id"] ?? "", i.body as ComentarInput) };
      },
    },
    catalogo: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<TipoTiqueteFila[]> {
        const c = await contextoHttp(this, i, ctx);
        return await catalogoDe(this, c.iempresa);
      },
    },
    definirTipo: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<TipoTiqueteFila> {
        const c = await contextoHttp(this, i, ctx);
        return await definirTipo(this, c.iempresa, i.params["tipo"] ?? "", i.body as TipoTiqueteInput);
      },
    },
    desdeChat: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Tiquete> {
        const c = await contextoHttp(this, i, ctx);
        return await desdeChat(this, c.iempresa, c.iusuario, i.body as DesdeChatInput);
      },
    },
    chat: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<{ ichat: string; tiquetes: Tiquete[] }> {
        const c = await contextoHttp(this, i, ctx);
        const ichat = i.query.get("ichat") ?? "";
        if (!ichat) throw new ValidationError("Falta ichat");
        return { ichat, tiquetes: await tiquetesDeChat(this, c.iempresa, ichat) };
      },
    },
    estadoChat: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Tiquete> {
        const c = await contextoHttp(this, i, ctx);
        return await estadoDesdeChat(this, c.iempresa, c.iusuario, i.body as EstadoChatInput);
      },
    },
    clasificar: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Clasificacion> {
        const c = await contextoHttp(this, i, ctx);
        return await clasificar(this, c.iempresa, c.iusuario, i.body as ClasificarInput);
      },
    },
  },
  /** En el server, los verbos son metodos directos (sin HTTP): las mismas funciones que usan los handlers. */
  setup(this: ServerPlugin) {
    const v: VerbosTiquetes = {
      crearTiquete: (iempresa, iusuario, input) => crearTiquete(this, iempresa, iusuario, input),
      listarTiquetes: (iempresa, filtros) => listarTiquetes(this, iempresa, "", filtros),
      detalleTiquete: (iempresa, id) => detalleTiquete(this, iempresa, id),
      cambiarTiquete: (iempresa, id, cambio) => cambiarTiquete(this, iempresa, "", id, cambio),
      archivarTiquete: (iempresa, id) => archivarTiquete(this, iempresa, "", id),
      asignarTiquete: (iempresa, id, input) => asignarTiquete(this, iempresa, "", id, input),
      adoptarTiquete: (iempresa, iusuario, id) => adoptarTiquete(this, iempresa, iusuario, id),
      cambiarEstado: (iempresa, id, iusuario, input) => cambiarEstado(this, iempresa, iusuario, id, input),
      comentarTiquete: (iempresa, id, iusuario, input) => comentarTiquete(this, iempresa, iusuario, id, input),
      catalogo: (iempresa) => catalogoDe(this, iempresa),
      definirTipo: (iempresa, tipo, input) => definirTipo(this, iempresa, tipo, input),
      desdeChat: (iempresa, iusuario, input) => desdeChat(this, iempresa, iusuario, input),
      tiquetesDeChat: (iempresa, ichat) => tiquetesDeChat(this, iempresa, ichat),
      estadoDesdeChat: (iempresa, iusuario, input) => estadoDesdeChat(this, iempresa, iusuario, input),
      clasificar: (iempresa, iusuario, input) => clasificar(this, iempresa, iusuario, input),
    };
    Object.assign(this, v);
  },
  /** Crea sus tablas (y les suma columnas nuevas) y siembra los tipos declarados en cfg.tipos. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
    for (const t of cfgDe(this).tipos ?? []) await definirTipo(this, t.iempresa, t.tipo, { nombre: t.nombre, descripcion: t.descripcion, estados: t.estados, cierran: t.cierran, campos: t.campos, bactivo: t.bactivo });
  },
}) as ServerPluginDef;

/** createServer(tiquetesServer, runtime) con los verbos tipados (services: contexto, alEvento). */
export function crearTiquetes(runtime: ServerPluginRuntime): ServerPlugin & VerbosTiquetes {
  return createServer(tiquetesServer, runtime) as ServerPlugin & VerbosTiquetes;
}
