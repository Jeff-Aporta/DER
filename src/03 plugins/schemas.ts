/**
 * schemas.ts (plugins) — configuración global (JSON) y contratos del lado servidor de los plugins. Los tipos
 * compartidos con el cliente viven en el `schemas.ts` de cada plugin (`identity/`, `permissions/`).
 */
import { z } from "zod";
import type { Database } from "../02 controllers/server/database.ts";
import type { ServerController } from "../02 controllers/server/controller.ts";
import type { Identity, Plugin } from "../02 controllers/server/schemas.ts";
import { type IdentityConfig, type LoginInput, type LoginResult, ZIdentityConfig } from "./identity/schemas.ts";
import { type DerLoad, type DerLoadResult, type PermissionsConfig, type SessionProfile, ZPermissionsConfig } from "./permissions/schemas.ts";
import type { TSesion, TUsuario } from "./identity/Objetos/mod.ts";
import type { TAccionRol, TGrupo, TRol, TRolUsuario } from "./permissions/Objetos/mod.ts";

/** JSON de configuración global: la sección presente (y `enabled` ≠ false) integra el plugin. */
export interface PluginsConfig {
  identity?: IdentityConfig | undefined;
  permissions?: PermissionsConfig | undefined;
}

export const ZPluginsConfig: z.ZodType<PluginsConfig> = z.object({
  identity: ZIdentityConfig.optional(),
  permissions: ZPermissionsConfig.optional(),
}).strict();

/** Dependencias en ejecución de `pluginsFromConfig`. */
export interface PluginsRuntime {
  db: Database;
  /** Variables para `"env:NOMBRE"` (en Workers, el `env` del fetch). Default: el entorno del proceso. */
  env?: Record<string, string | undefined> | undefined;
}

/** Plugin de identidad del lado servidor (sus ServerControllers y operaciones en proceso). */
export interface IdentityPlugin extends Plugin {
  usuarios: ServerController<TUsuario>;
  sesiones: ServerController<TSesion>;
  /** Login en proceso (lo mismo que `POST /login`). */
  login(input: LoginInput): Promise<LoginResult>;
  /** Revoca la sesión del token (lo mismo que `DELETE /logout`). */
  logout(identity: Identity): Promise<void>;
  /** Verifica un `Authorization: Bearer` (lo que usa la puerta de autenticación). */
  verify(token: string): Promise<Identity>;
}

/** Plugin de permisos del lado servidor (sus ServerControllers y operaciones en proceso). */
export interface PermissionsPlugin extends Plugin {
  grupos: ServerController<TGrupo>;
  roles: ServerController<TRol>;
  rolesUsuario: ServerController<TRolUsuario>;
  acciones: ServerController<TAccionRol>;
  /** Perfil de la sesión (lo mismo que `GET /permisos`). */
  profile(identity: Identity | null): Promise<SessionProfile>;
  /** Carga del DER (lo mismo que `PUT /permisos`). */
  load(der: DerLoad): Promise<DerLoadResult>;
}
