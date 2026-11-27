/**
 * schemas.ts (plugin de permisos RBAC) — tipos (uno por linea) y contratos Zod compartidos por client y server.
 *
 * El modelo vive EN LA BASE: `permisos_roles`, `permisos_catalogo` (tabla; no choca con `permisos_acciones` del plugin viejo `permissions`), `permisos_rol_accion` y
 * `permisos_usuarios_roles`. El codigo no conoce claves de rol: solo comprueba ACCIONES (`usuarios.rol`,
 * `tiquetes.ver`…). Un rol nuevo se crea por API/base y funciona sin desplegar.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/permisos.md
 */
import { z } from "zod";

/** Sentinela de empresa para roles y asignaciones GLOBALES (aplican en cualquier empresa). */
export const EMPRESA_GLOBAL = "*";

/** Cabecera por defecto con la empresa activa. */
export const CABECERA_EMPRESA_PERMISOS = "x-empresa";

/** Una accion del catalogo: la clave es lo que el codigo comprueba (`usuarios.rol`). */
export type AccionFila = { clave: string; grupo: string; descripcion: string | null; orden: number; sistema: boolean };

/** Un rol guardado: de sistema (semilla, no se borra) o de empresa (editable/borrable). */
export type RolFila = { irol: string; iempresa: string | null; clave: string; nombre: string; descripcion: string | null; etiqueta: string | null; nivel: number; sistema: boolean; bactivo: boolean; fhcre: string };

/** Una celda de la matriz: (rol, accion) -> permitido. */
export type PermisoRolFila = { irol: string; clave: string; permitido: boolean };

/** Asignacion de un rol a un usuario en una empresa (sentinela global = `*`). */
export type UsuarioRolFila = { iusuario: string; iempresa: string; irol: string; fhcre: string; fhasigno: string | null };

/** Rol tal como lo ve el front (sin columnas internas). */
export type RolResumen = { irol: string; iempresa: string | null; clave: string; nombre: string; descripcion: string | null; etiqueta: string | null; nivel: number; sistema: boolean };

/** Una celda de la matriz ya unida con el catalogo (para pintar la pantalla de roles). */
export type CeldaMatriz = { clave: string; grupo: string; descripcion: string | null; orden: number; permitido: boolean };

/** La matriz de un rol: el rol y todas las acciones del catalogo con su valor. */
export type MatrizRol = { rol: RolResumen; acciones: CeldaMatriz[] };

/** Lo que devuelve `GET permisos/mios`: el rol de la sesion y el mapa COMPLETO accion -> permitido. */
export type MisPermisos = { iusuario: string; iempresa: string; rol: RolResumen | null; roles: RolResumen[]; permisos: Record<string, boolean>; permitidas: string[] };

/** Cuerpo de `POST permisos/roles`. `permisos` siembra la matriz del rol nuevo. */
export type CrearRolInput = { clave: string; nombre: string; iempresa?: string | null | undefined; descripcion?: string | null | undefined; etiqueta?: string | null | undefined; nivel?: number | undefined; permisos?: string[] | undefined };

/** Cuerpo de `PUT permisos/roles/{irol}` (todo opcional). `sistema` no se puede cambiar. */
export type EditarRolInput = { nombre?: string | undefined; descripcion?: string | null | undefined; etiqueta?: string | null | undefined; nivel?: number | undefined; bactivo?: boolean | undefined };

/** Cuerpo de `PUT permisos/roles/{irol}/matriz`. `reemplazar` = deja en false las acciones que no vengan. */
export type PonerMatrizInput = { acciones: { clave: string; permitido: boolean }[]; reemplazar?: boolean | undefined };

/** Cuerpo de `PUT permisos/usuarios/{iusuario}/roles`: los roles del usuario EN ESA empresa. */
export type AsignarRolesInput = { iempresa?: string | null | undefined; roles: string[] };

/** Cuerpo de `PUT permisos/acciones`: alta/edicion de una accion del catalogo. */
export type AccionInput = { clave: string; grupo: string; descripcion?: string | null | undefined; orden?: number | undefined };

/** Resultado de una decision de permiso con su motivo (para logs y pruebas). */
export type DecisionPermiso = { permitido: boolean; motivo: string };

/** Configuracion del plugin. `accionesExtra` permite al consumidor sumar acciones propias a la semilla. */
export type PermisosConfig = { cabeceraEmpresa?: string | undefined; empresaGlobal?: string | undefined; accionesExtra?: AccionInput[] | undefined; asignaciones?: AsignacionSemilla[] | undefined };

/** Configuracion con los defaults aplicados. */
export type PermisosResolved = { cabeceraEmpresa: string; empresaGlobal: string; accionesExtra: AccionInput[] };

/** Asignacion de roles sembrada por el consumidor (para arrancar con usuarios ya repartidos). */
export type AsignacionSemilla = { iusuario: string; iempresa?: string | null | undefined; roles: string[] };

/** Verbos del plugin armado (server): lo que usan los consumidores desde codigo y los handlers. */
export type VerbosPermisos = { puede(usuario: string | null | undefined, empresa: string | null | undefined, clave: string): Promise<boolean>; exigir(usuario: string | null | undefined, empresa: string | null | undefined, clave: string): Promise<void>; permisosDe(usuario: string, empresa: string): Promise<Record<string, boolean>>; rolesDe(usuario: string, empresa: string): Promise<RolResumen[]>; misPermisos(usuario: string, empresa: string): Promise<MisPermisos>; catalogo(): Promise<AccionFila[]>; roles(empresa?: string | null): Promise<RolResumen[]>; matriz(irol: string): Promise<MatrizRol>; crearRol(actor: string, empresa: string, input: CrearRolInput): Promise<RolResumen>; editarRol(actor: string, empresa: string, irol: string, input: EditarRolInput): Promise<RolResumen>; borrarRol(actor: string, empresa: string, irol: string): Promise<{ borrado: boolean }>; ponerMatriz(actor: string, empresa: string, irol: string, input: PonerMatrizInput): Promise<MatrizRol>; crearAccion(actor: string, empresa: string, input: AccionInput): Promise<AccionFila>; rolesUsuario(iusuario: string, empresa: string): Promise<UsuarioRolFila[]>; asignarRoles(actor: string, empresa: string, iusuario: string, input: AsignarRolesInput): Promise<{ roles: string[] }>; quitarRol(actor: string, empresa: string, iusuario: string, irol: string): Promise<{ roles: string[] }>; ponerRoles(iusuario: string, empresa: string, claves: string[]): Promise<void>; exigirPermiso(ctx: unknown, clave: string, empresa?: string | null): Promise<void>; tienePermiso(ctx: unknown, clave: string, empresa?: string | null): Promise<boolean> };

/** Celdas de la matriz de un rol: el mapa accion -> permitido (admite la fila comodin `*`). */
export type CeldasRol = { irol: string; celdas: ReadonlyMap<string, boolean> };

/** Una accion de la semilla del catalogo. */
export type AccionSemilla = { clave: string; grupo: string; descripcion: string };

/** Un rol de la semilla, con la lista de acciones permitidas ("*" = todo el catalogo). */
export type RolSemilla = { clave: string; nombre: string; descripcion: string; etiqueta: string; nivel: number; permisos: "*" | string[] };

const texto = (max: number) => z.string().trim().min(1).max(max);
/** Clave de accion: `grupo.accion` en minusculas, con puntos y guiones. */
export const ZClaveAccion = z.string().trim().regex(/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/, "La accion debe ser grupo.accion (minusculas, puntos y guiones)");
/** Clave de rol: minusculas, digitos, guiones y guion bajo. */
export const ZClaveRol = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,59}$/, "La clave del rol va en minusculas (letras, digitos, - y _)");

/** Zod del alta de un rol. */
export const ZCrearRol: z.ZodType<CrearRolInput> = z.strictObject({ clave: ZClaveRol, nombre: texto(120), iempresa: z.string().trim().max(40).nullish(), descripcion: z.string().max(1000).nullish(), etiqueta: z.string().trim().max(30).nullish(), nivel: z.number().int().min(0).max(1000).optional(), permisos: z.array(ZClaveAccion).max(1000).optional() });

/** Zod de la edicion de un rol. */
export const ZEditarRol: z.ZodType<EditarRolInput> = z.strictObject({ nombre: texto(120).optional(), descripcion: z.string().max(1000).nullish(), etiqueta: z.string().trim().max(30).nullish(), nivel: z.number().int().min(0).max(1000).optional(), bactivo: z.boolean().optional() });

/** Zod de la matriz de un rol. */
export const ZPonerMatriz: z.ZodType<PonerMatrizInput> = z.strictObject({ acciones: z.array(z.strictObject({ clave: ZClaveAccion, permitido: z.boolean() })).max(2000), reemplazar: z.boolean().optional() });

/** Zod de la asignacion de roles. */
export const ZAsignarRoles: z.ZodType<AsignarRolesInput> = z.strictObject({ iempresa: z.string().trim().max(40).nullish(), roles: z.array(z.union([ZClaveRol, z.string().trim().min(1).max(120)])).max(50) });

/** Zod del alta/edicion de una accion del catalogo. */
export const ZAccionInput: z.ZodType<AccionInput> = z.strictObject({ clave: ZClaveAccion, grupo: z.string().trim().regex(/^[a-z][a-z0-9_-]*$/, "El grupo va en minusculas").max(60), descripcion: z.string().max(300).nullish(), orden: z.number().int().min(0).max(10000).optional() });

/** Zod de la configuracion del plugin. */
export const ZAsignacionSemilla: z.ZodType<AsignacionSemilla> = z.strictObject({ iusuario: z.string().trim().min(1).max(120), iempresa: z.string().trim().max(40).nullish(), roles: z.array(z.string().trim().min(1).max(160)).max(50) });
/** Zod de la configuracion del plugin. */
export const ZPermisosConfig: z.ZodType<PermisosConfig> = z.strictObject({ cabeceraEmpresa: z.string().trim().min(1).max(60).optional(), empresaGlobal: z.string().trim().min(1).max(10).optional(), accionesExtra: z.array(ZAccionInput).max(500).optional(), asignaciones: z.array(ZAsignacionSemilla).max(5000).optional() });
