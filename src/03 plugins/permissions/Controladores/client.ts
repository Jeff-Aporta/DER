/**
 * Lado cliente del plugin de permisos, armado con `ClientController`: perfil de la sesión, catálogo de
 * acciones, carga del DER y el CRUD/list de cada tabla del DER. El token llega por `headers`
 * (típicamente `identity.headers` de `IdentityClient`).
 *
 * ```ts
 * const permisos = new PermissionsClient({ baseUrl: "/api", headers: auth.headers });
 * const { perms } = await permisos.profile();
 * await permisos.load({ roles: [...], acciones: [...] });
 * await permisos.roles.query({ include: { acciones: true } });
 * ```
 */
import { ValidationError } from "../../../00 common/errors.ts";
import { ClientController } from "../../../02 controllers/client/controller.ts";
import { zodMessage } from "../../../01 objects/zod.ts";
import {
  type CatalogEntry,
  type DerLoad,
  type DerLoadResult,
  type PermissionsClientConfig,
  type SessionProfile,
  ZDerLoad,
} from "../schemas.ts";
import { AccionRol, Grupo, Rol, RolUsuario, type TAccionRol, type TGrupo, type TRol, type TRolUsuario } from "../Objetos/mod.ts";

export class PermissionsClient {
  readonly grupos: ClientController<TGrupo>;
  readonly roles: ClientController<TRol>;
  readonly rolesUsuario: ClientController<TRolUsuario>;
  readonly acciones: ClientController<TAccionRol>;

  constructor(readonly config: PermissionsClientConfig) {
    const base = {
      baseUrl: config.baseUrl,
      ...(config.fetch ? { fetch: config.fetch } : {}),
      ...(config.headers ? { headers: config.headers } : {}),
    };
    this.grupos = new ClientController(Grupo, base);
    this.roles = new ClientController(Rol, base);
    this.rolesUsuario = new ClientController(RolUsuario, base);
    this.acciones = new ClientController(AccionRol, base);
  }

  /** `GET /permisos`: perfil de la sesión (anónimo si no hay token). */
  async profile(): Promise<SessionProfile> {
    return await (await this.grupos.request("GET", "permisos")).json() as SessionProfile;
  }

  /** `GET /permisos?catalogo=1`: acciones de seguridad y sus rutas (quien puede cargar el DER). */
  async catalog(): Promise<CatalogEntry[]> {
    return await (await this.grupos.request("GET", "permisos?catalogo=1")).json() as CatalogEntry[];
  }

  /** `PUT /permisos`: carga el DER (validado en el cliente con el mismo Zod que el server). */
  async load(der: DerLoad): Promise<DerLoadResult> {
    const parsed = ZDerLoad.safeParse(der);
    if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
    return await (await this.grupos.request("PUT", "permisos", parsed.data)).json() as DerLoadResult;
  }
}
