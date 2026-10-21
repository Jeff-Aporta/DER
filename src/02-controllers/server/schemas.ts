/**
 * schemas.ts (server) — tipos del lado servidor, uno por línea. Viven aparte de `00-common/schemas.ts` porque dependen
 * de Kysely: así el cliente nunca necesita instalarlo.
 *
 * Secciones: motor · controller · database / router · rutas · plugins · hosts · doc · drivers
 */
import type { ColumnDefinitionBuilder, Dialect, Kysely, RawBuilder } from "kysely";
import type { z } from "zod";
import type { Pojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
import type { Action, AuthDecision, BaseCtx, ColumnDef, ControllerOptions, EndpointDef, ExposedName, HttpMethod, Include, IrregularRoute, OrderBy, PermissionContext, PluginDef, PluginEntity, RouteSecurity, SecurityDef, SecurityHooks, SecurityInput, SessionInfo, Where } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { Database } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { Router } from "@Jeff-Aporta/DER/src/02-controllers/server/router.ts";

export type Raw = RawBuilder<unknown>;

// ===================================================================================== motor

/** Motores incluidos: `pg` (también PGlite), `sqlite`, `mysql` y `mssql`. */
export type EngineName = "pg" | "sqlite" | "mysql" | "mssql" | (string & Record<never, never>);
export type IdentifierCase = "preserve" | "lower" | "upper";
/** Campo de salida de un SELECT: necesario para armar los objetos JSON de las relaciones en cada motor. */
export type OutField = { name: string; kind: "col" | "json" | "rel" };
/** Cómo devuelve filas una escritura: `returning` (PG/SQLite), `output` (MSSQL `OUTPUT inserted.*`) o `none` (MySQL: se relee). */
export type ReturningMode = "returning" | "output" | "none";
/** Índice resuelto (nombres en BD) listo para crear. */
export type ResolvedIndex = { name: string; table: string; columns: string[]; unique: boolean };
/**
 * Contrato de un motor: tipos SQL, lectura/escritura de valores, agregación JSON de las relaciones, LIKE sin mayúsculas,
 * paginación, identity, secuencias e índices. El ServerController arma la consulta sólo con estas primitivas.
 */
export type Engine = { name: EngineName; returning: ReturningMode; ifNotExists: boolean; escape: Raw | null; defaultValues: Raw; columnType(c: ColumnDef): string; selectExpr(ref: Raw, c: ColumnDef): Raw; toDb(c: ColumnDef, v: unknown): unknown; readJson(v: unknown): unknown; jsonOne(sub: Raw, alias: string, fields: OutField[]): Raw; jsonMany(sub: Raw, alias: string, fields: OutField[]): Raw; ilike(left: Raw, pattern: unknown): Raw; page(limit: number | undefined, offset: number | undefined): Raw | null; autoincrement(cb: ColumnDefinitionBuilder): ColumnDefinitionBuilder; createSequence(exec: Kysely<any>, name: string, start: number, increment: number): Promise<void>; nextValue(exec: Kysely<any>, name: string): Promise<number>; createIndex(exec: Kysely<any>, ix: ResolvedIndex): Promise<void> };

// ===================================================================================== controller

/** `exec` = la conexión o la transacción en curso; `state` = bolsa del request (`session`, `permiso`, `route`, `can`...). */
export type ServerCtx = BaseCtx & { request?: Request; exec: Kysely<any>; inTransaction?: boolean; state: Record<string, unknown> };
export type ComputedHelpers = { col(field: string): Raw; alias: string; engine: Engine };
/** SQL quemado para columnas virtuales: string con `{campo}`, `{ pg, sqlite, mysql, mssql }` por motor, o función con helpers. */
export type ComputedSql = string | Partial<Record<EngineName, string>> | ((h: ComputedHelpers) => Raw | string);
export type SseHandler<Ctl> = (this: Ctl, arg: any, send: (text: string) => void, ctx: ServerCtx) => Promise<void> | void;
export type ServerEndpoint<P extends Pojo> = { handler?(this: ServerController<P>, arg: any, ctx: ServerCtx): unknown; sse?: SseHandler<ServerController<P>> };
/** Tabla de configuración de las entidades (`plural/cfg`): una fila por entidad (pk = plural). Se declara en `Database` o por controller; sin ella `/cfg` no se expone. */
export type CfgTableDef = { table: string; columns: { pk: string; json: string; fecha: string } };
/** Índice de una tabla (columnas por nombre de campo del POJO). Default `ix_<tabla>_<columnas>` (o `ux_` si es único). */
export type IndexDef = { columns: string[]; unique?: boolean | undefined; name?: string | undefined };
/** Relaciones (y sus detalles anidados) que propaga la escritura. `true` = sin anidar más. */
export type WritePropagation = { [relation: string]: true | WritePropagation };
/**
 * Config del ServerController. `table` default: la de la entidad (plural). `doc` fuentes `.md`; `columnNames` nombres en BD;
 * `computed` SQL de las columnas virtuales; `sse` handlers por acción; `endpoints` implementación de los especiales; `cfg`
 * tabla de `/cfg` (o `false`); `expose` qué rutas se registran; `routes` irregulares; `security` (default: la de la
 * entidad); `hidden` columnas que nunca salen; `getPropagation`/`setPropagation` detalles que se leen/escriben con el padre.
 */
export type ServerControllerConfig<P extends Pojo> = ControllerOptions<P, ServerController<P>, ServerCtx> & { db: Database; table?: string; doc?: DocSources<ServerController<P>>; docBase?: string | URL; identifierCase?: IdentifierCase; columnNames?: Record<string, string>; computed?: Record<string, ComputedSql>; relations?: Record<string, { controller?: () => ServerController<any> }>; sse?: Partial<Record<Action, SseHandler<ServerController<P>>>>; endpoints?: Record<string, ServerEndpoint<P>>; cfg?: CfgTableDef | false; expose?: ExposedName[]; routes?: ExtraRoute<ServerController<P>>[]; security?: boolean | SecurityDef; hidden?: string[]; indexes?: IndexDef[]; autoIndexes?: boolean; getPropagation?(this: ServerController<P>): Include; setPropagation?(this: ServerController<P>): WritePropagation; defaultOrder?: OrderBy; register?: boolean };
export type SelectOptions = { alias?: string | undefined; fields?: string[] | undefined; where?: Where | undefined; orderBy?: OrderBy | undefined; limit?: number | undefined; offset?: number | undefined; include?: Include | undefined; extra?: Raw[] | undefined };
/** Opciones de `syncSchema()`: `migrate` recibe la fila ANTERIOR y retorna los valores nuevos; `keepExtra` no borra columnas sobrantes; `dryRun` sólo planea. */
export type SyncSchemaOptions = { migrate?(previous: Record<string, unknown>): Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>; keepExtra?: boolean | undefined; dryRun?: boolean | undefined };
export type SyncSchemaResult = { table: string; created: boolean; added: string[]; dropped: string[]; migrated: number; dryRun: boolean };
/** Relación cuyo detalle vive en OTRA base: se resuelve con un join de aplicación por POJOs (`IN` en lote). */
export type DeferredInclude = { path: string[]; rel: string; owner: ServerController<any>; include: Include | undefined };
/** SELECT armado: SQL, campos de salida y relaciones diferidas (cross-db). */
export type BuiltSelect = { query: Raw; fields: OutField[]; deferred: DeferredInclude[] };

// ===================================================================================== database / router

export type DatabaseOptions = { engine: Engine; dialect: Dialect; identifierCase?: IdentifierCase; cfg?: CfgTableDef };
export type DbFactoryOptions = { identifierCase?: IdentifierCase; cfg?: CfgTableDef };
/**
 * `context(req)` se mezcla en el ctx; `guard(route, req, ctx)` autoriza por id de ruta (retornar un Response corta);
 * `plugins` = resultados de `createServer` (sus controllers y rutas se registran; sus puertas entran al registro si el
 * consumidor no definió las suyas); `doc`/`docView` documentación general; `cors` preflight y cabeceras.
 */
export type RouterOptions = { basePath?: string; context?(req: Request): Partial<ServerCtx> | Promise<Partial<ServerCtx>>; exposeErrors?: boolean; onError?(error: unknown, req: Request): void; doc?: DocSources<unknown>; docBase?: string | URL; docView?: DocViewOptions; routes?: ExtraRoute<Router>[]; cors?: boolean | CorsOptions; guard?(route: RouteInfo, req: Request, ctx: Partial<ServerCtx>): Response | undefined | void | Promise<Response | undefined | void>; plugins?: ServerPlugin[] };
export type CorsOptions = { origin?: string; methods?: string; headers?: string; maxAge?: number };

// ===================================================================================== rutas

export type ExtraRouteInput = { request: Request; params: Record<string, string>; query: URLSearchParams; body: unknown };
/** Ruta irregular del server: la transversal (`IrregularRoute`) más `handler` (un `Response` pasa tal cual; `undefined` → 204; otro valor → JSON 200) y/o `sse`. */
export type ExtraRoute<Ctl = unknown> = IrregularRoute & { handler?(this: Ctl, input: ExtraRouteInput, ctx: ServerCtx): unknown; sse?(this: Ctl, input: ExtraRouteInput, send: (text: string) => void, ctx: ServerCtx): Promise<void> | void };
export type ActionRouteSpec = { name: string; method: HttpMethod; path: string; pkParams: string[]; sse: boolean; endpoint?: EndpointDef | undefined };
/** Descripción de una ruta registrada: `id` estable `METHOD:/ruta` (seguridad por ruta), `kind`, `name`, `entity` dueña, `security` efectiva. */
export type RouteInfo = { id: string; method: HttpMethod; path: string; kind: "action" | "extra" | "doc"; name: string; entity?: string; sse: boolean; security: RouteSecurity };
/** Ruta registrada con su handler (Web `Request` → `Response`); `params` los del host o los del matcher genérico. */
export type RouteDef = RouteInfo & { handle(req: Request, params: Record<string, string>): Promise<Response> };

// ===================================================================================== plugins (server)

/** Particularidades de servidor de una entidad de plugin (todo lo de `ServerControllerConfig` salvo `db`), inyectadas sobre la transversal. */
export type ServerEntityExtras = Omit<ServerControllerConfig<any>, "db" | "endpoints"> & { endpoints?: Record<string, EndpointDef<any> & ServerEndpoint<any>> };
export type ServerPluginEntity = PluginEntity & ServerEntityExtras;
export type ServerRoute = IrregularRoute & { handler?(this: ServerPlugin, input: ExtraRouteInput, ctx: ServerCtx): unknown; sse?(this: ServerPlugin, input: ExtraRouteInput, send: (text: string) => void, ctx: ServerCtx): Promise<void> | void };
/** Implementaciones de las puertas que el plugin ofrece (`this` = el plugin armado). El consumidor decide cuáles usa. */
export type ServerSecurityDef = { extract?(this: ServerPlugin, req: Request): Promise<SessionInfo | null> | SessionInfo | null; protected?(this: ServerPlugin, info: SessionInfo | null): boolean | Promise<boolean>; permissions?(this: ServerPlugin, info: SessionInfo | null, action: string, entity: string | null, ctx: PermissionContext): AuthDecision | Promise<AuthDecision> };
/** JSON del server de un plugin: el transversal con sus particularidades, `cfg` (Zod de la configuración), `security`, `seed` y `setup`. */
export type ServerPluginDef = Omit<PluginDef, "entities" | "routes"> & { entities?: Record<string, ServerPluginEntity> | undefined; routes?: Record<string, ServerRoute> | undefined; cfg?: z.ZodType | undefined; security?: ServerSecurityDef | undefined; seed?(this: ServerPlugin): Promise<void> | void; setup?(this: ServerPlugin): void };
/** `db` donde viven las tablas del plugin; `cfg` su configuración (admite `"env:NOMBRE"`); `env` variables para resolverlas (default: el proceso). */
export type ServerPluginRuntime = { db: Database; cfg?: Record<string, unknown> | undefined; env?: Record<string, string | undefined> | undefined };
/** Plugin armado en el server: `controllers.<clave>`, `list`, `routes` ya resueltas, `security` enlazada, `seed()`, `state` y las `ops` como métodos. */
export type ServerPlugin = { name: string; def: ServerPluginDef; db: Database; cfg: Record<string, any>; env: Record<string, string | undefined> | undefined; controllers: Record<string, ServerController<any>>; list: ServerController<any>[]; routes: ExtraRoute<ServerPlugin>[]; security: SecurityHooks; state: Record<string, unknown>; router: Router | null; seed(): Promise<void> } & Record<string, any>;
/** Seguridad de una ruta de plugin o irregular, en JSON. */
export type PluginRouteSecurity = SecurityInput;

// ===================================================================================== hosts

export type AzureHttpRequest = { method: string; url: string; headers: Iterable<[string, string]>; params: Record<string, string>; arrayBuffer(): Promise<ArrayBuffer> };
export type AzureHttpResponseInit = { status: number; headers: Record<string, string>; body?: string | Uint8Array | ReadableStream<Uint8Array> };
export type AzureAuthLevel = "anonymous" | "function" | "admin";
/** Lo mínimo de `app` de `@azure/functions` v4 (estructural: no hace falta instalar el paquete aquí). */
export type AzureApp = { http(name: string, options: { methods: string[]; route: string; authLevel: AzureAuthLevel; handler: (req: AzureHttpRequest, ctx: unknown) => Promise<AzureHttpResponseInit> }): void };
/** `stream` pasa el body como stream (SSE en vivo; requiere `app.setup({ enableHttpStream: true })`), default true. */
export type AzureOptions = { authLevel?: AzureAuthLevel; stream?: boolean; functionPrefix?: string };
export type WorkerExecutionContext = { waitUntil(promise: Promise<unknown>): void };
export type WorkerExport<Env> = { fetch(req: Request, env: Env, ctx: WorkerExecutionContext): Promise<Response> };

// ===================================================================================== doc

/** Fuentes `.md` (ruta local, `file:` o URL http(s): es indistinto) o función que las retorna. */
export type DocSources<Ctl> = string[] | ((this: Ctl) => string[] | Promise<string[]>);
export type DocSheet = { path: string; content: string };
/** Página `/doc?v=1`: `iswc-md-docs-vault` del kit por CDN, pineado por SHA. */
export type DocViewOptions = { pin?: string; title?: string; theme?: "light" | "dark"; palette?: string };

// ===================================================================================== drivers

/** Driver SQLite asíncrono estilo `sqlite3` (node-sqlite3): `all`/`run` con callback. */
export type AsyncSqlite = { all(sql: string, params: unknown[], cb: (err: Error | null, rows: unknown[]) => void): unknown; run(sql: string, params: unknown[], cb: (this: { changes?: number; lastID?: number }, err: Error | null) => void): unknown; close?(cb?: (err: Error | null) => void): unknown };
