/**
 * Especificación de `query()`: filtrado, selección de columnas, orden, paginación e include de relaciones.
 * Es JSON puro: viaja igual en el body del client y se valida igual en ambos lados.
 *
 * ```ts
 * {
 *   select: ["iproducto", "nombre", "precio"],
 *   where: {
 *     precio: { gte: 10, lt: 100 },
 *     nombre: { contains: "cafe" },          // like '%cafe%' (escapado)
 *     categoria: { nombre: "Bebidas" },      // filtro por relación → EXISTS(...)
 *     $or: [{ bactivo: true }, { stock: { gt: 0 } }],
 *   },
 *   orderBy: ["-precio", "nombre"],          // "-" = desc
 *   page: 1, pageSize: 20,
 *   include: { categoria: true, detalles: { producto: true } },
 * }
 * ```
 */
import { resolvePojo } from "@Jeff-Aporta/DER/src/01 objects/pojo.ts";
import {
  FIELD_OPS,
  type FieldOps,
  type Include,
  type NormalizedOrder,
  type OrderBy,
  type PageLimits,
  type QuerySpec,
  type SchemaMeta,
  ZQuerySpec,
} from "@Jeff-Aporta/DER/src/00 common/schemas.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01 objects/zod.ts";

export function normalizeOrder(o: OrderBy | undefined): NormalizedOrder[] {
  if (o == null) return [];
  const list = Array.isArray(o) ? o : [o];
  return list.map((it) => {
    if (typeof it === "string") {
      return it.startsWith("-") ? { field: it.slice(1), dir: "desc" } : { field: it.replace(/^\+/, ""), dir: "asc" };
    }
    return { field: it.field, dir: it.dir === "desc" ? "desc" : "asc" };
  });
}

/** Expande `"*"` y normaliza `true`/objeto. Devuelve pares [relación, include anidado]. */
export function expandInclude(meta: SchemaMeta, inc: Include | undefined): [string, Include | undefined][] {
  if (!inc) return [];
  const out = new Map<string, Include | undefined>();
  if (inc["*"]) for (const r of Object.keys(meta.relations)) out.set(r, undefined);
  for (const [k, v] of Object.entries(inc)) {
    if (k === "*" || !v) continue;
    out.set(k, v === true ? undefined : v);
  }
  return [...out];
}

/** Validación estructural compartida (client y server). Retorna el mensaje de error o `null`. */
export function validateQuery(meta: SchemaMeta, q: QuerySpec, limits: PageLimits): string | null {
  if (q == null || typeof q !== "object" || Array.isArray(q)) return "La consulta debe ser un objeto";
  const shape = ZQuerySpec.safeParse(q);
  if (!shape.success) return zodMessage(shape.error);
  if (q.select !== undefined) {
    for (const f of q.select) if (!meta.isColumn(f)) return `select: "${f}" no es una columna`;
  }
  for (const o of normalizeOrder(q.orderBy)) {
    if (!meta.isColumn(o.field)) return `orderBy: "${o.field}" no es una columna`;
  }
  if (q.page !== undefined && !(Number.isInteger(q.page) && q.page >= 1)) return "page debe ser un entero >= 1";
  if (q.pageSize !== undefined) {
    if (!(Number.isInteger(q.pageSize) && q.pageSize >= 1)) return "pageSize debe ser un entero >= 1";
    if (q.pageSize > limits.maxPageSize) return `pageSize no puede superar ${limits.maxPageSize}`;
  }
  return validateWhere(meta, q.where, "where") ?? validateInclude(meta, q.include, "include");
}

export function validateWhere(meta: SchemaMeta, w: unknown, path: string): string | null {
  if (w === undefined) return null;
  if (w == null || typeof w !== "object" || Array.isArray(w)) return `${path} debe ser un objeto`;
  for (const [k, v] of Object.entries(w as Record<string, unknown>)) {
    if (k === "$and" || k === "$or") {
      if (!Array.isArray(v)) return `${path}.${k} debe ser un arreglo`;
      for (let i = 0; i < v.length; i++) {
        const e = validateWhere(meta, v[i], `${path}.${k}[${i}]`);
        if (e) return e;
      }
    } else if (k === "$not") {
      const e = validateWhere(meta, v, `${path}.$not`);
      if (e) return e;
    } else if (meta.isRelation(k)) {
      const target = resolvePojo(meta.relation(k).target).meta;
      const e = validateWhere(target, v, `${path}.${k}`);
      if (e) return e;
    } else if (meta.isColumn(k)) {
      if (isOpsObject(v)) {
        for (const op of Object.keys(v)) {
          if (!FIELD_OPS.has(op)) return `${path}.${k}: operador desconocido "${op}"`;
        }
        const ops = v as FieldOps;
        if (ops.in !== undefined && !Array.isArray(ops.in)) return `${path}.${k}.in debe ser un arreglo`;
        if (ops.nin !== undefined && !Array.isArray(ops.nin)) return `${path}.${k}.nin debe ser un arreglo`;
        if (ops.between !== undefined && !(Array.isArray(ops.between) && ops.between.length === 2)) {
          return `${path}.${k}.between debe ser [desde, hasta]`;
        }
      }
    } else {
      return `${path}: "${k}" no es columna ni relación`;
    }
  }
  return null;
}

export function validateInclude(meta: SchemaMeta, inc: unknown, path: string): string | null {
  if (inc === undefined) return null;
  if (inc == null || typeof inc !== "object" || Array.isArray(inc)) return `${path} debe ser un objeto`;
  for (const [k, v] of Object.entries(inc as Record<string, unknown>)) {
    if (k === "*") continue;
    if (!meta.isRelation(k)) return `${path}: "${k}" no es una relación`;
    if (v && typeof v === "object") {
      const e = validateInclude(resolvePojo(meta.relation(k).target).meta, v, `${path}.${k}`);
      if (e) return e;
    } else if (typeof v !== "boolean" && v !== undefined) return `${path}.${k} debe ser bool u objeto`;
  }
  return null;
}

/** `{ gt: 1 }` vs un valor plano (Date y arrays son valores). */
export function isOpsObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}
