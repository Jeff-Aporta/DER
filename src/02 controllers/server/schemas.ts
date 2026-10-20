/**
 * schema.ts (server) — definiciones de tipos del lado servidor. Viven aparte de `common/schema.ts`
 * porque dependen de Kysely: así el cliente nunca necesita instalarlo.
 */
import type { Dialect, Kysely, RawBuilder } from "kysely";
import type { Pojo } from "@Jeff-Aporta/DER/src/01 objects/pojo.ts";
import type {
  Action,
  BaseCtx,
  CfgAction,
  ColumnDef,
  ControllerOptions,
  EndpointDef,
  HttpMethod,
  Include,
  OrderBy,
  Where,
} from "@Jeff-Aporta/DER/src/00 common/schemas.ts";
import type { Database } from "@Jeff-Aporta/DER/src/02 controllers/server/database.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02 controllers/server/controller.ts";
import type { Router } from "@Jeff-Aporta/DER/src/02 controllers/server/router.ts";

export type Raw = RawBuilder<unknown>;

// ===================================================================================== motor
/** Nombre del motor; los incluidos son "pg" y "sqlite" (cada uno en su carpeta). */
export type EngineName = "pg" | "sqlite" | (string & Record<never, never>);
export type IdentifierCase = "preserve" | "lower" | "upper";

/** Campo de salida de un SELECT: necesario para armar `json_object` en SQLite. */
export interface OutField {
  name: string;
  kind: "col" | "json" | "rel";
}

export interface Engine {
  readonly name: EngineName;
  /** Tipo SQL de la columna para `CREATE TABLE`. */
  columnType(c: ColumnDef): string;
  /** Expresión de lectura de la columna (normaliza fechas/horas a texto en PG). */
  selectExpr(ref: RawBuilder<unknown>, c: ColumnDef): RawBuilder<unknown>;
  /** Valor JS (ya casteado) → parámetro aceptado por el driver. */
  toDb(c: ColumnDef, v: unknown): unknown;
  /** Valor leído de una columna json/relación → objeto JS. */
  readJson(v: unknown): unknown;
  /** Subconsulta → objeto JSON (relación 1:1). */
  jsonOne(sub: RawBuilder<unknown>, alias: string, fields: OutField[]): RawBuilder<unknown>;
  /** Subconsulta → arreglo JSON (relación 1:N). */
  jsonMany(sub: RawBuilder<unknown>, alias: string, fields: OutField[]): RawBuilder<unknown>;
  /** Comparación LIKE sin distinción de mayúsculas. */
  ilike(left: RawBuilder<unknown>, pattern: unknown): RawBuilder<unknown>;
  /** Crea (si no existe) una secuencia global. */
  createSequence(exec: Kysely<any>, name: string, start: number, increment: number): Promise<void>;
  /** Siguiente valor de una secuencia global. */
  nextValue(exec: Kysely<any>, name: string): Promise<number>;
}

// ===================================================================================== controller

export interface ServerCtx extends BaseCtx {
  request?: Request;
  /** Ejecutor actual: la conexión o la transacción en curso. */
  exec: Kysely<any>;
  inTransaction?: boolean;
  /** Bolsa libre para datos del request (usuario autenticado, etc.). */
  state: Record<string, unknown>;
}

export interface ComputedHelpers {
  /** Referencia calificada a una columna del POJO (respeta alias, caso y nombre en BD). */
  col(field: string): Raw;
  alias: string;
  engine: Engine;
}

/**
 * SQL quemado para columnas virtuales:
 * - string con `{campo}` → se reemplaza por la referencia de la columna,
 * - `{ pg, sqlite }` por motor,
 * - función que recibe helpers y retorna string o `sql\`...\``.
 */
export type ComputedSql =
  | string
  | { pg?: string; sqlite?: string }
  | ((h: ComputedHelpers) => Raw | string);

export type SseHandler<Ctl> = (
  this: Ctl,
  arg: any,
  send: (text: string) => void,
  ctx: ServerCtx,
) => Promise<void> | void;

export interface ServerEndpoint<P extends Pojo> {
  handler?(this: ServerController<P>, arg: any, ctx: ServerCtx): unknown;
  sse?: SseHandler<ServerController<P>>;
}

export interface ServerControllerConfig<P extends Pojo>
  extends ControllerOptions<P, ServerController<P>, ServerCtx> {
  db: Database;
  table: string;
  /**
   * Secciones de documentación del controller: fuentes `.md` que se concatenan, en orden y como secciones,
   * al md AUTOGENERADO de la entidad (`GET plural/doc`; vista en `plural/doc?v=1`).
   * Default: `entity.def.doc`.
   */
  doc?: DocSources<ServerController<P>>;
  /** Base para rutas locales relativas de `doc` (default: cwd). */
  docBase?: string | URL;
  /** upper/lower/preserve para tabla y columnas. Por defecto el del Database. */
  identifierCase?: IdentifierCase;
  /** Nombre en BD de columnas que no se llaman igual que el campo del POJO. */
  columnNames?: Record<string, string>;
  /** Expresiones SQL de las columnas `virtual` del schema. */
  computed?: Record<string, ComputedSql>;
  /** Controller explícito por relación (por defecto el registrado para el POJO destino). */
  relations?: Record<string, { controller?: () => ServerController<any> }>;
  /** Handlers SSE por acción (`POST producto/sse`, `GET productos/sse`, ...). */
  sse?: Partial<Record<Action, SseHandler<ServerController<P>>>>;
  /** Implementación de los endpoints especiales definidos en la entidad. */
  endpoints?: Record<string, ServerEndpoint<P>>;
  /**
   * Tabla de configuración de `plural/cfg` para esta entidad (sobreescribe la de `Database`); `false` = no exponer
   * `/cfg` aunque la base tenga tabla. Sólo aplica si la entidad define `cfg` (su molde Zod).
   */
  cfg?: CfgTableDef | false;
  /**
   * Qué se registra como ruta (equivalente a `aplicar` de ISS). Default: todo lo que la entidad define
   * (CRUD, listas, query, endpoints, `/cfg` si hay cfg, `/doc`) y sus `/sse` si hay handler.
   */
  expose?: ExposedName[];
  /** Rutas irregulares extra de este controller (`this` = el controller). */
  routes?: ExtraRoute<ServerController<P>>[];
  /**
   * Seguridad de las rutas de este controller (aplica sólo si hay plugins cargados; sin plugins se omite):
   * `true` = todas protegidas con JWT y evaluadas contra la matriz de permisos; o el detalle por acción.
   * Default: pública.
   */
  security?: boolean | SecurityDef;
  /** Columnas que nunca se devuelven (no se seleccionan ni se retornan): p.ej. el hash de una contraseña. */
  hidden?: string[];
  /** Índices explícitos (además de los automáticos). */
  indexes?: IndexDef[];
  /**
   * Índices automáticos (default true): las FK de las relaciones 1:1 y las llaves remotas de los detalles 1:N
   * (en la tabla del detalle, si es de la misma base), salvo que ya sean prefijo de la pk.
   */
  autoIndexes?: boolean;
  /**
   * Detalles que se EXTRAEN en `get` (relaciones anidadas, JSON → objeto 1:1 / arreglo 1:N). Lo implementa el
   * consumidor. Default: `entity.def.getInclude`.
   */
  getPropagation?(this: ServerController<P>): Include;
  /**
   * Detalles que se ESCRIBEN junto al padre (pueden ser distintos de los que se leen):
   * `post` inserta el padre y luego sus detalles (copiando la FK de `on`); `put` borra los detalles enviados
   * y los vuelve a insertar; `delete` borra los detalles antes que el padre. Todo en una transacción y en
   * cascada según el anidamiento. Sólo para relaciones de PERTENENCIA (detalles), nunca para catálogos.
   */
  setPropagation?(this: ServerController<P>): WritePropagation;
  /** Orden por defecto de list/query. Por defecto las pks. */
  defaultOrder?: OrderBy;
  /** Registrar en `db` (necesario para relaciones y `db.seed()`). Default true. */
  register?: boolean;
}

/**
 * Tabla de configuración de las entidades (`plural/cfg`): una fila por entidad. El consumidor elige los nombres,
 * pero declara explícitamente qué columna es cada cosa, así las rutas `/cfg` quedan bien definidas:
 * ```ts
 * cfg: { table: "der_cfg", columns: { entidad: "plural", json: "jcfg", fecha: "fhultact" } }
 * ```
 * Se declara en `Database` (vale para todas sus entidades) o por controller. Sin ella, `/cfg` no se expone.
 * `seed()` la crea si no existe.
 */
export interface CfgTableDef {
  /** Tabla de configuración. */
  table: string;
  columns: {
    /** pk: el plural de la entidad (`productos`). */
    entidad: string;
    /** JSON de la configuración. */
    json: string;
    /** Fecha y hora de la última actualización (la pone el PUT). */
    fecha: string;
  };
}

export interface SelectOptions {
  alias?: string | undefined;
  fields?: string[] | undefined;
  where?: Where | undefined;
  orderBy?: OrderBy | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  include?: Include | undefined;
  /** Condiciones adicionales ya armadas (correlaciones, pks...). */
  extra?: Raw[] | undefined;
}


// ===================================================================================== database / router

export interface DatabaseOptions {
  engine: Engine;
  /** Cualquier dialecto de Kysely. */
  dialect: Dialect;
  /** Caso por defecto de tablas/columnas; cada controller puede sobreescribirlo. */
  identifierCase?: IdentifierCase;
  /** Tabla de configuración de las entidades (`plural/cfg`) por defecto para todos sus controllers. */
  cfg?: CfgTableDef;
}

export interface RouterOptions {
  basePath?: string;
  /** Contexto por request (auth, state...). Se mezcla en el ctx de la acción. */
  context?(req: Request): Partial<ServerCtx> | Promise<Partial<ServerCtx>>;
  /** Exponer el mensaje de errores 500 (útil en desarrollo). Default false. */
  exposeErrors?: boolean;
  onError?(error: unknown, req: Request): void;
  /** Secciones `.md` generales del API, concatenadas al índice autogenerado en `{base}/doc` y `{base}/doc?v=1`. */
  doc?: DocSources<unknown>;
  /** Base contra la que se resuelven las rutas locales relativas de `doc` (default: cwd). */
  docBase?: string | URL;
  /** Vista `/doc?v=1` con el kit iswc. */
  docView?: DocViewOptions;
  /** Rutas irregulares extra del API (`this` = el router). */
  routes?: ExtraRoute<Router>[];
  /** CORS: `true` (cualquier origen) u opciones. Responde los preflight `OPTIONS` y agrega las cabeceras. */
  cors?: boolean | CorsOptions;
  /**
   * Autorización por ruta (como la matriz SEG de ISS, por `route.id`). Retornar un `Response` corta;
   * lanzar `HttpError` responde ese status; no retornar nada deja pasar.
   */
  guard?(route: RouteInfo, req: Request, ctx: Partial<ServerCtx>): Response | undefined | void | Promise<Response | undefined | void>;
  /** Plugins (identidad, permisos...). Sin plugins de seguridad, `security` de las rutas se omite. */
  plugins?: Plugin[];
}

// ===================================================================================== rutas

/** Nombre lógico que puede exponer un controller: acción CRUD, cfg, doc o endpoint especial. */
export type ExposedName = Action | CfgAction | "doc" | (string & Record<never, never>);

/** Entrada de una ruta irregular. */
export interface ExtraRouteInput {
  request: Request;
  /** Parámetros `{nombre}` de la ruta, ya decodificados. */
  params: Record<string, string>;
  query: URLSearchParams;
  /** Body JSON (`undefined` en GET o vacío). */
  body: unknown;
}

/**
 * Ruta irregular (las `noRegulares` / `extras` de ISS): cualquier método y ruta con parámetros `{nombre}`,
 * relativa al basePath. Se registra en todos los hosts igual que las acciones.
 */
export interface ExtraRoute<Ctl = unknown> {
  method: HttpMethod;
  /** `reportes/{anio}/{mes}` */
  path: string;
  /** Un `Response` pasa tal cual; `undefined` → 204; cualquier otro valor → JSON 200. */
  handler?(this: Ctl, input: ExtraRouteInput, ctx: ServerCtx): unknown;
  /** Variante SSE en `path/sse` (texto plano por evento). */
  sse?(this: Ctl, input: ExtraRouteInput, send: (text: string) => void, ctx: ServerCtx): Promise<void> | void;
  /** Id de la ruta (default `METHOD:/path`). */
  id?: string;
  /** Seguridad de la ruta: `true` = JWT + permisos; `{ protected, permissions }` para el detalle. Default: pública. */
  security?: boolean | RouteSecurity;
}

/** Ruta de una acción del controller, antes de envolverla con su handler. */
export interface ActionRouteSpec {
  name: string;
  method: HttpMethod;
  path: string;
  /** Parámetros de la ruta que son las pks, en orden. */
  pkParams: string[];
  sse: boolean;
  endpoint?: EndpointDef | undefined;
}

/** Descripción de una ruta registrada: lo que cada host monta. */
export interface RouteInfo {
  /** `GET:/producto/{iproducto}` (estable: sirve para seguridad por ruta). */
  id: string;
  method: HttpMethod;
  /** Relativa al basePath, con parámetros `{nombre}`. */
  path: string;
  kind: "action" | "extra" | "doc";
  /** Acción, endpoint, `doc` o el id de la ruta irregular. */
  name: string;
  /** Entidad dueña (nombre), si aplica. */
  entity?: string;
  sse: boolean;
  /** Qué exige la ruta cuando hay plugins de seguridad cargados. */
  security: RouteSecurity;
}

/** Índice de una tabla (columnas por nombre de campo del POJO). */
export interface IndexDef {
  columns: string[];
  unique?: boolean | undefined;
  /** Default `ix_<tabla>_<columnas>` (o `ux_` si es único). */
  name?: string | undefined;
}

/** Índice resuelto (nombres en BD) listo para crear. */
export interface ResolvedIndex {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
}

/** Opciones de `syncSchema()` (sincroniza la tabla con las columnas del POJO; uso opcional, para migraciones). */
export interface SyncSchemaOptions {
  /**
   * Migración por fila: recibe la fila ANTERIOR (columnas viejas incluidas, antes de eliminarlas) y retorna
   * los valores de las columnas del POJO a escribir (p.ej. las nuevas calculadas desde las viejas).
   */
  migrate?(previous: Record<string, unknown>): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>;
  /** No eliminar las columnas que el POJO ya no tiene (default false: se eliminan). */
  keepExtra?: boolean | undefined;
  /** Sólo calcula el plan, sin tocar la base. */
  dryRun?: boolean | undefined;
}

/** Resultado (o plan, con `dryRun`) de `syncSchema()`. */
export interface SyncSchemaResult {
  table: string;
  /** La tabla no existía y se creó (seed). */
  created: boolean;
  /** Columnas agregadas (nombre en BD). */
  added: string[];
  /** Columnas eliminadas (nombre en BD). */
  dropped: string[];
  /** Filas pasadas por `migrate`. */
  migrated: number;
  dryRun: boolean;
}

/**
 * Relación cuyo detalle vive en OTRA base (u otro motor): no puede ir en el mismo SQL, se resuelve con un join
 * de aplicación por POJOs (consulta en lote con `IN` sobre las llaves y se anexa).
 */
export interface DeferredInclude {
  /** Ruta desde la raíz hasta los objetos dueños de la relación (`["lineas"]`; `[]` = las filas raíz). */
  path: string[];
  rel: string;
  /** Controller dueño de la relación (el de los objetos en `path`). */
  owner: ServerController<any>;
  include: Include | undefined;
}

/** SELECT armado: SQL, campos de salida y relaciones diferidas (cross-db). */
export interface BuiltSelect {
  query: Raw;
  fields: OutField[];
  deferred: DeferredInclude[];
}

/** Relaciones (y sus detalles anidados) que propaga la escritura. `true` = sin anidar más. */
export type WritePropagation = { [relation: string]: true | WritePropagation };

/** Seguridad efectiva de una ruta. */
export interface RouteSecurity {
  /** Exige identidad (JWT válido y vigente). */
  protected: boolean;
  /** Además, evalúa la matriz de permisos (rol/grupo → acción) con el id de la ruta. */
  permissions: boolean;
  /**
   * Acción de seguridad con la que se evalúa la ruta (default: el id de la ruta, `DELETE:/producto/{iproducto}`).
   * Un id personalizado (`productos.eliminar`) puede compartirse entre varias rutas.
   */
  action?: string | undefined;
}

/** Seguridad declarada en el registro de un controller (por acción/endpoint). */
export interface SecurityDef {
  /** Acciones públicas (sin JWT): ganan sobre `protected`. */
  public?: ExposedName[];
  /** Acciones protegidas con JWT: `true` = todas las no públicas (default). */
  protected?: true | ExposedName[];
  /** Evaluar la matriz de permisos en las protegidas. Default true. */
  permissions?: boolean;
  /**
   * Acciones de seguridad personalizadas por acción/endpoint (en lugar del id autogenerado de la ruta):
   * `{ delete: "productos.eliminar", getCfg: "productos.config", putCfg: "productos.config" }`.
   */
  actions?: Partial<Record<ExposedName, string>>;
}

// ===================================================================================== plugins

/** Identidad autenticada (la entrega el plugin de identidad; viaja en `ctx.state.identity`). */
export interface Identity {
  /** Id único (string) del usuario. */
  id: string;
  /** Claims verificados del token. */
  claims: Record<string, unknown>;
}

/** Resultado de autorizar una ruta. */
export interface AuthDecision {
  allowed: boolean;
  /** Valor efectivo del permiso (viaja en `ctx.state.permiso`). */
  value?: unknown;
  reason?: string;
}

/**
 * Plugin del Router: aporta controllers, rutas y/o las puertas de seguridad. Estándar común para que
 * identidad, permisos u otros (auditoría, rate-limit...) se integren igual.
 */
export interface Plugin {
  name: string;
  /** Controllers propios (ya construidos sobre el `db`): se registran como cualquier otro. */
  controllers?: ServerController<any>[];
  /** Rutas propias (`this` = el router). */
  routes?: ExtraRoute<Router>[];
  /**
   * Puerta de autenticación: `null` si el request no trae credenciales; lanza `HttpError(401)` si las trae
   * inválidas. Sólo un plugin la define.
   */
  authenticate?(req: Request, ctx: Partial<ServerCtx>): Promise<Identity | null>;
  /** Puerta de autorización para rutas con `security.permissions`. */
  authorize?(route: RouteInfo, identity: Identity, ctx: Partial<ServerCtx>): Promise<AuthDecision>;
  /**
   * Evalúa una acción de seguridad desde código (capacidades que no son una ruta). El router la expone a los
   * handlers como `ctx.state.can(accion, metodo?)`.
   */
  can?(identity: Identity, action: string, method: string): Promise<AuthDecision>;
  /** Seed de datos del plugin (tras crear las tablas): p.ej. el usuario administrador. Lo llama `router.seed()`. */
  seed?(router: Router): Promise<void>;
}

/** Ruta registrada con su handler (Web `Request` → `Response`). */
export interface RouteDef extends RouteInfo {
  /** `params`: los del host (Azure) o los del matcher genérico, ya decodificados. */
  handle(req: Request, params: Record<string, string>): Promise<Response>;
}

export interface CorsOptions {
  origin?: string;
  methods?: string;
  headers?: string;
  maxAge?: number;
}

// ===================================================================================== hosts

/** Lo mínimo de `HttpRequest` de `@azure/functions` v4 (estructural: no hace falta instalar el paquete aquí). */
export interface AzureHttpRequest {
  method: string;
  url: string;
  headers: Iterable<[string, string]>;
  params: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Lo mínimo de `HttpResponseInit`. */
export interface AzureHttpResponseInit {
  status: number;
  headers: Record<string, string>;
  body?: string | Uint8Array | ReadableStream<Uint8Array>;
}

export type AzureAuthLevel = "anonymous" | "function" | "admin";

/** Lo mínimo de `app` de `@azure/functions` v4. */
export interface AzureApp {
  http(
    name: string,
    options: {
      methods: string[];
      route: string;
      authLevel: AzureAuthLevel;
      handler: (req: AzureHttpRequest, ctx: unknown) => Promise<AzureHttpResponseInit>;
    },
  ): void;
}

export interface AzureOptions {
  authLevel?: AzureAuthLevel;
  /**
   * Pasar el body como stream (SSE en vivo). Requiere `app.setup({ enableHttpStream: true })`.
   * Default true; con false el body se lee completo antes de responder.
   */
  stream?: boolean;
  /** Prefijo de los nombres de función (default ""). */
  functionPrefix?: string;
}

/** Lo mínimo del `ExecutionContext` de Cloudflare Workers. */
export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Export por defecto de un Worker (`export default defineWorker(...)`). */
export interface WorkerExport<Env> {
  fetch(req: Request, env: Env, ctx: WorkerExecutionContext): Promise<Response>;
}

// ===================================================================================== doc

/** Fuentes `.md` (ruta local, `file:` o URL http(s): es indistinto) o función que las retorna. */
export type DocSources<Ctl> = string[] | ((this: Ctl) => string[] | Promise<string[]>);

/** Hoja de documentación ya leída. */
export interface DocSheet {
  /** Ruta de la hoja dentro del libro (p. ej. `productos.md` o `README.md`). */
  path: string;
  content: string;
}

/** Página `/doc?v=1`: `iswc-md-docs-vault` del kit is-webcomponents por CDN, pineado por SHA. */
export interface DocViewOptions {
  /** SHA de 40 del kit (default: el mismo pin que ISS). */
  pin?: string;
  title?: string;
  theme?: "light" | "dark";
  palette?: string;
}

/** `ctx.state.can`: evalúa una acción de seguridad para la identidad del request. */
export type CanFn = (action: string, method?: string) => Promise<AuthDecision>;
