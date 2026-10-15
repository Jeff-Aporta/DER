/**
 * Conexión (Kysely) + motor + registro de controllers (para resolver relaciones entre entidades).
 * Agnóstico: las fábricas concretas viven en `server/sqlite`, `server/pg`, `server/pglite`.
 */
import { Kysely } from "kysely";
import type { Pojo } from "@Jeff-Aporta/DER/src/01 objects/pojo.ts";
import type { PojoClass } from "@Jeff-Aporta/DER/src/00 common/schemas.ts";
import type { DatabaseOptions, Engine, IdentifierCase, ServerCtx } from "@Jeff-Aporta/DER/src/02 controllers/server/schemas.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02 controllers/server/controller.ts";

/**
 * Registro GLOBAL (todas las bases): los controllers pueden vivir en bases, motores y credenciales distintos
 * y aun así relacionarse por sus POJOs.
 */
const globalRegistry = new Map<PojoClass<any>, ServerController<any>>();

/** Todos los controllers registrados (de todas las bases). */
export function registeredControllers(): ServerController<any>[] {
  return [...globalRegistry.values()];
}

/** Controller registrado para un POJO en cualquier base (o `undefined`). */
export function findController<P extends Pojo>(pojo: PojoClass<P>): ServerController<P> | undefined {
  return globalRegistry.get(pojo) as ServerController<P> | undefined;
}

export class Database {
  readonly kysely: Kysely<any>;
  readonly engine: Engine;
  readonly identifierCase: IdentifierCase;
  readonly #controllers = new Map<PojoClass<any>, ServerController<any>>();

  constructor(opts: DatabaseOptions) {
    this.engine = opts.engine;
    this.kysely = new Kysely<any>({ dialect: opts.dialect });
    this.identifierCase = opts.identifierCase ?? "preserve";
  }

  register(ctrl: ServerController<any>): void {
    this.#controllers.set(ctrl.entity.pojo, ctrl);
    globalRegistry.set(ctrl.entity.pojo, ctrl);
  }

  /** Controller de un POJO: primero el de esta base y, si no, el de cualquier otra (relaciones cross-db). */
  controllerFor<P extends Pojo>(pojo: PojoClass<P>): ServerController<P> {
    const c = this.#controllers.get(pojo) ?? globalRegistry.get(pojo);
    if (!c) throw new Error(`No hay ServerController registrado para ${pojo.name}`);
    return c as ServerController<P>;
  }

  get controllers(): ServerController<any>[] {
    return [...this.#controllers.values()];
  }

  /**
   * Seed de todos los controllers de esta base y, propagado, de todo lo que sus `getPropagation` /
   * `setPropagation` alcanzan (aunque viva en otra base): cada controller crea su tabla en SU base, una vez.
   */
  async seed(visited: Set<ServerController<any>> = new Set()): Promise<void> {
    for (const c of this.#controllers.values()) await c.seed({}, visited);
  }

  /**
   * Transacción que se puede compartir entre controllers:
   * `db.transaction(async (tx) => { await a.post(x, tx); await b.postList(ys, tx); })`
   */
  transaction<T>(fn: (tx: Partial<ServerCtx>) => Promise<T>): Promise<T> {
    return this.kysely.transaction().execute((trx) => fn({ exec: trx, inTransaction: true }));
  }

  destroy(): Promise<void> {
    return this.kysely.destroy();
  }
}
