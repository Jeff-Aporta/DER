/**
 * Definición de una entidad REST: POJO (clase o generado del schema), singular/plural, tabla, rutas, verificaciones
 * compartidas, endpoints especiales y seguridad. Se define UNA vez y la reusan el ClientController y el ServerController.
 * Toda entidad queda en el registro global por su plural (`registry.entity("productos")`).
 *
 * Rutas (con `basePath` del router/cliente delante):
 *
 * | acción      | método      | ruta                         | param           |
 * |-------------|-------------|------------------------------|-----------------|
 * | get         | GET         | singular/pk1/pk2/...         | pojo (pks)      |
 * | post        | POST        | singular                     | pojo (body)     |
 * | put         | PUT         | singular/pk1/pk2/...         | pojo (body)     |
 * | delete      | DELETE      | singular/pk1/pk2/...         | pojo (pks)      |
 * | list        | GET         | plural                       | —               |
 * | query       | POST (GET)  | plural/query                 | QuerySpec       |
 * | postList    | POST        | plural                       | pojo[] (body)   |
 * | putList     | PUT         | plural                       | pojo[] (body)   |
 * | deleteList  | DELETE      | plural                       | pojo[] (body)   |
 * | getCfg/putCfg | GET/PUT   | plural/cfg                   | JSON            |
 * | doc         | GET         | plural/doc (`?v=1` vista)    | —               |
 * | endpoint    | def.method  | singular/pks.../nombre (one) ó plural/nombre (many) |
 *
 * Cualquier ruta + `/sse` es su variante Server-Sent Events. `/cfg` y `/doc` existen SÓLO en el plural.
 * Si singular === plural, el plural lleva el sufijo `pluralSuffix` (por defecto "s"): `dato/s`.
 */
import { type Pojo, pojoOf } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { type Action, ACTIONS, type EndpointDef, type EntityDef, type Hooks, type HttpMethod, type Patch, type PojoClass, type PojoOf, type RouteMatch, type Schema, type SchemaMeta, type SchemaZod } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { z } from "zod";
import { Obj } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { schemaZod } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";

const RESERVED_SEGMENTS = new Set(["query", "sse", "cfg", "doc"]);
const SEGMENT = /^[A-Za-z0-9_.~-]+(\/[A-Za-z0-9_.~-]+)*$/;

/** Nombre de tabla a partir de un segmento de ruta (`permisos/roles` → `permisos_roles`). */
function tableName(segment: string): string {
  return segment.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

export class Entity<P extends Pojo = Pojo> {
  readonly pojo: PojoClass<P>;
  readonly name: string;
  readonly singular: string;
  readonly plural: string;
  /** Nombre de la tabla: `def.table`, o el plural, o el singular (con `/` → `_`). */
  readonly table: string;
  readonly singularPath: string[];
  readonly pluralPath: string[];
  readonly listColumns: string[];
  readonly pageSize: number;
  readonly maxPageSize: number;
  readonly hooks: Hooks<P>;
  readonly endpoints: Record<string, EndpointDef<P>>;
  readonly itemHooksOnLists: boolean;

  constructor(readonly def: EntityDef<P>) {
    if (!def.pojo && !def.schema) throw new Error(`"${def.singular}": la entidad necesita un pojo o un schema`);
    this.pojo = def.pojo ?? pojoOf(def.schema as Schema) as unknown as PojoClass<P>;
    this.singular = def.singular;
    this.plural = def.plural;
    for (const s of [def.singular, def.plural, def.singularSuffix, def.pluralSuffix]) {
      if (s !== undefined && !SEGMENT.test(s)) throw new Error(`Segmento de ruta inválido "${s}"`);
    }
    const pluralSuffix = def.pluralSuffix ?? (def.singular === def.plural ? "s" : undefined);
    this.singularPath = [...def.singular.split("/"), ...(def.singularSuffix ? def.singularSuffix.split("/") : [])];
    this.pluralPath = [...def.plural.split("/"), ...(pluralSuffix ? pluralSuffix.split("/") : [])];
    if (this.singularPath.join("/") === this.pluralPath.join("/")) throw new Error(`"${def.singular}": la ruta singular y plural no pueden ser iguales`);
    this.table = def.table ?? tableName(def.plural) ?? tableName(def.singular);
    if (!this.table) throw new Error(`"${def.singular}": no se pudo determinar el nombre de la tabla (defina table, plural o singular)`);
    const meta = this.meta;
    this.listColumns = def.listColumns ?? meta.persisted;
    for (const c of this.listColumns) if (!meta.isColumn(c)) throw new Error(`listColumns: "${c}" no es una columna`);
    this.pageSize = def.pageSize ?? 50;
    this.maxPageSize = def.maxPageSize ?? 1000;
    this.hooks = def.hooks ?? {};
    this.endpoints = def.endpoints ?? {};
    this.itemHooksOnLists = def.itemHooksOnLists ?? true;
    if (def.cfg && !def.cfg.zod) throw new Error(`cfg: "${def.singular}" debe definir el molde Zod de su configuración (cfg.zod)`);
    this.name = def.name ?? def.singular;
    for (const [name, ep] of Object.entries(this.endpoints)) {
      const seg = ep.path ?? name;
      if ((ACTIONS as readonly string[]).includes(name)) throw new Error(`Endpoint "${name}" choca con una acción CRUD`);
      if (RESERVED_SEGMENTS.has(seg)) throw new Error(`Endpoint "${name}": "${seg}" es un segmento reservado`);
    }
    registry.register(this);
  }

  /** Schemas Zod de la entidad (row / insert / update / pk / molde), iguales en client y server. */
  get zod(): SchemaZod {
    return schemaZod(this.pojo.schema);
  }

  /** Copia del pojo con un upsert parcial tipado aplicado (`Obj.insert` con el molde Zod). No muta el original. */
  patch(pojo: P, cambios: Patch<P>): P {
    return this.toPojo(pojo.toJSON()).insert(cambios as Patch<P>);
  }

  /** Aplica una lista de acciones `Obj` sobre el JSON del pojo y lo valida contra el molde. */
  aplicar(pojo: P, acciones: Parameters<typeof Obj.aplicar>[1]): P {
    return this.toPojo({}).replace(Obj.aplicar(pojo.toJSON(), acciones) as Record<string, unknown>);
  }

  /** Molde Zod de la configuración de la entidad (`plural/cfg`); `undefined` si la entidad no define `cfg`. */
  get cfgZod(): z.ZodType | undefined {
    return this.def.cfg?.zod;
  }

  /** Schema Zod de un PUT parcial de la config: cada llave opcional, y sólo las que el molde define. */
  get cfgPatchZod(): z.ZodType | undefined {
    const m = this.cfgZod;
    return m ? Obj.esquemaInsert(m) : undefined;
  }

  get meta(): SchemaMeta {
    return this.pojo.meta;
  }

  /** Convierte objetos planos en el POJO de la entidad (las acciones siempre trabajan con pojos). */
  toPojo(v: unknown): P {
    return this.pojo.fromJSON(v) as P;
  }

  toPojos(v: unknown): P[] {
    if (!Array.isArray(v)) throw new TypeError("Se esperaba un arreglo");
    return this.pojo.fromList(v) as P[];
  }

  /** Segmentos URL de las pks del pojo. */
  pkSegments(pojo: P): string[] {
    return pojo.pkValues().map((v) => encodeURIComponent(v instanceof Date ? v.toISOString() : String(v ?? "")));
  }

  /** Método y ruta (sin basePath) de una acción o endpoint. */
  route(name: Action | string, pojo?: P, sse = false): { method: HttpMethod; path: string } {
    const S = this.singularPath.join("/");
    const L = this.pluralPath.join("/");
    const pks = () => {
      if (!pojo) throw new Error(`"${name}" requiere el pojo para armar la ruta`);
      return this.pkSegments(pojo).join("/");
    };
    const fixed: Record<string, () => { method: HttpMethod; path: string }> = {
      get: () => ({ method: "GET", path: `${S}/${pks()}` }),
      post: () => ({ method: "POST", path: S }),
      put: () => ({ method: "PUT", path: `${S}/${pks()}` }),
      delete: () => ({ method: "DELETE", path: `${S}/${pks()}` }),
      list: () => ({ method: "GET", path: L }),
      query: () => ({ method: "POST", path: `${L}/query` }),
      postList: () => ({ method: "POST", path: L }),
      putList: () => ({ method: "PUT", path: L }),
      deleteList: () => ({ method: "DELETE", path: L }),
      doc: () => ({ method: "GET", path: `${L}/doc` }),
      docView: () => ({ method: "GET", path: `${L}/doc?v=1` }),
      getCfg: () => ({ method: "GET", path: `${L}/cfg` }),
      putCfg: () => ({ method: "PUT", path: `${L}/cfg` }),
    };
    let r: { method: HttpMethod; path: string };
    const known = fixed[name];
    if (known) r = known();
    else {
      const ep = this.endpoints[name];
      if (!ep) throw new Error(`"${this.singular}" no tiene la acción/endpoint "${name}"`);
      const seg = ep.path ?? name;
      r = { method: ep.method, path: ep.scope === "one" ? `${S}/${pks()}/${seg}` : `${L}/${seg}` };
    }
    if (sse) r.path += "/sse";
    return r;
  }

  /** Resuelve método + segmentos (ya sin basePath) a una acción. El plural tiene prioridad. */
  match(method: string, segs: string[]): RouteMatch | null {
    let sse = false;
    if (segs.at(-1) === "sse") {
      sse = true;
      segs = segs.slice(0, -1);
    }
    const startsWith = (prefix: string[]) => prefix.length <= segs.length && prefix.every((p, i) => p === segs[i]);
    const npk = this.meta.pks.length;
    const M = method.toUpperCase();
    if (startsWith(this.pluralPath)) {
      const rest = segs.slice(this.pluralPath.length);
      if (rest.length === 0) {
        const name = ({ GET: "list", POST: "postList", PUT: "putList", DELETE: "deleteList" } as Record<string, Action>)[M];
        if (name) return { name, pks: [], sse };
      }
      if (rest.length === 1) {
        if (rest[0] === "query" && (M === "POST" || M === "GET")) return { name: "query", pks: [], sse };
        if (rest[0] === "doc" && M === "GET") return { name: "doc", pks: [], sse };
        if (rest[0] === "cfg" && this.def.cfg && M === "GET") return { name: "getCfg", pks: [], sse };
        if (rest[0] === "cfg" && this.def.cfg && M === "PUT") return { name: "putCfg", pks: [], sse };
        const ep = this.#findEndpoint(rest[0] ?? "", "many", M);
        if (ep) return { name: ep[0], endpoint: ep[1], pks: [], sse };
      }
    }
    if (startsWith(this.singularPath)) {
      const rest = segs.slice(this.singularPath.length).map(decodeURIComponent);
      if (rest.length === 0 && M === "POST") return { name: "post", pks: [], sse };
      if (rest.length === npk) {
        const name = ({ GET: "get", PUT: "put", DELETE: "delete" } as Record<string, Action>)[M];
        if (name) return { name, pks: rest, sse };
      }
      if (rest.length === npk + 1) {
        const ep = this.#findEndpoint(rest[npk] ?? "", "one", M);
        if (ep) return { name: ep[0], endpoint: ep[1], pks: rest.slice(0, npk), sse };
      }
    }
    return null;
  }

  #findEndpoint(seg: string, scope: "one" | "many", method: string): [string, EndpointDef<P>] | undefined {
    return Object.entries(this.endpoints).find(([n, e]) => (e.path ?? n) === seg && e.scope === scope && e.method === method);
  }

  /** Pojo con las pks tomadas de los segmentos de URL (sobre un body opcional). */
  pojoFromPks(pks: string[], body?: unknown): P {
    const p = this.toPojo(body && typeof body === "object" && !Array.isArray(body) ? body : {});
    const self = p as unknown as Record<string, unknown>;
    this.meta.pks.forEach((k, i) => (self[k] = pks[i]));
    return p;
  }
}

/** Con `pojo` (clase) la entidad queda tipada por la clase; con `schema` (JSON) el POJO se genera y se tipa por el schema. */
export function defineEntity<P extends Pojo>(def: EntityDef<P> & { pojo: PojoClass<P> }): Entity<P>;
export function defineEntity<const S extends Schema>(def: Omit<EntityDef<PojoOf<S>>, "pojo" | "schema"> & { schema: S }): Entity<PojoOf<S>>;
export function defineEntity(def: EntityDef<any>): Entity<any> {
  return new Entity(def);
}
