/**
 * schemas.ts (plugin de permisos) — tipos y contratos Zod compartidos por client y server. Sólo `zod`.
 */
import { z } from "zod";

/** Configuración del plugin de permisos (sección `permissions` del JSON global). */
export interface PermissionsConfig {
  enabled?: boolean | undefined;
  /** Grupo cuyos roles aplican a este API. Default `"API"`. */
  grupo?: string | undefined;
  /** Rol base: define los valores por defecto de todos (y es el de quien no tiene rol). Default `"USR"`. */
  rolBase?: string | undefined;
  /** Rol administrador (`"*": true`) que se crea en `seed()`. Default `"ADMIN"`. */
  rolAdmin?: string | undefined;
  /** Usuarios a los que `seed()` asigna el rol administrador. */
  admins?: string[] | undefined;
  /**
   * Acciones de seguridad que no son una ruta (capacidades que se consultan desde código con
   * `ctx.state.can("auditoria")`). Las de las rutas (autogeneradas o personalizadas) se toman solas.
   */
  actions?: string[] | undefined;
  /**
   * Sin valor para una ruta (ni en el rol ni en el base): `false` (default, como ISS) deja pasar con JWT;
   * `true` niega (lista blanca estricta).
   */
  denyByDefault?: boolean | undefined;
}

export const ZPermissionsConfig: z.ZodType<PermissionsConfig> = z.object({
  enabled: z.boolean().optional(),
  grupo: z.string().min(1).optional(),
  rolBase: z.string().min(1).optional(),
  rolAdmin: z.string().min(1).optional(),
  admins: z.array(z.string().min(1)).optional(),
  actions: z.array(z.string().min(1)).optional(),
  denyByDefault: z.boolean().optional(),
}).strict();

/** Valor de una acción para un rol (como `seg_accionesxrol.valor` de ISS). */
export type SegValue = boolean | string | { [k: string]: unknown };

/** Perfil de la sesión (`GET /permisos`): el front decide qué ofrecer; el server igual autoriza cada ruta. */
export interface SessionProfile {
  usuario: string | null;
  irol: string;
  igrupo: string;
  /** Roles vigentes del usuario en el grupo. */
  roles: string[];
  /** Valor efectivo por acción de seguridad (por verbo si la acción la comparten varios). */
  perms: Record<string, unknown>;
}

/** Entrada del catálogo (`GET /permisos?catalogo=1`): una acción y las rutas que la usan. */
export interface CatalogEntry {
  id: string;
  routes: { id: string; method: string; path: string }[];
}

export interface GrupoInput {
  igrupo: string;
  nombre?: string | null | undefined;
}
export interface RolInput {
  irol: string;
  igrupo: string;
  nombre?: string | null | undefined;
  bactivo?: boolean | undefined;
}
export interface RolUsuarioInput {
  iusuario: string;
  irol: string;
  finicial?: string | null | undefined;
  ffinal?: string | null | undefined;
  bprincipal?: boolean | undefined;
}
export interface AccionRolInput {
  irol: string;
  /** Acción de seguridad: id de ruta, id personalizado o `"*"` (cualquiera). */
  iaccion: string;
  valor: SegValue;
}

/** Carga del DER (`PUT /permisos`): upsert en una transacción. */
export interface DerLoad {
  grupos?: GrupoInput[] | undefined;
  roles?: RolInput[] | undefined;
  rolesusuario?: RolUsuarioInput[] | undefined;
  acciones?: AccionRolInput[] | undefined;
}

/** Respuesta de la carga: filas procesadas por tabla. */
export interface DerLoadResult {
  grupos: number;
  roles: number;
  rolesusuario: number;
  acciones: number;
}

const ZSegValue: z.ZodType<SegValue> = z.union([z.boolean(), z.string(), z.record(z.string(), z.unknown())]);

export const ZDerLoad: z.ZodType<DerLoad> = z.object({
  grupos: z.array(z.object({
    igrupo: z.string().min(1),
    nombre: z.string().nullable().optional(),
  }).strict()).optional(),
  roles: z.array(z.object({
    irol: z.string().min(1),
    igrupo: z.string().min(1),
    nombre: z.string().nullable().optional(),
    bactivo: z.boolean().optional(),
  }).strict()).optional(),
  rolesusuario: z.array(z.object({
    iusuario: z.string().min(1),
    irol: z.string().min(1),
    finicial: z.string().nullable().optional(),
    ffinal: z.string().nullable().optional(),
    bprincipal: z.boolean().optional(),
  }).strict()).optional(),
  acciones: z.array(z.object({ irol: z.string().min(1), iaccion: z.string().min(1), valor: ZSegValue }).strict())
    .optional(),
}).strict();

/** Configuración de `PermissionsClient` (el lado cliente del plugin). */
export interface PermissionsClientConfig {
  baseUrl: string;
  fetch?: typeof fetch | undefined;
  /** Cabeceras (p.ej. `identity.headers` de `IdentityClient` para mandar el token). */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>) | undefined;
}
