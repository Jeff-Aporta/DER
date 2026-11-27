/**
 * Plugin de permisos RBAC: el JSON TRANSVERSAL. TODO el sistema de roles y permisos vive en la base; el codigo
 * solo pide ACCIONES (`usuarios.rol`, `tiquetes.ver`…), nunca compara nombres de rol.
 *
 *   permisos_roles          (irol, iempresa, clave, nombre, descripcion, etiqueta, nivel, sistema, bactivo, fhcre)
 *   permisos_catalogo       (clave, grupo, descripcion, orden, sistema)
 *   permisos_rol_accion     (irol, clave, permitido)                     ← la matriz editable
 *   permisos_usuarios_roles (iusuario, iempresa, irol, fhcre, fhasigno)  ← asignacion por usuario y empresa
 *
 * Reglas: `iempresa` null = rol GLOBAL (aplica en cualquier empresa); el `irol` de un rol global es su clave.
 * Los roles de sistema (`sistema: true`, los de la semilla) no se borran, pero SU MATRIZ SE EDITA. Un rol nuevo
 * creado por API funciona sin desplegar. El comodin `*` en la matriz de un rol concede todas las acciones del
 * catalogo (la celda explicita del mismo rol gana).
 *
 * Ejemplo de consumo en el front:
 *
 *   const permisos = createClient(permisosPlugin, { baseUrl: "/api", headers: auth.headers });
 *   const { permisos: mapa } = await permisos.misPermisos();
 *   if (mapa["usuarios.rol"]) { ... }
 *
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/permisos.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type AccionFila, type AccionInput, type AsignarRolesInput, type CrearRolInput, type EditarRolInput, type MatrizRol, type MisPermisos, type PonerMatrizInput, type RolResumen, type UsuarioRolFila, ZAccionInput, ZAsignarRoles, ZCrearRol, ZEditarRol, ZPonerMatriz } from "@Jeff-Aporta/DER/src/03-plugins/permisos/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/permisos/schemas.ts";
export { ACCIONES_SEMILLA, ROLES_SEMILLA } from "@Jeff-Aporta/DER/src/03-plugins/permisos/seed.ts";
// Las reglas puras viven en `rules.ts` y se consumen por el SERVER (`permisos/server.ts`): el cliente no las necesita.

/** JSON transversal de permisos: las cuatro tablas (sin CRUD publicado) y los paths `permisos/...`. */
export const permisosPlugin: PluginDef = {
  name: "permisos",
  entities: {
    roles: {
      name: "permisos.rol",
      singular: "permisos_rol",
      plural: "permisos_roles",
      table: "permisos_roles",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          irol: { type: "string", pk: true, length: 160 },
          iempresa: { type: "string", length: 40, nullable: true },
          clave: { type: "string", length: 60, nullable: false },
          nombre: { type: "string", length: 120, nullable: false },
          descripcion: { type: "text", nullable: true },
          etiqueta: { type: "string", length: 30, nullable: true },
          nivel: { type: "int", default: 0 },
          sistema: { type: "bool", default: false },
          bactivo: { type: "bool", default: true },
          fhcre: { type: "datetime" },
        },
        relations: { permisos: { kind: "many", target: "permisos.rolaccion", on: { irol: "irol" } } },
      },
      listColumns: ["irol", "iempresa", "clave", "nombre", "nivel", "sistema", "bactivo"],
    },
    acciones: {
      name: "permisos.accion",
      singular: "permisos_accion",
      plural: "permisos_acciones",
      table: "permisos_catalogo",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          clave: { type: "string", pk: true, length: 120 },
          grupo: { type: "string", length: 60, nullable: false },
          descripcion: { type: "string", length: 300, nullable: true },
          orden: { type: "int", default: 0 },
          sistema: { type: "bool", default: false },
        },
      },
      listColumns: ["clave", "grupo", "orden", "sistema"],
    },
    rolAccion: {
      name: "permisos.rolaccion",
      singular: "permisos_rolaccion",
      plural: "permisos_rolaccion",
      table: "permisos_rol_accion",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          irol: { type: "string", pk: true, length: 160 },
          clave: { type: "string", pk: true, length: 120 },
          permitido: { type: "bool", default: false },
        },
        relations: { rol: { kind: "one", target: "permisos.rol", on: { irol: "irol" } }, accion: { kind: "one", target: "permisos.accion", on: { clave: "clave" } } },
      },
      listColumns: ["irol", "clave", "permitido"],
    },
    usuariosRoles: {
      name: "permisos.usuariorol",
      singular: "permisos_usuariorol",
      plural: "permisos_usuarios_roles",
      table: "permisos_usuarios_roles",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          iusuario: { type: "string", pk: true, length: 120 },
          iempresa: { type: "string", pk: true, length: 40 },
          irol: { type: "string", pk: true, length: 160 },
          fhcre: { type: "datetime" },
          fhasigno: { type: "datetime", nullable: true },
        },
        relations: { rol: { kind: "one", target: "permisos.rol", on: { irol: "irol" } } },
      },
      listColumns: ["iusuario", "iempresa", "irol", "fhcre"],
    },
  },
  irregularPaths: {
    mios: {
      method: "GET",
      path: "permisos/mios",
      security: "protected",
      returns: "json",
      ops: {
        /** GET permisos/mios: el rol de la sesion y el mapa COMPLETO accion -> permitido (para el front). */
        misPermisos(this: ClientPlugin): Promise<MisPermisos> {
          return this.call<MisPermisos>("mios");
        },
      },
    },
    puede: {
      method: "GET",
      path: "permisos/puede",
      security: "protected",
      returns: "json",
      ops: {
        /** GET permisos/puede?clave=usuarios.rol: decision para la sesion en la empresa activa. */
        puede(this: ClientPlugin, clave: string): Promise<{ permitido: boolean }> {
          return this.call<{ permitido: boolean }>("puede", undefined, { clave });
        },
      },
    },
    roles: {
      method: "GET",
      path: "permisos/roles",
      security: "protected",
      returns: "json",
      ops: {
        /** GET permisos/roles: catalogo de roles (globales + los de la empresa activa). */
        roles(this: ClientPlugin): Promise<RolResumen[]> {
          return this.call<RolResumen[]>("roles");
        },
      },
    },
    crearRol: {
      method: "POST",
      path: "permisos/roles",
      security: "protected",
      zod: ZCrearRol,
      returns: "json",
      ops: {
        /** POST permisos/roles: crea un rol nuevo (de la empresa activa o global) y opcionalmente su matriz. */
        crearRol(this: ClientPlugin, input: CrearRolInput): Promise<RolResumen> {
          return this.call<RolResumen>("crearRol", input);
        },
      },
    },
    editarRol: {
      method: "PUT",
      path: "permisos/roles/{irol}",
      security: "protected",
      zod: ZEditarRol,
      returns: "json",
      ops: {
        /** PUT permisos/roles/{irol}: nombre, descripcion, etiqueta, nivel o baja del rol. */
        editarRol(this: ClientPlugin, irol: string, input: EditarRolInput): Promise<RolResumen> {
          return this.call<RolResumen>("editarRol", input, { irol });
        },
      },
    },
    borrarRol: {
      method: "DELETE",
      path: "permisos/roles/{irol}",
      security: "protected",
      returns: "json",
      ops: {
        /** DELETE permisos/roles/{irol}: borra un rol de empresa (los de sistema no se borran). */
        borrarRol(this: ClientPlugin, irol: string): Promise<{ borrado: boolean }> {
          return this.call<{ borrado: boolean }>("borrarRol", undefined, { irol });
        },
      },
    },
    matriz: {
      method: "GET",
      path: "permisos/roles/{irol}/matriz",
      security: "protected",
      returns: "json",
      ops: {
        /** GET permisos/roles/{irol}/matriz: la matriz del rol contra TODO el catalogo. */
        matriz(this: ClientPlugin, irol: string): Promise<MatrizRol> {
          return this.call<MatrizRol>("matriz", undefined, { irol });
        },
      },
    },
    ponerMatriz: {
      method: "PUT",
      path: "permisos/roles/{irol}/matriz",
      security: "protected",
      zod: ZPonerMatriz,
      returns: "json",
      ops: {
        /** PUT permisos/roles/{irol}/matriz: cambia celdas de la matriz (y devuelve la matriz final). */
        ponerMatriz(this: ClientPlugin, irol: string, input: PonerMatrizInput): Promise<MatrizRol> {
          return this.call<MatrizRol>("ponerMatriz", input, { irol });
        },
      },
    },
    acciones: {
      method: "GET",
      path: "permisos/acciones",
      security: "protected",
      returns: "json",
      ops: {
        /** GET permisos/acciones: el catalogo completo de acciones del sistema. */
        acciones(this: ClientPlugin): Promise<AccionFila[]> {
          return this.call<AccionFila[]>("acciones");
        },
      },
    },
    crearAccion: {
      method: "PUT",
      path: "permisos/acciones",
      security: "protected",
      zod: ZAccionInput,
      returns: "json",
      ops: {
        /** PUT permisos/acciones: alta/edicion de una accion del catalogo (sin desplegar). */
        crearAccion(this: ClientPlugin, input: AccionInput): Promise<AccionFila> {
          return this.call<AccionFila>("crearAccion", input);
        },
      },
    },
    rolesUsuario: {
      method: "GET",
      path: "permisos/usuarios/{iusuario}/roles",
      security: "protected",
      returns: "json",
      ops: {
        /** GET permisos/usuarios/{iusuario}/roles: roles asignados al usuario en la empresa activa. */
        rolesUsuario(this: ClientPlugin, iusuario: string): Promise<UsuarioRolFila[]> {
          return this.call<UsuarioRolFila[]>("rolesUsuario", undefined, { iusuario });
        },
      },
    },
    asignarRoles: {
      method: "PUT",
      path: "permisos/usuarios/{iusuario}/roles",
      security: "protected",
      zod: ZAsignarRoles,
      returns: "json",
      ops: {
        /** PUT permisos/usuarios/{iusuario}/roles: reemplaza los roles del usuario en la empresa activa. */
        asignarRoles(this: ClientPlugin, iusuario: string, input: AsignarRolesInput): Promise<{ roles: string[] }> {
          return this.call<{ roles: string[] }>("asignarRoles", input, { iusuario });
        },
      },
    },
  },
};
