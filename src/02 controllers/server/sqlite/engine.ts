/** Motor SQLite: tipos, booleanos 0/1 y agregación JSON (json_object / json_group_array). */
import { type RawBuilder, sql } from "kysely";
import { dateToIso, parseMaybe } from "@Jeff-Aporta/DER/src/02 controllers/server/engine.ts";
import type { Engine, OutField } from "@Jeff-Aporta/DER/src/02 controllers/server/schemas.ts";

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
