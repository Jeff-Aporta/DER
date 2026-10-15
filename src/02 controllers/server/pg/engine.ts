/** Motor PostgreSQL: tipos, normalización de lectura y agregación JSON (row_to_json / json_agg). */
import { sql } from "kysely";
import { dateToIso, parseMaybe } from "@Jeff-Aporta/DER/src/02 controllers/server/engine.ts";
import type { Engine } from "@Jeff-Aporta/DER/src/02 controllers/server/schemas.ts";

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
