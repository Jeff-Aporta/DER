/**
 * Motores incluidos: `postgres` (PG y PGlite), `sqlite` (node:sqlite, better-sqlite3, sqlite3), `mysql` (mysql2) y
 * `mssql` (tedious). El contrato `Engine` está en `./schemas.ts`; el ServerController arma la consulta sólo con estas
 * primitivas y Kysely compila la sintaxis y los parámetros. Un motor nuevo es otra constante aquí.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import { type Kysely, type RawBuilder, sql } from "kysely";
import type { ColumnDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { toIso } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { Engine, IdentifierCase, OutField, ResolvedIndex } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";

/** `Date` → ISO 8601 UTC; cualquier otro valor tal cual. */
export function dateToIso(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

/**
 * Fecha-hora para motores sin zona (`datetime` de MySQL, `datetime2` de MSSQL): ISO 8601 en UTC sin la `Z`
 * (`2024-02-29T10:00:00.000`). Nunca se entrega un `Date` al driver: lo convertiría a la zona local del proceso.
 */
export function naiveUtc(v: unknown): string | null {
  return toIso(v)?.slice(0, 23) ?? null;
}

/** JSON.parse si es texto parseable; si no, el valor tal cual (lectura de json/relaciones). */
export function parseMaybe(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** Aplica `identifierCase` a un identificador. */
export function applyCase(name: string, c: IdentifierCase): string {
  if (c === "lower") return name.toLowerCase();
  return c === "upper" ? name.toUpperCase() : name;
}

const ESCAPE = sql.raw(`escape '\\'`);

/** `limit N offset M` (PG, SQLite, MySQL). */
function limitOffset(limit: number | undefined, offset: number | undefined): RawBuilder<unknown> | null {
  if (limit === undefined && !offset) return null;
  let q = sql``;
  if (limit !== undefined) q = sql`limit ${limit}`;
  if (offset) q = sql`${q} offset ${offset}`;
  return q;
}

/** `create [unique] index if not exists` con Kysely (motores que lo admiten). */
async function kyselyIndex(exec: Kysely<any>, ix: ResolvedIndex): Promise<void> {
  let b = exec.schema.createIndex(ix.name).ifNotExists().on(ix.table).columns(ix.columns);
  if (ix.unique) b = b.unique();
  await b.execute();
}

/** Secuencias emuladas con la tabla `_sequences` (SQLite y MySQL no tienen `CREATE SEQUENCE`). */
async function ensureSequencesTable(exec: Kysely<any>, name: string, start: number, increment: number, nameType: string, ignore: string): Promise<void> {
  await sql`create table if not exists _sequences (name ${sql.raw(nameType)} primary key, value bigint not null, increment integer not null)`.execute(exec);
  await sql`${sql.raw(ignore)} into _sequences (name, value, increment) values (${name}, ${start - increment}, ${increment})`.execute(exec);
}

function decimalType(c: ColumnDef, fallback: string): string {
  return c.precision ? `decimal(${c.precision}, ${c.scale ?? 0})` : fallback;
}

/** Valor de escritura común: json serializado, booleanos como vienen, fechas ISO. */
function toDbCommon(c: ColumnDef, v: unknown): unknown {
  if (v == null) return null;
  if (c.type === "json") return JSON.stringify(v);
  return dateToIso(v);
}

// ===================================================================================== PostgreSQL (y PGlite)

/** Motor PostgreSQL (también PGlite): `returning`, jsonb, `row_to_json`/`json_agg`, `ilike`, `CREATE SEQUENCE`. */
export const postgres: Engine = {
  name: "pg",
  returning: "returning",
  ifNotExists: true,
  escape: ESCAPE,
  defaultValues: sql`default values`,
  columnType(c) {
    if (c.type === "string") return c.length ? `varchar(${c.length})` : "text";
    if (c.type === "text") return "text";
    if (c.type === "uuid") return "uuid";
    if (c.type === "int") return "integer";
    if (c.type === "bigint") return "bigint";
    if (c.type === "float") return "double precision";
    if (c.type === "decimal") return c.precision ? `numeric(${c.precision}, ${c.scale ?? 0})` : "numeric";
    if (c.type === "bool") return "boolean";
    if (c.type === "date") return "date";
    if (c.type === "datetime") return "timestamptz";
    if (c.type === "time") return "time";
    return "jsonb";
  },
  selectExpr(ref, c) {
    if (c.type === "datetime") return sql`to_char(${ref} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
    return c.type === "date" || c.type === "time" ? sql`${ref}::text` : ref;
  },
  toDb: toDbCommon,
  readJson: parseMaybe,
  jsonOne(sub, alias) {
    const a = sql.id(alias);
    return sql`(select row_to_json(${a}) from (${sub}) as ${a})`;
  },
  jsonMany(sub, alias) {
    const a = sql.id(alias);
    return sql`(select coalesce(json_agg(${a}), '[]'::json) from (${sub}) as ${a})`;
  },
  ilike(left, pattern) {
    return sql`${left} ilike ${pattern}`;
  },
  page: limitOffset,
  autoincrement: (cb) => cb.generatedByDefaultAsIdentity(),
  async createSequence(exec, name, start, increment) {
    await sql`create sequence if not exists ${sql.id(name)} start with ${sql.lit(start)} increment by ${sql.lit(increment)}`.execute(exec);
  },
  async nextValue(exec, name) {
    const ident = `"${name.replace(/"/g, '""')}"`;
    const { rows } = await sql<{ v: string | number }>`select nextval(${ident}::regclass) as v`.execute(exec);
    const v = rows[0]?.v;
    if (v === undefined) throw new Error(`Secuencia inexistente: ${name}`);
    return Number(v);
  },
  createIndex: kyselyIndex,
};

// ===================================================================================== SQLite

function sqlitePairs(alias: string, fields: OutField[]): RawBuilder<unknown> {
  return sql.join(fields.map((f) => {
    const ref = sql.ref(`${alias}.${f.name}`);
    return sql`${sql.lit(f.name)}, ${f.kind === "col" ? ref : sql`json(${ref})`}`;
  }));
}

/** Motor SQLite: `returning`, `json_object`/`json_group_array`, booleanos 0/1, secuencias en `_sequences`. */
export const sqlite: Engine = {
  name: "sqlite",
  returning: "returning",
  ifNotExists: true,
  escape: ESCAPE,
  defaultValues: sql`default values`,
  columnType(c) {
    if (c.autoincrement) return "integer";
    if (c.type === "int" || c.type === "bigint" || c.type === "bool") return "integer";
    if (c.type === "float") return "real";
    if (c.type === "decimal") return "numeric";
    return "text";
  },
  selectExpr(ref) {
    return ref;
  },
  toDb(c, v) {
    if (c.type === "json") return toDbCommon(c, v);
    if (typeof v === "boolean") return v ? 1 : 0;
    return toDbCommon(c, v);
  },
  readJson: parseMaybe,
  jsonOne(sub, alias, fields) {
    return sql`(select json_object(${sqlitePairs(alias, fields)}) from (${sub}) as ${sql.id(alias)})`;
  },
  jsonMany(sub, alias, fields) {
    return sql`(select coalesce(json_group_array(json_object(${sqlitePairs(alias, fields)})), '[]') from (${sub}) as ${sql.id(alias)})`;
  },
  ilike(left, pattern) {
    return sql`lower(${left}) like lower(${pattern})`;
  },
  page: limitOffset,
  autoincrement: (cb) => cb.autoIncrement(),
  async createSequence(exec, name, start, increment) {
    await ensureSequencesTable(exec, name, start, increment, "text", "insert or ignore");
  },
  // UPDATE ... RETURNING es atómico.
  async nextValue(exec, name) {
    const { rows } = await sql<{ value: number }>`update _sequences set value = value + increment where name = ${name} returning value`.execute(exec);
    const v = rows[0]?.value;
    if (v === undefined) throw new Error(`Secuencia inexistente: ${name}`);
    return Number(v);
  },
  createIndex: kyselyIndex,
};

// ===================================================================================== MySQL (mysql2)

function mysqlPairs(alias: string, fields: OutField[]): RawBuilder<unknown> {
  return sql.join(fields.map((f) => sql`${sql.lit(f.name)}, ${sql.ref(`${alias}.${f.name}`)}`));
}

/** Motor MySQL/MariaDB: sin `RETURNING` (relectura), `json_object`/`json_arrayagg`, `last_insert_id` para secuencias. */
export const mysql: Engine = {
  name: "mysql",
  returning: "none",
  ifNotExists: true,
  escape: null,
  defaultValues: sql`() values ()`,
  columnType(c) {
    if (c.type === "string") return `varchar(${c.length ?? 255})`;
    if (c.type === "text") return "text";
    if (c.type === "uuid") return "char(36)";
    if (c.type === "int") return "int";
    if (c.type === "bigint") return "bigint";
    if (c.type === "float") return "double";
    if (c.type === "decimal") return decimalType(c, "decimal(18, 6)");
    if (c.type === "bool") return "tinyint(1)";
    if (c.type === "date") return "date";
    if (c.type === "datetime") return "datetime(3)";
    if (c.type === "time") return "time";
    return "json";
  },
  selectExpr(ref, c) {
    if (c.type === "date") return sql`date_format(${ref}, '%Y-%m-%d')`;
    if (c.type === "time") return sql`time_format(${ref}, '%H:%i:%s')`;
    if (c.type === "datetime") return sql`date_format(${ref}, '%Y-%m-%dT%H:%i:%s.%fZ')`;
    return ref;
  },
  toDb(c, v) {
    if (v == null) return null;
    if (c.type === "json") return toDbCommon(c, v);
    if (typeof v === "boolean") return v ? 1 : 0;
    if (c.type === "datetime") return naiveUtc(v);
    return toDbCommon(c, v);
  },
  readJson: parseMaybe,
  jsonOne(sub, alias, fields) {
    return sql`(select json_object(${mysqlPairs(alias, fields)}) from (${sub}) as ${sql.id(alias)})`;
  },
  jsonMany(sub, alias, fields) {
    return sql`(select coalesce(json_arrayagg(json_object(${mysqlPairs(alias, fields)})), json_array()) from (${sub}) as ${sql.id(alias)})`;
  },
  ilike(left, pattern) {
    return sql`lower(${left}) like lower(${pattern})`;
  },
  page: limitOffset,
  autoincrement: (cb) => cb.autoIncrement(),
  async createSequence(exec, name, start, increment) {
    await ensureSequencesTable(exec, name, start, increment, "varchar(120)", "insert ignore");
  },
  // LAST_INSERT_ID(expr) deja el valor en el resultado de la misma sentencia (atómico, sin segunda consulta).
  async nextValue(exec, name) {
    const r = await sql`update _sequences set value = last_insert_id(value + increment) where name = ${name}`.execute(exec);
    if (!r.numAffectedRows || r.insertId === undefined) throw new Error(`Secuencia inexistente: ${name}`);
    return Number(r.insertId);
  },
  createIndex: kyselyIndex,
};

// ===================================================================================== Microsoft SQL Server (tedious)

/** Proyección para `FOR JSON`: lo que ya es JSON va con `json_query` para que no se escape como texto. */
function mssqlProjection(alias: string, fields: OutField[]): RawBuilder<unknown> {
  return sql.join(fields.map((f) => {
    const ref = sql.ref(`${alias}.${f.name}`);
    return sql`${f.kind === "col" ? ref : sql`json_query(${ref})`} as ${sql.id(f.name)}`;
  }));
}

/** Motor SQL Server: `OUTPUT`, `FOR JSON PATH`, `OFFSET/FETCH`, `CREATE SEQUENCE`, catálogo `sys.*` en vez de `IF NOT EXISTS`. */
export const mssql: Engine = {
  name: "mssql",
  returning: "output",
  ifNotExists: false,
  escape: ESCAPE,
  defaultValues: sql`default values`,
  columnType(c) {
    if (c.type === "string") return `nvarchar(${c.length ?? 400})`;
    if (c.type === "text") return "nvarchar(max)";
    if (c.type === "uuid") return "uniqueidentifier";
    if (c.type === "int") return "int";
    if (c.type === "bigint") return "bigint";
    if (c.type === "float") return "float";
    if (c.type === "decimal") return decimalType(c, "decimal(18, 6)");
    if (c.type === "bool") return "bit";
    if (c.type === "date") return "date";
    if (c.type === "datetime") return "datetime2";
    if (c.type === "time") return "time";
    return "nvarchar(max)";
  },
  selectExpr(ref, c) {
    if (c.type === "date") return sql`convert(varchar(10), ${ref}, 23)`;
    if (c.type === "time") return sql`convert(varchar(8), ${ref}, 108)`;
    if (c.type === "datetime") return sql`convert(varchar(23), ${ref}, 126) + 'Z'`;
    return ref;
  },
  toDb(c, v) {
    if (v == null) return null;
    if (c.type === "datetime") return naiveUtc(v);
    return toDbCommon(c, v);
  },
  readJson: parseMaybe,
  jsonOne(sub, alias, fields) {
    return sql`(select ${mssqlProjection(alias, fields)} from (${sub}) as ${sql.id(alias)} for json path, without_array_wrapper)`;
  },
  jsonMany(sub, alias, fields) {
    return sql`isnull((select ${mssqlProjection(alias, fields)} from (${sub}) as ${sql.id(alias)} for json path), '[]')`;
  },
  ilike(left, pattern) {
    return sql`lower(${left}) like lower(${pattern})`;
  },
  // Toda consulta ordenada lleva OFFSET: así también vale como subconsulta (ORDER BY exige OFFSET/FETCH en T-SQL).
  page(limit, offset) {
    const q = sql`offset ${sql.lit(offset ?? 0)} rows`;
    return limit === undefined ? q : sql`${q} fetch next ${sql.lit(limit)} rows only`;
  },
  autoincrement: (cb) => cb.identity(),
  async createSequence(exec, name, start, increment) {
    await sql`if not exists (select 1 from sys.sequences where name = ${name}) create sequence ${sql.id(name)} start with ${sql.lit(start)} increment by ${sql.lit(increment)}`.execute(exec);
  },
  async nextValue(exec, name) {
    const { rows } = await sql<{ v: number }>`select next value for ${sql.id(name)} as v`.execute(exec);
    const v = rows[0]?.v;
    if (v === undefined) throw new Error(`Secuencia inexistente: ${name}`);
    return Number(v);
  },
  async createIndex(exec, ix) {
    const cols = sql.join(ix.columns.map((c) => sql.id(c)));
    await sql`if not exists (select 1 from sys.indexes where name = ${ix.name}) create ${sql.raw(ix.unique ? "unique " : "")}index ${sql.id(ix.name)} on ${sql.table(ix.table)} (${cols})`.execute(exec);
  },
};
