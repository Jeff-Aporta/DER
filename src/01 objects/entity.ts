/**
 * Definición de una entidad REST: POJO, singular/plural, rutas, verificaciones compartidas y endpoints especiales.
 * Se define UNA vez y la reusan tanto el ClientController como el ServerController.
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
 * | endpoint    | def.method  | singular/pks.../nombre (one) ó plural/nombre (many) |
 *
 * Cualquier ruta + `/sse` es su variante Server-Sent Events.
 * Si singular === plural, el plural lleva el sufijo `pluralSuffix` (por defecto "s"): `dato/s`.
 */
import { type Pojo, registerPojo } from "@Jeff-Aporta/DER/src/01 objects/pojo.ts";
import {
  type Action,
  ACTIONS,
  type EndpointDef,
  type EntityDef,
  type Hooks,
  type HttpMethod,
  type PojoClass,
  type RouteMatch,
  type SchemaMeta,
  type SchemaZod,
} from "@Jeff-Aporta/DER/src/00 common/schemas.ts";
import type { z } from "zod";
import { Obj } from "@Jeff-Aporta/DER/src/00 common/obj.ts";
import type { Patch } from "@Jeff-Aporta/DER/src/00 common/schemas.ts";
import { schemaZod } from "@Jeff-Aporta/DER/src/01 objects/zod.ts";

const RESERVED_SEGMENTS = new Set(["query", "sse", "cfg", "doc"]);

export class Entity<P extends Pojo = Pojo> {
  readonly pojo: PojoClass<P>;
  readonly name: string;
  readonly singular: string;
  readonly plural: string;
  readonly singularPath: string[];
  readonly pluralPath: string[];
  readonly listColumns: string[];
  readonly pageSize: number;
  readonly maxPageSize: number;
  readonly hooks: Hooks<P>;
  readonly endpoints: Record<string, EndpointDef<P>>;
  readonly itemHooksOnLists: boolean;

  constructor(readonly def: EntityDef<P>) {
    this.pojo = def.pojo;
    this.singular = def.singular;
    this.plural = def.plural;
    for (const s of [def.singular, def.plural, def.singularSuffix, def.pluralSuffix]) {
      if (s !== undefined && !/^[A-Za-z0-9_.~-]+(\/[A-Za-z0-9_.~-]+)*$/.test(s)) {
        throw new Error(`Segmento de ruta inválido "${s}"`);
      }
    }
    const pluralSuffix = def.pluralSuffix ?? (def.singular === def.plural ? "s" : undefined);
    this.singularPath = [...def.singular.split("/"), ...(def.singularSuffix ? def.singularSuffix.split("/") : [])];
    this.pluralPath = [...def.plural.split("/"), ...(pluralSuffix ? pluralSuffix.split("/") : [])];
    if (this.singularPath.join("/") === this.pluralPath.join("/")) {
      throw new Error(`"${def.singular}": la ruta singular y plural no pueden ser iguales`);
    }
    const meta = this.meta;
    this.listColumns = def.listColumns ?? meta.persisted;
    for (const c of this.listColumns) {
      if (!meta.isColumn(c)) throw new Error(`listColumns: "${c}" no es una columna`);
    }
    this.pageSize = def.pageSize ?? 50;
    this.maxPageSize = def.maxPageSize ?? 1000;
    this.hooks = def.hooks ?? {};
    this.endpoints = def.endpoints ?? {};
    this.itemHooksOnLists = def.itemHooksOnLists ?? true;
    if (def.cfg?.column) {
      const c = meta.columns[def.cfg.column];
      if (!c || c.type !== "json" || c.virtual) throw new Error(`cfg.column: "${def.cfg.column}" debe ser una columna json persistida`);
    }
    this.name = def.name ?? def.singular;
    registerPojo(this.name, def.pojo);
    for (const [name, ep] of Object.entries(this.endpoints)) {
      const seg = ep.path ?? name;
      if ((ACTIONS as readonly string[]).includes(name)) throw new Error(`Endpoint "${name}" choca con una acción CRUD`);
      if (RESERVED_SEGMENTS.has(seg)) throw new Error(`Endpoint "${name}": "${seg}" es un segmento reservado`);
    }
  }

  /** Schemas Zod de la entidad (row / insert / update / pk / molde), iguales en client y server. */
  get zod(): SchemaZod {
    return schemaZod(this.pojo.schema);
  }

  /**
   * Copia del pojo con un upsert parcial tipado aplicado (`Obj.push` con el molde Zod). No muta el original.
   * Útil para armar el body de un PUT a partir de lo que se tiene.
   */
  patch(pojo: P, cambios: Patch<P>): P {
    return this.toPojo(pojo.toJSON()).push(cambios as Patch<P>);
  }

  /** Aplica una lista de acciones `Obj` sobre el JSON del pojo y lo valida contra el molde. */
  aplicar(pojo: P, acciones: Parameters<typeof Obj.aplicar>[1]): P {
    return this.toPojo({}).replace(Obj.aplicar(pojo.toJSON(), acciones) as Record<string, unknown>);
  }

  /** Molde Zod de la config (`cfg.zod` o el `zod` de la columna); `undefined` = JSON libre. */
  get cfgZod(): z.ZodType | undefined {
    const cfg = this.def.cfg;
    if (!cfg) return undefined;
    return cfg.zod ?? (cfg.column ? this.meta.column(cfg.column).zod : undefined);
  }

  /** Schema Zod de un PUT parcial de la config (cada llave opcional y `null` = quitar). */
  get cfgPatchZod(): z.ZodType | undefined {
    const m = this.cfgZod;
    return m ? Obj.esquemaPush(m) : undefined;
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
    return pojo.pkValues().map((v) =>
      encodeURIComponent(v instanceof Date ? v.toISOString() : String(v ?? ""))
    );
  }

  /** Método y ruta (sin basePath) de una acción o endpoint. */
  route(name: Action | string, pojo?: P, sse = false): { method: HttpMethod; path: string } {
    const S = this.singularPath.join("/");
    const L = this.pluralPath.join("/");
    const pks = () => {
      if (!pojo) throw new Error(`"${name}" requiere el pojo para armar la ruta`);
      return this.pkSegments(pojo).join("/");
    };
    let r: { method: HttpMethod; path: string };
    switch (name) {
      case "get":
        r = { method: "GET", path: `${S}/${pks()}` };
        break;
      case "post":
        r = { method: "POST", path: S };
        break;
      case "put":
        r = { method: "PUT", path: `${S}/${pks()}` };
        break;
      case "delete":
        r = { method: "DELETE", path: `${S}/${pks()}` };
        break;
      case "list":
        r = { method: "GET", path: L };
        break;
      case "query":
        r = { method: "POST", path: `${L}/query` };
        break;
      case "postList":
        r = { method: "POST", path: L };
        break;
      case "putList":
        r = { method: "PUT", path: L };
        break;
      case "doc":
        r = { method: "GET", path: `${L}/doc` };
        break;
      case "docView":
        r = { method: "GET", path: `${L}/doc?v=1` };
        break;
      case "getCfg":
        r = { method: "GET", path: `${S}/${pks()}/cfg` };
        break;
      case "putCfg":
        r = { method: "PUT", path: `${S}/${pks()}/cfg` };
        break;
      case "deleteList":
        r = { method: "DELETE", path: L };
        break;
      default: {
        const ep = this.endpoints[name];
        if (!ep) throw new Error(`"${this.singular}" no tiene la acción/endpoint "${name}"`);
        const seg = ep.path ?? name;
        r = { method: ep.method, path: ep.scope === "one" ? `${S}/${pks()}/${seg}` : `${L}/${seg}` };
      }
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
        const name = ({ GET: "list", POST: "postList", PUT: "putList", DELETE: "deleteList" } as Record<string, Action>)[
          M
        ];
        if (name) return { name, pks: [], sse };
      } else if (rest.length === 1) {
        if (rest[0] === "query" && (M === "POST" || M === "GET")) return { name: "query", pks: [], sse };
        if (rest[0] === "doc" && M === "GET") return { name: "doc", pks: [], sse };
        const seg = rest[0];
        const ep = seg === undefined ? undefined : this.findEndpoint(seg, "many", M);
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
        if (rest[npk] === "cfg" && this.def.cfg) {
          if (M === "GET") return { name: "getCfg", pks: rest.slice(0, npk), sse };
          if (M === "PUT") return { name: "putCfg", pks: rest.slice(0, npk), sse };
        }
        const seg = rest[npk];
        const ep = seg === undefined ? undefined : this.findEndpoint(seg, "one", M);
        if (ep) return { name: ep[0], endpoint: ep[1], pks: rest.slice(0, npk), sse };
      }
    }
    return null;
  }

  private findEndpoint(seg: string, scope: "one" | "many", method: string): [string, EndpointDef<P>] | undefined {
    return Object.entries(this.endpoints).find(([n, e]) =>
      (e.path ?? n) === seg && e.scope === scope && e.method === method
    );
  }

  /** Pojo con las pks tomadas de los segmentos de URL (sobre un body opcional). */
  pojoFromPks(pks: string[], body?: unknown): P {
    const p = this.toPojo(body && typeof body === "object" && !Array.isArray(body) ? body : {});
    const self = p as unknown as Record<string, unknown>;
    this.meta.pks.forEach((k, i) => (self[k] = pks[i]));
    return p;
  }
}

export function defineEntity<P extends Pojo>(def: EntityDef<P>): Entity<P> {
  return new Entity(def);
}
