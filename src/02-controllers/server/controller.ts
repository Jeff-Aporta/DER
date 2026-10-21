/**
 * ServerController: implementa las acciones contra SQL. El SQL lo arma el controller a partir del schema (columnas, pks,
 * relaciones) con las primitivas del motor (`Engine`); el usuario sólo aporta SQL quemado para columnas calculadas.
 *
 * ```ts
 * const productos = new ServerController(ProductoEntity, {
 *   db, identifierCase: "lower",                      // table: default el de la entidad (plural)
 *   computed: { total: "{precio} * {stock}" },          // {campo} → referencia correcta según motor/caso
 *   hooks: { prePost(p) { if (p.precio! < 0) return "precio negativo"; } },
 *   actions: { async delete(p, ctx, next) { ...; return next(p); } },
 *   sse: { post(p, send) { send("validando"); ... } },
 *   endpoints: { activar: { handler(p, ctx) { ... } } },
 * });
 * ```
 * Escrituras: `returning` (PG/SQLite), `output inserted/deleted` (MSSQL) o relectura por pk (MySQL), según el motor.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import { type Kysely, sql } from "kysely";
import { CASTS, HttpError, NotFoundError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { BaseController } from "@Jeff-Aporta/DER/src/02-controllers/controller.ts";
import type { Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import { sequenceOf } from "@Jeff-Aporta/DER/src/01-objects/meta.ts";
import { type Pojo, resolvePojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
import { expandInclude, isOpsObject, normalizeOrder } from "@Jeff-Aporta/DER/src/01-objects/query.ts";
import type { Action, CfgAction, ColumnDef, EndpointDef, FieldOps, Include, QuerySpec, Where } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { TextChannel } from "@Jeff-Aporta/DER/src/00-common/sse.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import { type Database, registeredControllers } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import { composeFromSources, entityContractMd, entitySheetPath, vaultHtml } from "@Jeff-Aporta/DER/src/02-controllers/server/doc.ts";
import { applyCase } from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";
import type { z } from "zod";
import type { BuiltSelect, CfgTableDef, ComputedSql, DeferredInclude, DocSheet, DocViewOptions, Engine, IdentifierCase, OutField, Raw, ResolvedIndex, SelectOptions, ServerControllerConfig, ServerCtx, SyncSchemaOptions, SyncSchemaResult, WritePropagation } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";

/** Generador de alias únicos por consulta. */
class Aliases {
  #n = 0;
  /** Siguiente alias (`t0`, `t1`…). */
  next(): string {
    return `t${this.#n++}`;
  }
}

const escapeLike = (s: string) => String(s).replace(/[\\%_]/g, (m) => "\\" + m);

/** `"FAC-{n:5}"` → `FAC-00042`; `"{n}"` → `42`. `n` ya viene quemado en la base de la secuencia. */
export function formatSequence(pattern: string, n: string): string {
  return pattern.replace(/\{n(?::(\d+))?\}/g, (_m, w: string | undefined) => (w ? n.padStart(Number(w), "0") : n));
}

/** Controller del lado servidor: arma el SQL con las primitivas del motor y lo ejecuta con Kysely. */
export class ServerController<P extends Pojo> extends BaseController<P, ServerCtx> {
  /** Base (conexión + motor) donde vive la tabla. */
  readonly db: Database;
  /** Nombre de la tabla ya con el caso aplicado (config o el de la entidad). */
  readonly table: string;
  /** Caso de tabla y columnas (config o el de la base). */
  readonly identifierCase: IdentifierCase;

  constructor(entity: Entity<P>, readonly config: ServerControllerConfig<P>) {
    super(entity, config);
    this.db = config.db;
    this.identifierCase = config.identifierCase ?? config.db.identifierCase;
    this.table = applyCase(config.table ?? entity.table, this.identifierCase);
    const meta = entity.meta;
    for (const k of Object.keys(config.computed ?? {})) if (!meta.columns[k]?.virtual) throw new Error(`computed: "${k}" debe ser una columna virtual del schema`);
    for (const k of Object.keys(config.columnNames ?? {})) if (!meta.isColumn(k)) throw new Error(`columnNames: "${k}" no es una columna`);
    if (config.register !== false) config.db.register(this);
  }

  /** Motor de la base. */
  get engine(): Engine {
    return this.db.engine;
  }

  // ================================================================ identificadores

  /** Columna oculta: nunca se devuelve (`config.hidden`). */
  isHidden(field: string): boolean {
    return this.config.hidden?.includes(field) ?? false;
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
    return def === undefined ? null : this.#compileComputed(alias, def);
  }

  #compileComputed(alias: string, def: ComputedSql): Raw {
    let src: Raw | string | undefined;
    if (typeof def === "function") src = def({ col: (f) => this.col(alias, f), alias, engine: this.engine });
    else if (typeof def === "object") src = (def as Record<string, string | undefined>)[this.engine.name];
    else src = def;
    if (src === undefined) throw new Error(`computed sin expresión para el motor ${this.engine.name}`);
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

  /** Castea con el tipo de la columna y convierte al formato del motor. */
  toDb(field: string, v: unknown): unknown {
    const c = this.entity.meta.column(field);
    return this.engine.toDb(c, v == null ? v : CASTS[c.type](v));
  }

  // ================================================================ SELECT

  /** Arma un SELECT completo con relaciones anidadas (JSON) y filtros. */
  buildSelect(opts: SelectOptions = {}, aliases = new Aliases()): BuiltSelect {
    const meta = this.entity.meta;
    const A = opts.alias ?? aliases.next();
    const explicit = !!opts.fields;
    const includes = expandInclude(meta, opts.include);
    const fields = [...(opts.fields ?? [...meta.persisted.filter((f) => !this.isHidden(f)), ...meta.virtual.filter((v) => this.config.computed?.[v] !== undefined)])];
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
      if (!expr && explicit) throw new ValidationError(`"${f}" no tiene expresión en el servidor`);
      if (!expr) continue;
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
      const r = this.#relationExpr(A, rel, sub, aliases);
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
    const orderSql = (order.length ? order : meta.pks.map((field) => ({ field, dir: "asc" as const }))).map((o) => {
      const e = this.fieldExpr(A, o.field);
      if (!e) throw new ValidationError(`"${o.field}" no tiene expresión en el servidor`);
      return sql`${e} ${sql.raw(o.dir)}`;
    });
    q = sql`${q} order by ${sql.join(orderSql)}`;
    const page = this.engine.page(opts.limit, opts.offset);
    if (page) q = sql`${q} ${page}`;
    return { query: q, fields: out, deferred };
  }

  /** ¿El otro controller vive en la misma base (mismo SQL posible)? */
  isSameDb(other: ServerController<any>): boolean {
    return other.db === this.db;
  }

  /** Controller que maneja el detalle de una relación. */
  relationController(rel: string): ServerController<any> {
    const def = this.entity.meta.relation(rel);
    const override = this.config.relations?.[rel]?.controller?.();
    if (override) return override;
    try {
      return this.db.controllerFor(resolvePojo(def.target));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`"${this.entity.name}" usa la relación "${rel}": ${msg}`);
    }
  }

  #correlation(A: string, rel: string, child: ServerController<any>, Z: string): Raw[] {
    const def = this.entity.meta.relation(rel);
    return Object.entries(def.on).map(([local, remote]) => sql`${child.col(Z, remote)} = ${this.col(A, local)}`);
  }

  /** Subconsulta correlacionada que devuelve el detalle como objeto (one) o arreglo (many) JSON. */
  #relationExpr(A: string, rel: string, include: Include | undefined, aliases: Aliases): { expr: Raw; deferred: DeferredInclude[] } {
    const def = this.entity.meta.relation(rel);
    const child = this.relationController(rel);
    const Z = aliases.next();
    const { query, fields, deferred } = child.buildSelect({ alias: Z, include, extra: this.#correlation(A, rel, child, Z), limit: def.kind === "one" ? 1 : undefined }, aliases);
    const W = aliases.next();
    const expr = def.kind === "one" ? this.engine.jsonOne(query, W, fields) : this.engine.jsonMany(query, W, fields);
    return { expr, deferred };
  }

  // ================================================================ WHERE

  /** `WHERE` de un `Where` para el alias `A` (relaciones como `EXISTS`); `null` si no hay condiciones. */
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
        continue;
      }
      if (k === "$not") {
        const s = this.buildWhere(A, v as Where, aliases);
        if (s) parts.push(sql`not (${s})`);
        continue;
      }
      if (meta.isRelation(k)) {
        const child = this.relationController(k);
        const Z = aliases.next();
        const conds = [...this.#correlation(A, k, child, Z)];
        const cw = child.buildWhere(Z, v as Where, aliases);
        if (cw) conds.push(cw);
        parts.push(sql`exists (select 1 from ${sql.table(child.table)} as ${sql.id(Z)} where ${sql.join(conds, sql` and `)})`);
        continue;
      }
      // una columna oculta nunca se filtra (tampoco vía relaciones o lógicos): no puede servir de oráculo
      if (this.isHidden(k)) throw new ValidationError(`"${k}" no es consultable`);
      const e = this.fieldExpr(A, k);
      if (!e) throw new ValidationError(`"${k}" no tiene expresión en el servidor`);
      parts.push(...this.#fieldConditions(k, e, v));
    }
    return parts.length ? sql.join(parts, sql` and `) : null;
  }

  #fieldConditions(field: string, e: Raw, v: unknown): Raw[] {
    const p = (x: unknown) => this.toDb(field, x);
    if (v === null) return [sql`${e} is null`];
    if (Array.isArray(v)) return [v.length ? sql`${e} in (${sql.join(v.map(p))})` : sql`1 = 0`];
    if (!isOpsObject(v)) return [sql`${e} = ${p(v)}`];
    const like = (pattern: string) => (this.engine.escape ? sql`${this.engine.ilike(e, pattern)} ${this.engine.escape}` : this.engine.ilike(e, pattern));
    const out: Raw[] = [];
    for (const [op, x] of Object.entries(v as FieldOps)) {
      if (x === undefined) continue;
      if (op === "eq") out.push(x === null ? sql`${e} is null` : sql`${e} = ${p(x)}`);
      else if (op === "ne") out.push(x === null ? sql`${e} is not null` : sql`${e} <> ${p(x)}`);
      else if (op === "gt") out.push(sql`${e} > ${p(x)}`);
      else if (op === "gte") out.push(sql`${e} >= ${p(x)}`);
      else if (op === "lt") out.push(sql`${e} < ${p(x)}`);
      else if (op === "lte") out.push(sql`${e} <= ${p(x)}`);
      else if (op === "in") out.push((x as unknown[]).length ? sql`${e} in (${sql.join((x as unknown[]).map(p))})` : sql`1 = 0`);
      else if (op === "nin" && (x as unknown[]).length) out.push(sql`${e} not in (${sql.join((x as unknown[]).map(p))})`);
      else if (op === "nin") continue;
      else if (op === "between") out.push(sql`${e} between ${p((x as [unknown, unknown])[0])} and ${p((x as [unknown, unknown])[1])}`);
      else if (op === "like") out.push(sql`${e} like ${String(x)}`);
      else if (op === "ilike") out.push(this.engine.ilike(e, String(x)));
      else if (op === "contains") out.push(like(`%${escapeLike(x as string)}%`));
      else if (op === "startsWith") out.push(like(`${escapeLike(x as string)}%`));
      else if (op === "endsWith") out.push(like(`%${escapeLike(x as string)}`));
      else if (op === "isNull") out.push(x ? sql`${e} is null` : sql`${e} is not null`);
      else throw new ValidationError(`Operador desconocido "${op}"`);
    }
    return out;
  }

  /** `pk1 = ? and pk2 = ?` (alias null → sin calificar, para UPDATE/DELETE). */
  pkWhere(alias: string | null, pojo: P): Raw {
    const self = pojo as unknown as Record<string, unknown>;
    return sql.join(this.entity.meta.pks.map((k) => sql`${this.col(alias, k)} = ${this.toDb(k, self[k])}`), sql` and `);
  }

  /** Columnas devueltas por una escritura (`returning` o `output <prefix>.col`). */
  #returning(prefix: string | null = null): Raw {
    const meta = this.entity.meta;
    const ref = (f: string) => (prefix ? sql.ref(`${prefix}.${this.dbCol(f)}`) : this.col(null, f));
    return sql.join(meta.persisted.filter((f) => !this.isHidden(f)).map((f) => sql`${this.engine.selectExpr(ref(f), meta.column(f))} as ${sql.id(f)}`));
  }

  // ================================================================ ejecución

  /** Ejecuta SQL y castea las filas al POJO. */
  async rows(q: Raw, exec: Kysely<any> = this.db.kysely): Promise<P[]> {
    const { rows } = await q.execute(exec);
    return this.toPojos(rows as Record<string, unknown>[]);
  }

  /** Filas crudas → POJOs (parsea json y relaciones según el motor). */
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

  /** Un registro por pks con el `include` dado (relaciones cross-db resueltas). */
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
  #holdersAt(roots: Pojo[], path: string[]): Pojo[] {
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
      const holders = this.#holdersAt(roots, d.path);
      if (holders.length) await d.owner.attachRelation(holders, d.rel, d.include);
    }
  }

  /** Anexa a `holders` la relación `rel`, consultando en lote al controller del detalle con SU base y SU motor (`IN` sobre las llaves de `on`). */
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
    const found = tuples.size ? await child.select({ where: this.#tuplesWhere(remotes, [...tuples.values()]), include }) : [];
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
  #tuplesWhere(cols: string[], tuples: Record<string, unknown>[]): Where {
    const [only] = cols;
    if (cols.length === 1 && only) return { [only]: { in: tuples.map((t) => t[only]) } };
    return { $or: tuples };
  }

  /** Traduce los filtros por relación cuyo detalle vive en otra base a un filtro local sobre las columnas de `on`. Los de la misma base quedan en SQL (EXISTS). */
  async resolveWhere(where: Where | undefined): Promise<Where | undefined> {
    if (!where) return where;
    const meta = this.entity.meta;
    const out: Record<string, unknown> = {};
    const extra: Where[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (k === "$and" || k === "$or") {
        out[k] = await Promise.all((v as Where[]).map((w) => this.resolveWhere(w)));
        continue;
      }
      if (k === "$not") {
        out[k] = await this.resolveWhere(v as Where);
        continue;
      }
      if (!meta.isRelation(k)) {
        out[k] = v;
        continue;
      }
      const child = this.relationController(k);
      if (this.isSameDb(child)) {
        out[k] = await child.resolveWhere(v as Where);
        continue;
      }
      const pairs = Object.entries(meta.relation(k).on);
      const found = await child.select({ fields: pairs.map(([, r]) => r), where: v as Where });
      const tuples = found.map((c) => Object.fromEntries(pairs.map(([l, r]) => [l, (c as unknown as Record<string, unknown>)[r]])));
      const [firstLocal] = pairs.map(([l]) => l);
      extra.push(tuples.length || !firstLocal ? this.#tuplesWhere(pairs.map(([l]) => l), tuples) : { [firstLocal]: { in: [] } });
    }
    if (extra.length) out["$and"] = [...((out["$and"] as Where[] | undefined) ?? []), ...extra];
    return out as Where;
  }

  // ================================================================ escrituras

  /** INSERT de un pojo (completa secuencias) y devuelve la fila guardada según el modo del motor. */
  async insertOne(pojo: P, exec: Kysely<any> = this.db.kysely): Promise<P> {
    const meta = this.entity.meta;
    const self = pojo as unknown as Record<string, unknown>;
    await this.#fillSequences(pojo, exec);
    const fields = meta.persisted.filter((k) => self[k] !== undefined && !(meta.column(k).autoincrement && self[k] == null));
    const tbl = sql.table(this.table);
    const cols = sql.join(fields.map((f) => sql.id(this.dbCol(f))));
    const vals = sql.join(fields.map((f) => this.toDb(f, self[f])));
    const mode = this.engine.returning;
    if (mode === "returning") {
      const q = fields.length ? sql`insert into ${tbl} (${cols}) values (${vals}) returning ${this.#returning()}` : sql`insert into ${tbl} ${this.engine.defaultValues} returning ${this.#returning()}`;
      return this.#firstRow(await this.rows(q, exec));
    }
    if (mode === "output") {
      const q = fields.length ? sql`insert into ${tbl} (${cols}) output ${this.#returning("inserted")} values (${vals})` : sql`insert into ${tbl} output ${this.#returning("inserted")} ${this.engine.defaultValues}`;
      return this.#firstRow(await this.rows(q, exec));
    }
    // sin RETURNING (MySQL): insertar y releer por pk; la pk autoincrement sale de insertId
    const q = fields.length ? sql`insert into ${tbl} (${cols}) values (${vals})` : sql`insert into ${tbl} ${this.engine.defaultValues}`;
    const r = await q.execute(exec);
    const key = pojo.pkOnly() as unknown as Record<string, unknown>;
    for (const k of meta.pks) if (key[k] == null && meta.column(k).autoincrement && r.insertId !== undefined) key[k] = Number(r.insertId);
    return this.#firstRow(await this.selectOne(key as unknown as P, {}, exec));
  }

  #firstRow(rows: P[] | P | null): P {
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error(`INSERT en "${this.table}" no retornó la fila`);
    return row;
  }

  /** PUT singular: el cuerpo se aplica sobre el registro actual según `schema.put` (`insert` parcial por defecto, `insertIgnore`, `update` o `replace`). */
  async updateOne(pojo: P, exec: Kysely<any> = this.db.kysely): Promise<P | null> {
    const meta = this.entity.meta;
    const modo = this.entity.pojo.schema.put ?? "insert";
    const editables = meta.persisted.filter((k) => !meta.pks.includes(k));
    const sent = pojo as unknown as Record<string, unknown>;
    let self = sent;
    let fields = editables.filter((k) => sent[k] !== undefined);
    if (modo === "replace") fields = editables;
    else if (fields.length) {
      const actual = await this.selectOne(pojo, {}, exec);
      if (!actual) return null;
      const cambios = Object.fromEntries(fields.map((k) => [k, (pojo.toJSON() as Record<string, unknown>)[k]]));
      let next: P;
      if (modo === "update") next = actual.update(cambios as never);
      else if (modo === "insertIgnore") next = actual.insertIgnore(cambios as never);
      else next = actual.insert(cambios as never);
      self = next as unknown as Record<string, unknown>;
      fields = editables.filter((k) => self[k] !== undefined);
    }
    if (!fields.length) return this.selectOne(pojo, undefined, exec);
    const sets = sql.join(fields.map((f) => sql`${sql.id(this.dbCol(f))} = ${this.toDb(f, self[f] ?? null)}`));
    const tbl = sql.table(this.table);
    const mode = this.engine.returning;
    if (mode === "returning") return (await this.rows(sql`update ${tbl} set ${sets} where ${this.pkWhere(null, pojo)} returning ${this.#returning()}`, exec))[0] ?? null;
    if (mode === "output") return (await this.rows(sql`update ${tbl} set ${sets} output ${this.#returning("inserted")} where ${this.pkWhere(null, pojo)}`, exec))[0] ?? null;
    await sql`update ${tbl} set ${sets} where ${this.pkWhere(null, pojo)}`.execute(exec);
    return this.selectOne(pojo, {}, exec);
  }

  /** DELETE por pks y devuelve la fila borrada (`null` si no existía). */
  async deleteOne(pojo: P, exec: Kysely<any> = this.db.kysely): Promise<P | null> {
    const tbl = sql.table(this.table);
    const mode = this.engine.returning;
    if (mode === "returning") return (await this.rows(sql`delete from ${tbl} where ${this.pkWhere(null, pojo)} returning ${this.#returning()}`, exec))[0] ?? null;
    if (mode === "output") return (await this.rows(sql`delete from ${tbl} output ${this.#returning("deleted")} where ${this.pkWhere(null, pojo)}`, exec))[0] ?? null;
    const before = await this.selectOne(pojo, {}, exec);
    if (!before) return null;
    await sql`delete from ${tbl} where ${this.pkWhere(null, pojo)}`.execute(exec);
    return before;
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
  #detailItems(rel: string, value: unknown): Pojo[] {
    const def = this.entity.meta.relation(rel);
    if (def.kind === "many") return Array.isArray(value) ? value as Pojo[] : [];
    return value instanceof Object ? [value as Pojo] : [];
  }

  /** Ejecutor para escribir en un detalle: la transacción en curso si vive en la misma base; si no, SU propia conexión (cross-db no es atómico entre bases). */
  #childExec(child: ServerController<any>, exec: Kysely<any>, ctx: ServerCtx): { exec: Kysely<any>; ctx: ServerCtx } {
    if (this.isSameDb(child)) return { exec, ctx: { ...ctx, exec, inTransaction: true } };
    const own = child.db.kysely;
    return { exec: own, ctx: { ...ctx, exec: own, inTransaction: false } };
  }

  /** Inserta los detalles de `rels` de `source` colgándolos de `parent` (FK según `on`), con sus pre*. */
  async #insertDetails(parent: P, source: P, prop: WritePropagation, exec: Kysely<any>, ctx: ServerCtx): Promise<void> {
    const self = parent as unknown as Record<string, unknown>;
    for (const [rel, nested] of Object.entries(prop)) {
      const value = (source as unknown as Record<string, unknown>)[rel];
      if (value === undefined) continue;
      const def = this.entity.meta.relation(rel);
      const child = this.relationController(rel);
      const saved: Pojo[] = [];
      for (const [i, raw] of this.#detailItems(rel, value).entries()) {
        const item = child.entity.toPojo(raw) as Pojo & Record<string, unknown>;
        for (const [local, remote] of Object.entries(def.on)) item[remote] = self[local];
        const x = this.#childExec(child, exec, ctx);
        const e = await child.verify("post", item, x.ctx);
        if (e) throw new ValidationError(`${rel}[${i}]: ${e}`);
        saved.push(await child.insertDeep(item, nested === true ? {} : nested, x.exec, x.ctx));
      }
      self[rel] = def.kind === "many" ? saved : saved[0] ?? null;
    }
  }

  /** Borra (en cascada según `prop`) los detalles actuales de `parent`. */
  async #deleteDetails(parent: P, prop: WritePropagation, exec: Kysely<any>, ctx: ServerCtx): Promise<void> {
    const self = parent as unknown as Record<string, unknown>;
    for (const [rel, nested] of Object.entries(prop)) {
      const def = this.entity.meta.relation(rel);
      const child = this.relationController(rel);
      const where = Object.fromEntries(Object.entries(def.on).map(([local, remote]) => [remote, self[local]]));
      const x = this.#childExec(child, exec, ctx);
      for (const item of await child.select({ where }, x.exec)) await child.deleteDeep(item, nested === true ? {} : nested, x.exec, x.ctx);
    }
  }

  /** `post` con propagación: el padre y luego sus detalles (recursivo). */
  async insertDeep(pojo: P, prop: WritePropagation, exec: Kysely<any>, ctx: ServerCtx): Promise<P> {
    const saved = await this.insertOne(pojo, exec);
    await this.#insertDetails(saved, pojo, prop, exec, ctx);
    return saved;
  }

  /** `put` con propagación: el padre y, por cada detalle enviado, borra los actuales e inserta los nuevos. */
  async updateDeep(pojo: P, prop: WritePropagation, exec: Kysely<any>, ctx: ServerCtx): Promise<P | null> {
    const updated = await this.updateOne(pojo, exec);
    if (!updated) return null;
    const sent = pojo as unknown as Record<string, unknown>;
    const touched = Object.fromEntries(Object.entries(prop).filter(([rel]) => sent[rel] !== undefined));
    await this.#deleteDetails(updated, touched, exec, ctx);
    await this.#insertDetails(updated, pojo, touched, exec, ctx);
    return updated;
  }

  /** `delete` con propagación: los detalles (en cascada) y luego el padre. */
  async deleteDeep(pojo: P, prop: WritePropagation, exec: Kysely<any>, ctx: ServerCtx): Promise<P | null> {
    if (!Object.keys(prop).length) return this.deleteOne(pojo, exec);
    const current = await this.selectOne(pojo, {}, exec);
    if (!current) return null;
    await this.#deleteDetails(current, prop, exec, ctx);
    return this.deleteOne(pojo, exec);
  }

  /** Ejecuta una escritura: directa si no hay propagación, o en transacción si la hay. */
  #write<T>(ctx: ServerCtx, direct: () => Promise<T>, deep: (prop: WritePropagation, tx: Kysely<any>) => Promise<T>): Promise<T> {
    const prop = this.setPropagation();
    if (!Object.keys(prop).length) return direct();
    return this.inTransaction(ctx, (tx) => deep(prop, tx));
  }

  protected execute(action: Action, arg: unknown, ctx: ServerCtx): Promise<unknown> {
    const ex = ctx.exec;
    if (action === "get") return this.selectOne(arg as P, ctx.include ?? this.getPropagation(), ex);
    if (action === "post") return this.#write(ctx, () => this.insertOne(arg as P, ex), (prop, tx) => this.insertDeep(arg as P, prop, tx, ctx));
    if (action === "put") return this.#write(ctx, () => this.updateOne(arg as P, ex), (prop, tx) => this.updateDeep(arg as P, prop, tx, ctx));
    if (action === "delete") return this.#write(ctx, () => this.deleteOne(arg as P, ex), (prop, tx) => this.deleteDeep(arg as P, prop, tx, ctx));
    if (action === "list") return this.select({ fields: this.entity.listColumns.filter((f) => !this.isHidden(f)) }, ex);
    if (action === "query") {
      const q = arg as QuerySpec<P>;
      const hidden = [...(q.select ?? [])].find((f) => this.isHidden(f));
      if (hidden) throw new ValidationError(`"${hidden}" no es consultable`);
      const size = q.pageSize ?? this.entity.pageSize;
      return this.select({ fields: q.select as string[] | undefined, where: q.where, orderBy: q.orderBy, include: q.include, limit: size, offset: ((q.page ?? 1) - 1) * size }, ex);
    }
    if (action === "postList") {
      return this.inTransaction(ctx, async (tx) => {
        const prop = this.setPropagation();
        const out: P[] = [];
        for (const p of arg as P[]) out.push(await this.insertDeep(p, prop, tx, ctx));
        return out;
      });
    }
    return this.inTransaction(ctx, async (tx) => {
      const prop = this.setPropagation();
      const out: P[] = [];
      for (const [i, item] of (arg as P[]).entries()) {
        const r = action === "putList" ? await this.updateDeep(item, prop, tx, ctx) : await this.deleteDeep(item, prop, tx, ctx);
        if (!r) throw new NotFoundError(`[${i}] No encontrado: ${item.pkValues().join("/")}`);
        out.push(r);
      }
      return out;
    });
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
    return entityContractMd(this.entity, { table: this.table, basePath, cfg: this.hasCfg() });
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

  // ================================================================ /cfg (configuración de la entidad)

  /** Tabla de configuración que aplica: la del controller o la de la base. `null` = `/cfg` no se expone. */
  cfgTable(): CfgTableDef | null {
    if (!this.entity.def.cfg || this.config.cfg === false) return null;
    return this.config.cfg ?? this.db.cfg ?? null;
  }

  /** ¿Se exponen `GET/PUT plural/cfg`? */
  hasCfg(): boolean {
    return this.cfgTable() !== null;
  }

  protected async executeCfg(action: CfgAction, cambios: Record<string, unknown> | undefined, ctx: ServerCtx): Promise<unknown> {
    const t = this.cfgTable();
    if (!t) throw new NotFoundError(`"${this.entity.plural}" no expone configuración (el servidor no define tabla de cfg)`);
    const molde = this.entity.cfgZod as z.ZodType;
    if (action === "getCfg") return this.#conDefaults(await this.loadCfg(t, ctx.exec), molde);
    return this.inTransaction(ctx, async (exec) => {
      // sólo update: cambia llaves que el molde ya define (con sus defaults); nunca crea otras
      const next = Obj.update(this.#conDefaults(await this.loadCfg(t, exec), molde), cambios ?? {});
      const r = molde.safeParse(next);
      if (!r.success) throw new ValidationError(zodMessage(r.error));
      await this.saveCfg(t, r.data, exec);
      return r.data;
    });
  }

  /** JSON guardado con los valores por defecto del molde aplicados (si lo guardado no cumple el molde, tal cual). */
  #conDefaults(v: unknown, molde: z.ZodType): Record<string, unknown> {
    const base = Obj.esPlano(v) ? v : {};
    const r = molde.safeParse(base);
    return (r.success ? r.data : base) as Record<string, unknown>;
  }

  /** Identificadores de la tabla de configuración, con el caso del controller. */
  #cfgIds(t: CfgTableDef) {
    const c = (n: string) => sql.id(applyCase(n, this.identifierCase));
    return { tabla: sql.table(applyCase(t.table, this.identifierCase)), pk: c(t.columns.pk), json: c(t.columns.json), fecha: c(t.columns.fecha) };
  }

  /** JSON guardado de la configuración de esta entidad (`undefined` si aún no tiene fila). */
  async loadCfg(t: CfgTableDef, exec: Kysely<any>): Promise<unknown> {
    const id = this.#cfgIds(t);
    const { rows } = await sql<Record<string, unknown>>`select ${id.json} as ${sql.id("cfg")} from ${id.tabla} where ${id.pk} = ${this.entity.plural}`.execute(exec);
    const [row] = rows;
    return row ? this.engine.readJson(row["cfg"]) ?? undefined : undefined;
  }

  /** Guarda el JSON completo (UPDATE o, si la entidad aún no tiene fila, INSERT) con la fecha de actualización. */
  async saveCfg(t: CfgTableDef, value: unknown, exec: Kysely<any>): Promise<void> {
    const id = this.#cfgIds(t);
    const json = this.engine.toDb({ type: "json" }, value);
    const fecha = this.engine.toDb({ type: "datetime" }, new Date());
    const r = await sql`update ${id.tabla} set ${id.json} = ${json}, ${id.fecha} = ${fecha} where ${id.pk} = ${this.entity.plural}`.execute(exec);
    if (r.numAffectedRows && r.numAffectedRows > 0n) return;
    await sql`insert into ${id.tabla} (${id.pk}, ${id.json}, ${id.fecha}) values (${this.entity.plural}, ${json}, ${fecha})`.execute(exec);
  }

  /** `CREATE TABLE IF NOT EXISTS` de la tabla de configuración (compartida por las entidades de la base). */
  async seedCfgTable(exec: Kysely<any> = this.db.kysely): Promise<void> {
    const t = this.cfgTable();
    if (!t) return;
    const n = (c: string) => applyCase(c, this.identifierCase);
    if (!this.engine.ifNotExists && await this.#tableExists(n(t.table), exec)) return;
    let b = exec.schema.createTable(n(t.table));
    if (this.engine.ifNotExists) b = b.ifNotExists();
    await b.addColumn(n(t.columns.pk), sql.raw(this.engine.columnType({ type: "string", length: 120 })), (cb) => cb.primaryKey().notNull())
      .addColumn(n(t.columns.json), sql.raw(this.engine.columnType({ type: "json" })))
      .addColumn(n(t.columns.fecha), sql.raw(this.engine.columnType({ type: "datetime" })))
      .execute();
  }

  /** ¿Existe handler SSE para la acción/endpoint? La variante `/sse` sólo se publica si devuelve `true`. */
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

  /** Seed del controller: su tabla y, en cascada, las de los detalles que propaga, sin repetir ni entrar en ciclos. `propagate: false` = sólo la propia. */
  async seed(opts: { exec?: Kysely<any>; propagate?: boolean } = {}, visited: Set<ServerController<any>> = new Set()): Promise<void> {
    if (visited.has(this)) return;
    visited.add(this);
    await this.seedTable(opts.exec ?? this.db.kysely);
    await this.seedCfgTable(opts.exec ?? this.db.kysely);
    if (opts.propagate === false) return;
    // cada controller crea su tabla en SU base: el ejecutor sólo se comparte dentro de la misma base
    for (const child of this.propagationControllers()) await child.seed(child.db === this.db && opts.exec ? { exec: opts.exec } : {}, visited);
  }

  /** Set de los controllers alcanzables por `getPropagation` (anidado, `"*"` expandido) ∪ `setPropagation` (anidado), de cualquier base. */
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
    const read = expandInclude(this.entity.meta, this.getPropagation()).map(([rel]) => rel);
    return [...new Set([...read, ...Object.keys(this.setPropagation())])];
  }

  // ================================================================ secuencias

  /** Nombre de la secuencia global de una columna (`<tabla>_<campo>_seq` si no se nombra). */
  sequenceName(field: string): string {
    const def = sequenceOf(field, this.entity.meta.column(field));
    return applyCase(def?.name ?? `${this.config.table ?? this.entity.table}_${field}_seq`, this.identifierCase);
  }

  /** Crea (si no existen) las secuencias globales de la tabla. */
  async ensureSequences(exec: Kysely<any> = this.db.kysely): Promise<void> {
    for (const f of this.entity.meta.persisted) {
      const def = sequenceOf(f, this.entity.meta.column(f));
      if (!def || def.scope?.length) continue;
      await this.engine.createSequence(exec, this.sequenceName(f), def.start ?? 1, def.increment ?? 1);
    }
  }

  /**
   * Siguiente valor de la secuencia de `field` para `pojo`: global (secuencia del motor) o por ámbito (máximo del grupo +
   * incremento, dentro de la transacción del insert). Se quema en `base` (default 10): numérico, o texto (con `pattern`).
   */
  async nextSequence(field: string, pojo: P, exec: Kysely<any> = this.db.kysely): Promise<number | string> {
    const def = sequenceOf(field, this.entity.meta.column(field));
    if (!def) throw new Error(`"${field}" no tiene secuencia`);
    const start = def.start ?? 1;
    const increment = def.increment ?? 1;
    let n: number;
    if (def.scope?.length) {
      const self = pojo as unknown as Record<string, unknown>;
      const missing = def.scope.filter((k) => self[k] == null);
      if (missing.length) throw new ValidationError(`La secuencia de "${field}" requiere: ${missing.join(", ")}`);
      const where = sql.join(def.scope.map((k) => sql`${this.col(null, k)} = ${this.toDb(k, self[k])}`), sql` and `);
      const { rows } = await sql<{ v: unknown }>`select max(${this.col(null, field)}) as ${sql.id("v")} from ${sql.table(this.table)} where ${where}`.execute(exec);
      const max = rows[0]?.v;
      // en texto, el número es el último tramo alfanumérico (el que deja el patrón al final)
      const last = typeof max === "string" ? parseInt(/([0-9a-z]+)$/i.exec(max)?.[1] ?? "", def.base) : Number(max);
      n = max == null || Number.isNaN(last) ? start : last + increment;
    } else n = await this.engine.nextValue(exec, this.sequenceName(field));
    if (def.as === "number") return n;
    const text = n.toString(def.base);
    return def.pattern ? formatSequence(def.pattern, text) : text;
  }

  /** Completa las columnas con secuencia que no vienen en el pojo (antes del INSERT). */
  async #fillSequences(pojo: P, exec: Kysely<any>): Promise<void> {
    const self = pojo as unknown as Record<string, unknown>;
    for (const f of this.entity.meta.persisted) {
      if (this.entity.meta.column(f).sequence !== undefined && self[f] == null) self[f] = await this.nextSequence(f, pojo, exec);
    }
  }

  // ================================================================ índices

  /** ¿Las columnas son un prefijo de la pk? (ya están indexadas por la pk). */
  isPkPrefix(fields: string[]): boolean {
    const pks = this.entity.meta.pks;
    return fields.length <= pks.length && fields.every((f, i) => pks[i] === f);
  }

  #indexOf(table: string, columns: string[], unique: boolean, name?: string): ResolvedIndex {
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
        add(this.#indexOf(this.table, locals.map((f) => this.dbCol(f)), false));
      }
    }
    for (const ix of this.config.indexes ?? []) {
      for (const f of ix.columns) meta.column(f);
      add(this.#indexOf(this.table, ix.columns.map((f) => this.dbCol(f)), !!ix.unique, ix.name));
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
      out.push(this.#indexOf(child.table, remotes.map((f) => child.dbCol(f)), false));
    }
    return out;
  }

  /** Índices que piden sobre ESTA tabla las relaciones 1:N de otros controllers de la misma base (así no importa el orden del seed). */
  requestedIndexes(): ResolvedIndex[] {
    const others = registeredControllers().filter((c) => c !== this && c.db === this.db);
    const all = others.flatMap((c) => {
      try {
        return c.detailIndexes();
      } catch {
        return [];
      }
    });
    return all.filter((ix) => ix.table === this.table);
  }

  /** `CREATE [UNIQUE] INDEX IF NOT EXISTS` de cada índice. */
  async ensureIndexes(indexes: ResolvedIndex[], exec: Kysely<any> = this.db.kysely): Promise<void> {
    for (const ix of indexes) await this.engine.createIndex(exec, ix);
  }

  // ================================================================ sync POJO ↔ tabla (migraciones)

  /** Inventario de los accessors (getter + setter) del POJO, en toda su cadena de prototipos. */
  pojoAccessors(): Set<string> {
    const names = new Set<string>();
    for (let proto: object | null = this.entity.pojo.prototype; proto && proto !== Object.prototype;) {
      for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(proto))) if (d.get && d.set) names.add(name);
      proto = Object.getPrototypeOf(proto) as object | null;
    }
    return names;
  }

  async #tableExists(table: string, exec: Kysely<any>): Promise<boolean> {
    const tables = await exec.introspection.getTables();
    return tables.some((t) => t.name === table);
  }

  /** Valor por defecto de una columna para el DDL. */
  #defaultTo(c: ColumnDef): unknown {
    return c.default !== null && typeof c.default === "object" ? sql.raw(c.default.sql) : this.engine.toDb(c, c.default);
  }

  /**
   * Sincroniza la tabla con el POJO (opcional, para migraciones): inventario de getters/setters → columnas; agrega las que
   * faltan, pasa cada fila por `migrate` (con las columnas viejas aún presentes) y elimina las que el POJO ya no tiene.
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
        const c = meta.column(expected.get(col) ?? col);
        await tx.schema.alterTable(this.table).addColumn(col, sql.raw(this.engine.columnType(c)), (cb) => (c.default === undefined ? cb : cb.defaultTo(this.#defaultTo(c) as never))).execute();
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
    const exists = !this.engine.ifNotExists && await this.#tableExists(this.table, exec);
    if (!exists) {
      let b = exec.schema.createTable(this.table);
      if (this.engine.ifNotExists) b = b.ifNotExists();
      for (const f of meta.persisted) {
        const c = meta.column(f);
        const isPk = pks.includes(f);
        if (c.autoincrement && !(c.type === "int" || c.type === "bigint")) throw new Error(`"${f}": autoincrement sólo aplica a int/bigint`);
        if (c.autoincrement && this.engine.name === "sqlite" && !(single && isPk)) throw new Error(`"${f}": en SQLite autoincrement requiere que sea la única pk`);
        b = b.addColumn(this.dbCol(f), sql.raw(this.engine.columnType(c)), (cb) => {
          if (isPk && single) cb = cb.primaryKey();
          if (c.autoincrement) cb = this.engine.autoincrement(cb);
          if (isPk || c.nullable === false) cb = cb.notNull();
          if (c.unique) cb = cb.unique();
          if (c.default !== undefined) cb = cb.defaultTo(this.#defaultTo(c) as never);
          return cb;
        });
      }
      if (!single) b = b.addPrimaryKeyConstraint(`${this.table}_pk`, pks.map((k) => this.dbCol(k)) as never);
      await b.execute();
    }
    await this.ensureSequences(exec);
    await this.ensureIndexes(this.resolvedIndexes(), exec);
    await this.ensureIndexes(this.requestedIndexes(), exec);
  }
}
