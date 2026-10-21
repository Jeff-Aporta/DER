/**
 * Resolución de un schema JSON: pks, columnas persistidas/virtuales, relaciones, secuencias y validaciones de definición.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/objetos.md
 */
import type { ColumnDef, Schema, SchemaMeta, SequenceDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";

/** Identidad tipada: conserva los literales del JSON para inferir los tipos de los campos. */
export function defineSchema<const S extends Schema>(schema: S): S {
  return schema;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NUMERIC = new Set(["int", "bigint", "float", "decimal"]);
const TEXT = new Set(["string", "text"]);
const metaCache = new WeakMap<Schema, SchemaMeta>();

/** Definición normalizada de la secuencia de una columna (`null` si no tiene): base 2..36 (default 10) y `as` resuelto según el tipo. */
export function sequenceOf(name: string, c: ColumnDef): (SequenceDef & { base: number; as: "number" | "string" }) | null {
  if (c.sequence === undefined) return null;
  const def = c.sequence === true ? {} : c.sequence;
  const base = def.base ?? 10;
  if (!Number.isInteger(base) || base < 2 || base > 36) throw new Error(`"${name}": la base de la secuencia debe ser un entero entre 2 y 36`);
  const as = def.as ?? (NUMERIC.has(c.type) ? "number" : "string");
  if (as === "number" && !NUMERIC.has(c.type)) throw new Error(`"${name}": una secuencia numérica exige una columna numérica`);
  if (as === "string" && !TEXT.has(c.type)) throw new Error(`"${name}": una secuencia en texto exige una columna string/text`);
  if (base !== 10 && as !== "string") throw new Error(`"${name}": una secuencia en base ${base} debe quemarse como texto (as: "string" en columna string)`);
  return { ...def, base, as };
}

/** Metadata de un schema (cacheada): valida nombres, pks, relaciones y secuencias; lanza con el detalle si algo está mal definido. */
export function schemaMeta(schema: Schema): SchemaMeta {
  const cached = metaCache.get(schema);
  if (cached) return cached;
  const columns = schema.columns;
  const relations = schema.relations ?? {};
  for (const name of [...Object.keys(columns), ...Object.keys(relations)]) {
    if (!IDENT.test(name)) throw new Error(`Nombre de campo inválido "${name}" (use [A-Za-z_][A-Za-z0-9_]*)`);
  }
  for (const name of Object.keys(relations)) {
    if (name in columns) throw new Error(`"${name}" no puede ser columna y relación a la vez`);
  }
  for (const [name, c] of Object.entries(columns)) sequenceOf(name, c);
  const pks = schema.primaryKey ? [...schema.primaryKey] : Object.entries(columns).filter(([, c]) => c.pk).map(([k]) => k);
  if (!pks.length) throw new Error("El schema debe definir al menos una pk");
  for (const pk of pks) {
    if (!columns[pk]) throw new Error(`La pk "${pk}" no es una columna`);
    if (columns[pk].virtual) throw new Error(`La pk "${pk}" no puede ser virtual`);
  }
  const column = (n: string): ColumnDef => {
    const c = Object.hasOwn(columns, n) ? columns[n] : undefined;
    if (!c) throw new Error(`"${n}" no es una columna`);
    return c;
  };
  const relation = (n: string) => {
    const r = Object.hasOwn(relations, n) ? relations[n] : undefined;
    if (!r) throw new Error(`"${n}" no es una relación`);
    return r;
  };
  const m: SchemaMeta = { schema, columns, persisted: Object.keys(columns).filter((k) => !columns[k]?.virtual), virtual: Object.keys(columns).filter((k) => columns[k]?.virtual), pks, relations, column, relation, isColumn: (n) => Object.hasOwn(columns, n), isRelation: (n) => Object.hasOwn(relations, n) };
  metaCache.set(schema, m);
  return m;
}

/** Columna obligatoria al insertar: no nullable, sin default, sin `sequence` (la genera el motor), sin `autoincrement` y sin `virtual`. */
export function isRequiredOnInsert(c: ColumnDef, isPk: boolean): boolean {
  if (c.virtual || c.autoincrement || c.sequence || c.default !== undefined) return false;
  return isPk || c.nullable === false;
}
