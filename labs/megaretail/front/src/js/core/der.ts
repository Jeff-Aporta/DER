/**
 * der.ts — el cliente DER del front: plugins `megaretail` (las once entidades + sus paths), `identity` (usuarios) y
 * `permissions` (roles) armados con `createClient` contra `/api`. Todas las peticiones llevan la cabecera `x-usuario`
 * del usuario seleccionado (sesión sin contraseña del lab). Las entidades se buscan por su plural en el registro de DER.
 */
import { type ClientController, type ClientPlugin, createClient, type Entity, identity, megaretail, permissions, registry, z } from "@megaretail/vendor";
import { estado } from "./estado.ts";
import type { Perfil, UsuarioLab } from "../consts/schemas/ui.schemas.ts";
import { ZUsuarioLab } from "../consts/schemas/ui.schemas.ts";

/** Cabecera de sesión del lab. */
export const CABECERA_USUARIO = "x-usuario";

let baseUrl = "/api";
let plugins: { dominio: ClientPlugin; auth: ClientPlugin; permisos: ClientPlugin } | null = null;

/** Cabeceras de toda petición: el usuario activo (si lo hay). */
export function headers(): HeadersInit {
  return estado.usuario ? { [CABECERA_USUARIO]: estado.usuario } : {};
}

/** Arma (una vez) los plugins del cliente contra la `baseUrl` dada. */
export function conectar(api = "/api"): void {
  baseUrl = api;
  plugins = {
    dominio: createClient(megaretail, { baseUrl, headers }),
    auth: createClient(identity, { baseUrl, headers }),
    permisos: createClient(permissions, { baseUrl, headers }),
  };
}

function armados() {
  if (!plugins) conectar(baseUrl);
  return plugins!;
}

/** El plugin del dominio (`call("registrar", …)`, `controllers.ventas`…). */
export function dominio(): ClientPlugin {
  return armados().dominio;
}

/** Plugin de permisos (`profile()`). */
export function permisos(): ClientPlugin {
  return armados().permisos;
}

/** Entidad registrada por su plural (`productos`, `usuarios`, `permisos/roles`), o `null`. */
export function entidad(plural: string): Entity<any> | null {
  return registry.has(plural) ? registry.entity(plural) : null;
}

/** Entidad por su `name` (lo que usan las relaciones: `producto`, `identity.usuarios`), o `null`. */
export function entidadPorNombre(name: string): Entity<any> | null {
  return registry.byName(name) ?? null;
}

/** ClientController de una entidad por su plural (de cualquiera de los tres plugins). */
export function controller(plural: string): ClientController<any> {
  const p = armados();
  for (const plugin of [p.dominio, p.auth, p.permisos]) {
    const c = Object.values(plugin.controllers).find((x) => x.entity.pluralPath.join("/") === plural);
    if (c) return c;
  }
  throw new Error(`No hay controller para "${plural}"`);
}

/** Todas las entidades expuestas (del dominio y de los plugins), con su plural. */
export function entidades(): { plural: string; entity: Entity<any> }[] {
  return registry.entities().filter(({ entity }) => entity.def.exposed !== false).map(({ key, entity }) => ({ plural: key, entity }));
}

/** Usuarios del lab para el selector (ruta pública). */
export async function usuariosLab(): Promise<UsuarioLab[]> {
  const res = await fetch(`${baseUrl}/lab/usuarios`);
  if (!res.ok) throw new Error(`No se pudo leer la lista de usuarios (${res.status})`);
  return z.array(ZUsuarioLab).parse(await res.json());
}

/** Perfil de permisos del usuario activo (anónimo si no hay usuario). */
export function perfil(): Promise<Perfil> {
  return permisos()["profile"]() as Promise<Perfil>;
}
