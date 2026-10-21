/**
 * Plugin de permisos: el JSON TRANSVERSAL. DER de permisos (destilado de SEG de ISS, con ids únicos string):
 *
 *   permisos_grupos (igrupo, nombre)                                        ← grupo al que pertenecen los roles
 *   permisos_roles (irol, igrupo, nombre, bactivo)                          ← cada rol pertenece a un grupo
 *   permisos_rolesusuario (iusuario, irol, finicial, ffinal, bprincipal)    ← vigencia y rol principal
 *   permisos_accionesrol (irol, iaccion, valor)                             ← iaccion = id de ruta (o su alias) o "*"
 *
 * El rol base (default `USR`, configurable) define los valores por defecto de todos: efectivo(R) = (base − ids de R) + R;
 * un rol particular no puede repetir un valor que ya trae el base. Todas las entidades son administrables por CRUD (un rol
 * con permiso sobre ellas edita el DER). Paths irregulares: `GET permisos` (perfil; `?catalogo=1`) y `PUT permisos` (carga
 * del DER). Hermético: la relación `usuario` apunta a `identity.usuarios` si ese plugin está registrado. Sólo `zod`.
 *
 * ```ts
 * const permisos = createClient(permissions, { baseUrl: "/api", headers: auth.headers });
 * const { perms } = await permisos.profile();
 * await permisos.load({ roles: [...], acciones: [...] });
 * await permisos.controllers.roles.query({ include: { acciones: true } });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/permissions.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type CatalogEntry, type DerLoad, type DerLoadResult, type SessionProfile, ZDerLoad } from "@Jeff-Aporta/DER/src/03-plugins/permissions/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/permissions/schemas.ts";

/** JSON transversal de permisos: las cuatro entidades del DER (expuestas y administrables) y los paths `permisos`. */
export const permissions: PluginDef = {
  name: "permissions",
  entities: {
    grupos: {
      name: "permisos.grupo",
      singular: "permisos/grupo",
      plural: "permisos/grupos",
      exposed: true,
      administrable: true,
      schema: {
        columns: { igrupo: { type: "string", pk: true, length: 60 }, nombre: { type: "string", length: 200 } },
        relations: { roles: { kind: "many", target: "permisos.rol", on: { igrupo: "igrupo" } } },
      },
      security: true,
    },
    roles: {
      name: "permisos.rol",
      singular: "permisos/rol",
      plural: "permisos/roles",
      exposed: true,
      administrable: true,
      schema: {
        columns: { irol: { type: "string", pk: true, length: 60 }, igrupo: { type: "string", length: 60, nullable: false }, nombre: { type: "string", length: 200 }, bactivo: { type: "bool", default: true } },
        relations: { acciones: { kind: "many", target: "permisos.accion", on: { irol: "irol" } }, grupo: { kind: "one", target: "permisos.grupo", on: { igrupo: "igrupo" } } },
      },
      security: true,
    },
    rolesUsuario: {
      name: "permisos.rolusuario",
      singular: "permisos/rolusuario",
      plural: "permisos/rolesusuario",
      exposed: true,
      administrable: true,
      schema: {
        columns: { iusuario: { type: "string", pk: true, length: 120 }, irol: { type: "string", pk: true, length: 60 }, finicial: { type: "datetime" }, ffinal: { type: "datetime" }, bprincipal: { type: "bool", default: false } },
        relations: { rol: { kind: "one", target: "permisos.rol", on: { irol: "irol" } }, usuario: { kind: "one", target: "identity.usuarios", on: { iusuario: "iusuario" } } },
      },
      security: true,
    },
    acciones: {
      name: "permisos.accion",
      singular: "permisos/accion",
      plural: "permisos/acciones",
      exposed: true,
      administrable: true,
      schema: { columns: { irol: { type: "string", pk: true, length: 60 }, iaccion: { type: "string", pk: true, length: 300 }, valor: { type: "json" } } },
      security: true,
    },
  },
  /** Un solo recurso, `permisos`: el verbo HTTP decide la operación (sin sufijos de acción en la ruta). */
  irregularPaths: {
    profile: {
      method: "GET",
      path: "permisos",
      ops: {
        /** `GET /permisos`: perfil de la sesión (anónimo si no hay token). */
        profile(this: ClientPlugin): Promise<SessionProfile> {
          return this.call<SessionProfile>("profile");
        },
        /** `GET /permisos?catalogo=1`: acciones de seguridad y sus rutas (quien puede cargar el DER). */
        catalog(this: ClientPlugin): Promise<CatalogEntry[]> {
          return this.call<CatalogEntry[]>("profile", { catalogo: "1" });
        },
      },
    },
    load: {
      method: "PUT",
      path: "permisos",
      security: true,
      zod: ZDerLoad,
      ops: {
        /** `PUT /permisos`: carga el DER (validado en el cliente con el mismo Zod que el server). */
        load(this: ClientPlugin, der: DerLoad): Promise<DerLoadResult> {
          return this.call<DerLoadResult>("load", der);
        },
      },
    },
  },
};
