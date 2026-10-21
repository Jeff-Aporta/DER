/**
 * schemas.ts (plugin de permisos) — tipos (uno por línea) y contratos Zod compartidos por client y server. Sólo `zod`.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/permissions.md
 */
import { z } from "zod";

/**
 * Configuración del plugin de permisos (`createServer(permissionsServer, { db, cfg })`): `grupo` cuyos roles aplican a este API
 * (default `"API"`); `rolBase` valores por defecto de todos (default `"USR"`); `rolAdmin` rol `"*": true` que crea `seed()`
 * (default `"ADMIN"`); `admins` usuarios a los que `seed()` asigna el rol admin; `actions` acciones de seguridad que no son
 * ruta (capacidades de código); `denyByDefault` sin valor para una ruta: `false` deja pasar con sesión, `true` niega; `aliases`
 * personaliza el nombre que se quema en la BD para cada acción (id de ruta o acción personalizada → alias).
 */
export type PermissionsConfig = { grupo?: string | undefined; rolBase?: string | undefined; rolAdmin?: string | undefined; admins?: string[] | undefined; actions?: string[] | undefined; denyByDefault?: boolean | undefined; aliases?: Record<string, string> | undefined };
/** Zod estricto de `PermissionsConfig` (incluye `aliases`). */
export const ZPermissionsConfig: z.ZodType<PermissionsConfig> = z.object({ grupo: z.string().min(1).optional(), rolBase: z.string().min(1).optional(), rolAdmin: z.string().min(1).optional(), admins: z.array(z.string().min(1)).optional(), actions: z.array(z.string().min(1)).optional(), denyByDefault: z.boolean().optional(), aliases: z.record(z.string().min(1), z.string().min(1)).optional() }).strict();
/** Valor de una acción para un rol (como `seg_accionesxrol.valor` de ISS). */
export type SegValue = boolean | string | { [k: string]: unknown };
/** Perfil de la sesión (`GET /permisos`): el front decide qué ofrecer; el server igual autoriza cada ruta. `perms` = valor efectivo por acción (por verbo si la comparten varios). */
export type SessionProfile = { usuario: string | null; irol: string; igrupo: string; roles: string[]; perms: Record<string, unknown> };
/** Entrada del catálogo (`GET /permisos?catalogo=1`): una acción y las rutas que la usan. */
export type CatalogEntry = { id: string; routes: { id: string; method: string; path: string }[] };
export type GrupoInput = { igrupo: string; nombre?: string | null | undefined };
export type RolInput = { irol: string; igrupo: string; nombre?: string | null | undefined; bactivo?: boolean | undefined };
export type RolUsuarioInput = { iusuario: string; irol: string; finicial?: string | null | undefined; ffinal?: string | null | undefined; bprincipal?: boolean | undefined };
/** `iaccion` = id de ruta, id personalizado o `"*"` (cualquiera). */
export type AccionRolInput = { irol: string; iaccion: string; valor: SegValue };
/** Carga del DER (`PUT /permisos`): upsert en una transacción. */
export type DerLoad = { grupos?: GrupoInput[] | undefined; roles?: RolInput[] | undefined; rolesusuario?: RolUsuarioInput[] | undefined; acciones?: AccionRolInput[] | undefined };
/** Respuesta de la carga: filas procesadas por tabla. */
export type DerLoadResult = { grupos: number; roles: number; rolesusuario: number; acciones: number };
const ZSegValue: z.ZodType<SegValue> = z.union([z.boolean(), z.string(), z.record(z.string(), z.unknown())]);
/** Zod estricto de la carga del DER (`PUT permisos`). */
export const ZDerLoad: z.ZodType<DerLoad> = z.object({ grupos: z.array(z.object({ igrupo: z.string().min(1), nombre: z.string().nullable().optional() }).strict()).optional(), roles: z.array(z.object({ irol: z.string().min(1), igrupo: z.string().min(1), nombre: z.string().nullable().optional(), bactivo: z.boolean().optional() }).strict()).optional(), rolesusuario: z.array(z.object({ iusuario: z.string().min(1), irol: z.string().min(1), finicial: z.string().nullable().optional(), ffinal: z.string().nullable().optional(), bprincipal: z.boolean().optional() }).strict()).optional(), acciones: z.array(z.object({ irol: z.string().min(1), iaccion: z.string().min(1), valor: ZSegValue }).strict()).optional() }).strict();
/** Matriz de la sesión: mapa del rol base, del rol principal vigente (null = sólo base), rol efectivo y roles vigentes. */
export type PermissionMatrix = { base: ReadonlyMap<string, unknown>; rol: ReadonlyMap<string, unknown> | null; irol: string; roles: string[] };
/** Configuración con los defaults aplicados. */
export type PermissionsResolved = { grupo: string; rolBase: string; rolAdmin: string; denyByDefault: boolean; admins: string[]; actions: string[]; aliases: Record<string, string> };
