/** Resolución de un schema JSON: pks, columnas persistidas/virtuales, relaciones y validaciones de definición. */
import type { ColumnDef, Schema, SchemaMeta } from "@Jeff-Aporta/DER/src/00 common/schemas.ts";

/** Identidad tipada: conserva los literales del JSON para inferir los tipos de los campos. */
export function defineSchema<const S extends Schema>(schema: S): S {
  return schema;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const metaCache = new WeakMap<Schema, SchemaMeta>();

export function schemaMeta(schema: Schema): SchemaMeta {
  let m = metaCache.get(schema);
  if (m) return m;
  const columns = schema.columns;
  const relations = schema.relations ?? {};
  for (const name of [...Object.keys(columns), ...Object.keys(relations)]) {
    if (!IDENT.test(name)) throw new Error(`Nombre de campo inválido "${name}" (use [A-Za-z_][A-Za-z0-9_]*)`);
  }
  for (const name of Object.keys(relations)) {
    if (name in columns) throw new Error(`"${name}" no puede ser columna y relación a la vez`);
  }
  const pks = schema.primaryKey ? [...schema.primaryKey] : Object.entries(columns).filter(([, c]) => c.pk).map(([k]) => k);
  if (!pks.length) throw new Error("El schema debe definir al menos una pk");
  for (const pk of pks) {
    if (!columns[pk]) throw new Error(`La pk "${pk}" no es una columna`);
    if (columns[pk].virtual) throw new Error(`La pk "${pk}" no puede ser virtual`);
  }
  m = {
    schema,
    columns,
    persisted: Object.entries(columns).filter(([, c]) => !c.virtual).map(([k]) => k),
    virtual: Object.entries(columns).filter(([, c]) => c.virtual).map(([k]) => k),
    pks,
    relations,
    column(n) {
      const c = Object.hasOwn(columns, n) ? columns[n] : undefined;
      if (!c) throw new Error(`"${n}" no es una columna`);
      return c;
    },
    relation(n) {
      const r = Object.hasOwn(relations, n) ? relations[n] : undefined;
      if (!r) throw new Error(`"${n}" no es una relación`);
      return r;
    },
    isColumn: (n) => Object.hasOwn(columns, n),
    isRelation: (n) => Object.hasOwn(relations, n),
  };
  metaCache.set(schema, m);
  return m;
}

/**
 * Columna obligatoria al insertar: no nullable, sin default, sin `sequence` (la genera el motor),
 * sin `autoincrement` (lo genera la columna) y sin `virtual` (la calcula el server).
 */
export function isRequiredOnInsert(c: ColumnDef, isPk: boolean): boolean {
  if (c.virtual || c.autoincrement || c.sequence || c.default !== undefined) return false;
  return isPk || c.nullable === false;
}
