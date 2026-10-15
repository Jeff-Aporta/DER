/**
 * ServerController: implementa las acciones contra SQL. El SQL lo arma el controller a partir del schema
 * (columnas, pks, relaciones) bifurcando por motor; el usuario sólo aporta SQL quemado para columnas calculadas.
 *
 * ```ts
 * const productos = new ServerController(Producto, {
 *   db, table: "productos", identifierCase: "lower",
 *   computed: { total: "{precio} * {stock}" },          // {campo} → referencia correcta según motor/caso
 *   hooks: { prePost(p) { if (p.precio! < 0) return "precio negativo"; } },
 *   actions: { async delete(p, ctx, next) { ...; return next(p); } },
 *   sse: { post(p, send) { send("validando"); ... } },
 *   endpoints: { activar: { handler(p, ctx) { ... } } },
 * });
 * ```
 */
import { type Kysely, sql } from "kysely";
import { CASTS } from "../../00 common/cast.ts";
import { BaseController } from "../controller.ts";
import type { Entity } from "../../01 objects/entity.ts";
import { HttpError, NotFoundError, ValidationError } from "../../00 common/errors.ts";
import { Obj } from "../../00 common/obj.ts";
import { type Pojo, resolvePojo } from "../../01 objects/pojo.ts";
import { expandInclude, isOpsObject, normalizeOrder } from "../../01 objects/query.ts";
import type {
  Action,
  CfgAction,
  ColumnDef,
  SequenceDef,
  EndpointDef,
  FieldOps,
  Include,
  QuerySpec,
  Where,
} from "../../00 common/schemas.ts";
import { TextChannel } from "../../00 common/sse.ts";
import { zodMessage } from "../../01 objects/zod.ts";
import { type Database, registeredControllers } from "./database.ts";
import { composeFromSources, entityContractMd, entitySheetPath, vaultHtml } from "./doc.ts";
import { applyCase } from "./engine.ts";
import type {
  ComputedSql,
  BuiltSelect,
  DeferredInclude,
  DocSheet,
  DocViewOptions,
  Engine,
  IdentifierCase,
  OutField,
  Raw,
  SelectOptions,
  ServerControllerConfig,
  ResolvedIndex,
  ServerCtx,
  SyncSchemaOptions,
  SyncSchemaResult,
  WritePropagation,
} from "./schemas.ts";


/** Generador de alias únicos por consulta. */
export class Aliases {
  #n = 0;
  next(): string {
    return `t${this.#n++}`;
  }
}

const escapeLike = (s: string) => String(s).replace(/[\\%_]/g, (m) => "\\" + m);
const ESCAPE = sql.raw(`escape '\\'`);

export class ServerController<P extends Pojo> extends BaseController<P, ServerCtx> {
  readonly db: Database;
  readonly table: string;
  readonly identifierCase: IdentifierCase;

  constructor(entity: Entity<P>, readonly config: ServerControllerConfig<P>) {
    super(entity, config);
    this.db = config.db;
    this.identifierCase = config.identifierCase ?? config.db.identifierCase;
    this.table = applyCase(config.table, this.identifierCase);
    const meta = entity.meta;
    for (const k of Object.keys(config.computed ?? {})) {
      if (!meta.columns[k]?.virtual) throw new Error(`computed: "${k}" debe ser una columna virtual del schema`);
    }
    for (const k of Object.keys(config.columnNames ?? {})) {
      if (!meta.isColumn(k)) throw new Error(`columnNames: "${k}" no es una columna`);
    }
    if (config.register !== false) config.db.register(this);
  }

  get engine(): Engine {
    return this.db.engine;
  }

  // ================================================================ identificadores

  /** Columna oculta: nunca se devuelve (`config.hidden`). */
  isHidden(field: string): boolean {
    return this.config.hidden?.includes(field) ?? false;
  }

  /** Una consulta pública no puede seleccionar columnas ocultas (los filtros los rechaza `buildWhere`). */
  private assertNotHidden(q: QuerySpec<P>): void {
    const used = [...(q.select ?? [])];
    const hidden = used.find((f) => this.isHidden(f));
    if (hidden) throw new ValidationError(`"${hidden}" no es consultable`);
  }

  /** Nombre de la columna en BD. */
  dbCol(field: string): string {
    return applyCase(this.config.columnNames?.[field] ?? field, this.identifierCase);
  }

  /** Referencia a columna, calificada con alias si se da. */
  col(alias: string | null, field: string): Raw {
    const c = this.dbCol(field);
    return alias ? sql.ref(`${alias}.${c}`) : sql.id(c);
  }

  /** Expresión cruda de un campo (columna o calculado) o null si es virtual sin expresión. */
  fieldExpr(alias: string, field: string): Raw | null {
    const c = this.entity.meta.columns[field];
    if (!c) throw new ValidationError(`"${field}" no es una columna`);
    if (!c.virtual) return this.col(alias, field);
    const def = this.config.computed?.[field];
    if (def === undefined) return null;
    return this.compileComputed(alias, def);
  }

  private compileComputed(alias: string, def: ComputedSql): Raw {
    let src: Raw | string | undefined;
    if (typeof def === "function") {
      src = def({ col: (f) => this.col(alias, f), alias, engine: this.engine });
    } else if (typeof def === "object") {
      src = (def as Record<string, string | undefined>)[this.engine.name];
      if (src === undefined) throw new Error(`computed sin expresión para el motor ${this.engine.name}`);
    } else src = def;
    if (typeof src !== "string") return src;
    // "{precio} * {stock}" → partes crudas + referencias
    const parts: Raw[] = [];
    let last = 0;
    for (const m of src.matchAll(/\{(\w+)\}/g)) {
      parts.push(sql.raw(src.slice(last, m.index)));
      parts.push(this.col(alias, m[1] ?? ""));
      last = (m.index ?? 0) + m[0].length;
    }
    parts.push(sql.raw(src.slice(last)));
    return sql`(${sql.join(parts, sql``)})`;
  }

  private colDef(field: string): ColumnDef {
    return this.entity.meta.column(field);
  }

  /** Castea con el tipo de la columna y convierte al formato del motor. */
  toDb(field: string, v: unknown): unknown {
    const c = this.colDef(field);
    return this.engine.toDb(c, v == null ? v : CASTS[c.type](v));
  }

  // ================================================================ SELECT

  /** Arma un SELECT completo con relaciones anidadas (JSON) y filtros. */
  buildSelect(opts: SelectOptions = {}, aliases = new Aliases()): BuiltSelect {
    const meta = this.entity.meta;
    const A = opts.alias ?? aliases.next();
    const explicit = !!opts.fields;
    const includes = expandInclude(meta, opts.include);
    const fields = [
      ...(opts.fields ?? [
        ...meta.persisted.filter((f) => !this.isHidden(f)),
        ...meta.virtual.filter((v) => this.config.computed?.[v] !== undefined),
      ]),
    ];
    // las relaciones a otra base se anexan por POJOs: necesitan las columnas locales de `on` en la salida
    for (const [rel] of includes) {
      if (this.isSameDb(this.relationController(rel))) continue;
      for (const local of Object.keys(meta.relation(rel).on)) if (!fields.includes(local)) fields.push(local);
    }
    const sel: Raw[] = [];
    const out: OutField[] = [];
    for (const f of fields) {
      const c = meta.columns[f];
      if (!c) throw new ValidationError(`"${f}" no es una columna`);
      let expr = this.fieldExpr(A, f);
      if (!expr) {
        if (explicit) throw new ValidationError(`"${f}" no tiene expresión en el servidor`);
        continue;
      }
      if (!c.virtual) expr = this.engine.selectExpr(expr, c);
      sel.push(sql`${expr} as ${sql.id(f)}`);
      out.push({ name: f, kind: c.type === "json" ? "json" : "col" });
    }
    const deferred: DeferredInclude[] = [];
    for (const [rel, sub] of includes) {
      if (!this.isSameDb(this.relationController(rel))) {
        deferred.push({ path: [], rel, owner: this, include: sub });
        continue;
      }
      const r = this.relationExpr(A, rel, sub, aliases);
      sel.push(sql`${r.expr} as ${sql.id(rel)}`);
      out.push({ name: rel, kind: "rel" });
      for (const d of r.deferred) deferred.push({ ...d, path: [rel, ...d.path] });
    }
    if (!sel.length) throw new ValidationError("No hay columnas para seleccionar");

    const conds = [...(opts.extra ?? [])];
    const w = this.buildWhere(A, opts.where, aliases);
    if (w) conds.push(w);

    let q = sql`select ${sql.join(sel)} from ${sql.table(this.table)} as ${sql.id(A)}`;
    if (conds.length) q = sql`${q} where ${sql.join(conds, sql` and `)}`;
    const order = normalizeOrder(opts.orderBy ?? this.config.defaultOrder);
    const orderSql = (order.length ? order : meta.pks.map((field) => ({ field, dir: "asc" as const }))).map(
      (o) => {
        const e = this.fieldExpr(A, o.field);
        if (!e) throw new ValidationError(`"${o.field}" no tiene expresión en el servidor`);
        return sql`${e} ${sql.raw(o.dir)}`;
      },
    );
    q = sql`${q} order by ${sql.join(orderSql)}`;
    if (opts.limit !== undefined) q = sql`${q} limit ${opts.limit}`;
    if (opts.offset) q = sql`${q} offset ${opts.offset}`;
    return { query: q, fields: out, deferred };
  }

  /** ¿El otro controller vive en la misma base (mismo SQL posible)? */
  isSameDb(other: ServerController<any>): boolean {
    return other.db === this.db;
  }

  /** Controller que maneja el detalle de una relación. */
  relationController(rel: string): ServerController<any> {
    const def = this.entity.meta.relation(rel);
    if (!def) throw new ValidationError(`"${rel}" no es una relación`);
    const override = this.config.relations?.[rel]?.controller?.();
    if (override) return override;
    try {
      return this.db.controllerFor(resolvePojo(def.target));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`"${this.entity.name}" usa la relación "${rel}": ${msg}`);
    }
  }

  private correlation(A: string, rel: string, child: ServerController<any>, Z: string): Raw[] {
    const def = this.entity.meta.relation(rel);
    return Object.entries(def.on).map(([local, remote]) => sql`${child.col(Z, remote)} = ${this.col(A, local)}`);
  }

  /** Subconsulta correlacionada que devuelve el detalle como objeto (one) o arreglo (many) JSON. */
  relationExpr(
    A: string,
    rel: string,
    include: Include | undefined,
    aliases: Aliases,
  ): { expr: Raw; deferred: DeferredInclude[] } {
    const def = this.entity.meta.relation(rel);
    const child = this.relationController(rel);
    const Z = aliases.next();
    const { query, fields, deferred } = child.buildSelect(
      {
        alias: Z,
        include,
        extra: this.correlation(A, rel, child, Z),
        limit: def.kind === "one" ? 1 : undefined,
      },
      aliases,
    );
    const W = aliases.next();
    const expr = def.kind === "one" ? this.engine.jsonOne(query, W, fields) : this.engine.jsonMany(query, W, fields);
    return { expr, deferred };
  }

  // ================================================================ WHERE

  buildWhere(A: string, where: Where | undefined, aliases = new Aliases()): Raw | null {
    if (!where) return null;
    const meta = this.entity.meta;
    const parts: Raw[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (k === "$and" || k === "$or") {
        const subs = (v as Where[]).map((w) => this.buildWhere(A, w, aliases)).filter((x): x is Raw => !!x);
        if (subs.length) parts.push(sql`(${sql.join(subs, k === "$and" ? sql` and ` : sql` or `)})`);
        else if (k === "$or" && (v as Where[]).length) parts.push(sql`1 = 1`);
      } else if (k === "$not") {
        const s = this.buildWhere(A, v as Where, aliases);
        if (s) parts.push(sql`not (${s})`);
      } else if (meta.isRelation(k)) {
        const child = this.relationController(k);
        const Z = aliases.next();
        const conds = [...this.correlation(A, k, child, Z)];
        const cw = child.buildWhere(Z, v as Where, aliases);
        if (cw) conds.push(cw);
        parts.push(sql`exists (select 1 from ${sql.table(child.table)} as ${sql.id(Z)} where ${
          sql.join(conds, sql` and `)
        })`);
      } else {
        // una columna oculta nunca se filtra (tampoco vía relaciones o lógicos): no puede servir de oráculo
        if (this.isHidden(k)) throw new ValidationError(`"${k}" no es consultable`);
        const e = this.fieldExpr(A, k);
        if (!e) throw new ValidationError(`"${k}" no tiene expresión en el servidor`);
        parts.push(...this.fieldConditions(k, e, v));
      }
    }
    return parts.length ? sql.join(parts, sql` and `) : null;
  }

  private fieldConditions(field: string, e: Raw, v: unknown): Raw[] {
    const p = (x: unknown) => this.toDb(field, x);
    if (v === null) return [sql`${e} is null`];
    if (Array.isArray(v)) return [v.length ? sql`${e} in (${sql.join(v.map(p))})` : sql`1 = 0`];
    if (!isOpsObject(v)) return [sql`${e} = ${p(v)}`];
    const out: Raw[] = [];
    const ops = v as FieldOps;
    for (const [op, x] of Object.entries(ops)) {
      if (x === undefined) continue;
      switch (op) {
        case "eq":
          out.push(x === null ? sql`${e} is null` : sql`${e} = ${p(x)}`);
          break;
        case "ne":
          out.push(x === null ? sql`${e} is not null` : sql`${e} <> ${p(x)}`);
          break;
        case "gt":
          out.push(sql`${e} > ${p(x)}`);
          break;
        case "gte":
          out.push(sql`${e} >= ${p(x)}`);
          break;
        case "lt":
          out.push(sql`${e} < ${p(x)}`);
          break;
        case "lte":
          out.push(sql`${e} <= ${p(x)}`);
          break;
        case "in": {
          const a = x as unknown[];
          out.push(a.length ? sql`${e} in (${sql.join(a.map(p))})` : sql`1 = 0`);
          break;
        }
        case "nin": {
          const a = x as unknown[];
          if (a.length) out.push(sql`${e} not in (${sql.join(a.map(p))})`);
          break;
        }
        case "between": {
          const [a, b] = x as [unknown, unknown];
          out.push(sql`${e} between ${p(a)} and ${p(b)}`);
          break;
        }
        case "like":
          out.push(sql`${e} like ${String(x)}`);
          break;
        case "ilike":
          out.push(this.engine.ilike(e, String(x)));
          break;
        case "contains":
          out.push(sql`${this.engine.ilike(e, `%${escapeLike(x as string)}%`)} ${ESCAPE}`);
          break;
        case "startsWith":
          out.push(sql`${this.engine.ilike(e, `${escapeLike(x as string)}%`)} ${ESCAPE}`);
          break;
        case "endsWith":
          out.push(sql`${this.engine.ilike(e, `%${escapeLike(x as string)}`)} ${ESCAPE}`);
          break;
        case "isNull":
          out.push(x ? sql`${e} is null` : sql`${e} is not null`);
          break;
        default:
          throw new ValidationError(`Operador desconocido "${op}"`);
      }
    }
    return out;
  }

  /** `pk1 = ? and pk2 = ?` (alias null → sin calificar, para UPDATE/DELETE). */
  pkWhere(alias: string | null, pojo: P): Raw {
    const self = pojo as unknown as Record<string, unknown>;
    return sql.join(
      this.entity.meta.pks.map((k) => sql`${this.col(alias, k)} = ${this.toDb(k, self[k])}`),
      sql` and `,
    );
  }

  private returning(): Raw {
    const meta = this.entity.meta;
    return sql.join(
      meta.persisted.filter((f) => !this.isHidden(f))
        .map((f) => sql`${this.engine.selectExpr(this.col(null, f), meta.column(f))} as ${sql.id(f)}`),
    );
  }

  // ================================================================ ejecución

  /** Ejecuta SQL y castea las filas al POJO. */
  async rows(q: Raw, exec: Kysely<any> = this.db.kysely): Promise<P[]> {
    const { rows } = await q.execute(exec);
    return this.toPojos(rows as Record<string, unknown>[]);
  }

  toPojos(rows: Record<string, unknown>[]): P[] {
    const meta = this.entity.meta;
    const jsonCols = Object.keys(meta.columns).filter((k) => meta.column(k).type === "json");
    const rels = Object.keys(meta.relations);
    return rows.map((r) => {
      for (const k of jsonCols) if (k in r) r[k] = this.engine.readJson(r[k]);
      for (const k of rels) if (k in r) r[k] = this.engine.readJson(r[k]);
      return this.entity.toPojo(r);
    });
  }

  async selectOne(pojo: P, include: Include | undefined, exec?: Kysely<any>): Promise<P | null> {
    const aliases = new Aliases();
    const A = aliases.next();
    const built = this.buildSelect({ alias: A, include, extra: [this.pkWhere(A, pojo)], limit: 1 }, aliases);
    const rows = await this.rows(built.query, exec);
    await this.resolveDeferred(rows, built.deferred);
    return rows[0] ?? null;
  }

  /** SELECT con filtros cross-db resueltos y relaciones de otras bases anexadas por POJOs. */
  async select(opts: SelectOptions, exec?: Kysely<any>): Promise<P[]> {
    const where = await this.resolveWhere(opts.where);
    const built = this.buildSelect({ ...opts, where });
    const rows = await this.rows(built.query, exec);
    await this.resolveDeferred(rows, built.deferred);
    return rows;
  }

  // ================================================================ cross-db (join de aplicación por POJOs)

  /** Objetos dueños de una relación diferida: las filas raíz o los anidados en `path`. */
  private holdersAt(roots: Pojo[], path: string[]): Pojo[] {
    let level: unknown[] = roots;
    for (const seg of path) {
      level = level.flatMap((o) => {
        const v = (o as Record<string, unknown> | null)?.[seg];
        return Array.isArray(v) ? v : v ? [v] : [];
      });
    }
    return level.filter((o): o is Pojo => o != null && typeof o === "object");
  }

  /** Resuelve las relaciones diferidas (detalles en otra base) y las anexa a sus dueños. */
  async resolveDeferred(roots: Pojo[], deferred: DeferredInclude[]): Promise<void> {
    for (const d of deferred) {
      const holders = this.holdersAt(roots, d.path);
      if (holders.length) await d.owner.attachRelation(holders, d.rel, d.include);
    }
  }

  /**
   * Anexa a `holders` (POJOs de este controller) la relación `rel`, consultando en lote al controller del
   * detalle con SU base y SU motor (`IN` sobre las llaves de `on`).
   */
  async attachRelation(holders: Pojo[], rel: string, include: Include | undefined): Promise<void> {
    const def = this.entity.meta.relation(rel);
    const child = this.relationController(rel);
    const pairs = Object.entries(def.on);
    const keyOf = (o: Record<string, unknown>, cols: string[]) => JSON.stringify(cols.map((c) => o[c] ?? null));
    const locals = pairs.map(([l]) => l);
    const remotes = pairs.map(([, r]) => r);
    const tuples = new Map<string, Record<string, unknown>>();
    for (const h of holders) {
      const o = h as unknown as Record<string, unknown>;
      if (locals.some((l) => o[l] == null)) continue;
      tuples.set(keyOf(o, locals), Object.fromEntries(pairs.map(([l, r]) => [r, o[l]])));
    }
    const found = tuples.size ? await child.select({ where: this.tuplesWhere(remotes, [...tuples.values()]), include }) : [];
    const byKey = new Map<string, Pojo[]>();
    for (const c of found) {
      const k = keyOf(c as unknown as Record<string, unknown>, remotes);
      byKey.set(k, [...(byKey.get(k) ?? []), c]);
    }
    for (const h of holders) {
      const matches = byKey.get(keyOf(h as unknown as Record<string, unknown>, locals)) ?? [];
      (h as unknown as Record<string, unknown>)[rel] = def.kind === "many" ? matches : matches[0] ?? null;
    }
  }

  /** `where` que coincide con cualquiera de las tuplas (`IN` si es una sola columna). */
  private tuplesWhere(cols: string[], tuples: Record<string, unknown>[]): Where {
    const [only] = cols;
    if (cols.length === 1 && only) return { [only]: { in: tuples.map((t) => t[only]) } };
    return { $or: tuples };
  }

  /**
   * Traduce los filtros por relación cuyo detalle vive en otra base: consulta allá las llaves que cumplen
   * y los reemplaza por un filtro local sobre las columnas de `on`. Los de la misma base quedan en SQL (EXISTS).
   */
  async resolveWhere(where: Where | undefined): Promise<Where | undefined> {
    if (!where) return where;
    const meta = this.entity.meta;
    const out: Record<string, unknown> = {};
    const extra: Where[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (k === "$and" || k === "$or") {
        out[k] = await Promise.all((v as Where[]).map((w) => this.resolveWhere(w)));
      } else if (k === "$not") {
        out[k] = await this.resolveWhere(v as Where);
      } else if (meta.isRelation(k)) {
        const child = this.relationController(k);
        if (this.isSameDb(child)) {
          out[k] = await child.resolveWhere(v as Where);
          continue;
        }
        const pairs = Object.entries(meta.relation(k).on);
        const found = await child.select({ fields: pairs.map(([, r]) => r), where: v as Where });
        const tuples = found.map((c) =>
          Object.fromEntries(pairs.map(([l, r]) => [l, (c as unknown as Record<string, unknown>)[r]]))
        );
        const [firstLocal] = pairs.map(([l]) => l);
        extra.push(
          tuples.length || !firstLocal
            ? this.tuplesWhere(pairs.map(([l]) => l), tuples)
            : { [firstLocal]: { in: [] } },
        );
      } else out[k] = v;
    }
    if (extra.length) out["$and"] = [...((out["$and"] as Where[] | undefined) ?? []), ...extra];
    return out as Where;
  }

  async insertOne(pojo: P, exec?: Kysely<any>): Promise<P> {
    const meta = this.entity.meta;
    const self = pojo as unknown as Record<string, unknown>;
    await this.fillSequences(pojo, exec ?? this.db.kysely);
    const fields = meta.persisted.filter((k) =>
      self[k] !== undefined && !(meta.column(k).autoincrement && self[k] == null)
    );
    const tbl = sql.table(this.table);
    const q = fields.length
      ? sql`insert into ${tbl} (${sql.join(fields.map((f) => sql.id(this.dbCol(f))))}) values (${
        sql.join(fields.map((f) => this.toDb(f, self[f])))
      }) returning ${this.returning()}`
      : sql`insert into ${tbl} default values returning ${this.returning()}`;
    const [row] = await this.rows(q, exec);
    if (!row) throw new Error(`INSERT en "${this.table}" no retornó la fila`);
    return row;
  }

  async updateOne(pojo: P, exec?: Kysely<any>): Promise<P | null> {
    const meta = this.entity.meta;
    const self = pojo as unknown as Record<string, unknown>;
    const fields = meta.persisted.filter((k) => !meta.pks.includes(k) && self[k] !== undefined);
    if (!fields.length) return this.selectOne(pojo, undefined, exec);
    const sets = fields.map((f) => sql`${sql.id(this.dbCol(f))} = ${this.toDb(f, self[f])}`);
    const q = sql`update ${sql.table(this.table)} set ${sql.join(sets)} where ${
      this.pkWhere(null, pojo)
    } returning ${this.returning()}`;
    return (await this.rows(q, exec))[0] ?? null;
  }

  async deleteOne(pojo: P, exec?: Kysely<any>): Promise<P | null> {
    const q = sql`delete from ${sql.table(this.table)} where ${this.pkWhere(null, pojo)} returning ${
      this.returning()
    }`;
    return (await this.rows(q, exec))[0] ?? null;
  }

  /** Ejecuta en la transacción del ctx o abre una nueva. */
  async inTransaction<T>(ctx: ServerCtx, fn: (exec: Kysely<any>) => Promise<T>): Promise<T> {
    if (ctx.inTransaction) return fn(ctx.exec);
    return await this.db.kysely.transaction().execute(fn);
  }

  protected makeCtx(partial?: Partial<ServerCtx>): ServerCtx {
    return { state: {}, ...partial, exec: partial?.exec ?? this.db.kysely };
  }

  // ================================================================ propagación de detalles

  /** Detalles que se extraen en `get` (config `getPropagation`, o `entity.def.getInclude`). */
  getPropagation(): Include {
    return this.config.getPropagation?.call(this) ?? this.entity.def.getInclude ?? {};
  }

  /** Detalles que se escriben junto al padre en post/put/delete (config `setPropagation`). */
  setPropagation(): WritePropagation {
    return this.config.setPropagation?.call(this) ?? {};
  }

  /** Valores de un detalle (arreglo en 1:N, objeto o nada en 1:1) como lista. */
  private detailItems(rel: string, value: unknown): Pojo[] {
    const def = this.entity.meta.relation(rel);
    if (def.kind === "many") return Array.isArray(value) ? value as Pojo[] : [];
    return value instanceof Object ? [value as Pojo] : [];
  }

  /**
   * Ejecutor para escribir en un detalle: la transacción en curso si vive en la misma base; si vive en otra
   * (otro motor o credenciales), SU propia conexión (cross-db no es atómico entre bases).
   */
  private childExec(child: ServerController<any>, exec: Kysely<any>, ctx: ServerCtx): { exec: Kysely<any>; ctx: ServerCtx } {
    if (this.isSameDb(child)) return { exec, ctx: { ...ctx, exec, inTransaction: true } };
    const own = child.db.kysely;
    return { exec: own, ctx: { ...ctx, exec: own, inTransaction: false } };
  }

  /** Inserta los detalles de `rels` de `source` colgándolos de `parent` (FK según `on`), con sus pre*. */
  private async insertDetails(
    parent: P,
    source: P,
    prop: WritePropagation,
    exec: Kysely<any>,
    ctx: ServerCtx,
  ): Promise<void> {
    const self = parent as unknown as Record<string, unknown>;
    for (const [rel, nested] of Object.entries(prop)) {
      const value = (source as unknown as Record<string, unknown>)[rel];
      if (value === undefined) continue;
      const def = this.entity.meta.relation(rel);
      const child = this.relationController(rel);
      const saved: Pojo[] = [];
      for (const [i, raw] of this.detailItems(rel, value).entries()) {
        const item = child.entity.toPojo(raw) as Pojo & Record<string, unknown>;
        for (const [local, remote] of Object.entries(def.on)) item[remote] = self[local];
        const x = this.childExec(child, exec, ctx);
        const e = await child.verify("post", item, x.ctx);
        if (e) throw new ValidationError(`${rel}[${i}]: ${e}`);
        saved.push(await child.insertDeep(item, nested === true ? {} : nested, x.exec, x.ctx));
      }
      self[rel] = def.kind === "many" ? saved : saved[0] ?? null;
    }
  }

  /** Borra (en cascada según `prop`) los detalles actuales de `parent`. */
  private async deleteDetails(parent: P, prop: WritePropagation, exec: Kysely<any>, ctx: ServerCtx): Promise<void> {
    const self = parent as unknown as Record<string, unknown>;
    for (const [rel, nested] of Object.entries(prop)) {
      const def = this.entity.meta.relation(rel);
      const child = this.relationController(rel);
      const where = Object.fromEntries(Object.entries(def.on).map(([local, remote]) => [remote, self[local]]));
      const x = this.childExec(child, exec, ctx);
      for (const item of await child.select({ where }, x.exec)) {
        await child.deleteDeep(item, nested === true ? {} : nested, x.exec, x.ctx);
      }
    }
  }

  /** `post` con propagación: el padre y luego sus detalles (recursivo). */
  async insertDeep(pojo: P, prop: WritePropagation, exec: Kysely<any>, ctx: ServerCtx): Promise<P> {
    const saved = await this.insertOne(pojo, exec);
    await this.insertDetails(saved, pojo, prop, exec, ctx);
    return saved;
  }

  /** `put` con propagación: el padre y, por cada detalle enviado, borra los actuales e inserta los nuevos. */
  async updateDeep(pojo: P, prop: WritePropagation, exec: Kysely<any>, ctx: ServerCtx): Promise<P | null> {
    const updated = await this.updateOne(pojo, exec);
    if (!updated) return null;
    const sent = (pojo as unknown as Record<string, unknown>);
    const touched = Object.fromEntries(Object.entries(prop).filter(([rel]) => sent[rel] !== undefined));
    await this.deleteDetails(updated, touched, exec, ctx);
    await this.insertDetails(updated, pojo, touched, exec, ctx);
    return updated;
  }

  /** `delete` con propagación: los detalles (en cascada) y luego el padre. */
  async deleteDeep(pojo: P, prop: WritePropagation, exec: Kysely<any>, ctx: ServerCtx): Promise<P | null> {
    if (!Object.keys(prop).length) return this.deleteOne(pojo, exec);
    const current = await this.selectOne(pojo, {}, exec);
    if (!current) return null;
    await this.deleteDetails(current, prop, exec, ctx);
    return this.deleteOne(pojo, exec);
  }

  /** Ejecuta una escritura: directa si no hay propagación, o en transacción si la hay. */
  private write<T>(ctx: ServerCtx, direct: () => Promise<T>, deep: (prop: WritePropagation, tx: Kysely<any>) => Promise<T>) {
    const prop = this.setPropagation();
    if (!Object.keys(prop).length) return direct();
    return this.inTransaction(ctx, (tx) => deep(prop, tx));
  }

  protected execute(action: Action, arg: unknown, ctx: ServerCtx): Promise<unknown> {
    const ex = ctx.exec;
    switch (action) {
      case "get":
        return this.selectOne(arg as P, ctx.include ?? this.getPropagation(), ex);
      case "post":
        return this.write(ctx, () => this.insertOne(arg as P, ex), (prop, tx) => this.insertDeep(arg as P, prop, tx, ctx));
      case "put":
        return this.write(ctx, () => this.updateOne(arg as P, ex), (prop, tx) => this.updateDeep(arg as P, prop, tx, ctx));
      case "delete":
        return this.write(ctx, () => this.deleteOne(arg as P, ex), (prop, tx) => this.deleteDeep(arg as P, prop, tx, ctx));
      case "list":
        return this.select({ fields: this.entity.listColumns.filter((f) => !this.isHidden(f)) }, ex);
      case "query": {
        const q = arg as QuerySpec<P>;
        this.assertNotHidden(q);
        const size = q.pageSize ?? this.entity.pageSize;
        const page = q.page ?? 1;
        return this.select({
          fields: q.select as string[] | undefined,
          where: q.where,
          orderBy: q.orderBy,
          include: q.include,
          limit: size,
          offset: (page - 1) * size,
        }, ex);
      }
      case "postList":
        return this.inTransaction(ctx, async (tx) => {
          const prop = this.setPropagation();
          const out: P[] = [];
          for (const p of arg as P[]) out.push(await this.insertDeep(p, prop, tx, ctx));
          return out;
        });
      case "putList":
      case "deleteList":
        return this.inTransaction(ctx, async (tx) => {
          const prop = this.setPropagation();
          const out: P[] = [];
          const list = arg as P[];
          for (const [i, item] of list.entries()) {
            const r = action === "putList"
              ? await this.updateDeep(item, prop, tx, ctx)
              : await this.deleteDeep(item, prop, tx, ctx);
            if (!r) throw new NotFoundError(`[${i}] No encontrado: ${item.pkValues().join("/")}`);
            out.push(r);
          }
          return out;
        });
    }
  }

  protected executeEndpoint(name: string, _ep: EndpointDef<P>, arg: unknown, ctx: ServerCtx): Promise<unknown> {
    const impl = this.config.endpoints?.[name]?.handler;
    if (!impl) throw new HttpError(501, `El endpoint "${name}" no tiene implementación en el servidor`);
    return Promise.resolve(impl.call(this, arg, ctx));
  }

  // ================================================================ /doc

  /** Fuentes `.md` del controller (config `doc`, o `entity.def.doc`); siempre un arreglo. */
  async docSources(): Promise<string[]> {
    const d = this.config.doc ?? this.entity.def.doc ?? [];
    return typeof d === "function" ? await d.call(this) : d;
  }

  /** Contrato generado de la entidad (rutas, columnas, relaciones, endpoints, cfg). */
  contractMd(basePath = ""): string {
    return entityContractMd(this.entity, { table: this.table, basePath });
  }

  /** Doc expuesta: el contrato autogenerado + las fuentes `doc` concatenadas como secciones. */
  async composedDoc(basePath = ""): Promise<string> {
    return composeFromSources(this.contractMd(basePath), await this.docSources(), this.config.docBase);
  }

  /** La doc compuesta como hoja del libro (`productos.md`). */
  async docSheet(basePath = ""): Promise<DocSheet> {
    return { path: entitySheetPath(this.entity), content: await this.composedDoc(basePath) };
  }

  /** `plural/doc?v=1`: la doc compuesta en `iswc-md-docs-vault`. */
  async docView(basePath = "", view?: DocViewOptions): Promise<string> {
    return vaultHtml([await this.docSheet(basePath)], `${this.entity.plural} · Documentación`, view);
  }

  protected executeDoc(ctx: ServerCtx): Promise<string> {
    return this.composedDoc(typeof ctx.state["basePath"] === "string" ? ctx.state["basePath"] : "");
  }

  // ================================================================ /cfg

  protected async executeCfg(
    action: CfgAction,
    pojo: P,
    cambios: Record<string, unknown> | undefined,
    ctx: ServerCtx,
  ): Promise<unknown> {
    if (action === "getCfg") {
      const v = await this.loadCfg(pojo, ctx);
      return v === undefined ? null : v ?? {};
    }
    return this.inTransaction(ctx, async (exec) => {
      const tx = { ...ctx, exec, inTransaction: true };
      const actual = await this.loadCfg(pojo, tx);
      if (actual === undefined) return null;
      const molde = this.entity.cfgZod;
      let merged = Obj.push(Obj.esPlano(actual) ? actual : {}, cambios, molde);
      if (molde) {
        const r = molde.safeParse(merged);
        if (!r.success) throw new ValidationError(zodMessage(r.error));
        merged = r.data as Record<string, unknown>;
      }
      await this.saveCfg(pojo, merged, tx);
      return merged;
    });
  }

  private cfgColumn(): string {
    const col = this.config.cfg?.column ?? this.entity.def.cfg?.column;
    if (!col) throw new HttpError(501, `"${this.entity.singular}": cfg sin columna ni load/save en el servidor`);
    return col;
  }

  /** Condición sobre la tabla externa de cfg: columnas `keys` = pks del pojo. */
  private cfgKeysWhere(pojo: P): Raw {
    const keys = this.config.cfg?.keys ?? {};
    const self = pojo as unknown as Record<string, unknown>;
    return sql.join(
      this.entity.meta.pks.map((k) =>
        sql`${sql.id(applyCase(keys[k] ?? this.config.columnNames?.[k] ?? k, this.identifierCase))} = ${
          this.toDb(k, self[k])
        }`
      ),
      sql` and `,
    );
  }

  /** JSON actual de la config; `undefined` = la entidad no existe. */
  async loadCfg(pojo: P, ctx: ServerCtx): Promise<unknown> {
    const def = this.config.cfg;
    if (def?.load) return await def.load.call(this, pojo, ctx);
    if (def?.table) {
      const col = sql.id(applyCase(this.cfgColumn(), this.identifierCase));
      const tbl = sql.table(applyCase(def.table, this.identifierCase));
      const { rows } = await sql<Record<string, unknown>>`select ${col} as ${sql.id("cfg")} from ${tbl} where ${
        this.cfgKeysWhere(pojo)
      }`.execute(ctx.exec);
      const [row] = rows;
      return row ? this.engine.readJson(row["cfg"]) ?? {} : {};
    }
    const col = this.cfgColumn();
    const { rows } = await sql<Record<string, unknown>>`select ${this.col(null, col)} as ${sql.id("cfg")} from ${
      sql.table(this.table)
    } where ${this.pkWhere(null, pojo)}`.execute(ctx.exec);
    const [row] = rows;
    if (!row) return undefined;
    return this.engine.readJson(row["cfg"]) ?? {};
  }

  async saveCfg(pojo: P, value: unknown, ctx: ServerCtx): Promise<void> {
    const def = this.config.cfg;
    if (def?.save) {
      await def.save.call(this, pojo, value, ctx);
      return;
    }
    const json = this.engine.toDb({ type: "json" }, value);
    if (def?.table) {
      const colName = applyCase(this.cfgColumn(), this.identifierCase);
      const tbl = sql.table(applyCase(def.table, this.identifierCase));
      const { rows } = await sql`update ${tbl} set ${sql.id(colName)} = ${json} where ${
        this.cfgKeysWhere(pojo)
      } returning 1 as ${sql.id("ok")}`.execute(ctx.exec);
      if (rows.length) return;
      const keys = def.keys ?? {};
      const self = pojo as unknown as Record<string, unknown>;
      const pks = this.entity.meta.pks;
      const cols = [
        ...pks.map((k) => sql.id(applyCase(keys[k] ?? this.config.columnNames?.[k] ?? k, this.identifierCase))),
        sql.id(colName),
      ];
      const vals = [...pks.map((k) => this.toDb(k, self[k])), json];
      await sql`insert into ${tbl} (${sql.join(cols)}) values (${sql.join(vals)})`.execute(ctx.exec);
      return;
    }
    await sql`update ${sql.table(this.table)} set ${this.col(null, this.cfgColumn())} = ${json} where ${
      this.pkWhere(null, pojo)
    }`.execute(ctx.exec);
  }

  /** ¿Existe handler SSE para la acción/endpoint? */
  hasStream(name: string): boolean {
    return !!(this.config.sse?.[name as Action] ?? this.config.endpoints?.[name]?.sse);
  }

  protected executeStream(name: string, arg: unknown, ctx: ServerCtx): AsyncIterable<string> {
    const handler = this.config.sse?.[name as Action] ?? this.config.endpoints?.[name]?.sse;
    if (!handler) throw new HttpError(404, `"${name}" no tiene variante SSE`);
    const ch = new TextChannel();
    queueMicrotask(async () => {
      try {
        await handler.call(this, arg, (t) => ch.push(t), ctx);
        ch.close();
      } catch (e) {
        ch.close(e);
      }
    });
    return ch;
  }

  // ================================================================ seed

  /**
   * Seed del controller: su tabla y, en cascada, las de los detalles que propaga (`getPropagation` ∪
   * `setPropagation`), sin repetir ni entrar en ciclos. `propagate: false` = sólo la propia.
   */
  async seed(
    opts: { exec?: Kysely<any>; propagate?: boolean } = {},
    visited: Set<ServerController<any>> = new Set(),
  ): Promise<void> {
    if (visited.has(this)) return;
    visited.add(this);
    await this.seedTable(opts.exec ?? this.db.kysely);
    if (opts.propagate === false) return;
    for (const child of this.propagationControllers()) {
      // cada controller crea su tabla en SU base: el ejecutor sólo se comparte dentro de la misma base
      await child.seed(child.db === this.db && opts.exec ? { exec: opts.exec } : {}, visited);
    }
  }

  /**
   * Set de los controllers alcanzables por `getPropagation` (anidado, `"*"` expandido) ∪ `setPropagation`
   * (anidado), de cualquier base. Es lo que `seed()` propaga.
   */
  propagationControllers(): ServerController<any>[] {
    const out = new Set<ServerController<any>>();
    const walkRead = (ctrl: ServerController<any>, inc: Include | undefined): void => {
      for (const [rel, sub] of expandInclude(ctrl.entity.meta, inc)) {
        const child = ctrl.relationController(rel);
        if (out.has(child)) continue;
        out.add(child);
        walkRead(child, sub);
      }
    };
    const walkWrite = (ctrl: ServerController<any>, prop: WritePropagation): void => {
      for (const [rel, nested] of Object.entries(prop)) {
        const child = ctrl.relationController(rel);
        out.add(child);
        if (nested !== true) walkWrite(child, nested);
      }
    };
    walkRead(this, this.getPropagation());
    walkWrite(this, this.setPropagation());
    out.delete(this);
    return [...out];
  }

  /** Relaciones de detalle (lectura ∪ escritura), con `"*"` expandido. */
  detailRelations(): string[] {
    const meta = this.entity.meta;
    const read = expandInclude(meta, this.getPropagation()).map(([rel]) => rel);
    return [...new Set([...read, ...Object.keys(this.setPropagation())])];
  }

  // ================================================================ secuencias

  /** Definición de secuencia de una columna (o `null`). */
  sequenceDef(field: string): SequenceDef | null {
    const s = this.entity.meta.column(field).sequence;
    return s === undefined ? null : s === true ? {} : s;
  }

  /** Nombre de la secuencia global de una columna (`<tabla>_<campo>_seq` si no se nombra). */
  sequenceName(field: string): string {
    return applyCase(this.sequenceDef(field)?.name ?? `${this.config.table}_${field}_seq`, this.identifierCase);
  }

  /** Crea (si no existen) las secuencias globales de la tabla. */
  async ensureSequences(exec: Kysely<any> = this.db.kysely): Promise<void> {
    for (const f of this.entity.meta.persisted) {
      const def = this.sequenceDef(f);
      if (!def || def.scope?.length) continue;
      await this.engine.createSequence(exec, this.sequenceName(f), def.start ?? 1, def.increment ?? 1);
    }
  }

  /**
   * Siguiente valor de la secuencia de `field` para `pojo`: global (secuencia del motor) o por ámbito
   * (máximo del grupo + incremento, dentro de la transacción del insert); con `pattern`, formateado.
   */
  async nextSequence(field: string, pojo: P, exec: Kysely<any> = this.db.kysely): Promise<number | string> {
    const def = this.sequenceDef(field);
    if (!def) throw new Error(`"${field}" no tiene secuencia`);
    const start = def.start ?? 1;
    const increment = def.increment ?? 1;
    let n: number;
    if (def.scope?.length) {
      const self = pojo as unknown as Record<string, unknown>;
      const missing = def.scope.filter((k) => self[k] == null);
      if (missing.length) throw new ValidationError(`La secuencia de "${field}" requiere: ${missing.join(", ")}`);
      const where = sql.join(def.scope.map((k) => sql`${this.col(null, k)} = ${this.toDb(k, self[k])}`), sql` and `);
      const { rows } = await sql<{ v: unknown }>`select max(${this.col(null, field)}) as ${sql.id("v")} from ${
        sql.table(this.table)
      } where ${where}`.execute(exec);
      const max = rows[0]?.v;
      const last = typeof max === "string" ? Number(/(\d+)(?!.*\d)/.exec(max)?.[1] ?? Number.NaN) : Number(max);
      n = max == null || Number.isNaN(last) ? start : last + increment;
    } else {
      n = await this.engine.nextValue(exec, this.sequenceName(field));
    }
    return def.pattern ? formatSequence(def.pattern, n) : n;
  }

  /** Completa las columnas con secuencia que no vienen en el pojo (antes del INSERT). */
  private async fillSequences(pojo: P, exec: Kysely<any>): Promise<void> {
    const self = pojo as unknown as Record<string, unknown>;
    for (const f of this.entity.meta.persisted) {
      if (this.sequenceDef(f) && self[f] == null) self[f] = await this.nextSequence(f, pojo, exec);
    }
  }

  // ================================================================ índices

  /** ¿Las columnas son un prefijo de la pk? (ya están indexadas por la pk). */
  isPkPrefix(fields: string[]): boolean {
    const pks = this.entity.meta.pks;
    return fields.length <= pks.length && fields.every((f, i) => pks[i] === f);
  }

  private indexOf(table: string, columns: string[], unique: boolean, name?: string): ResolvedIndex {
    const base = `${unique ? "ux" : "ix"}_${table}_${columns.join("_")}`.replace(/[^A-Za-z0-9_]+/g, "_").slice(0, 60);
    return { name: name ?? base, table, columns, unique };
  }

  /** Índices de la tabla propia: explícitos + automáticos (FK de relaciones 1:1). */
  resolvedIndexes(): ResolvedIndex[] {
    const meta = this.entity.meta;
    const out = new Map<string, ResolvedIndex>();
    const add = (i: ResolvedIndex) => out.set(`${i.table}:${i.columns.join(",")}`, i);
    if (this.config.autoIndexes !== false) {
      for (const def of Object.values(meta.relations)) {
        const locals = Object.keys(def.on);
        if (def.kind !== "one" || this.isPkPrefix(locals)) continue;
        if (locals.length === 1 && locals[0] && meta.column(locals[0]).unique) continue;
        add(this.indexOf(this.table, locals.map((f) => this.dbCol(f)), false));
      }
    }
    for (const ix of this.config.indexes ?? []) {
      for (const f of ix.columns) meta.column(f);
      add(this.indexOf(this.table, ix.columns.map((f) => this.dbCol(f)), !!ix.unique, ix.name));
    }
    return [...out.values()];
  }

  /** Índices automáticos en las tablas de los detalles 1:N de la misma base (sus llaves remotas). */
  detailIndexes(): ResolvedIndex[] {
    if (this.config.autoIndexes === false) return [];
    const out: ResolvedIndex[] = [];
    for (const [rel, def] of Object.entries(this.entity.meta.relations)) {
      if (def.kind !== "many") continue;
      const child = this.relationController(rel);
      const remotes = Object.values(def.on);
      if (!this.isSameDb(child) || child.isPkPrefix(remotes)) continue;
      out.push(this.indexOf(child.table, remotes.map((f) => child.dbCol(f)), false));
    }
    return out;
  }

  /**
   * Índices que piden sobre ESTA tabla las relaciones 1:N de otros controllers de la misma base (los crea la
   * tabla del detalle al sembrarse, así no importa el orden del seed).
   */
  requestedIndexes(): ResolvedIndex[] {
    return registeredControllers()
      .filter((c) => c !== this && c.db === this.db)
      .flatMap((c) => {
        try {
          return c.detailIndexes();
        } catch {
          return [];
        }
      })
      .filter((ix) => ix.table === this.table);
  }

  /** `CREATE [UNIQUE] INDEX IF NOT EXISTS` de cada índice. */
  async ensureIndexes(indexes: ResolvedIndex[], exec: Kysely<any> = this.db.kysely): Promise<void> {
    for (const ix of indexes) {
      let b = exec.schema.createIndex(ix.name).ifNotExists().on(ix.table).columns(ix.columns);
      if (ix.unique) b = b.unique();
      await b.execute();
    }
  }

  // ================================================================ sync POJO ↔ tabla (migraciones)

  /** Inventario de los accessors (getter + setter) del POJO, en toda su cadena de prototipos. */
  pojoAccessors(): Set<string> {
    const names = new Set<string>();
    for (let proto: object | null = this.entity.pojo.prototype; proto && proto !== Object.prototype;) {
      for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
        if (d.get && d.set) names.add(name);
      }
      proto = Object.getPrototypeOf(proto) as object | null;
    }
    return names;
  }

  /**
   * Sincroniza la tabla con el POJO (opcional, para migraciones): inventario de getters/setters → columnas;
   * agrega las que faltan (conservando los valores de las existentes), pasa cada fila por `migrate` (con las
   * columnas viejas aún presentes) y elimina las que el POJO ya no tiene. Todo en una transacción.
   */
  async syncSchema(opts: SyncSchemaOptions = {}): Promise<SyncSchemaResult> {
    const meta = this.entity.meta;
    const accessors = this.pojoAccessors();
    const sinAccessor = meta.persisted.filter((f) => !accessors.has(f));
    if (sinAccessor.length) throw new Error(`syncSchema: el POJO no tiene getter/setter para: ${sinAccessor.join(", ")}`);
    const expected = new Map(meta.persisted.map((f) => [this.dbCol(f), f] as const));
    const result: SyncSchemaResult = { table: this.table, created: false, added: [], dropped: [], migrated: 0, dryRun: !!opts.dryRun };

    const tables = await this.db.kysely.introspection.getTables();
    const current = tables.find((t) => t.name === this.table);
    if (!current) {
      result.created = true;
      result.added = [...expected.keys()];
      if (!opts.dryRun) await this.seedTable();
      return result;
    }
    const existing = new Set(current.columns.map((c) => c.name));
    result.added = [...expected.keys()].filter((c) => !existing.has(c));
    result.dropped = opts.keepExtra ? [] : [...existing].filter((c) => !expected.has(c));
    const pkFaltante = meta.pks.map((k) => this.dbCol(k)).find((c) => result.added.includes(c));
    if (pkFaltante) throw new Error(`syncSchema: la pk "${pkFaltante}" no existe en la tabla; recréela (no se migra la pk)`);
    if (opts.dryRun) return result;

    await this.db.kysely.transaction().execute(async (tx) => {
      for (const col of result.added) {
        const field = expected.get(col) ?? col;
        const c = meta.column(field);
        await tx.schema.alterTable(this.table).addColumn(col, sql.raw(this.engine.columnType(c)), (cb) => {
          if (c.default === undefined) return cb;
          return cb.defaultTo(
            c.default !== null && typeof c.default === "object" ? sql.raw(c.default.sql) : this.engine.toDb(c, c.default) as never,
          );
        }).execute();
      }
      if (opts.migrate) {
        const { rows } = await sql<Record<string, unknown>>`select * from ${sql.table(this.table)}`.execute(tx);
        for (const raw of rows) {
          const previous = Object.fromEntries(Object.entries(raw).map(([k, v]) => [expected.get(k) ?? k, v]));
          const values = await opts.migrate(previous);
          if (!values) continue;
          const pojo = this.entity.toPojo({ ...Object.fromEntries(meta.pks.map((k) => [k, previous[k]])), ...values });
          await this.updateOne(pojo, tx);
          result.migrated++;
        }
      }
      for (const col of result.dropped) await tx.schema.alterTable(this.table).dropColumn(col).execute();
    });
    await this.ensureSequences();
    await this.ensureIndexes(this.resolvedIndexes());
    return result;
  }

  /** `CREATE TABLE IF NOT EXISTS` a partir de las columnas persistidas del POJO (sólo esta tabla). */
  async seedTable(exec: Kysely<any> = this.db.kysely): Promise<void> {
    const meta = this.entity.meta;
    const pks = meta.pks;
    const single = pks.length === 1;
    let b = exec.schema.createTable(this.table).ifNotExists();
    for (const f of meta.persisted) {
      const c = meta.column(f);
      const isPk = pks.includes(f);
      if (c.autoincrement && !(c.type === "int" || c.type === "bigint")) {
        throw new Error(`"${f}": autoincrement sólo aplica a int/bigint`);
      }
      if (c.autoincrement && this.engine.name === "sqlite" && !(single && isPk)) {
        throw new Error(`"${f}": en SQLite autoincrement requiere que sea la única pk`);
      }
      const type = this.engine.name === "sqlite" && c.autoincrement ? "integer" : this.engine.columnType(c);
      b = b.addColumn(this.dbCol(f), sql.raw(type), (cb) => {
        if (isPk && single) cb = cb.primaryKey();
        if (c.autoincrement) cb = this.engine.name === "pg" ? cb.generatedByDefaultAsIdentity() : cb.autoIncrement();
        if (isPk || c.nullable === false) cb = cb.notNull();
        if (c.unique) cb = cb.unique();
        if (c.default !== undefined) {
          cb = cb.defaultTo(
            c.default !== null && typeof c.default === "object"
              ? sql.raw(c.default.sql)
              : this.engine.toDb(c, c.default) as never,
          );
        }
        return cb;
      });
    }
    if (!single) b = b.addPrimaryKeyConstraint(`${this.table}_pk`, pks.map((k) => this.dbCol(k)) as never);
    await b.execute();
    await this.ensureSequences(exec);
    await this.ensureIndexes(this.resolvedIndexes(), exec);
    await this.ensureIndexes(this.requestedIndexes(), exec);
  }
}

/** `"FAC-{n:5}"` → `FAC-00042`; `"{n}"` → `42`. */
export function formatSequence(pattern: string, n: number): string {
  return pattern.replace(/\{n(?::(\d+))?\}/g, (_m, w: string | undefined) => (w ? String(n).padStart(Number(w), "0") : String(n)));
}
