/**
 * rules.ts (plugin de permisos RBAC) — reglas PURAS, sin base ni HTTP.
 *
 * - El ambito de un rol es su `iempresa` (null = GLOBAL, aplica en cualquier empresa).
 * - El `irol` de un rol global ES su clave (`propietario`); el de un rol de empresa lleva el ambito
 *   (`acme:supervisor`). Asi la columna `rol` que ya usan los consumidores (p.ej. `crm_miembros.rol`)
 *   sigue siendo legible y no hay que traducir nada.
 * - El permiso se resuelve por ACCION: para cada rol vigente del usuario, la celda explicita de la accion
 *   gana sobre el comodin `*` del mismo rol; los roles se SUMAN (union: el permiso de cualquiera vale).
 * - `nivel` solo ordena y desempata (para el rol principal y para el badge); NO concede permisos.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/permisos.md
 */
import { type CeldasRol, type RolFila, type RolResumen, EMPRESA_GLOBAL } from "@Jeff-Aporta/DER/src/03-plugins/permisos/schemas.ts";

/** Comodin de la matriz: permiso para TODAS las acciones del catalogo (la celda explicita gana). */
export const COMODIN = "*";

/** Normaliza la empresa pedida: vacia, "todas" o "all" -> global. */
export function empresaNormalizada(empresa: string | null | undefined, global: string = EMPRESA_GLOBAL): string {
  const v = String(empresa ?? "").trim().toLowerCase();
  if (!v || v === "todas" || v === "all") return global;
  return v;
}

/** `irol` de un rol: la clave si es global, `empresa:clave` si es de una empresa. */
export function irolDe(iempresa: string | null | undefined, clave: string, global: string = EMPRESA_GLOBAL): string {
  const e = String(iempresa ?? "").trim();
  if (!e || e === global) return clave;
  return `${e}:${clave}`;
}

/** Clave de un rol a partir de su `irol` (para roles de empresa; los globales ya son la clave). */
export function claveDeIrol(irol: string): string {
  const i = irol.indexOf(":");
  return i < 0 ? irol : irol.slice(i + 1);
}

/** Etiqueta legible del rol: la configurada en la base, o la clave en mayusculas. */
export function etiquetaDe(rol: Pick<RolResumen, "clave" | "etiqueta">): string {
  const e = String(rol.etiqueta ?? "").trim();
  return e || rol.clave.trim().toUpperCase();
}

/** Un rol aplica en la empresa si es global o si es de esa empresa. */
export function aplicaEnEmpresa(rol: Pick<RolResumen, "iempresa">, empresa: string, global: string = EMPRESA_GLOBAL): boolean {
  const e = String(rol.iempresa ?? "").trim();
  return !e || e === global || e === empresa;
}

/** Ordena roles del que mas puede al que menos (nivel desc, luego clave). */
export function ordenarRoles(roles: RolResumen[]): RolResumen[] {
  return [...roles].sort((a, b) => Number(b.nivel ?? 0) - Number(a.nivel ?? 0) || a.clave.localeCompare(b.clave));
}

/**
 * Permiso EFECTIVO de un usuario: recorre sus roles y, para cada accion del catalogo, gana la primera
 * respuesta (comodin si el rol lo trae, si no la celda explicita; el rol puede negar en concreto lo que
 * el comodin le daria). La union entre roles es "cualquiera que lo permita".
 */
export function permisosEfectivos(roles: readonly CeldasRol[], catalogo: readonly string[]): Record<string, boolean> {
  const salida: Record<string, boolean> = {};
  for (const clave of catalogo) {
    let permitido = false;
    for (const { celdas } of roles) {
      if (celdas.has(clave)) {
        if (celdas.get(clave) === true) { permitido = true; break; }
        continue;
      }
      if (celdas.get(COMODIN) === true) { permitido = true; break; }
    }
    salida[clave] = permitido;
  }
  return salida;
}

/** `true` si el rol trae el comodin en su matriz (permiso total sobre el catalogo). */
export function tieneComodin(celdas: ReadonlyMap<string, boolean>): boolean {
  return celdas.get(COMODIN) === true;
}

/** Nivel maximo entre los roles (para impedir escaladas de privilegios al asignar). */
export function nivelMaximo(roles: readonly Pick<RolResumen, "nivel">[]): number {
  return roles.reduce((max, r) => Math.max(max, Number(r.nivel ?? 0)), 0);
}

/** Un rol de la base aplicable a la empresa, ya como resumen publico (los inactivos no aplican). */
export function rolesVigentes(roles: readonly RolFila[], empresa: string, global: string = EMPRESA_GLOBAL): RolResumen[] {
  const aplicables = roles
    .filter((r) => r.bactivo !== false && aplicaEnEmpresa(r, empresa, global))
    .map((r) => ({ irol: String(r.irol), iempresa: r.iempresa == null ? null : String(r.iempresa), clave: String(r.clave), nombre: String(r.nombre), descripcion: r.descripcion == null ? null : String(r.descripcion), etiqueta: r.etiqueta == null ? null : String(r.etiqueta), nivel: Number(r.nivel ?? 0), sistema: r.sistema === true }));
  return ordenarRoles(aplicables as RolResumen[]);
}

/**
 * Celdas iniciales de la matriz de un rol de la semilla: el comodin y su lista explicita de acciones.
 * Toda accion de la lista tiene que existir en el catalogo: si no, la celda se guardaria pero NUNCA concederia
 * nada (el permiso se resuelve por ACCION del catalogo) y el rol perderia permisos sin que nadie lo note.
 */
export function aplicarMatrizSemilla(rol: { clave: string; permisos: "*" | readonly string[] }, catalogo: readonly string[]): { clave: string; permitido: boolean }[] {
  if (rol.permisos === "*") return [{ clave: COMODIN, permitido: true }, ...catalogo.map((clave) => ({ clave, permitido: true }))];
  const conocidas = new Set(catalogo);
  const desconocidas = rol.permisos.filter((clave) => !conocidas.has(clave));
  if (desconocidas.length) throw new Error(`El rol "${rol.clave}" de la semilla trae acciones que no estan en el catalogo: ${desconocidas.join(", ")}`);
  return rol.permisos.map((clave) => ({ clave, permitido: true }));
}
