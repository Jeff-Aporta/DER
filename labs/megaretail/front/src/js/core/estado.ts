/**
 * estado.ts — estado global mínimo de la app (sin DOM): usuario seleccionado, perfil de permisos y vista activa,
 * con suscripción por evento. El usuario se recuerda en localStorage (`mr:usuario`).
 */
import type { Perfil } from "../consts/schemas/ui.schemas.ts";
import type { Vista } from "../consts/schemas/componentes.schemas.ts";

const CLAVE_USUARIO = "mr:usuario";
const bus = new EventTarget();

/** Estado en memoria. */
export const estado: { usuario: string | null; perfil: Perfil | null; vista: Vista | null } = { usuario: leerUsuario(), perfil: null, vista: null };

function leerUsuario(): string | null {
  try {
    return localStorage.getItem(CLAVE_USUARIO);
  } catch {
    return null;
  }
}

/** Cambia el usuario activo (null = anónimo) y avisa. */
export function setUsuario(usuario: string | null): void {
  estado.usuario = usuario;
  try {
    if (usuario) localStorage.setItem(CLAVE_USUARIO, usuario);
    else localStorage.removeItem(CLAVE_USUARIO);
  } catch {
    /* sin almacenamiento */
  }
  bus.dispatchEvent(new CustomEvent("usuario", { detail: usuario }));
}

/** Guarda el perfil de permisos del usuario activo y avisa. */
export function setPerfil(perfil: Perfil | null): void {
  estado.perfil = perfil;
  bus.dispatchEvent(new CustomEvent("perfil", { detail: perfil }));
}

/** Cambia la vista activa y avisa. */
export function setVista(vista: Vista): void {
  estado.vista = vista;
  bus.dispatchEvent(new CustomEvent("vista", { detail: vista }));
}

/** Suscripción a un cambio de estado; devuelve la función para desuscribirse. */
export function alCambiar(que: "usuario" | "perfil" | "vista", fn: () => void): () => void {
  bus.addEventListener(que, fn);
  return () => bus.removeEventListener(que, fn);
}

/** ¿El perfil activo permite la acción? Sin perfil (anónimo) → false; sin valor → true (como decide DER sin `denyByDefault`). */
export function puede(permiso: string | undefined, verbo = "POST"): boolean {
  if (!permiso) return true;
  const p = estado.perfil;
  if (!p || !p.usuario) return false;
  const v = p.perms[permiso];
  if (v === undefined) return true;
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const porVerbo = (v as Record<string, unknown>)[verbo];
    return porVerbo !== false;
  }
  return v !== false;
}
