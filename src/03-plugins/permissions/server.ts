/**
 * Plugin de permisos (server): evalúa usuario → rol vigente (dentro del grupo configurado) → vector de acciones, y lo ofrece
 * como puerta `permissions` del registro (entra si el consumidor no definió la suya). Hermético respecto de identidad: sólo
 * necesita `info.id` de la sesión, venga de donde venga.
 *
 * ```ts
 * const permisos = createServer(permissionsServer, { db, cfg: { grupo: "API", admins: ["admin"] } });
 * const router = createRouter(ctrls, { basePath: "/api", plugins: [auth, permisos] });
 * await router.seed();   // grupo, rol base, rol administrador ("*": true) y los admins
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
import { HttpError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { AuthDecision, PermissionContext, SessionInfo } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { Pojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { ExtraRouteInput, RouteInfo, ServerCtx, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { permissions } from "@Jeff-Aporta/DER/src/03-plugins/permissions/index.ts";
import { decide } from "@Jeff-Aporta/DER/src/03-plugins/permissions/rules.ts";
import { type CatalogEntry, type DerLoad, type DerLoadResult, type PermissionMatrix, type PermissionsConfig, type PermissionsResolved, type SessionProfile, ZDerLoad, ZPermissionsConfig } from "@Jeff-Aporta/DER/src/03-plugins/permissions/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/permissions/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/permissions/rules.ts";

function cfg(p: ServerPlugin): PermissionsResolved {
  const c = p.cfg as PermissionsConfig;
  return { grupo: c.grupo ?? "API", rolBase: c.rolBase ?? "USR", rolAdmin: c.rolAdmin ?? "ADMIN", denyByDefault: c.denyByDefault ?? false, admins: c.admins ?? [], actions: c.actions ?? [] };
}

/** Roles vigentes del usuario en el grupo configurado (activos, dentro de su vigencia), el principal primero. */
async function rolesVigentes(p: ServerPlugin, iusuario: string): Promise<string[]> {
  const now = Date.now();
  const grupo = cfg(p).grupo;
  const asignados = await p.controllers["rolesUsuario"]!.select({ where: { iusuario }, include: { rol: true } });
  return asignados
    .filter((a) => (!a.finicial || a.finicial.getTime() <= now) && (!a.ffinal || a.ffinal.getTime() > now))
    .filter((a) => a.rol && a.rol.bactivo !== false && a.rol.igrupo === grupo)
    .sort((a, b) => Number(b.bprincipal ?? false) - Number(a.bprincipal ?? false))
    .flatMap((a) => (a.rol?.irol ? [String(a.rol.irol)] : []));
}

async function mapaDe(p: ServerPlugin, irol: string): Promise<Map<string, unknown>> {
  const filas = await p.controllers["acciones"]!.select({ where: { irol } });
  return new Map(filas.flatMap((f) => (f.iaccion ? [[String(f.iaccion), f.valor] as const] : [])));
}

/** Matriz del usuario: la del rol base y la de su rol principal vigente (null = sólo base). */
async function matrix(p: ServerPlugin, iusuario: string | null): Promise<PermissionMatrix> {
  const { rolBase } = cfg(p);
  const base = await mapaDe(p, rolBase);
  const roles = iusuario ? await rolesVigentes(p, iusuario) : [];
  const principal = roles[0] ?? rolBase;
  const rol = principal === rolBase ? null : await mapaDe(p, principal);
  return { base, rol, irol: principal, roles };
}

/** Acción de seguridad de una ruta: la personalizada del registro o el id autogenerado. */
function accionDe(route: RouteInfo): string {
  return route.security.action ?? route.id;
}

/** Catálogo: cada acción (de rutas evaluables o sólo de código) con las rutas que la usan. */
function catalogo(p: ServerPlugin): CatalogEntry[] {
  const map = new Map<string, { id: string; method: string; path: string }[]>();
  for (const route of p.router?.routes.filter((x) => x.security.permissions) ?? []) {
    const k = accionDe(route);
    map.set(k, [...(map.get(k) ?? []), { id: route.id, method: route.method, path: route.path }]);
  }
  for (const a of cfg(p).actions) if (!map.has(a)) map.set(a, []);
  return [...map].map(([id, routes]) => ({ id, routes }));
}

/** Upsert por pk dentro de la transacción. */
async function upsert<P extends Pojo>(ctrl: ServerController<P>, data: Record<string, unknown>, tx: Partial<ServerCtx>): Promise<void> {
  const pojo = ctrl.pojo(data);
  const existe = await ctrl.get(pojo.pkOnly(), { ...tx, include: {} });
  if (existe) await ctrl.put(pojo, tx);
  else await ctrl.post(pojo, tx);
}

export const permissionsServer: ServerPluginDef = Obj.insert(permissions, {
  cfg: ZPermissionsConfig,
  routes: {
    profile: {
      async handler(this: ServerPlugin, { query }: ExtraRouteInput, ctx: ServerCtx) {
        const info = (ctx.state["session"] as SessionInfo | null | undefined) ?? null;
        if (!query.has("catalogo")) return this["profile"](info);
        // `?catalogo=1`: lo administra quien puede cargar el DER (misma acción que `PUT /permisos`)
        if (!info) throw new HttpError(401, "Requiere autenticación");
        const carga = this.router?.routes.find((r) => r.method === "PUT" && r.path === "permisos");
        const d = await this["can"](info, carga ? accionDe(carga) : "PUT:/permisos", "PUT");
        if (!d.allowed) throw new HttpError(403, d.reason ?? "Sin permiso");
        return catalogo(this);
      },
    },
    load: {
      handler(this: ServerPlugin, { body }: ExtraRouteInput) {
        return this["load"](body);
      },
    },
  },
  security: {
    /** Puerta `permissions`: decide con la matriz del usuario de la sesión y el verbo de la petición. */
    permissions(this: ServerPlugin, info: SessionInfo | null, action: string, _entity: string | null, pctx: PermissionContext): Promise<AuthDecision> {
      if (!info) return Promise.resolve({ allowed: false, reason: "Requiere autenticación" });
      return this["can"](info, action, pctx.method ?? "GET");
    },
  },
  ops: {
    /** Decisión para una acción de seguridad (ruta o capacidad de código) y un verbo. */
    async can(this: ServerPlugin, info: SessionInfo, action: string, method = "GET"): Promise<AuthDecision> {
      const m = await matrix(this, info.id);
      return decide(m.base, m.rol, action, method, cfg(this).denyByDefault);
    },
    /** Perfil de la sesión (lo mismo que `GET /permisos`). */
    async profile(this: ServerPlugin, info: SessionInfo | null): Promise<SessionProfile> {
      const m = await matrix(this, info?.id ?? null);
      const perms: Record<string, unknown> = {};
      if (info) {
        for (const { id, routes } of catalogo(this)) {
          // una acción compartida por varios verbos se informa por verbo (como un valor partido)
          const metodos = [...new Set(routes.length ? routes.map((r) => r.method) : ["GET"])];
          const valor = (verbo: string) => {
            const d = decide(m.base, m.rol, id, verbo, cfg(this).denyByDefault);
            return d.allowed ? d.value ?? true : false;
          };
          perms[id] = metodos.length === 1 ? valor(metodos[0] ?? "GET") : Object.fromEntries(metodos.map((x) => [x, valor(x)]));
        }
      }
      return { usuario: info?.id ?? null, irol: m.irol, igrupo: cfg(this).grupo, roles: m.roles, perms };
    },
    /** Carga del DER (lo mismo que `PUT /permisos`): upsert de grupos, roles, rolesusuario y acciones en una transacción. */
    async load(this: ServerPlugin, der: unknown): Promise<DerLoadResult> {
      const parsed = ZDerLoad.safeParse(der);
      if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
      const data: DerLoad = parsed.data;
      if (this.router) {
        const ids = new Set(catalogo(this).map((a) => a.id));
        const desconocidas = (data.acciones ?? []).map((a) => a.iaccion).filter((id) => id !== "*" && !ids.has(id));
        if (desconocidas.length) throw new ValidationError(`Acciones no declaradas: ${[...new Set(desconocidas)].join(", ")}`);
      }
      const c = this.controllers;
      await this.db.transaction(async (tx) => {
        for (const g of data.grupos ?? []) await upsert(c["grupos"]!, { ...g }, tx);
        for (const r of data.roles ?? []) await upsert(c["roles"]!, { ...r }, tx);
        for (const ru of data.rolesusuario ?? []) await upsert(c["rolesUsuario"]!, { ...ru }, tx);
        for (const a of data.acciones ?? []) await upsert(c["acciones"]!, { ...a }, tx);
      });
      return { grupos: data.grupos?.length ?? 0, roles: data.roles?.length ?? 0, rolesusuario: data.rolesusuario?.length ?? 0, acciones: data.acciones?.length ?? 0 };
    },
    /** Catálogo de acciones evaluables (rutas con `permissions` + las de código). */
    catalog(this: ServerPlugin): CatalogEntry[] {
      return catalogo(this);
    },
  },
  /** Grupo, rol base, rol administrador (`"*": true`) y los admins configurados. */
  async seed(this: ServerPlugin) {
    const { grupo, rolBase, rolAdmin, admins } = cfg(this);
    await this["load"]({ grupos: [{ igrupo: grupo, nombre: grupo }], roles: [{ irol: rolBase, igrupo: grupo, nombre: "Base (valores por defecto)" }, { irol: rolAdmin, igrupo: grupo, nombre: "Administrador" }], acciones: [{ irol: rolAdmin, iaccion: "*", valor: true }], rolesusuario: admins.map((iusuario) => ({ iusuario, irol: rolAdmin, bprincipal: true })) });
  },
}) as ServerPluginDef;
