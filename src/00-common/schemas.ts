/**
 * schemas.ts — TODAS las definiciones de tipos y contratos Zod del núcleo común (client + server).
 * Los módulos (`base`, `pojo`, `entity`, `query`, `registry`, `controller`, `zod`, `sse`) importan sus tipos de aquí.
 * Aquí no hay lógica, sólo tipos (uno por línea), constantes de contrato y schemas Zod.
 * Los tipos propios del servidor que dependen de Kysely viven en `02-controllers/server/schemas.ts`.
 *
 * Secciones: columnas · pojo · query · entidad · seguridad · controller · client · plugins · sse · zod · diagramas
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/objetos.md
 */
import { z } from "zod";
import type { Pojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
import type { Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import type { ClientController } from "@Jeff-Aporta/DER/src/02-controllers/client/controller.ts";
import type { TConsulta } from "@Jeff-Aporta/wc-base/schemas.ts";
import type { ClassSpec, DiagramGroup, ErSpec } from "@Jeff-Aporta/wc-diagrams/diagram-types.schemas.ts";

export { type TAccionObj, type TCodigoObj, type TConsulta, type TJson, ZAccionObj, ZConsulta, ZJson } from "@Jeff-Aporta/wc-base/schemas.ts";

// ===================================================================================== columnas

export type ColumnType = "string" | "text" | "int" | "bigint" | "float" | "decimal" | "bool" | "date" | "datetime" | "time" | "json" | "uuid";
export type JsonPrimitive = string | number | boolean | null;
/**
 * Secuencia de una columna: global (`CREATE SEQUENCE` en PG/MSSQL; tabla `_sequences` en SQLite/MySQL) con `name` para
 * compartirla, `start` e `increment`; `scope` = consecutivo por grupo (máximo + incremento dentro del grupo); `pattern`
 * = el número formateado (`"FAC-{n:5}"` → `FAC-00042`); `base` (2..36, default 10) = base en la que se quema el
 * número (base > 10 exige columna string); `as` = `number` (sólo base 10 en columna numérica) o `string`.
 */
export type SequenceDef = { name?: string | undefined; start?: number | undefined; increment?: number | undefined; scope?: string[] | undefined; pattern?: string | undefined; base?: number | undefined; as?: "number" | "string" | undefined };
/** `pk` forma parte de la llave; `autoincrement` = identity del motor (sólo pks enteras); `nullable` default true salvo pks; `default` literal o `{ sql }`; `enum` valores permitidos (Zod automático); `virtual` no se persiste (`computed` en el server); `sequence` valor generado al insertar; `zod` refina el valor (en `json` es su molde). */
export type ColumnDef = { type: ColumnType; pk?: boolean; autoincrement?: boolean; nullable?: boolean; length?: number; precision?: number; scale?: number; unique?: boolean; default?: JsonPrimitive | { sql: string }; enum?: readonly (string | number)[]; virtual?: boolean; sequence?: true | SequenceDef; zod?: z.ZodType };
/** `one` → objeto (1:1 / N:1), `many` → lista (1:N). `target` = nombre de la entidad (JSON puro, se resuelve en diferido) o thunk a la clase. `on` = `columnaLocal: columnaDelDetalle`. */
export type RelationDef = { kind: "one" | "many"; target: string | (() => PojoClass<any>); on: Record<string, string> };
/** Cómo aplica el PUT singular el cuerpo sobre el registro actual (acciones de `Obj`): `insert` (default, parcial), `insertIgnore`, `update` o `replace`. */
export type PutMode = "insert" | "insertIgnore" | "update" | "replace";
export type Schema = { columns: Record<string, ColumnDef>; relations?: Record<string, RelationDef>; primaryKey?: readonly string[]; put?: PutMode };
type TSOf<T extends ColumnType> = T extends "int" | "bigint" | "float" | "decimal" ? number : T extends "bool" ? boolean : T extends "datetime" ? Date : T extends "json" ? any : string;
type ColValue<C extends ColumnDef> = C extends { zod: z.ZodType<infer Z> } ? Z : C extends { enum: readonly (infer E)[] } ? E : TSOf<C["type"]>;
/** Campos (columnas) de un schema con sus tipos TS. */
export type ColumnsOf<S extends Schema> = { -readonly [K in keyof S["columns"]]: ColValue<S["columns"][K]> | null | undefined };
/** Metadata resuelta de un schema. */
export type SchemaMeta = { schema: Schema; columns: Record<string, ColumnDef>; persisted: string[]; virtual: string[]; pks: string[]; relations: Record<string, RelationDef>; column(name: string): ColumnDef; relation(name: string): RelationDef; isColumn(name: string): boolean; isRelation(name: string): boolean };

// ===================================================================================== pojo

export type PojoInit = Record<string, unknown>;
/** Constructor de un POJO concreto (clase hija de Pojo con `schema`). */
export type PojoClass<T extends Pojo = Pojo> = { new (init?: PojoInit | Pojo): T; schema: Schema; readonly meta: SchemaMeta; fromJSON<X extends Pojo>(this: new (init?: PojoInit) => X, obj: unknown): X; fromList<X extends Pojo>(this: new (init?: PojoInit) => X, list: unknown): X[]; prototype: T };
export type PojoOf<S extends Schema> = Pojo & ColumnsOf<S>;
export type GeneratedPojoClass<S extends Schema> = { new (init?: PojoInit | Pojo): PojoOf<S>; schema: S; readonly meta: SchemaMeta; fromJSON<X extends Pojo>(this: new (init?: PojoInit) => X, obj: unknown): X; fromList<X extends Pojo>(this: new (init?: PojoInit) => X, list: unknown): X[]; prototype: PojoOf<S> };
/** Llaves de datos de un POJO (excluye métodos y miembros de la base). */
export type FieldsOf<P> = Exclude<{ [K in keyof P]: P[K] extends (...a: any[]) => any ? never : K }[keyof P], keyof Pojo | "$meta"> & string;
type PatchValue<V> = V extends Date ? V | string | null : V extends (infer E)[] ? (E extends Pojo ? (Patch<E> | E)[] : V) | null : V extends Pojo ? Patch<V> | V | null : V extends Record<string, unknown> ? { [K in keyof V]?: PatchValue<V[K]> } | null : V | null;
export type PojoPartialOp = "insert" | "insertIgnore" | "update";
/** Cambios parciales tipados para `pojo.insert/insertIgnore/update` (`null` = quitar, según el molde). */
export type Patch<P> = { [K in FieldsOf<P>]?: PatchValue<NonNullable<P[K]>> } & Record<string, unknown>;
/** Consulta tipada (`true` marca la hoja; objetos descienden; `"*"` y `"[campo=valor]"` de Obj). */
export type PojoQuery<P> = { [K in FieldsOf<P>]?: TConsulta } & Record<string, TConsulta>;

// ===================================================================================== query

export type FieldOps = { eq?: unknown; ne?: unknown; gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown; in?: unknown[]; nin?: unknown[]; between?: [unknown, unknown]; like?: string; ilike?: string; contains?: string; startsWith?: string; endsWith?: string; isNull?: boolean };
/** Operadores admitidos en `where` (`campo: { op: valor }`). */
export const FIELD_OPS: ReadonlySet<string> = new Set(["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "between", "like", "ilike", "contains", "startsWith", "endsWith", "isNull"]);
/** Filtro: `campo: valor` (igualdad; `null` → IS NULL; array → IN), `campo: { op: valor }`, `relacion: { ...filtro del detalle }` (EXISTS) y los lógicos `$and`, `$or`, `$not`. */
export type Where<P = any> = { [K in FieldsOf<P>]?: unknown } & { $and?: Where<P>[]; $or?: Where<P>[]; $not?: Where<P> };
/** JData de relaciones (es una TConsulta de Obj): `true` incluye, objeto anida, `"*"` = todas. */
export type Include = { [relation: string]: boolean | Include | undefined };
export type OrderItem = string | { field: string; dir?: "asc" | "desc" | undefined };
export type OrderBy = OrderItem | OrderItem[];
/** `query()`: por GET viaja como `?q=<JSON>`. `orderBy`: `"campo"` asc, `"-campo"` desc, o `{ field, dir }`. `page` 1-based; `pageSize` default el de la entidad (50), tope `maxPageSize` (1000). */
export type QuerySpec<P = any> = { select?: FieldsOf<P>[] | string[]; where?: Where<P>; orderBy?: OrderBy; page?: number; pageSize?: number; include?: Include };
export type NormalizedOrder = { field: string; dir: "asc" | "desc" };
export type PageLimits = { pageSize: number; maxPageSize: number };

// ===================================================================================== entidad

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
/** Las nueve acciones CRUD/colección de todo controller. */
export const ACTIONS = ["get", "post", "put", "delete", "list", "query", "postList", "putList", "deleteList"] as const;
export type Action = typeof ACTIONS[number];
/** Acciones de configuración JSON (`plural/cfg`). */
export type CfgAction = "getCfg" | "putCfg";
/** Documentación (`plural/doc` → md autogenerado + secciones; `plural/doc?v=1` → vista iswc). */
export type DocAction = "doc" | "docView";
/** Resultado de un pre*: truthy = mensaje de error (string literal, o `true` = "Datos inválidos"), falsy = OK. */
export type Check = string | boolean | null | undefined | void | 0;
export type CheckResult = Check | Promise<Check>;
/** Entrada de `preConfirm`: unión discriminada por `action` (cada acción con su forma exacta de argumento). */
export type ConfirmInput<P> = { action: "get" | "post" | "put" | "delete"; arg: P } | { action: "getCfg"; arg: undefined } | { action: "putCfg"; arg: undefined; cambios: Record<string, unknown> } | { action: "list"; arg: undefined } | { action: "query"; arg: QuerySpec<P> } | { action: "postList" | "putList" | "deleteList"; arg: P[] } | { action: "endpoint"; name: string; arg: P | P[] };
/** Verificaciones. `this` es el controller que las ejecuta (client o server). `preConfirm` corre en todas las acciones antes del pre* específico. */
export type Hooks<P extends Pojo, Ctl = any, Ctx = any> = { preConfirm?(this: Ctl, input: ConfirmInput<P>, ctx: Ctx): CheckResult; preGet?(this: Ctl, pojo: P, ctx: Ctx): CheckResult; prePost?(this: Ctl, pojo: P, ctx: Ctx): CheckResult; prePut?(this: Ctl, pojo: P, ctx: Ctx): CheckResult; preDelete?(this: Ctl, pojo: P, ctx: Ctx): CheckResult; preList?(this: Ctl, ctx: Ctx): CheckResult; preQuery?(this: Ctl, query: QuerySpec<P>, ctx: Ctx): CheckResult; prePostList?(this: Ctl, list: P[], ctx: Ctx): CheckResult; prePutList?(this: Ctl, list: P[], ctx: Ctx): CheckResult; preDeleteList?(this: Ctl, list: P[], ctx: Ctx): CheckResult; preGetCfg?(this: Ctl, ctx: Ctx): CheckResult; prePutCfg?(this: Ctl, cambios: Record<string, unknown>, ctx: Ctx): CheckResult };
/** Configuración JSON de la ENTIDAD (`GET/PUT plural/cfg`): `zod` = molde con defaults; el PUT aplica `Obj.update` (sólo llaves del molde). */
export type CfgDef = { zod: z.ZodType };
/** Endpoint especial: `one` → singular/pks.../nombre con un pojo; `many` → plural/nombre con pojo[]. `returns` cómo castea el client. */
export type EndpointDef<P extends Pojo = any> = { method: HttpMethod; scope: "one" | "many"; returns?: "pojo" | "list" | "json"; path?: string; pre?(this: any, arg: P | P[], ctx: any): CheckResult };
/**
 * Definición de una entidad REST. `pojo` (clase) o `schema` (JSON: el POJO se genera); `name` para relaciones (default
 * `singular`); `table` nombre en BD (default: plural, luego singular, con `/` → `_`); `security` compartida con el
 * client (qué acciones son públicas/protegidas); `doc` fuentes `.md` para `plural/doc`.
 */
export type EntityDef<P extends Pojo = Pojo> = { pojo?: PojoClass<P>; schema?: Schema; name?: string; singular: string; plural: string; table?: string; singularSuffix?: string; pluralSuffix?: string; listColumns?: string[]; getInclude?: Include; pageSize?: number; maxPageSize?: number; hooks?: Hooks<P>; endpoints?: Record<string, EndpointDef<P>>; paths?: Record<string, IrregularPath>; cfg?: CfgDef; doc?: string[]; itemHooksOnLists?: boolean; security?: boolean | SecurityDef; exposed?: boolean; administrable?: boolean };
export type RouteMatch = { name: Action | string; endpoint?: EndpointDef; pks: string[]; sse: boolean };

// ===================================================================================== seguridad (transversal)

/** Nombre lógico que puede exponer un controller: acción CRUD, cfg, doc o endpoint especial. */
export type ExposedName = Action | CfgAction | "doc" | (string & Record<never, never>);
/** Seguridad efectiva de una ruta: `protected` exige sesión; `permissions` evalúa además `permissions()` del registro con `action` (default: id de la ruta). */
export type RouteSecurity = { protected: boolean; permissions: boolean; action?: string | undefined };
/** Seguridad declarada en una entidad o controller: `public` gana; `protected` `true` = todas las no públicas; `actions` ids personalizados por acción. */
export type SecurityDef = { public?: ExposedName[]; protected?: true | ExposedName[]; permissions?: boolean; actions?: Partial<Record<ExposedName, string>> };
/** Seguridad de una ruta irregular en JSON: `"protected"` = sólo sesión; `true` = sesión + permisos; `"public"`/`false` = pública. */
export type SecurityInput = boolean | "public" | "protected" | RouteSecurity;
/** Sesión autenticada (la entrega `extract()` del registro; viaja en `ctx.session` y, en el server, en `ctx.state.session`). */
export type SessionInfo = { id: string; role?: string | null | undefined; claims?: Record<string, unknown> | undefined; [k: string]: unknown };
/** Resultado de `permissions()`: `value` es el valor efectivo del permiso (viaja en `ctx.state.permiso`). */
export type AuthDecision = { allowed: boolean; value?: unknown; reason?: string };
/** Contexto extra de una decisión de permisos (verbo HTTP y, en el server, la ruta). */
export type PermissionContext = { method?: string | undefined; route?: unknown };
/**
 * Puertas del registro global (de libre definición por el consumidor; los plugins sólo aportan implementaciones):
 * `extract(req)` saca la sesión del request (p.ej. del JWT); `protected(info)` decide si hay sesión válida (default:
 * `info !== null`); `permissions(info, action, entity, ctx)` decide si la acción se permite. Sin `extract` no hay
 * seguridad: toda ruta se sirve (skip).
 */
export type SecurityHooks = { extract?: ((req: Request) => Promise<SessionInfo | null> | SessionInfo | null) | undefined; protected?: ((info: SessionInfo | null) => boolean | Promise<boolean>) | undefined; permissions?: ((info: SessionInfo | null, action: string, entity: string | null, ctx: PermissionContext) => AuthDecision | Promise<AuthDecision>) | undefined };
/** `ctx.state.can(action, entity?)`: evalúa una acción de seguridad para la sesión del request (sin puertas: permitido). */
export type CanFn = (action: string, entity?: string | null) => Promise<AuthDecision>;

// ===================================================================================== controller

export type BaseCtx = { signal?: AbortSignal; include?: Include; session?: SessionInfo | null | undefined; [key: string]: unknown };
export type ActionArgs<P> = { get: P; post: P; put: P; delete: P; list: undefined; query: QuerySpec<P>; postList: P[]; putList: P[]; deleteList: P[] };
export type ActionResults<P> = { get: P | null; post: P; put: P | null; delete: P | null; list: P[]; query: P[]; postList: P[]; putList: P[]; deleteList: P[] };
/** Reemplaza la implementación de una acción. `next()` ejecuta la implementación por defecto. */
export type ActionOverride<P, Ctl, Ctx, A extends Action> = (this: Ctl, arg: ActionArgs<P>[A], ctx: Ctx, next: (arg?: ActionArgs<P>[A]) => Promise<ActionResults<P>[A]>) => Promise<ActionResults<P>[A]> | ActionResults<P>[A];
/** Overrides: SOLO las 9 acciones CRUD/colección. NO cubren cfg, endpoints, `/sse` ni `doc`. */
export type ActionOverrides<P, Ctl, Ctx> = { [A in Action]?: ActionOverride<P, Ctl, Ctx, A> };
export type ControllerOptions<P extends Pojo, Ctl, Ctx> = { hooks?: Hooks<P, Ctl, Ctx>; actions?: ActionOverrides<P, Ctl, Ctx> };

// ===================================================================================== client

export type ClientCtx = BaseCtx & { headers?: HeadersInit };
export type HeadersSource = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
/** `baseUrl` incluye el basePath (`http://localhost:8000/api`); `fetch` inyectable; `headers` fijas o función (p.ej. el token). */
export type ClientConfig<P extends Pojo, Ctl = any> = ControllerOptions<P, Ctl, ClientCtx> & { baseUrl: string; fetch?: typeof fetch; headers?: HeadersSource };

// ===================================================================================== plugins (JSON transversal)

/** Dónde cuelga un path: del `singular` de la entidad, de su `plural` o de ninguna entidad (`none`). */
export type RoutePrefix = "singular" | "plural" | "none";
/** Operaciones ligadas a un path: funciones con `this` = el plugin armado (`createClient`/`createServer`); quedan como métodos del plugin. */
export type PluginOps = Record<string, (this: any, ...args: any[]) => unknown>;
/**
 * Path irregular (no sigue las reglas REST). A nivel de plugin (`irregularPaths`) no pertenece a ninguna entidad (`prefix` `none`);
 * dentro de una entidad (`paths`) cuelga de su `plural` (default) o `singular`; con `pks: true` (solo `singular`) lleva las pks de la
 * entidad (`usuario/{iusuario}/sufijo`) y el handler las recibe en `input.pks`. `zod` valida el body en el client; `returns` cómo
 * castea el client; `ops` las operaciones (cliente o server) que lo usan.
 */
export type IrregularPath = { method: HttpMethod; path: string; prefix?: RoutePrefix | undefined; pks?: boolean | undefined; security?: SecurityInput | undefined; zod?: z.ZodType | undefined; returns?: "pojo" | "list" | "json" | "void" | undefined; id?: string | undefined; ops?: PluginOps | undefined };
/** Entidad de un plugin: la definición compartida con su schema JSON y, EXPLÍCITOS, `exposed` (se publica por API) y `administrable` (admite escrituras por CRUD). */
export type PluginEntity = Omit<EntityDef<any>, "pojo" | "schema" | "exposed" | "administrable"> & { schema: Schema; exposed: boolean; administrable: boolean };
/**
 * Plugin = JSON transversal: entidades (schema, rutas regulares REST y sus `paths`) e `irregularPaths` (los que no pertenecen a
 * ninguna entidad). El server lo reusa tal cual y le INYECTA sus particularidades (`Obj.insert`): handlers, hidden, puertas…
 */
export type PluginDef = { name: string; entities?: Record<string, PluginEntity> | undefined; irregularPaths?: Record<string, IrregularPath> | undefined };
/** Config de `createClient`: `baseUrl` del API, `fetch` inyectable, `headers` fijas o función, `token` inicial y `onToken` para persistirlo. */
export type ClientPluginConfig = { baseUrl: string; fetch?: typeof fetch | undefined; headers?: HeadersSource | undefined; token?: string | null | undefined; onToken?: ((token: string | null) => void) | undefined };
/** Plugin armado en el cliente: un `ClientController` por entidad (clave del JSON), `call(path, body?, pks?)` para cualquier path irregular (del plugin o de una entidad), token de sesión y las `ops` de los paths como métodos. */
export type ClientPlugin = { name: string; def: PluginDef; config: ClientPluginConfig; controllers: Record<string, ClientController<any>>; state: Record<string, unknown>; token: string | null; setToken(token: string | null): void; headers(): HeadersInit | Promise<HeadersInit>; request(method: string, path: string, body?: unknown, ctx?: ClientCtx): Promise<Response>; call<R = unknown>(path: string, body?: unknown, keys?: Record<string, string> | Pojo): Promise<R> } & Record<string, any>;

// ===================================================================================== sse

export type SseEvent = { event: string; data: string };

// ===================================================================================== zod

/** Schemas Zod generados de un schema JSON (ver `zodOf`): `row` lectura (todo opcional), `insert` POST, `update` PUT (pks requeridas), `pk` GET/DELETE, `molde` de `Obj.insert`. */
export type SchemaZod = { row: z.ZodObject; insert: z.ZodObject; update: z.ZodObject; pk: z.ZodObject; molde: z.ZodObject };
/** Zod de un ítem de `orderBy`: texto (`"-campo"`) u objeto `{ field, dir }`. */
export const ZOrderItem: z.ZodType<OrderItem> = z.union([z.string(), z.object({ field: z.string(), dir: z.enum(["asc", "desc"]).optional() })]);
/** Zod recursivo del `include` (JData de relaciones). */
export const ZInclude: z.ZodType<Include> = z.lazy(() => z.record(z.string(), z.union([z.boolean(), z.undefined(), ZInclude])));
export type QuerySpecShape = { select?: string[] | undefined; where?: Record<string, unknown> | undefined; orderBy?: OrderBy | undefined; page?: number | undefined; pageSize?: number | undefined; include?: Include | undefined };
/** Forma de `query()` (la validación semántica de campos/relaciones la hace `validateQuery`). */
export const ZQuerySpec: z.ZodType<QuerySpecShape> = z.object({ select: z.array(z.string()).optional(), where: z.record(z.string(), z.unknown()).optional(), orderBy: z.union([ZOrderItem, z.array(ZOrderItem)]).optional(), page: z.number().int().min(1, "page debe ser un entero >= 1").optional(), pageSize: z.number().int().min(1, "pageSize debe ser un entero >= 1").optional(), include: ZInclude.optional() }).strict();

// ===================================================================================== diagramas

// Los tipos del payload son EXACTAMENTE los del kit is-webcomponents (por CDN): lo que DER genera es lo que el componente lee.
export type { ClassRelationKind, ClassSpec, ClassSpecClass, ClassSpecRelation, DiagramGroup, ErCardinality, ErDashStyle, ErSpec, ErSpecAttribute, ErSpecEntity, ErSpecRelation } from "@Jeff-Aporta/wc-diagrams/diagram-types.schemas.ts";
/** Payload listo para <iswc-er-diagram> (`ErSpec` del kit, ya normalizado: direction, ratio, ids, identifying). */
export type ErPayload = { erDiagram: ErSpec };
/** Payload listo para <iswc-class-diagram> (`ClassSpec` del kit). */
export type ClassPayload = { classDiagram: ClassSpec };
/** Relaciones que se propagan por entidad: { pedido: ["lineas"] }. */
export type PropagationSpec = Record<string, readonly string[]>;
/** `groupOf` asigna cada entidad a un grupo; `propagations` → arista punteada; `nullableCards` FK nullable → zeroOrOne/zeroOrMany; `ratio` guía ancho/alto del ER (default 1.4, el del kit). */
export type DiagramOptions = { title?: string; subtitle?: string; direction?: ErSpec["direction"]; ratio?: number; groups?: DiagramGroup[]; groupOf?: (entity: { readonly name: string }) => string | undefined; propagations?: PropagationSpec; nullableCards?: boolean };
/** Lo que `registry.entities()` entrega: la entidad y su clave (pluralPath). */
export type RegisteredEntity = { key: string; entity: Entity<any> };
