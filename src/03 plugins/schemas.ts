/**
 * schemas.ts (plugins) — configuración global (JSON) y contratos del lado servidor de los plugins. Los tipos
 * compartidos con el cliente viven en el `schemas.ts` de cada plugin (`identity/`, `permissions/`).
 */
import { z } from "zod";
import type { Database } from "@Jeff-Aporta/DER/src/02 controllers/server/database.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02 controllers/server/controller.ts";
import type { Identity, Plugin } from "@Jeff-Aporta/DER/src/02 controllers/server/schemas.ts";
import {
  type AuditEventInfo,
  type AuditQuery,
  type DeviceInfo,
  type IdentityConfig,
  type LoginInput,
  type LoginResult,
  type PasswordChangeInput,
  type SessionInfo,
  ZIdentityConfig,
} from "@Jeff-Aporta/DER/src/03 plugins/identity/schemas.ts";
import { type DerLoad, type DerLoadResult, type PermissionsConfig, type SessionProfile, ZPermissionsConfig } from "@Jeff-Aporta/DER/src/03 plugins/permissions/schemas.ts";
import type { Evento, Intento, Sesion, Usuario } from "@Jeff-Aporta/DER/src/03 plugins/identity/Objetos/mod.ts";
import type { AccionRol, Grupo, Rol, RolUsuario } from "@Jeff-Aporta/DER/src/03 plugins/permissions/Objetos/mod.ts";

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
  usuarios: ServerController<Usuario>;
  sesiones: ServerController<Sesion>;
  intentos: ServerController<Intento>;
  eventos: ServerController<Evento>;
  /**
   * Login en proceso (lo mismo que `POST /login`). `req` alimenta la auditoría (IP real, user-agent,
   * dispositivo); sin él se registra como `desconocido`.
   */
  login(input: LoginInput, req?: Request): Promise<LoginResult>;
  /** Revoca la sesión del token (lo mismo que `DELETE /logout`). */
  logout(identity: Identity): Promise<void>;
  /** Revoca todas las sesiones del usuario y devuelve cuántas cerró (lo mismo que `DELETE /logout/all`). */
  logoutAll(identity: Identity, dev?: DeviceInfo): Promise<number>;
  /** Sesiones vigentes del usuario, marcando la actual (lo mismo que `GET /sessions`). */
  sessions(identity: Identity): Promise<SessionInfo[]>;
  /** Cambia la contraseña (exige la actual) y revoca las demás sesiones (lo mismo que `PUT /password`). */
  changePassword(identity: Identity, input: PasswordChangeInput, dev?: DeviceInfo): Promise<number>;
  /** Auditoría filtrable (lo mismo que `GET /events`). */
  events(query: AuditQuery): Promise<AuditEventInfo[]>;
  /** Verifica un `Authorization: Bearer` (lo que usa la puerta de autenticación). */
  verify(token: string): Promise<Identity>;
}

/** Plugin de permisos del lado servidor (sus ServerControllers y operaciones en proceso). */
export interface PermissionsPlugin extends Plugin {
  grupos: ServerController<Grupo>;
  roles: ServerController<Rol>;
  rolesUsuario: ServerController<RolUsuario>;
  acciones: ServerController<AccionRol>;
  /** Perfil de la sesión (lo mismo que `GET /permisos`). */
  profile(identity: Identity | null): Promise<SessionProfile>;
  /** Carga del DER (lo mismo que `PUT /permisos`). */
  load(der: DerLoad): Promise<DerLoadResult>;
}