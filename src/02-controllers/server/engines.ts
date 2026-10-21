/**
 * Motores: utilidades comunes y las implementaciones incluidas (`postgres`, `sqlite`). El contrato `Engine`
 * está en `./schemas.ts`; el ServerController sólo arma la consulta con estas primitivas (Kysely compila la
 * sintaxis y los parámetros).
 */
import { type RawBuilder, sql } from "kysely";
import type { Engine, IdentifierCase, OutField } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";

export function dateToIso(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

export function parseMaybe(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export function applyCase(name: string, c: IdentifierCase): string {
  return c === "lower" ? name.toLowerCase() : c === "upper" ? name.toUpperCase() : name;
}


export const postgres: Engine = {
  name: "pg",
  columnType(c) {
    switch (c.type) {
      case "string":
        return c.length ? `varchar(${c.length})` : "text";
      case "text":
        return "text";
      case "uuid":
        return "uuid";
      case "int":
        return "integer";
      case "bigint":
        return "bigint";
      case "float":
        return "double precision";
      case "decimal":
        return c.precision ? `numeric(${c.precision}, ${c.scale ?? 0})` : "numeric";
      case "bool":
        return "boolean";
      case "date":
        return "date";
      case "datetime":
        return "timestamptz";
      case "time":
        return "time";
      case "json":
        return "jsonb";
    }
  },
  selectExpr(ref, c) {
    return c.type === "date" || c.type === "time" ? sql`${ref}::text` : ref;
  },
  toDb(c, v) {
    if (v == null) return null;
    if (c.type === "json") return JSON.stringify(v);
    return dateToIso(v);
  },
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
  async createSequence(exec, name, start, increment) {
    await sql`create sequence if not exists ${sql.id(name)} start with ${sql.lit(start)} increment by ${
      sql.lit(increment)
    }`.execute(exec);
  },
  async nextValue(exec, name) {
    const ident = `"${name.replace(/"/g, '""')}"`;
    const { rows } = await sql<{ v: string | number }>`select nextval(${ident}::regclass) as v`.execute(exec);
    const v = rows[0]?.v;
    if (v === undefined) throw new Error(`Secuencia inexistente: ${name}`);
    return Number(v);
  },
};


function sqlitePairs(alias: string, fields: OutField[]): RawBuilder<unknown> {
  return sql.join(
    fields.map((f) => {
      const ref = sql.ref(`${alias}.${f.name}`);
      return sql`${sql.lit(f.name)}, ${f.kind === "col" ? ref : sql`json(${ref})`}`;
    }),
  );
}

export const sqlite: Engine = {
  name: "sqlite",
  columnType(c) {
    switch (c.type) {
      case "int":
      case "bigint":
      case "bool":
        return "integer";
      case "float":
        return "real";
      case "decimal":
        return "numeric";
      default:
        return "text";
    }
  },
  selectExpr(ref) {
    return ref;
  },
  toDb(c, v) {
    if (v == null) return null;
    if (c.type === "json") return JSON.stringify(v);
    if (typeof v === "boolean") return v ? 1 : 0;
    return dateToIso(v);
  },
  readJson: parseMaybe,
  jsonOne(sub, alias, fields) {
    return sql`(select json_object(${sqlitePairs(alias, fields)}) from (${sub}) as ${sql.id(alias)})`;
  },
  jsonMany(sub, alias, fields) {
    return sql`(select coalesce(json_group_array(json_object(${
      sqlitePairs(alias, fields)
    })), '[]') from (${sub}) as ${sql.id(alias)})`;
  },
  ilike(left, pattern) {
    return sql`lower(${left}) like lower(${pattern})`;
  },
  // SQLite no tiene secuencias: se emulan con la tabla `_sequences` (UPDATE ... RETURNING es atómico).
  async createSequence(exec, name, start, increment) {
    await sql`create table if not exists _sequences (name text primary key, value integer not null, increment integer not null)`
      .execute(exec);
    await sql`insert or ignore into _sequences (name, value, increment) values (${name}, ${start - increment}, ${increment})`
      .execute(exec);
  },
  async nextValue(exec, name) {
    const { rows } = await sql<{ value: number }>`update _sequences set value = value + increment where name = ${name} returning value`
      .execute(exec);
    const v = rows[0]?.value;
    if (v === undefined) throw new Error(`Secuencia inexistente: ${name}`);
    return Number(v);
  },
};
