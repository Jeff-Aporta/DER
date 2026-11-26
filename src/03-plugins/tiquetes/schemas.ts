/**
 * Tipos y Zod del plugin de tiquetes: la entidad ABSTRACTA del sistema que sirve para pedidos, entregas, reservas y
 * solicitudes segun el TIPO DE EMPRESA. El catalogo de tipos y de campos de cada tipo es DECLARATIVO (JSON por empresa):
 * un restaurante define pedidos con direccion y platos; un hotel, reservas con habitacion y fechas; sin tocar codigo.
 *
 *   tiquetes_tipos     (iempresa, tipo, nombre, descripcion, estados, cierran, campos, bactivo, fhcre, fhact)
 *   tiquetes_tiquetes  (id, iempresa, tipo, estado, titulo, descripcion, datos, fcha, fchaFin, prioridad, iusuarioCreador, iusuarioAsignado, ichat, iexterno, fhcre, fhact, bactivo)
 *   tiquetes_eventos   (id, iempresa, itiquete, clase, estadoAnterior, estado, iusuario, texto, datos, fhcre)
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/tiquetes.md
 */
import { z } from "zod";

/** Tipos que trae el plugin de fabrica; el catalogo de cada empresa puede definir CUALQUIER otro texto. */
export const TIPOS_TIQUETE = ["pedido", "entrega", "reserva", "solicitud", "otro"] as const;

/** Estados del ciclo de vida de un tiquete (un tipo puede restringirlos en su catalogo). */
export const ESTADOS_TIQUETE = ["nuevo", "asignado", "en_proceso", "esperando", "listo", "entregado", "cerrado", "cancelado"] as const;

/** Estados que cierran un tiquete por defecto (configurable por tipo). */
export const ESTADOS_CIERRE = ["entregado", "cerrado", "cancelado"] as const;

/** Prioridad del tiquete. */
export const PRIORIDADES_TIQUETE = ["baja", "media", "alta", "urgente"] as const;

/** Tipos de campo que un catalogo puede declarar en `datos`. */
export const TIPOS_CAMPO_TIQUETE = ["texto", "numero", "booleano", "fecha", "fechaHora", "lista", "json"] as const;

/** Transiciones permitidas del estado: la maquina de estados es la misma para todos los tipos. */
export const TRANSICIONES_TIQUETE: Record<string, readonly string[]> = {
  nuevo: ["asignado", "en_proceso", "esperando", "cancelado"],
  asignado: ["en_proceso", "esperando", "cancelado"],
  en_proceso: ["esperando", "listo", "cancelado"],
  esperando: ["en_proceso", "listo", "cancelado"],
  listo: ["entregado", "cerrado", "en_proceso"],
  entregado: ["cerrado"],
  cerrado: [],
  cancelado: [],
};

/** Tipo de tiquete (texto: el catalogo de la empresa decide cuales existen). */
export type TipoTiquete = string;

/** Estado de un tiquete. */
export type EstadoTiquete = (typeof ESTADOS_TIQUETE)[number];

/** Prioridad de un tiquete. */
export type PrioridadTiquete = (typeof PRIORIDADES_TIQUETE)[number];

/** Tipo de un campo declarado en `datos`. */
export type TipoCampoTiquete = (typeof TIPOS_CAMPO_TIQUETE)[number];

/** Un campo propio del tipo (lo que el tiquete guarda en `datos`): clave, rotulo, tipo, si es obligatorio y sus opciones. */
export type CampoTiquete = { clave: string; etiqueta: string; tipo: TipoCampoTiquete; requerido: boolean; opciones?: string[] | undefined; defecto?: unknown; ayuda?: string | undefined };

/** Un tipo de tiquete tal como lo declara (o lo sobrescribe) una empresa. */
export type TipoTiqueteDef = { tipo: TipoTiquete; nombre: string; descripcion: string; estados: EstadoTiquete[]; cierran: EstadoTiquete[]; campos: CampoTiquete[] };

/** Un tipo base de fabrica (sin empresa: el catalogo lo copia para cada empresa que no lo haya declarado). */
export type TipoTiqueteBase = TipoTiqueteDef;

/** Fila del catalogo de tipos de UNA empresa. */
export type TipoTiqueteFila = { iempresa: string; tipo: TipoTiquete; nombre: string; descripcion: string | null; estados: EstadoTiquete[] | null; cierran: EstadoTiquete[] | null; campos: CampoTiquete[] | null; bactivo: boolean; fhcre: string; fhact: string | null };

/** Un tiquete: la entidad abstracta del negocio. */
export type Tiquete = { id: string; iempresa: string; tipo: TipoTiquete; estado: EstadoTiquete; titulo: string; descripcion: string | null; datos: unknown; fcha: string; fchaFin: string | null; prioridad: PrioridadTiquete; iusuarioCreador: string; iusuarioAsignado: string | null; ichat: string | null; iexterno: string | null; fhcre: string; fhact: string | null; bactivo: boolean };

/** Un evento del historial de un tiquete (tambien es el comentario: `clase` = `comentario`). */
export type EventoTiquete = { id: string; iempresa: string; itiquete: string; clase: string; estadoAnterior: EstadoTiquete | null; estado: EstadoTiquete | null; iusuario: string | null; texto: string | null; datos: unknown; fhcre: string };

/** Detalle: el tiquete y su historial completo, en orden de llegada. */
export type DetalleTiquete = { tiquete: Tiquete; eventos: EventoTiquete[] };

/** Datos para crear un tiquete. `datos` se valida contra los campos del tipo (catalogo de la empresa). */
export type TiqueteInput = { tipo: TipoTiquete; titulo: string; descripcion?: string | null | undefined; datos?: unknown; estado?: EstadoTiquete | undefined; fcha?: string | null | undefined; fchaFin?: string | null | undefined; prioridad?: PrioridadTiquete | undefined; iusuarioAsignado?: string | null | undefined; ichat?: string | null | undefined; iexterno?: string | null | undefined };

/** Cambios sobre los datos editables de un tiquete (el tipo NO cambia; el estado va por su propia ruta). */
export type TiqueteCambio = { titulo?: string | undefined; descripcion?: string | null | undefined; datos?: unknown; fcha?: string | null | undefined; fchaFin?: string | null | undefined; prioridad?: PrioridadTiquete | undefined; iusuarioAsignado?: string | null | undefined };

/** Filtros de la lista (todos opcionales). `asignado` = `mi` o el id de un WRKR; `sinAsignar` = sin responsable. */
export type ListaFiltros = { estado?: EstadoTiquete | undefined; tipo?: TipoTiquete | undefined; prioridad?: PrioridadTiquete | undefined; asignado?: string | undefined; sinAsignar?: boolean | undefined; desde?: string | undefined; hasta?: string | undefined; q?: string | undefined; incluirArchivados?: boolean | undefined; page?: number | undefined; pageSize?: number | undefined };

/** Pagina de tiquetes (el total es de lo que cumple los filtros, no de la pagina). */
export type PaginaTiquetes = { tiquetes: Tiquete[]; total: number; page: number; pageSize: number };

/** Asignacion de un tiquete a un WRKR. */
export type AsignarInput = { iusuarioAsignado: string; nota?: string | null | undefined };

/** Cambio de estado (con comentario opcional que queda en el historial). */
export type EstadoInput = { estado: EstadoTiquete; comentario?: string | null | undefined };

/** Comentario (queda en el historial del tiquete). */
export type ComentarInput = { texto: string };

/** Un tiquete creado desde una conversacion del bot: `iexterno` lo hace idempotente y las fechas las administra el bot. */
export type DesdeChatInput = { ichat: string; tipo?: TipoTiquete | undefined; titulo: string; descripcion?: string | null | undefined; datos?: unknown; fcha?: string | null | undefined; fchaFin?: string | null | undefined; prioridad?: PrioridadTiquete | undefined; iusuarioAsignado?: string | null | undefined; iexterno?: string | null | undefined };

/** Cambio de estado pedido desde una conversacion: el tiquete debe pertenecer a ese `ichat`. */
export type EstadoChatInput = { id: string; ichat: string; estado: EstadoTiquete; comentario?: string | null | undefined };

/** Tiquetes de una conversacion (lo que el bot consulta). */
export type ChatTiquetes = { ichat: string; tiquetes: Tiquete[] };

/** Contexto que el bot puede aportar a la clasificacion (telemetria de la app): HTTP 5xx o una traza son error del sistema. */
export type ClasificacionContexto = { codigoHttp?: number | undefined; traza?: string | undefined; ruta?: string | undefined; pantalla?: string | undefined };

/** Veredicto determinista: `tiquete` = lo resuelve un humano; `error` = fallo del sistema (cola de errores). */
export type VeredictoClasificacion = { destino: "tiquete" | "error"; motivo: string; senales: string[]; reglas: string[] };

/** Datos para clasificar un reporte del cliente y (por defecto) crear lo que corresponda. */
export type ClasificarInput = { texto: string; ichat?: string | null | undefined; tipo?: TipoTiquete | undefined; titulo?: string | null | undefined; contexto?: ClasificacionContexto | undefined; crear?: boolean | undefined };

/** Resultado de clasificar: el veredicto y lo que se creo (un tiquete o un reporte en la cola de errores). */
export type Clasificacion = VeredictoClasificacion & { tiquete: Tiquete | null; ierror: number | null };

/** Sesion resuelta por el consumidor: quien actua y en que empresa (el aislamiento SIEMPRE es por `iempresa`). */
export type ContextoTiquetes = { iusuario: string; iempresa: string; rol?: string | undefined };

/** Servicios opcionales del consumidor: `contexto` resuelve la sesion HTTP; `alEvento` avisa cada cambio. */
export type TiquetesServicios = { contexto?: ((req: Request, sesion: { id?: string } | null | undefined) => Promise<ContextoTiquetes> | ContextoTiquetes) | undefined; alEvento?: ((evento: EventoTiquete, tiquete: Tiquete) => Promise<void> | void) | undefined };

/** Configuracion del plugin: prioridad por defecto, tipos declarativos por empresa y si se registra en la cola de errores. */
export type TiquetesConfig = { prioridadPorDefecto?: PrioridadTiquete | undefined; tipos?: TipoConfiguradoTiquete[] | undefined; registrarEnErrores?: boolean | undefined };

/** Verbos de servidor del plugin armado (sin HTTP: las mismas funciones que usan los handlers). */
export type VerbosTiquetes = { crearTiquete(iempresa: string, iusuario: string, input: TiqueteInput): Promise<Tiquete>; listarTiquetes(iempresa: string, filtros?: ListaFiltros): Promise<PaginaTiquetes>; detalleTiquete(iempresa: string, id: string): Promise<DetalleTiquete>; cambiarTiquete(iempresa: string, id: string, cambio: TiqueteCambio): Promise<Tiquete>; archivarTiquete(iempresa: string, id: string): Promise<Tiquete>; asignarTiquete(iempresa: string, id: string, input: AsignarInput): Promise<Tiquete>; adoptarTiquete(iempresa: string, iusuario: string, id: string): Promise<Tiquete>; cambiarEstado(iempresa: string, id: string, iusuario: string, input: EstadoInput): Promise<Tiquete>; comentarTiquete(iempresa: string, id: string, iusuario: string, input: ComentarInput): Promise<EventoTiquete>; catalogo(iempresa: string): Promise<TipoTiqueteFila[]>; definirTipo(iempresa: string, tipo: string, input: TipoTiqueteInput): Promise<TipoTiqueteFila>; desdeChat(iempresa: string, iusuario: string, input: DesdeChatInput): Promise<Tiquete>; tiquetesDeChat(iempresa: string, ichat: string): Promise<Tiquete[]>; estadoDesdeChat(iempresa: string, iusuario: string, input: EstadoChatInput): Promise<Tiquete>; clasificar(iempresa: string, iusuario: string, input: ClasificarInput): Promise<Clasificacion> };

/** Alta o cambio de un tipo del catalogo (declarativo: sin codigo). `tipo` viaja en la ruta, no en el cuerpo. */
export type TipoTiqueteInput = { nombre: string; descripcion?: string | null | undefined; estados?: EstadoTiquete[] | undefined; cierran?: EstadoTiquete[] | undefined; campos?: CampoTiquete[] | undefined; bactivo?: boolean | undefined };

/** Zod de un campo del catalogo. */
export const ZCampoTiquete = z.strictObject({ clave: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "La clave del campo debe empezar por letra y usar letras, numeros o _").max(60), etiqueta: z.string().trim().min(1).max(120), tipo: z.enum(TIPOS_CAMPO_TIQUETE), requerido: z.boolean().default(false), opciones: z.array(z.string().max(120)).max(100).optional(), defecto: z.unknown().optional(), ayuda: z.string().max(500).optional() });

/** Un tipo declarado en la configuracion: la empresa y el tipo viajan en el JSON. */
export type TipoConfiguradoTiquete = TipoTiqueteInput & { iempresa: string; tipo: string };

/** Zod del alta o cambio de un tipo del catalogo. */
export const ZTipoCatalogoTiquete = z.strictObject({ nombre: z.string().trim().min(1).max(160), descripcion: z.string().max(2000).nullish(), estados: z.array(z.enum(ESTADOS_TIQUETE)).min(1).optional(), cierran: z.array(z.enum(ESTADOS_TIQUETE)).optional(), campos: z.array(ZCampoTiquete).max(60).optional(), bactivo: z.boolean().optional() });

/** Zod de un tipo declarado en la configuracion (incluye la empresa y el tipo). */
export const ZTipoConfiguradoTiquete = ZTipoCatalogoTiquete.extend({ iempresa: z.string().min(1).max(40), tipo: z.string().trim().min(1).max(40) });

/** Zod de la configuracion del plugin. */
export const ZTiquetesConfig = z.strictObject({ prioridadPorDefecto: z.enum(PRIORIDADES_TIQUETE).default("media"), tipos: z.array(ZTipoConfiguradoTiquete).default([]), registrarEnErrores: z.boolean().default(true) });

/** Zod del alta de un tiquete. */
export const ZTiqueteInput = z.strictObject({ tipo: z.string().trim().min(1).max(40), titulo: z.string().trim().min(1).max(200), descripcion: z.string().max(20000).nullish(), datos: z.unknown().optional(), estado: z.enum(ESTADOS_TIQUETE).optional(), fcha: z.string().max(40).nullish(), fchaFin: z.string().max(40).nullish(), prioridad: z.enum(PRIORIDADES_TIQUETE).optional(), iusuarioAsignado: z.string().max(120).nullish(), ichat: z.string().max(40).nullish(), iexterno: z.string().max(200).nullish() });

/** Zod de los cambios de un tiquete. */
export const ZTiqueteCambio = z.strictObject({ titulo: z.string().trim().min(1).max(200).optional(), descripcion: z.string().max(20000).nullish(), datos: z.unknown().optional(), fcha: z.string().max(40).nullish(), fchaFin: z.string().max(40).nullish(), prioridad: z.enum(PRIORIDADES_TIQUETE).optional(), iusuarioAsignado: z.string().max(120).nullish() });

/** Zod de la asignacion. */
export const ZAsignar = z.strictObject({ iusuarioAsignado: z.string().trim().min(1).max(120), nota: z.string().max(2000).nullish() });

/** Zod del cambio de estado. */
export const ZEstado = z.strictObject({ estado: z.enum(ESTADOS_TIQUETE), comentario: z.string().max(4000).nullish() });

/** Zod del comentario. */
export const ZComentar = z.strictObject({ texto: z.string().trim().min(1).max(8000) });

/** Zod del alta desde una conversacion. */
export const ZDesdeChat = z.strictObject({ ichat: z.string().min(1).max(40), tipo: z.string().trim().min(1).max(40).optional(), titulo: z.string().trim().min(1).max(200), descripcion: z.string().max(20000).nullish(), datos: z.unknown().optional(), fcha: z.string().max(40).nullish(), fchaFin: z.string().max(40).nullish(), prioridad: z.enum(PRIORIDADES_TIQUETE).optional(), iusuarioAsignado: z.string().max(120).nullish(), iexterno: z.string().max(200).nullish() });

/** Zod del cambio de estado desde una conversacion. */
export const ZEstadoChat = z.strictObject({ id: z.string().min(1).max(40), ichat: z.string().min(1).max(40), estado: z.enum(ESTADOS_TIQUETE), comentario: z.string().max(4000).nullish() });

/** Zod del contexto de clasificacion (telemetria de la app). */
export const ZClasificacionContexto = z.strictObject({ codigoHttp: z.number().int().min(100).max(599).optional(), traza: z.string().max(20000).optional(), ruta: z.string().max(1000).optional(), pantalla: z.string().max(200).optional() });

/** Zod de la clasificacion de un reporte. */
export const ZClasificar = z.strictObject({ texto: z.string().trim().min(1).max(20000), ichat: z.string().max(40).nullish(), tipo: z.string().trim().min(1).max(40).optional(), titulo: z.string().max(200).nullish(), contexto: ZClasificacionContexto.optional(), crear: z.boolean().optional() });

/** Tipos base de fabrica: lo que el catalogo de cualquier empresa tiene si no declara lo suyo. */
export const CATALOGO_POR_DEFECTO: readonly TipoTiqueteBase[] = [
  { tipo: "pedido", nombre: "Pedido", descripcion: "Un pedido de productos, platos o servicios a domicilio.", estados: [...ESTADOS_TIQUETE], cierran: [...ESTADOS_CIERRE], campos: [{ clave: "direccion", etiqueta: "Direccion de entrega", tipo: "texto", requerido: false }, { clave: "telefono", etiqueta: "Telefono de contacto", tipo: "texto", requerido: false }, { clave: "platos", etiqueta: "Platos o productos", tipo: "lista", requerido: false }, { clave: "total", etiqueta: "Total", tipo: "numero", requerido: false }, { clave: "notas", etiqueta: "Notas", tipo: "texto", requerido: false }] },
  { tipo: "entrega", nombre: "Entrega", descripcion: "Una entrega de un producto o paquete con su ventana de tiempo.", estados: [...ESTADOS_TIQUETE], cierran: [...ESTADOS_CIERRE], campos: [{ clave: "direccion", etiqueta: "Direccion de entrega", tipo: "texto", requerido: false }, { clave: "receptor", etiqueta: "Quien recibe", tipo: "texto", requerido: false }, { clave: "guia", etiqueta: "Numero de guia", tipo: "texto", requerido: false }] },
  { tipo: "reserva", nombre: "Reserva", descripcion: "Una reserva con fecha de inicio y de fin (habitacion, mesa, cita, turno).", estados: [...ESTADOS_TIQUETE], cierran: [...ESTADOS_CIERRE], campos: [{ clave: "habitacion", etiqueta: "Habitacion o recurso", tipo: "texto", requerido: false }, { clave: "personas", etiqueta: "Personas", tipo: "numero", requerido: false }, { clave: "fechaInicio", etiqueta: "Fecha de inicio", tipo: "fechaHora", requerido: false }, { clave: "fechaFin", etiqueta: "Fecha de fin", tipo: "fechaHora", requerido: false }, { clave: "notas", etiqueta: "Notas", tipo: "texto", requerido: false }] },
  { tipo: "solicitud", nombre: "Solicitud", descripcion: "Una solicitud generica de atencion que resuelve un humano.", estados: [...ESTADOS_TIQUETE], cierran: [...ESTADOS_CIERRE], campos: [{ clave: "asunto", etiqueta: "Asunto", tipo: "texto", requerido: false }, { clave: "detalle", etiqueta: "Detalle", tipo: "texto", requerido: false }] },
  { tipo: "otro", nombre: "Otro", descripcion: "Cualquier otro trabajo que la empresa quiera modelar con su propio catalogo.", estados: [...ESTADOS_TIQUETE], cierran: [...ESTADOS_CIERRE], campos: [] },
];
