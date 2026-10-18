/**
 * schemas.ts (plugin de identidad) — tipos y contratos Zod compartidos por client y server. Sólo `zod`:
 * lo puede importar el front sin arrastrar nada del servidor.
 */
import { z } from "zod";

/** Configuración del plugin de identidad (sección `identity` del JSON global). */
export interface IdentityConfig {
  /** Default true cuando la sección existe. */
  enabled?: boolean | undefined;
  /** Secret key: firma del JWT (HS384). Admite `"env:NOMBRE"` (se lee de `env`). Mínimo 32 caracteres. */
  secret: string;
  /** Pepper del hash de contraseñas, SEPARADO del JWT. Si falta, se usa `secret` (compat). Rotar el JWT ya no rompe las contraseñas. */
  pepper?: string | undefined;
  /** Vigencia del token en segundos (default 86400 = 24 h). */
  expiresIn?: number | undefined;
  /** Claim `iss` (opcional; si se define, también se exige al verificar). */
  issuer?: string | undefined;
  /** Iteraciones PBKDF2 (default 100000, el máximo que admite Cloudflare Workers). */
  iterations?: number | undefined;
  /** Usuario administrador que se crea en `router.seed()` si no existe. */
  admin?: { usuario: string; password: string; nombre?: string | undefined } | undefined;
  /** Endurecimiento del login (bloqueo, dispositivo nuevo, viaje imposible, política de contraseña). */
  security?: IdentitySecurityConfig | undefined;
  /** Modo de firma del JWT (HS384 simétrico por defecto; ES256 asimétrico + JWKS). */
  jwt?: IdentityJwtConfig | undefined;
  /** Proxies de confianza para derivar la IP real: toma el ÚLTIMO salto de confianza, no el primero. Default 0 (legacy: primer salto). */
  trustProxy?: number | undefined;
  /** Emisores de confianza: tokens firmados (ES256) por estas llaves se aceptan.
   *  Cada uno declara la URL del JWKS y, opcionalmente, el `iss` esperado. */
  trustedIssuers?: Array<{ name: string; jwksUrl: string; issuer?: string | undefined }> | undefined;
}

/** Entrada del caché de JWKS por URL. */
export interface JwksCacheEntry { jwks: { keys: Record<string, unknown>[] }; exp: number }

/** Modo de firma del JWT. */
export interface IdentityJwtConfig {
  alg?: "HS384" | "ES256" | undefined;
  /** kid del JWT (ES256). */
  kid?: string | undefined;
  /** Llave privada JWK (solo el firmante; ej. usrs). */
  privateJwk?: Record<string, unknown> | undefined;
  /** Llave pública JWK (verificadores y para publicar el JWKS). */
  publicJwk?: Record<string, unknown> | undefined;
}

/** Política de contraseña (mínimos). */
export interface IdentityPasswordPolicy {
  /** Longitud mínima (default 8; nunca menos de 8). */
  minLength?: number | undefined;
}

/** Viaje imposible básico: sin geolocalización, un cambio de IP en una ventana corta es sospechoso. */
export interface IdentityTravelConfig {
  /** Default false. */
  enabled?: boolean | undefined;
  /** Minutos mínimos entre dos logins desde IP distinta (default 5). */
  minMinutes?: number | undefined;
  /** Bloquea el login además de auditarlo (default false). */
  block?: boolean | undefined;
}

/** Endurecimiento del login (sección `identity.security` del JSON de plugins). */
export interface IdentitySecurityConfig {
  /** Fallos permitidos por IP o por usuario dentro de `windowSeconds` antes de bloquear (default 5). */
  maxAttempts?: number | undefined;
  /** Ventana de conteo, en segundos (default 900). */
  windowSeconds?: number | undefined;
  /** Duración del bloqueo, en segundos (default 900). */
  lockSeconds?: number | undefined;
  /** Bloquea el login desde un dispositivo no visto antes (default false: sólo audita). */
  blockNewDevice?: boolean | undefined;
  /** Viaje imposible básico (default: desactivado). */
  travel?: IdentityTravelConfig | undefined;
  /** Política mínima de contraseña. */
  password?: IdentityPasswordPolicy | undefined;
}

export const ZIdentitySecurityConfig: z.ZodType<IdentitySecurityConfig> = z.object({
  maxAttempts: z.number().int().min(1).max(100).optional(),
  windowSeconds: z.number().int().min(1).max(86_400).optional(),
  lockSeconds: z.number().int().min(1).max(86_400).optional(),
  blockNewDevice: z.boolean().optional(),
  travel: z.object({
    enabled: z.boolean().optional(),
    minMinutes: z.number().int().min(0).max(1440).optional(),
    block: z.boolean().optional(),
  }).strict().optional(),
  password: z.object({ minLength: z.number().int().min(8).max(256).optional() }).strict().optional(),
}).strict();

export const ZIdentityConfig: z.ZodType<IdentityConfig> = z.object({
  enabled: z.boolean().optional(),
  secret: z.string().min(1, "identity.secret es obligatorio"),
  pepper: z.string().min(32, "identity.pepper debe tener al menos 32 caracteres").optional(),
  expiresIn: z.number().int().positive().optional(),
  issuer: z.string().optional(),
  iterations: z.number().int().min(10000).max(100000).optional(),
  admin: z.object({ usuario: z.string().min(1), password: z.string().min(8), nombre: z.string().optional() }).strict()
    .optional(),
  security: ZIdentitySecurityConfig.optional(),
  trustProxy: z.number().int().min(0).max(10).optional(),
  jwt: z.object({
    alg: z.enum(["HS384", "ES256"]).optional(),
    kid: z.string().min(1).optional(),
    privateJwk: z.record(z.string(), z.unknown()).optional(),
    publicJwk: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
}).strict();

/** Claims del JWT (identidad, nunca permisos: el rol se lee en cada request). */
export interface JwtClaims {
  /** Id único del usuario. */
  sub: string;
  /** Id de la sesión (permite revocar en `logout`). */
  jti: string;
  iat: number;
  exp: number;
  iss?: string | undefined;
  nombre?: string | undefined;
}

export const ZJwtClaims: z.ZodType<JwtClaims> = z.object({
  sub: z.string().min(1),
  jti: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
  iss: z.string().optional(),
  nombre: z.string().optional(),
});

/** Body de `POST /login`. */
export interface LoginInput {
  usuario: string;
  password: string;
}

export const ZLoginInput: z.ZodType<LoginInput> = z.object({
  usuario: z.string().min(1, "Falta el usuario"),
  password: z.string().min(1, "Falta la contraseña"),
}).strict();

/** Respuesta de `POST /login`. */
export interface LoginResult {
  token: string;
  tipo: "Bearer";
  /** Vencimiento ISO. */
  expira: string;
  usuario: { iusuario: string; nombre: string | null };
}


/** Resultado de un intento de login (auditoría). */
export type LoginOutcome = "ok" | "fallo" | "bloqueado";

/** Motivo del intento: qué se decidió y por qué. */
export type LoginReason =
  | "credenciales"
  | "usuario_inexistente"
  | "usuario_inactivo"
  | "bloqueo"
  | "dispositivo_nuevo"
  | "viaje_imposible"
  | "politica_password";

/** Datos del cliente derivados del request (auditoría y detección). */
export interface DeviceInfo {
  /** IP real (primer salto de `X-Forwarded-For`). */
  ip: string;
  userAgent: string;
  /** `escritorio` | `movil` | `tablet` | `bot` | `desconocido`. */
  dispositivo: string;
  /** Sistema operativo deducido del user-agent. */
  so: string;
  /** Navegador deducido del user-agent. */
  navegador: string;
  /** Huella estable del dispositivo (hash de user-agent), para detectar equipos nuevos. */
  huella: string;
}

/** Sesión activa tal como la ve `GET /sessions` (sin token). */
export interface SessionInfo {
  jti: string;
  emitido: string | null;
  expira: string | null;
  ultimoAcceso: string | null;
  ip: string | null;
  userAgent: string | null;
  dispositivo: string | null;
  so: string | null;
  navegador: string | null;
  /** `true` en la sesión que hace la consulta. */
  actual: boolean;
}

/** Evento de auditoría tal como lo ve `GET /events`. */
export interface AuditEventInfo {
  ievento: string;
  iusuario: string | null;
  accion: string;
  entidad: string | null;
  entidadId: string | null;
  ip: string | null;
  userAgent: string | null;
  dispositivo: string | null;
  jdata: unknown;
  creado: string | null;
}

/** Filtros de `GET /events`. */
export interface AuditQuery {
  iusuario?: string | undefined;
  accion?: string | undefined;
  desde?: string | undefined;
  hasta?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export const ZAuditQuery: z.ZodType<AuditQuery> = z.object({
  iusuario: z.string().min(1).optional(),
  accion: z.string().min(1).optional(),
  desde: z.string().min(1).optional(),
  hasta: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).strict()
  .refine((q) => q.desde === undefined || !Number.isNaN(new Date(q.desde).getTime()), {
    message: "desde no es una fecha válida",
    path: ["desde"],
  })
  .refine((q) => q.hasta === undefined || !Number.isNaN(new Date(q.hasta).getTime()), {
    message: "hasta no es una fecha válida",
    path: ["hasta"],
  });

/** Body de `PUT /password`. */
export interface PasswordChangeInput {
  actual: string;
  nueva: string;
}

export const ZPasswordChangeInput: z.ZodType<PasswordChangeInput> = z.object({
  actual: z.string().min(1, "Falta la contraseña actual"),
  nueva: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
}).strict();

/** Configuración de `IdentityClient` (el lado cliente del plugin). */
export interface IdentityClientConfig {
  /** URL base del API (con su basePath), p.ej. `https://api.x.com/api`. */
  baseUrl: string;
  fetch?: typeof fetch | undefined;
  /** Token inicial (p.ej. recuperado de un almacenamiento propio). */
  token?: string | null | undefined;
  /** Aviso al cambiar el token (login → token, logout → null): para persistirlo donde la app decida. */
  onToken?: ((token: string | null) => void) | undefined;
}