/**
 * Registro GLOBAL (singleton): todo lo que existe se registra aquí y desde aquí se recupera.
 *
 * - Entidades por su plural (la ruta plural: `productos`, `permisos/roles`): `defineEntity` las registra; dos entidades
 *   con el mismo plural es un error (el consumidor define otro plural). Desde cualquier controller se obtienen
 *   instancias de otra entidad: `registry.pojo("productos", { nombre: "A" })`.
 * - POJOs por nombre de entidad (`name`, default `singular`): es lo que resuelve `RelationDef.target` en formato string.
 * - Puertas de seguridad de libre definición (`extract`, `protected`, `permissions`): los plugins aportan
 *   implementaciones y el consumidor decide cuál usa (o la suya). Sin `extract` no hay seguridad.
 * - `session`: singleton de la sesión actual (lado cliente, o un proceso de un solo usuario); en el server la sesión
 *   de cada request viaja en el `ctx`.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/objetos.md
 */
import type { AuthDecision, PermissionContext, PojoClass, RegisteredEntity, SecurityHooks, SessionInfo } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import type { Pojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";

class Registry {
  readonly #entities = new Map<string, Entity<any>>();
  readonly #pojos = new Map<string, PojoClass<any>>();
  readonly #security: SecurityHooks = {};
  /** Sesión actual (singleton). `null` = anónimo. */
  session: SessionInfo | null = null;

  /** Registra la entidad por su plural y su POJO por su nombre. Lanza si otro plural o nombre ya existe. */
  register(entity: Entity<any>): void {
    const key = entity.pluralPath.join("/");
    const previa = this.#entities.get(key);
    if (previa && previa !== entity) throw new Error(`Ya existe una entidad con el plural "${key}" (${previa.name}); defina otro plural para "${entity.name}"`);
    const pojo = this.#pojos.get(entity.name);
    if (pojo && pojo !== entity.pojo) throw new Error(`Ya existe otra entidad con el nombre "${entity.name}"`);
    this.#entities.set(key, entity);
    this.#pojos.set(entity.name, entity.pojo);
  }

  /** Registra un POJO bajo un nombre (para `target: "nombre"` sin entidad). */
  registerPojo(name: string, cls: PojoClass<any>): void {
    this.#pojos.set(name, cls);
  }

  /** ¿Hay una entidad registrada con ese plural? */
  has(plural: string): boolean {
    return this.#entities.has(plural);
  }

  /** Entidad por su plural (lanza si no existe). */
  entity<P extends Pojo = Pojo>(plural: string): Entity<P> {
    const e = this.#entities.get(plural);
    if (!e) throw new Error(`No hay una entidad registrada con el plural "${plural}"`);
    return e as Entity<P>;
  }

  /** Entidad por su nombre (`name`), o `undefined`. */
  byName<P extends Pojo = Pojo>(name: string): Entity<P> | undefined {
    return [...this.#entities.values()].find((e) => e.name === name) as Entity<P> | undefined;
  }

  /** Todas las entidades registradas, con su clave (plural). */
  entities(): RegisteredEntity[] {
    return [...this.#entities].map(([key, entity]) => ({ key, entity }));
  }

  /** Instancia del POJO de la entidad `plural` con el contenido dado (indirecta: nunca la clase). */
  pojo<P extends Pojo = Pojo>(plural: string, content?: unknown): P {
    return this.entity<P>(plural).toPojo(content ?? {});
  }

  /** Clase del POJO registrado bajo `name` (lo que usan las relaciones). */
  pojoClass(name: string): PojoClass<any> {
    const c = this.#pojos.get(name);
    if (!c) throw new Error(`No hay POJO registrado como "${name}" (¿falta defineEntity?)`);
    return c;
  }

  /** Puertas de seguridad vigentes. */
  get security(): SecurityHooks {
    return this.#security;
  }

  /** Define (o reemplaza) puertas: `secure({ extract, protected, permissions })`. `null` las borra todas. */
  secure(hooks: SecurityHooks | null): void {
    if (hooks === null) {
      delete this.#security.extract;
      delete this.#security.protected;
      delete this.#security.permissions;
      return;
    }
    if (hooks.extract !== undefined) this.#security.extract = hooks.extract;
    if (hooks.protected !== undefined) this.#security.protected = hooks.protected;
    if (hooks.permissions !== undefined) this.#security.permissions = hooks.permissions;
  }

  /** ¿Hay sistema de seguridad conectado? (sin `extract`, toda ruta se sirve). */
  get secured(): boolean {
    return this.#security.extract !== undefined;
  }

  /** ¿`info` es una sesión válida? (`protected` del consumidor, o `info !== null`). */
  async isLogged(info: SessionInfo | null): Promise<boolean> {
    if (this.#security.protected) return await this.#security.protected(info);
    return info !== null;
  }

  /** Decisión de `permissions()` para la sesión; sin puerta, permitido. */
  async decide(info: SessionInfo | null, action: string, entity: string | null = null, ctx: PermissionContext = {}): Promise<AuthDecision> {
    if (!this.#security.permissions) return { allowed: true, value: true };
    return await this.#security.permissions(info, action, entity, ctx);
  }

  /** Olvida entidades, POJOs, puertas y sesión (pruebas). */
  clear(): void {
    this.#entities.clear();
    this.#pojos.clear();
    this.secure(null);
    this.session = null;
  }
}

/** El registro global: un singleton por proceso. */
export const registry: Registry = new Registry();
