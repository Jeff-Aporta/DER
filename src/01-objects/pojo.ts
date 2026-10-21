/**
 * POJOs: toda columna es un getter/setter con su casteo. Los datos viven en `this.f`.
 *
 * Dos formas de declararlos (combinables):
 *
 * 1. Generada desde el schema JSON (recomendada):
 *    ```ts
 *    class Producto extends pojoOf(ProductoSchema) {
 *      declare categoria: Categoria | null;   // relaciones: sólo el tipo, el accessor se genera
 *      get etiqueta() { return `${this.nombre} ($${this.precio})`; }
 *    }
 *    ```
 * 2. Manual, al estilo clásico (el schema sigue siendo la fuente para Zod/seed/SQL):
 *    ```ts
 *    class Producto extends Pojo {
 *      static override schema = ProductoSchema;
 *      get nombre(): string | null { return this.f["nombre"] as string; }
 *      set nombre(v: unknown) { this.f["nombre"] = toStr(v); }
 *    }
 *    ```
 *
 * Acciones JSON parciales y tipadas (con el molde Zod del schema; el resultado se valida y nunca sale del molde):
 *   p.insert(cambios)       upsert profundo: lo no mencionado se conserva; `null` → null si la columna lo admite
 *   p.insertIgnore(cambios) sólo agrega lo que no está definido (nunca pisa)
 *   p.update(cambios)      sólo cambia lo que ya está definido
 *   p.delete(query)        quita (deja sin definir) lo marcado; en json con molde quita dentro del json
 *   p.get(query)           JSON con sólo lo marcado (estructura desde la raíz)
 *   p.replace(obj)         reemplazo directo de todo el contenido
 * Una columna `json` SIN `zod` no tiene molde: cualquier acción la reemplaza completa (replace directo).
 */
import { CASTS } from "@Jeff-Aporta/DER/src/00-common/cast.ts";
import { ValidationError } from "@Jeff-Aporta/DER/src/00-common/errors.ts";
import { schemaMeta } from "@Jeff-Aporta/DER/src/01-objects/meta.ts";
import { Obj } from "@Jeff-Aporta/DER/src/00-common/obj.ts";
import type {
  GeneratedPojoClass,
  PojoPartialOp,
  Patch,
  PojoClass,
  PojoInit,
  PojoQuery,
  Schema,
  SchemaMeta,
  TConsulta,
} from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { pojoValues, schemaZod, zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";

const RESERVED = new Set([
  "f",
  "assign",
  "toJSON",
  "pkValues",
  "pkOnly",
  "constructor",
  "insert",
  "insertIgnore",
  "update",
  "delete",
  "get",
  "replace",
]);


export abstract class Pojo {
  static schema: Schema;
  /** Almacenamiento de los campos. */
  protected declare f: Record<string, unknown>;

  constructor(init?: PojoInit | Pojo) {
    Object.defineProperty(this, "f", { value: {}, writable: true, enumerable: false });
    if (init) this.assign(init);
  }

  /** Metadata resuelta del schema de la clase. */
  static get meta(): SchemaMeta {
    return schemaMeta(this.schema);
  }

  get $meta(): SchemaMeta {
    return (this.constructor as typeof Pojo).meta;
  }

  /** Crea una instancia casteando un objeto plano (o devuelve la misma si ya es de la clase). */
  static fromJSON<T extends Pojo>(this: new (init?: PojoInit) => T, obj: unknown): T {
    if (obj instanceof this) return obj;
    return new this((obj ?? {}) as PojoInit);
  }

  static fromList<T extends Pojo>(this: new (init?: PojoInit) => T, list: unknown): T[] {
    if (!Array.isArray(list)) return [];
    return list.map((o) => (o instanceof this ? o : new this((o ?? {}) as PojoInit)));
  }

  /** Asigna sólo las llaves conocidas del schema (columnas y relaciones), pasando por los setters. */
  assign(obj: PojoInit | Pojo): this {
    const { columns, relations } = this.$meta;
    const src = obj as Record<string, unknown>;
    for (const k of [...Object.keys(columns), ...Object.keys(relations)]) {
      const v = src[k];
      if (v !== undefined) (this as unknown as Record<string, unknown>)[k] = v;
    }
    return this;
  }

  /** Valores de las pks en orden. */
  pkValues(): unknown[] {
    return this.$meta.pks.map((k) => (this as unknown as Record<string, unknown>)[k]);
  }

  /** Copia con sólo las pks. */
  pkOnly(): this {
    const C = this.constructor as new (init?: PojoInit) => this;
    const o: PojoInit = {};
    for (const k of this.$meta.pks) o[k] = (this as unknown as Record<string, unknown>)[k];
    return new C(o);
  }

  /** Serializa columnas (incluidas virtuales) y relaciones definidas; omite lo `undefined`. */
  toJSON(): Record<string, unknown> {
    const { columns, relations } = this.$meta;
    const self = this as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(columns)) {
      const v = self[k];
      if (v === undefined) continue;
      out[k] = v instanceof Date ? v.toISOString() : v;
    }
    for (const k of Object.keys(relations)) {
      const v = self[k];
      if (v === undefined) continue;
      if (Array.isArray(v)) out[k] = v.map((x) => (x instanceof Pojo ? x.toJSON() : x));
      else out[k] = v instanceof Pojo ? v.toJSON() : v;
    }
    return out;
  }

  // ------------------------------------------------------------------ acciones JSON (Obj + Zod)

  insert(cambios: Patch<this>): this {
    return this.#partial("insert", cambios);
  }

  insertIgnore(cambios: Patch<this>): this {
    return this.#partial("insertIgnore", cambios);
  }

  update(cambios: Patch<this>): this {
    return this.#partial("update", cambios);
  }

  delete(query: PojoQuery<this>): this {
    const next = Obj.delete(this.toJSON(), query as TConsulta) as Record<string, unknown>;
    return this.#commit(next);
  }

  get(query: PojoQuery<this>): Record<string, unknown> {
    return Obj.get(this.toJSON(), query as TConsulta) as Record<string, unknown>;
  }

  replace(obj: PojoInit | Pojo): this {
    return this.#commit(obj instanceof Pojo ? obj.toJSON() : obj);
  }

  #partial(op: PojoPartialOp, cambios: Record<string, unknown>): this {
    const base = this.toJSON();
    const z = schemaZod(this.$meta.schema);
    const next = (op === "insert"
      ? Obj.insert(base, cambios, z.molde)
      : op === "insertIgnore"
      ? Obj.insertIgnore(base, cambios)
      : Obj.update(base, cambios)) as Record<string, unknown>;
    // json sin molde → reemplazo directo
    for (const [k, c] of Object.entries(this.$meta.columns)) {
      if (c.type !== "json" || c.zod || cambios[k] === undefined) continue;
      const existe = base[k] !== undefined;
      if (op === "insert" || (op === "insertIgnore" && !existe) || (op === "update" && existe)) next[k] = cambios[k];
    }
    return this.#commit(next);
  }

  /** Castea `next` en una instancia nueva, valida con el Zod `row` y recién entonces reemplaza el contenido. */
  #commit(next: Record<string, unknown>): this {
    const C = this.constructor as new (init?: PojoInit) => this;
    const tmp = new C(next);
    const r = schemaZod(this.$meta.schema).row.safeParse(pojoValues(tmp));
    if (!r.success) throw new ValidationError(zodMessage(r.error));
    this.f = { ...tmp.f };
    return this;
  }
}

/**
 * Genera una clase base con un getter/setter casteado por cada columna y relación del schema.
 * Si una subclase redefine el accessor, el suyo tiene prioridad.
 */
export function pojoOf<const S extends Schema>(schema: S): GeneratedPojoClass<S> {
  const meta = schemaMeta(schema);
  for (const k of [...Object.keys(meta.columns), ...Object.keys(meta.relations)]) {
    if (RESERVED.has(k)) throw new Error(`"${k}" es un nombre reservado del POJO`);
  }
  class Generated extends Pojo {
    static override schema: Schema = schema;
  }
  const proto = Generated.prototype as unknown as Record<string, unknown>;
  for (const [k, def] of Object.entries(meta.columns)) {
    const cast = CASTS[def.type];
    if (!cast) throw new Error(`Tipo de columna desconocido "${def.type}" en "${k}"`);
    Object.defineProperty(proto, k, {
      get(this: { f: Record<string, unknown> }) {
        return this.f[k];
      },
      set(this: { f: Record<string, unknown> }, v: unknown) {
        this.f[k] = v === undefined ? undefined : cast(v);
      },
      enumerable: true,
      configurable: true,
    });
  }
  for (const [k, rel] of Object.entries(meta.relations)) {
    Object.defineProperty(proto, k, {
      get(this: { f: Record<string, unknown> }) {
        return this.f[k];
      },
      set(this: { f: Record<string, unknown> }, v: unknown) {
        this.f[k] = castRelation(rel.kind, resolvePojo(rel.target), v);
      },
      enumerable: true,
      configurable: true,
    });
  }
  return Generated as unknown as GeneratedPojoClass<S>;
}

// ------------------------------------------------------------------ registro por nombre

const registry = new Map<string, PojoClass<any>>();

/** Registra un POJO bajo un nombre para resolver `RelationDef.target` en formato string. */
export function registerPojo(name: string, cls: PojoClass<any>): void {
  registry.set(name, cls);
}

export function resolvePojo(target: string | (() => PojoClass<any>)): PojoClass<any> {
  if (typeof target === "function") return target();
  const c = registry.get(target);
  if (!c) throw new Error(`No hay POJO registrado como "${target}" (¿falta defineEntity/registerPojo?)`);
  return c;
}

/** Casteo de relaciones, útil también para POJOs manuales. */
export function castRelation(kind: "one" | "many", target: PojoClass<any>, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (typeof v === "string") v = JSON.parse(v);
  if (kind === "many") return v == null ? [] : target.fromList(v);
  return v == null ? null : target.fromJSON(v);
}
