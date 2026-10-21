/**
 * Conexión (Kysely) + motor + registro de controllers (para resolver relaciones entre entidades, por POJO o por plural).
 * Agnóstico: las fábricas concretas viven en `server/sqlite.ts`, `pg.ts`, `pglite.ts`, `mysql.ts` y `mssql.ts`.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import { Kysely } from "kysely";
import type { Pojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
import type { PojoClass } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { CfgTableDef, DatabaseOptions, Engine, IdentifierCase, ServerCtx } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";

/** Registro GLOBAL (todas las bases): los controllers pueden vivir en bases, motores y credenciales distintos y aun así relacionarse. */
const globalRegistry = new Map<PojoClass<any>, ServerController<any>>();

/** Todos los controllers registrados (de todas las bases). */
export function registeredControllers(): ServerController<any>[] {
  return [...globalRegistry.values()];
}

/** Controller registrado para un POJO (clase) o para el plural de su entidad, en cualquier base (o `undefined`). */
export function findController<P extends Pojo>(key: PojoClass<P> | string): ServerController<P> | undefined {
  if (typeof key !== "string") return globalRegistry.get(key) as ServerController<P> | undefined;
  return registeredControllers().find((c) => c.entity.pluralPath.join("/") === key) as ServerController<P> | undefined;
}

/** Conexión Kysely + motor + registro de los controllers de esa base (y tabla de cfg por defecto). */
export class Database {
  /** Instancia de Kysely (ejecutor por defecto). */
  readonly kysely: Kysely<any>;
  /** Motor (primitivas SQL) de esta base. */
  readonly engine: Engine;
  /** Caso por defecto de tablas y columnas para sus controllers. */
  readonly identifierCase: IdentifierCase;
  /** Tabla de configuración de las entidades (`plural/cfg`) por defecto para sus controllers. */
  readonly cfg: CfgTableDef | undefined;
  readonly #controllers = new Map<PojoClass<any>, ServerController<any>>();

  constructor(opts: DatabaseOptions) {
    this.engine = opts.engine;
    this.kysely = new Kysely<any>({ dialect: opts.dialect });
    this.identifierCase = opts.identifierCase ?? "preserve";
    this.cfg = opts.cfg;
  }

  /** Registra un controller en esta base y en el registro global (lo hace el constructor del controller). */
  register(ctrl: ServerController<any>): void {
    this.#controllers.set(ctrl.entity.pojo, ctrl);
    globalRegistry.set(ctrl.entity.pojo, ctrl);
  }

  /** Controller de un POJO (clase) o de un plural: primero el de esta base y, si no, el de cualquier otra (relaciones cross-db). */
  controllerFor<P extends Pojo>(key: PojoClass<P> | string): ServerController<P> {
    const own = typeof key === "string" ? this.controllers.find((c) => c.entity.pluralPath.join("/") === key) : this.#controllers.get(key);
    const c = own ?? findController(key);
    if (!c) throw new Error(`No hay ServerController registrado para ${typeof key === "string" ? key : key.name}`);
    return c as ServerController<P>;
  }

  /** Controllers registrados en esta base. */
  get controllers(): ServerController<any>[] {
    return [...this.#controllers.values()];
  }

  /** Seed de todos los controllers de esta base y, propagado, de todo lo que sus propagaciones alcanzan (aunque viva en otra base). */
  async seed(visited: Set<ServerController<any>> = new Set()): Promise<void> {
    for (const c of this.#controllers.values()) await c.seed({}, visited);
  }

  /** Transacción que se puede compartir entre controllers: `db.transaction(async (tx) => { await a.post(x, tx); })`. */
  transaction<T>(fn: (tx: Partial<ServerCtx>) => Promise<T>): Promise<T> {
    return this.kysely.transaction().execute((trx) => fn({ exec: trx, inTransaction: true }));
  }

  /** Cierra la conexión. */
  destroy(): Promise<void> {
    return this.kysely.destroy();
  }
}
