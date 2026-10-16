/**
 * Zod como estándar de contratos: cada schema JSON genera sus schemas Zod, iguales en client y server.
 *
 *   zodOf(Producto).row     lectura / formularios / validación de acciones parciales
 *   zodOf(Producto).insert  POST: requeridos = no nullable, sin default y no autoincrement
 *   zodOf(Producto).update  PUT: pks requeridas, el resto opcional
 *   zodOf(Producto).pk      GET/DELETE: sólo pks requeridas
 *   zodOf(Producto).molde   molde de `Obj.insert`: `null` → null si la columna es nullable; si no, se quita
 *
 * Una columna puede refinar su tipo con `zod: z.email()`; en columnas `json` el `zod` es su molde.
 * Los tipos y schemas de contrato (`SchemaZod`, `ZQuerySpec`...) viven en `schema.ts`.
 */
import { z } from "zod";
import { isRequiredOnInsert, schemaMeta } from "@Jeff-Aporta/DER/src/01 objects/meta.ts";
import { type Pojo, resolvePojo } from "@Jeff-Aporta/DER/src/01 objects/pojo.ts";
import type { ColumnDef, PojoClass, Schema, SchemaZod } from "@Jeff-Aporta/DER/src/00 common/schemas.ts";

const EXPECTED: Record<ColumnDef["type"], string> = {
  string: "texto",
  text: "texto",
  uuid: "texto",
  int: "un entero",
  bigint: "un entero",
  float: "un número",
  decimal: "un número",
  bool: "un booleano",
  date: "una fecha YYYY-MM-DD",
  datetime: "una fecha/hora",
  time: "una hora HH:MM:SS",
  json: "JSON",
};

/** Mensajes en español: falta / nulo / tipo. */
function err(name: string, c: ColumnDef) {
  return (iss: { input?: unknown }) =>
    iss.input === undefined
      ? `Falta el campo requerido "${name}"`
      : iss.input === null
      ? `"${name}" no puede ser nulo`
      : `"${name}" debe ser ${EXPECTED[c.type]}`;
}

/** Zod del valor (no nulo) de una columna. */
export function columnZod(name: string, c: ColumnDef): z.ZodType {
  if (c.zod) return c.zod;
  const error = err(name, c);
  if (c.enum) {
    const msg = `"${name}" debe ser uno de: ${c.enum.join(", ")}`;
    const literals: z.ZodLiteral[] = c.enum.map((v: string | number): z.ZodLiteral => z.literal(v));
    return z.union(literals as [z.ZodLiteral, z.ZodLiteral, ...z.ZodLiteral[]], {
      error: (iss: { input?: unknown }): string => (iss.input == null ? error(iss) : msg),
    });
  }
  const typeMsg = error({ input: "" });
  switch (c.type) {
    case "string": {
      const s = z.string({ error });
      return c.length ? s.max(c.length, `"${name}" supera ${c.length} caracteres`) : s;
    }
    case "text":
    case "uuid":
      return z.string({ error });
    case "int":
    case "bigint":
      return z.number({ error }).int(typeMsg);
    case "float":
    case "decimal":
      return z.number({ error });
    case "bool":
      return z.boolean({ error });
    case "date":
      return z.string({ error }).regex(/^\d{4}-\d{2}-\d{2}$/, typeMsg);
    case "datetime":
      return z.date({ error });
    case "time":
      return z.string({ error }).regex(/^\d{2}:\d{2}:\d{2}$/, typeMsg);
    case "json":
      return z.unknown();
  }
}

const cache = new WeakMap<Schema, SchemaZod>();

export function schemaZod(schema: Schema): SchemaZod {
  let r = cache.get(schema);
  if (r) return r;
  const meta = schemaMeta(schema);
  const row: Record<string, z.ZodType> = {};
  const insert: Record<string, z.ZodType> = {};
  const update: Record<string, z.ZodType> = {};
  const pk: Record<string, z.ZodType> = {};
  const molde: Record<string, z.ZodType> = {};
  for (const [k, c] of Object.entries(meta.columns)) {
    const base = columnZod(k, c);
    const isPk = meta.pks.includes(k);
    const notNull = isPk || c.nullable === false;
    const opt = notNull ? base.optional() : base.nullable().optional();
    row[k] = base.nullable().optional();
    molde[k] = notNull ? base.optional() : base.nullable();
    if (c.virtual) continue;
    insert[k] = isRequiredOnInsert(c, isPk) ? base : opt;
    update[k] = isPk ? base : opt;
    if (isPk) pk[k] = base;
  }
  for (const [k, rel] of Object.entries(meta.relations)) {
    const target = () => schemaZod(resolvePojo(rel.target).schema);
    const tRow = z.lazy(() => target().row);
    const tMolde = z.lazy(() => target().molde);
    row[k] = rel.kind === "many" ? z.array(tRow).optional() : tRow.nullable().optional();
    molde[k] = rel.kind === "many" ? z.array(tMolde) : tMolde.nullable();
  }
  r = {
    row: z.object(row),
    insert: z.object(insert),
    update: z.object(update),
    pk: z.object(pk),
    molde: z.object(molde),
  };
  cache.set(schema, r);
  return r;
}

export function zodOf(pojo: PojoClass<any>): SchemaZod {
  return schemaZod(pojo.schema);
}

/** Valores de columnas definidos (sin `undefined`) tal como los dejaron los setters. */
export function pojoValues(p: Pojo): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const self = p as unknown as Record<string, unknown>;
  for (const k of Object.keys(p.$meta.columns)) if (self[k] !== undefined) out[k] = self[k];
  return out;
}

/** Primer issue de Zod como mensaje legible (`ruta: mensaje` cuando es anidado). */
export function zodMessage(e: z.ZodError): string {
  const i = e.issues[0];
  if (!i) return "Datos inválidos";
  const path = i.path.length > 1 ? `${i.path.join(".")}: ` : "";
  return path + i.message;
}
