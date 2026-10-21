/**
 * schemas.ts — TODAS las definiciones de tipos y contratos Zod del núcleo común (client + server).
 * Los módulos (`pojo`, `entity`, `query`, `controller`, `obj`, `zod`, `sse`) importan sus tipos de aquí;
 * aquí no hay lógica, sólo tipos, constantes de contrato y schemas Zod.
 *
 * Los tipos propios del servidor que dependen de Kysely viven en `server/schemas.ts`, para que el
 * cliente no tenga que instalar Kysely (aislamiento de dependencias por dimensión).
 *
 * Secciones:  columnas · pojo · query · entidad · controller · client · sse · obj · zod
 */
import { z } from "zod";
import type { Pojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";

// ===================================================================================== columnas

export type ColumnType =
  | "string"
  | "text"
  | "int"
  | "bigint"
  | "float"
  | "decimal"
  | "bool"
  | "date"
  | "datetime"
  | "time"
  | "json"
  | "uuid";

export type JsonPrimitive = string | number | boolean | null;

export interface ColumnDef {
  type: ColumnType;
  /** Forma parte de la llave primaria (el orden de las pks es el orden de declaración, o `Schema.primaryKey`). */
  pk?: boolean;
  /** Autonumérico (identity en PG, AUTOINCREMENT en SQLite). Sólo aplica a pks enteras. */
  autoincrement?: boolean;
  /** Por defecto `true`, salvo en pks. */
  nullable?: boolean;
  /** Longitud para `string` (varchar(n) en PG). */
  length?: number;
  precision?: number;
  scale?: number;
  unique?: boolean;
  /** Valor por defecto: literal, o SQL crudo `{ sql: "CURRENT_TIMESTAMP" }`. */
  default?: JsonPrimitive | { sql: string };
  /** Valores permitidos; se validan automáticamente (Zod) en los pre*. */
  enum?: readonly (string | number)[];
  /** No se persiste: la calcula el server (ver `computed` en ServerController). */
  virtual?: boolean;
  /**
   * Valor generado al insertar si no viene (igual en todos los motores; el cliente no lo exige en el POST):
   * `true` = secuencia propia de la columna; o `SequenceDef` (nombrada/compartida, por ámbito o con formato).
   */
  sequence?: true | SequenceDef;
  /**
   * Zod del valor (no nulo). Refina el tipo (`z.email()`) y, en columnas `json`, define su molde:
   * con molde las acciones parciales (insert/insertIgnore/update/delete) entran al JSON; sin molde se reemplaza.
   */
  zod?: z.ZodType;
}

/**
 * Secuencia de una columna:
 * - global (default): una secuencia real (`CREATE SEQUENCE` en PG; tabla `_sequences` en SQLite), con `name`
 *   para compartirla entre tablas, `start` e `increment`;
 * - `scope`: consecutivo por grupo (máximo + incremento dentro del grupo, p.ej. la línea dentro del pedido);
 * - `pattern`: para columnas string, el número formateado: `"FAC-{n:5}"` → `FAC-00042`, `"{n}"` → `42`.
 */
export interface SequenceDef {
  name?: string | undefined;
  start?: number | undefined;
  increment?: number | undefined;
  scope?: string[] | undefined;
  pattern?: string | undefined;
}

export interface RelationDef {
  /** `one` → objeto (1:1 / N:1), `many` → lista (1:N). */
  kind: "one" | "many";
  /**
   * POJO del detalle: nombre de la entidad (JSON puro, se resuelve en diferido; `defineEntity` registra
   * su POJO con `name` o, si no, con su `singular`) o un thunk anotado `(): PojoClass => TClase`.
   */
  target: string | (() => PojoClass<any>);
  /** Mapeo `columnaLocal: columnaDelDetalle`; el controller arma la correlación. */
  on: Record<string, string>;
}

/**
 * Cómo aplica el PUT singular (`PUT singular/pks...`) el cuerpo recibido sobre el registro actual (acciones de `Obj`,
 * guiadas por el molde Zod de cada columna json):
 * - `insert` (default): ajuste parcial — lo no mencionado se conserva y dentro de los json se fusiona en profundidad;
 * - `insertIgnore`: sólo completa lo que no está definido (nunca pisa);
 * - `update`: sólo cambia lo que ya está definido;
 * - `replace`: reemplazo directo de todo el registro (lo no enviado queda vacío).
 */
export type PutMode = "insert" | "insertIgnore" | "update" | "replace";

export interface Schema {
  columns: Record<string, ColumnDef>;
  relations?: Record<string, RelationDef>;
  /** Orden explícito de las pks. Si se omite se toman las columnas con `pk: true` en orden. */
  primaryKey?: readonly string[];
  /** Modo del PUT singular sobre el registro actual. Default `insert` (ajustes parciales). */
  put?: PutMode;
}

type TSOf<T extends ColumnType> = T extends "int" | "bigint" | "float" | "decimal" ? number
  : T extends "bool" ? boolean
  : T extends "datetime" ? Date
  : T extends "json" ? any
  : string;

type ColValue<C extends ColumnDef> = C extends { zod: z.ZodType<infer Z> } ? Z
  : C extends { enum: readonly (infer E)[] } ? E
  : TSOf<C["type"]>;

/** Campos (columnas) de un schema con sus tipos TS. */
export type ColumnsOf<S extends Schema> = {
  -readonly [K in keyof S["columns"]]: ColValue<S["columns"][K]> | null | undefined;
};

/** Metadata resuelta de un schema. */
export interface SchemaMeta {
  schema: Schema;
  columns: Record<string, ColumnDef>;
  /** Columnas persistidas (no virtuales). */
  persisted: string[];
  virtual: string[];
  pks: string[];
  relations: Record<string, RelationDef>;
  /** Definición de la columna (lanza si no existe). */
  column(name: string): ColumnDef;
  /** Definición de la relación (lanza si no existe). */
  relation(name: string): RelationDef;
  isColumn(name: string): boolean;
  isRelation(name: string): boolean;
}

// ===================================================================================== pojo

export type PojoInit = Record<string, unknown>;

/** Constructor de un POJO concreto (clase hija de Pojo con `schema`). */
export interface PojoClass<T extends Pojo = Pojo> {
  new (init?: PojoInit | Pojo): T;
  schema: Schema;
  readonly meta: SchemaMeta;
  fromJSON<X extends Pojo>(this: new (init?: PojoInit) => X, obj: unknown): X;
  fromList<X extends Pojo>(this: new (init?: PojoInit) => X, list: unknown): X[];
  prototype: T;
}

export type PojoOf<S extends Schema> = Pojo & ColumnsOf<S>;

export interface GeneratedPojoClass<S extends Schema> {
  new (init?: PojoInit | Pojo): PojoOf<S>;
  schema: S;
  readonly meta: SchemaMeta;
  fromJSON<X extends Pojo>(this: new (init?: PojoInit) => X, obj: unknown): X;
  fromList<X extends Pojo>(this: new (init?: PojoInit) => X, list: unknown): X[];
  prototype: PojoOf<S>;
}

/** Llaves de datos de un POJO (excluye métodos y miembros de la base). */
export type FieldsOf<P> =
  & Exclude<
    { [K in keyof P]: P[K] extends (...a: any[]) => any ? never : K }[keyof P],
    keyof Pojo | "$meta"
  >
  & string;

type PatchValue<V> = V extends Date ? V | string | null
  : V extends (infer E)[] ? (E extends Pojo ? (Patch<E> | E)[] : V) | null
  : V extends Pojo ? Patch<V> | V | null
  : V extends Record<string, unknown> ? { [K in keyof V]?: PatchValue<V[K]> } | null
  : V | null;

/** Acción parcial de un POJO sobre su JSON. */
export type PojoPartialOp = "insert" | "insertIgnore" | "update";

/** Cambios parciales tipados para `pojo.insert/insertIgnore/update` (`null` = quitar, según el molde). */
export type Patch<P> = { [K in FieldsOf<P>]?: PatchValue<NonNullable<P[K]>> } & Record<string, unknown>;

/** Consulta tipada (`true` marca la hoja; objetos descienden; `"*"` y `"[campo=valor]"` de Obj). */
export type PojoQuery<P> = { [K in FieldsOf<P>]?: TConsulta } & Record<string, TConsulta>;

// ===================================================================================== query

export interface FieldOps {
  eq?: unknown;
  ne?: unknown;
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  in?: unknown[];
  nin?: unknown[];
  between?: [unknown, unknown];
  like?: string;
  ilike?: string;
  /** contains/startsWith/endsWith: sin distinción de mayúsculas y con comodines escapados. */
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  isNull?: boolean;
}

export const FIELD_OPS: ReadonlySet<string> = new Set([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "nin",
  "between",
  "like",
  "ilike",
  "contains",
  "startsWith",
  "endsWith",
  "isNull",
]);

/**
 * Filtro: `campo: valor` (igualdad; `null` → IS NULL; array → IN), `campo: { op: valor }`,
 * `relacion: { ...filtro del detalle }` (EXISTS) y los lógicos `$and`, `$or`, `$not`.
 */
export type Where<P = any> =
  & { [K in FieldsOf<P>]?: unknown }
  & {
    $and?: Where<P>[];
    $or?: Where<P>[];
    $not?: Where<P>;
  };

/** JData de relaciones (es una TConsulta de Obj): `true` incluye, objeto anida, `"*"` = todas. */
export type Include = { [relation: string]: boolean | Include | undefined };

export type OrderItem = string | { field: string; dir?: "asc" | "desc" | undefined };
export type OrderBy = OrderItem | OrderItem[];

/**
 * `query()`: filtros, orden y paginación. Por GET el `QuerySpec` va como `?q=<JSON URL-encoded>` (ver `src/02-controllers/client/controller.ts`).
 * - `orderBy`: `"campo"` asc, `"-campo"` o `"+campo"` asc, o `{ field, dir }`.
 * - `page`: 1-based, default 1. `pageSize`: default el de la entidad (50); tope `entity.maxPageSize` (default 1000). `query({})` devuelve como mucho `pageSize` filas.
 */
export interface QuerySpec<P = any> {
  select?: FieldsOf<P>[] | string[];
  where?: Where<P>;
  /** `"campo"` asc, `"-campo"` desc (forma con `+` = asc, `+campo` también), o `{ field, dir }`. */
  orderBy?: OrderBy;
  /** Página 1-based. */
  page?: number;
  pageSize?: number;
  include?: Include;
}

export interface NormalizedOrder {
  field: string;
  dir: "asc" | "desc";
}

export interface PageLimits {
  pageSize: number;
  maxPageSize: number;
}

// ===================================================================================== entidad

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export const ACTIONS = [
  "get",
  "post",
  "put",
  "delete",
  "list",
  "query",
  "postList",
  "putList",
  "deleteList",
] as const;
export type Action = typeof ACTIONS[number];

/** Acciones de configuración JSON (`/cfg`). */
export type CfgAction = "getCfg" | "putCfg";

/** Documentación (`plural/doc` → md autogenerado + secciones; `plural/doc?v=1` → esa doc en la vista iswc). */
export type DocAction = "doc" | "docView";

/**
 * Resultado de un pre*: truthy = mensaje de error, falsy = OK.
 * - `string` no vacío: mensaje literal.
 * - `true` o cualquier otro truthy no string: mensaje genérico `"Datos inválidos"`.
 */
export type Check = string | boolean | null | undefined | void | 0;
export type CheckResult = Check | Promise<Check>;

/**
 * Entrada de `preConfirm`: unión discriminada por `action` (cada acción con su forma exacta de argumento).
 */
export type ConfirmInput<P> =
  | { action: "get" | "post" | "put" | "delete"; arg: P }
  | { action: "getCfg"; arg: undefined }
  | { action: "putCfg"; arg: undefined; cambios: Record<string, unknown> }
  | { action: "list"; arg: undefined }
  | { action: "query"; arg: QuerySpec<P> }
  | { action: "postList" | "putList" | "deleteList"; arg: P[] }
  | { action: "endpoint"; name: string; arg: P | P[] };

/** Verificaciones. `this` es el controller que las ejecuta (client o server). */
export interface Hooks<P extends Pojo, Ctl = any, Ctx = any> {
  /**
   * Regla GENERAL: corre en todas las acciones (CRUD, list, query, listas, endpoints, /cfg y sus /sse),
   * después de las reglas automáticas y antes del pre* específico. Evita repetir la misma regla en cada pre*.
   */
  preConfirm?(this: Ctl, input: ConfirmInput<P>, ctx: Ctx): CheckResult;
  preGet?(this: Ctl, pojo: P, ctx: Ctx): CheckResult;
  prePost?(this: Ctl, pojo: P, ctx: Ctx): CheckResult;
  prePut?(this: Ctl, pojo: P, ctx: Ctx): CheckResult;
  preDelete?(this: Ctl, pojo: P, ctx: Ctx): CheckResult;
  preList?(this: Ctl, ctx: Ctx): CheckResult;
  preQuery?(this: Ctl, query: QuerySpec<P>, ctx: Ctx): CheckResult;
  prePostList?(this: Ctl, list: P[], ctx: Ctx): CheckResult;
  prePutList?(this: Ctl, list: P[], ctx: Ctx): CheckResult;
  preDeleteList?(this: Ctl, list: P[], ctx: Ctx): CheckResult;
  /** GET `plural/cfg`. */
  preGetCfg?(this: Ctl, ctx: Ctx): CheckResult;
  /** PUT `plural/cfg`: recibe el JSON parcial. */
  prePutCfg?(this: Ctl, cambios: Record<string, unknown>, ctx: Ctx): CheckResult;
}

/**
 * Configuración JSON de la ENTIDAD (no de un registro): sus valores por defecto, servidos sólo sobre el plural
 * (`GET plural/cfg` y `PUT plural/cfg`; los singulares no tienen `/cfg`). Siempre tipada con Zod:
 * - `getCfg()` devuelve el JSON guardado con los defaults del molde aplicados;
 * - `putCfg(cambios)` aplica el JSON parcial con `Obj.update` (sólo cambia llaves que el molde ya define, nunca crea
 *   otras) y valida el resultado completo con el molde.
 * Dónde se guarda lo decide el server: una tabla de configuración (`CfgTableDef`, en `Database` o por controller);
 * si el server no define esa tabla, las rutas `/cfg` no se exponen.
 */
export interface CfgDef {
  /** Molde Zod de la config (obligatorio): forma, tipos y valores por defecto (`.default(...)`). */
  zod: z.ZodType;
}

export interface EndpointDef<P extends Pojo = any> {
  method: HttpMethod;
  /** `one` → singular/pks.../nombre y recibe un pojo. `many` → plural/nombre y recibe pojo[]. */
  scope: "one" | "many";
  /** Cómo castear la respuesta en el client. Por defecto `json` (sin casteo). */
  returns?: "pojo" | "list" | "json";
  /** Segmento de la ruta. Por defecto el nombre del endpoint. */
  path?: string;
  /** Verificación compartida del endpoint. */
  pre?(this: any, arg: P | P[], ctx: any): CheckResult;
}

export interface EntityDef<P extends Pojo> {
  pojo: PojoClass<P>;
  /** Nombre para referenciarla en relaciones (`target: "nombre"`). Por defecto `singular`. */
  name?: string;
  singular: string;
  plural: string;
  /** Segmento extra tras el singular, p.ej. "one" → `dato/one/1`. Por defecto ninguno. */
  singularSuffix?: string;
  /** Segmento extra tras el plural. Por defecto "s" sólo si singular === plural. */
  pluralSuffix?: string;
  /** Columnas aplanadas que devuelve `list()`. Por defecto todas las persistidas. */
  listColumns?: string[];
  /** Include por defecto de `get()` cuando no se especifica uno. */
  getInclude?: Include;
  pageSize?: number;
  maxPageSize?: number;
  /** Verificaciones compartidas: corren igual en client (antes del fetch) y en server. */
  hooks?: Hooks<P>;
  endpoints?: Record<string, EndpointDef<P>>;
  /** Config JSON de la entidad (`/cfg`). */
  cfg?: CfgDef;
  /**
   * Secciones de documentación (compartidas): fuentes `.md` (ruta local, `file:` o URL; indistinto) que se
   * concatenan como secciones al md AUTOGENERADO de la entidad en `GET plural/doc` y `plural/doc?v=1`.
   * El ServerController puede sobreescribirlo con su propio `doc`.
   */
  doc?: string[];
  /** En postList/putList/deleteList ejecutar además el pre singular sobre cada ítem. Default true. */
  itemHooksOnLists?: boolean;
}

export interface RouteMatch {
  /** Acción CRUD o nombre de endpoint especial. */
  name: Action | string;
  endpoint?: EndpointDef;
  /** Segmentos de pks (URL-decoded, sin castear). */
  pks: string[];
  sse: boolean;
}

// ===================================================================================== controller

export interface BaseCtx {
  signal?: AbortSignal;
  /** Relaciones a traer en `get()`. */
  include?: Include;
  [key: string]: unknown;
}

export interface ActionArgs<P> {
  get: P;
  post: P;
  put: P;
  delete: P;
  list: undefined;
  query: QuerySpec<P>;
  postList: P[];
  putList: P[];
  deleteList: P[];
}

export interface ActionResults<P> {
  get: P | null;
  post: P;
  put: P | null;
  delete: P | null;
  list: P[];
  query: P[];
  postList: P[];
  putList: P[];
  deleteList: P[];
}

/** Reemplaza la implementación de una acción. `next()` ejecuta la implementación por defecto. */
export type ActionOverride<P, Ctl, Ctx, A extends Action> = (
  this: Ctl,
  arg: ActionArgs<P>[A],
  ctx: Ctx,
  next: (arg?: ActionArgs<P>[A]) => Promise<ActionResults<P>[A]>,
) => Promise<ActionResults<P>[A]> | ActionResults<P>[A];

/** Overrides: SOLO las 9 acciones CRUD/colección (`Action`). NO cubren `getCfg`, `putCfg`, endpoints personalizados, streams (`/sse`) ni `doc` — esas rutas no son reemplazables por `actions`. */
export type ActionOverrides<P, Ctl, Ctx> = { [A in Action]?: ActionOverride<P, Ctl, Ctx, A> };

export interface ControllerOptions<P extends Pojo, Ctl, Ctx> {
  /** Verificaciones propias de este lado (se suman a las de la entidad). */
  hooks?: Hooks<P, Ctl, Ctx>;
  /** Overrides de acciones con acceso a `this` (el controller) y a `next` (la acción por defecto). */
  actions?: ActionOverrides<P, Ctl, Ctx>;
}

// ===================================================================================== client

export interface ClientCtx extends BaseCtx {
  /** Headers extra para esta llamada. */
  headers?: HeadersInit;
}

export interface ClientConfig<P extends Pojo, Ctl = any> extends ControllerOptions<P, Ctl, ClientCtx> {
  /** URL base de la API (incluye el basePath del router), p.ej. `http://localhost:8000/api`. */
  baseUrl: string;
  /** fetch a usar (por defecto el global). Útil para tests o interceptores. */
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
}

// ===================================================================================== sse

export interface SseEvent {
  event: string;
  data: string;
}

// ===================================================================================== obj
// Contratos de `Obj` (operaciones VIRTUALES): vienen de iswc por URL (`deno task sync` trae lo último).
import type { TConsulta } from "@Jeff-Aporta/wc-base/schemas.ts";
export { type TAccionObj, type TCodigoObj, type TConsulta, type TJson, ZAccionObj, ZConsulta, ZJson } from "@Jeff-Aporta/wc-base/schemas.ts";

// ===================================================================================== zod

/**
 * Schemas Zod generados de un schema JSON (ver `zodOf`).
 * `row` valida la forma LEÍDA (fila de get/list/query o resultado de POST/PUT/DELETE):
 *   todo opcional, nullable según la columna.
 * `molde` es el molde real que se pasa a `Obj.insert` para interpretar `null` y conservar
 *   el resto del JSON.
 */
export interface SchemaZod {
  /** Lectura, formularios y validación del resultado de las acciones parciales: todo opcional, nullable según la columna. */
  row: z.ZodObject;
  /** POST: requeridos = no nullable, sin default, no `sequence`, no `autoincrement` y no `virtual`. */
  insert: z.ZodObject;
  /** PUT: pks requeridas, el resto opcional. */
  update: z.ZodObject;
  /** GET/DELETE: sólo pks. */
  pk: z.ZodObject;
  /** Molde de `Obj.insert` en las acciones parciales del POJO: `null` → null si la columna es nullable; si no, se quita. */
  molde: z.ZodObject;
}

export const ZOrderItem: z.ZodType<OrderItem> = z.union([
  z.string(),
  z.object({ field: z.string(), dir: z.enum(["asc", "desc"]).optional() }),
]);

export const ZInclude: z.ZodType<Include> = z.lazy(() =>
  z.record(z.string(), z.union([z.boolean(), z.undefined(), ZInclude]))
);

/** Forma estructural de `query()` (lo que valida `ZQuerySpec`; los campos los valida `validateQuery`). */
export interface QuerySpecShape {
  select?: string[] | undefined;
  where?: Record<string, unknown> | undefined;
  orderBy?: OrderBy | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  include?: Include | undefined;
}

/** Forma de `query()` (la validación semántica de campos/relaciones la hace `validateQuery`). */
export const ZQuerySpec: z.ZodType<QuerySpecShape> = z.object({
  select: z.array(z.string()).optional(),
  where: z.record(z.string(), z.unknown()).optional(),
  orderBy: z.union([ZOrderItem, z.array(ZOrderItem)]).optional(),
  page: z.number().int().min(1, "page debe ser un entero >= 1").optional(),
  pageSize: z.number().int().min(1, "pageSize debe ser un entero >= 1").optional(),
  include: ZInclude.optional(),
}).strict();

// ===================================================================================== diagramas

/** Cardinalidad de un extremo en el diagrama ER. */
export type ErCardinality = "one" | "many" | "zeroOrOne" | "zeroOrMany";

/** Grupo visual (cajón) de un diagrama. */
export interface DiagramGroup {
  id: string;
  name: string;
  hue?: number;
}

/** Atributo de una caja ER. */
export interface DiagramAttribute {
  name: string;
  type: string;
  key?: "PK" | "FK";
}

/** Caja de entidad del diagrama ER. */
export interface ErEntityBox {
  id: string;
  name: string;
  group?: string;
  attributes: DiagramAttribute[];
}

/** Arista del diagrama ER. */
export interface ErRelation {
  from: string;
  to: string;
  fromCard: ErCardinality;
  toCard: ErCardinality;
  label?: string;
  dashStyle?: "solid" | "dashed" | "dotted";
  identifying?: boolean;
}

/** Cuerpo de { "erDiagram": … }. */
export interface ErDiagram {
  title?: string;
  direction?: "LR" | "TB";
  groups?: DiagramGroup[];
  entities: ErEntityBox[];
  relations: ErRelation[];
}

/** Payload listo para <iswc-er-diagram>. */
export interface ErPayload {
  erDiagram: ErDiagram;
}

/** Clase del diagrama de clases. */
export interface ClassBox {
  id: string;
  name: string;
  stereotype?: string;
  group?: string;
  attributes: string[];
  methods?: string[];
}

/** Arista del diagrama de clases. */
export interface ClassRelation {
  from: string;
  to: string;
  kind: "association" | "dependency";
  label?: string;
}

/** Cuerpo de { "classDiagram": … }. */
export interface ClassDiagram {
  title?: string;
  direction?: "LR" | "TB";
  groups?: DiagramGroup[];
  classes: ClassBox[];
  relations: ClassRelation[];
}

/** Payload listo para <iswc-class-diagram>. */
export interface ClassPayload {
  classDiagram: ClassDiagram;
}

/**
 * Relaciones que se propagan por entidad: { pedido: ["lineas"] }.
 * Se toma de getPropagation / setPropagation del controller.
 */
export type PropagationSpec = Record<string, readonly string[]>;

/** Opciones comunes a los payloads de diagrama. */
export interface DiagramOptions {
  /** Título que muestra el componente. */
  title?: string;
  /** Dirección del layout (default del componente si se omite). */
  direction?: "LR" | "TB";
  /** Grupos (cajones) declarados a mano. */
  groups?: DiagramGroup[];
  /** Asigna cada entidad a un grupo (recibe la entidad; basta su name). */
  groupOf?: (entity: { readonly name: string }) => string | undefined;
  /** Relaciones marcadas como propagación → arista punteada. */
  propagations?: PropagationSpec;
  /** FK nullable → zeroOrOne / zeroOrMany (default: one / many). */
  nullableCards?: boolean;
}
