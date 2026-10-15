/**
 * Plugin de permisos: evalúa la relación usuario → rol vigente (dentro del grupo configurado)
 * → vector de acciones, y la aplica como puerta `authorize` del Router a toda ruta con
 * `security.permissions`. Expone:
 *
 *   GET  /permisos            perfil de la sesión (público: sin token responde el perfil anónimo)
 *   GET  /permisos?catalogo=1 acciones evaluables (quien puede cargar el DER)
 *   PUT  /permisos            carga del DER completo (grupos, roles, rolesusuario, acciones) en una transacción
 *   CRUD + list de permisos/grupo(s), permisos/rol(es), permisos/rolusuario(rolesusuario), permisos/accion(es)
 */
import { HttpError, ValidationError } from "@Jeff-Aporta/DER/src/00 common/errors.ts";
import { ServerController } from "@Jeff-Aporta/DER/src/02 controllers/server/controller.ts";
import type { Database } from "@Jeff-Aporta/DER/src/02 controllers/server/database.ts";
import type { Router } from "@Jeff-Aporta/DER/src/02 controllers/server/router.ts";
import type { CanFn, Identity, RouteInfo, ServerCtx } from "@Jeff-Aporta/DER/src/02 controllers/server/schemas.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01 objects/zod.ts";
import type { Pojo } from "@Jeff-Aporta/DER/src/01 objects/pojo.ts";
import { type CatalogEntry, type DerLoad, type PermissionsConfig, type SessionProfile, ZDerLoad } from "@Jeff-Aporta/DER/src/03 plugins/permissions/schemas.ts";
import type { PermissionsPlugin } from "@Jeff-Aporta/DER/src/03 plugins/schemas.ts";
import { AccionRolEntity, GrupoEntity, RolEntity, RolUsuarioEntity, type Rol } from "@Jeff-Aporta/DER/src/03 plugins/permissions/Objetos/mod.ts";
import { decide } from "@Jeff-Aporta/DER/src/03 plugins/permissions/Controladores/rules.ts";

export function permissionsPlugin(cfg: PermissionsConfig & { db: Database }): PermissionsPlugin {
  const { db } = cfg;
  const grupo = cfg.grupo ?? "API";
  const rolBase = cfg.rolBase ?? "USR";
  const rolAdmin = cfg.rolAdmin ?? "ADMIN";
  const denyByDefault = cfg.denyByDefault ?? false;
  let router: Router | null = null;

  const grupos = new ServerController(GrupoEntity, { db, table: "permisos_grupos", security: true });
  const roles = new ServerController(RolEntity, { db, table: "permisos_roles", security: true });
  const rolesUsuario = new ServerController(RolUsuarioEntity, { db, table: "permisos_rolesusuario", security: true });
  const acciones = new ServerController(AccionRolEntity, { db, table: "permisos_accionesrol", security: true });

  /** Roles vigentes del usuario en el grupo configurado (activos, dentro de su vigencia), el principal primero. */
  async function rolesVigentes(iusuario: string): Promise<Rol[]> {
    const now = Date.now();
    const asignados = await rolesUsuario.select({ where: { iusuario }, include: { rol: true } });
    return asignados
      .filter((a) => (!a.finicial || a.finicial.getTime() <= now) && (!a.ffinal || a.ffinal.getTime() > now))
      .filter((a) => a.rol && a.rol.bactivo !== false && a.rol.igrupo && a.rol.igrupo === grupo)
      .sort((a, b) => Number(b.bprincipal ?? false) - Number(a.bprincipal ?? false))
      .flatMap((a) => (a.rol ? [a.rol] : []));
  }

  async function mapaDe(irol: string): Promise<Map<string, unknown>> {
    const filas = await acciones.select({ where: { irol } });
    return new Map(filas.flatMap((f) => (f.iaccion ? [[f.iaccion, f.valor] as const] : [])));
  }

  /** Matriz del usuario: la del rol base y la de su rol principal vigente (null = sólo base). */
  async function matrix(iusuario: string | null) {
    const base = await mapaDe(rolBase);
    const vigentes = iusuario ? await rolesVigentes(iusuario) : [];
    const principal = vigentes[0]?.irol ?? rolBase;
    const rol = principal === rolBase ? null : await mapaDe(principal);
    return { base, rol, irol: principal, roles: vigentes.flatMap((r) => (r.irol ? [r.irol] : [])) };
  }

  function rutasEvaluables(r: Router) {
    return r.routes.filter((x) => x.security.permissions);
  }

  /** Acción de seguridad de una ruta: la personalizada del registro o el id autogenerado. */
  const accionDe = (route: RouteInfo): string => route.security.action ?? route.id;

  /** Catálogo: cada acción (de rutas o sólo de código) con las rutas que la usan. */
  function catalogo(r: Router | null): CatalogEntry[] {
    const map = new Map<string, { id: string; method: string; path: string }[]>();
    for (const route of r ? rutasEvaluables(r) : []) {
      const k = accionDe(route);
      map.set(k, [...(map.get(k) ?? []), { id: route.id, method: route.method, path: route.path }]);
    }
    for (const a of cfg.actions ?? []) if (!map.has(a)) map.set(a, []);
    return [...map].map(([id, routes]) => ({ id, routes }));
  }

  async function profile(identity: Identity | null): Promise<SessionProfile> {
    const m = await matrix(identity?.id ?? null);
    const perms: Record<string, unknown> = {};
    if (identity) {
      for (const { id, routes } of catalogo(router)) {
        // una acción compartida por varios verbos se informa por verbo (como un valor partido)
        const metodos = [...new Set(routes.length ? routes.map((r) => r.method) : ["GET"])];
        const valor = (m2: string) => {
          const d = decide(m.base, m.rol, id, m2, denyByDefault);
          return d.allowed ? d.value ?? true : false;
        };
        perms[id] = metodos.length === 1 ? valor(metodos[0] ?? "GET") : Object.fromEntries(metodos.map((x) => [x, valor(x)]));
      }
    }
    return { usuario: identity?.id ?? null, irol: m.irol, igrupo: grupo, roles: m.roles, perms };
  }

  /** Upsert por pk dentro de la transacción. */
  async function upsert<P extends Pojo>(ctrl: ServerController<P>, data: Record<string, unknown>, tx: Partial<ServerCtx>) {
    const pojo = ctrl.entity.toPojo(data);
    const existe = await ctrl.get(pojo.pkOnly(), { ...tx, include: {} });
    if (existe) await ctrl.put(pojo, tx);
    else await ctrl.post(pojo, tx);
  }

  async function load(der: unknown) {
    const parsed = ZDerLoad.safeParse(der);
    if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
    const data: DerLoad = parsed.data;
    if (router) {
      const ids = new Set(catalogo(router).map((a) => a.id));
      const desconocidas = (data.acciones ?? []).map((a) => a.iaccion).filter((id) => id !== "*" && !ids.has(id));
      if (desconocidas.length) throw new ValidationError(`Acciones no declaradas: ${[...new Set(desconocidas)].join(", ")}`);
    }
    await db.transaction(async (tx) => {
      for (const g of data.grupos ?? []) await upsert(grupos, { ...g }, tx);
      for (const r of data.roles ?? []) await upsert(roles, { ...r }, tx);
      for (const ru of data.rolesusuario ?? []) await upsert(rolesUsuario, { ...ru }, tx);
      for (const a of data.acciones ?? []) await upsert(acciones, { ...a }, tx);
    });
    return {
      grupos: data.grupos?.length ?? 0,
      roles: data.roles?.length ?? 0,
      rolesusuario: data.rolesusuario?.length ?? 0,
      acciones: data.acciones?.length ?? 0,
    };
  }

  return {
    name: "permissions",
    grupos,
    roles,
    rolesUsuario,
    acciones,
    controllers: [grupos, roles, rolesUsuario, acciones],
    profile,
    load,
    routes: [
      // un solo recurso: el verbo HTTP decide (sin sufijos de acción en la ruta)
      {
        method: "GET",
        path: "permisos",
        async handler({ query }, ctx) {
          router ??= this;
          const identity = (ctx.state["identity"] as Identity | null | undefined) ?? null;
          if (!query.has("catalogo")) return profile(identity);
          // `?catalogo=1`: lo administra quien puede cargar el DER (misma acción que `PUT /permisos`)
          if (!identity) throw new HttpError(401, "Requiere autenticación");
          const carga = this.routes.find((r) => r.method === "PUT" && r.path === "permisos");
          const d = await (ctx.state["can"] as CanFn)(carga ? accionDe(carga) : "PUT:/permisos", "PUT");
          if (!d.allowed) throw new HttpError(403, d.reason ?? "Sin permiso");
          return catalogo(this);
        },
      },
      {
        method: "PUT",
        path: "permisos",
        security: true,
        handler({ body }) {
          router ??= this;
          return load(body);
        },
      },
    ],
    async authorize(route, identity) {
      const m = await matrix(identity.id);
      return decide(m.base, m.rol, accionDe(route), route.method, denyByDefault);
    },
    async can(identity, action, method) {
      const m = await matrix(identity.id);
      return decide(m.base, m.rol, action, method, denyByDefault);
    },
    async seed(r) {
      router = r;
      await load({
        grupos: [{ igrupo: grupo, nombre: grupo }],
        roles: [
          { irol: rolBase, igrupo: grupo, nombre: "Base (valores por defecto)" },
          { irol: rolAdmin, igrupo: grupo, nombre: "Administrador" },
        ],
        acciones: [{ irol: rolAdmin, iaccion: "*", valor: true }],
        rolesusuario: (cfg.admins ?? []).map((iusuario) => ({ iusuario, irol: rolAdmin, bprincipal: true })),
      });
    },
  };
}
