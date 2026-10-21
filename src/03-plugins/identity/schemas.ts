/**
 * schemas.ts (plugin de identidad) — tipos (uno por línea) y contratos Zod compartidos por client y server. Sólo `zod`.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/identity.md
 */
import { z } from "zod";

/** Política de contraseña (mínimos): `minLength` default 8, nunca menos de 8. */
export type IdentityPasswordPolicy = { minLength?: number | undefined };
/** Viaje imposible básico: sin geolocalización, un cambio de IP en una ventana corta es sospechoso. `block` bloquea además de auditar. */
export type IdentityTravelConfig = { enabled?: boolean | undefined; minMinutes?: number | undefined; block?: boolean | undefined };
/** Endurecimiento del login: fallos permitidos por IP o usuario en `windowSeconds` (default 5 / 900), duración del bloqueo, dispositivo nuevo, viaje imposible, política de contraseña. */
export type IdentitySecurityConfig = { maxAttempts?: number | undefined; windowSeconds?: number | undefined; lockSeconds?: number | undefined; blockNewDevice?: boolean | undefined; travel?: IdentityTravelConfig | undefined; password?: IdentityPasswordPolicy | undefined };
/** Modo de firma del JWT: `HS384` (simétrico, default) o `ES256` (asimétrico: `privateJwk` firma, `publicJwk` verifica y se publica en el JWKS). */
export type IdentityJwtConfig = { alg?: "HS384" | "ES256" | undefined; kid?: string | undefined; privateJwk?: Record<string, unknown> | undefined; publicJwk?: Record<string, unknown> | undefined };
/** Emisor de confianza: tokens ES256 firmados por las llaves de su JWKS se aceptan. */
export type TrustedIssuer = { name: string; jwksUrl: string; issuer?: string | undefined };
/**
 * Configuración del plugin de identidad (`createServer(identityServer, { db, cfg })`): `secret` firma el JWT HS384 (mín. 32,
 * admite `"env:NOMBRE"`); `pepper` del hash (si falta, `secret`); `expiresIn` segundos (default 86400); `issuer` claim `iss`;
 * `iterations` PBKDF2 (default 100000); `admin` usuario que crea `seed()`; `security` endurecimiento; `jwt` modo de firma;
 * `trustProxy` saltos de confianza para la IP real; `trustedIssuers` emisores externos.
 */
export type IdentityConfig = { secret: string; pepper?: string | undefined; expiresIn?: number | undefined; issuer?: string | undefined; iterations?: number | undefined; admin?: { usuario: string; password: string; nombre?: string | undefined } | undefined; security?: IdentitySecurityConfig | undefined; jwt?: IdentityJwtConfig | undefined; trustProxy?: number | undefined; trustedIssuers?: TrustedIssuer[] | undefined };
/** Zod estricto de `IdentitySecurityConfig` (rangos de intentos, ventanas, política). */
export const ZIdentitySecurityConfig: z.ZodType<IdentitySecurityConfig> = z.object({ maxAttempts: z.number().int().min(1).max(100).optional(), windowSeconds: z.number().int().min(1).max(86_400).optional(), lockSeconds: z.number().int().min(1).max(86_400).optional(), blockNewDevice: z.boolean().optional(), travel: z.object({ enabled: z.boolean().optional(), minMinutes: z.number().int().min(0).max(1440).optional(), block: z.boolean().optional() }).strict().optional(), password: z.object({ minLength: z.number().int().min(8).max(256).optional() }).strict().optional() }).strict();
/** Zod estricto de `IdentityConfig` (claves desconocidas se rechazan). */
export const ZIdentityConfig: z.ZodType<IdentityConfig> = z.object({ secret: z.string().min(1, "secret es obligatorio"), pepper: z.string().min(32, "pepper debe tener al menos 32 caracteres").optional(), expiresIn: z.number().int().positive().optional(), issuer: z.string().optional(), iterations: z.number().int().min(10000).max(100000).optional(), admin: z.object({ usuario: z.string().min(1), password: z.string().min(8), nombre: z.string().optional() }).strict().optional(), security: ZIdentitySecurityConfig.optional(), trustProxy: z.number().int().min(0).max(10).optional(), trustedIssuers: z.array(z.object({ name: z.string().min(1), jwksUrl: z.string().url(), issuer: z.string().optional() }).strict()).optional(), jwt: z.object({ alg: z.enum(["HS384", "ES256"]).optional(), kid: z.string().min(1).optional(), privateJwk: z.record(z.string(), z.unknown()).optional(), publicJwk: z.record(z.string(), z.unknown()).optional() }).strict().optional() }).strict();
/** Claims del JWT (identidad, nunca permisos: el rol se lee en cada request). `jti` = id de la sesión (permite revocar). */
export type JwtClaims = { sub: string; jti: string; iat: number; exp: number; iss?: string | undefined; nombre?: string | undefined };
/** Zod de los claims aceptados al verificar un token. */
export const ZJwtClaims: z.ZodType<JwtClaims> = z.object({ sub: z.string().min(1), jti: z.string().min(1), iat: z.number().int(), exp: z.number().int(), iss: z.string().optional(), nombre: z.string().optional() });
/** Entrada del caché de JWKS por URL. */
export type JwksCacheEntry = { jwks: { keys: Record<string, unknown>[] }; exp: number };
/** Body de `POST /login`. */
export type LoginInput = { usuario: string; password: string };
/** Zod del body de login (mismo en client y server). */
export const ZLoginInput: z.ZodType<LoginInput> = z.object({ usuario: z.string().min(1, "Falta el usuario"), password: z.string().min(1, "Falta la contraseña") }).strict();
/** Respuesta de `POST /login`. */
export type LoginResult = { token: string; tipo: "Bearer"; expira: string; usuario: { iusuario: string; nombre: string | null } };
/** Resultado de un intento de login (auditoría). */
export type LoginOutcome = "ok" | "fallo" | "bloqueado";
/** Motivo del intento: qué se decidió y por qué. */
export type LoginReason = "credenciales" | "usuario_inexistente" | "usuario_inactivo" | "bloqueo" | "dispositivo_nuevo" | "viaje_imposible" | "politica_password";
/** Datos del cliente derivados del request (auditoría y detección): IP real, user-agent, tipo de equipo, SO, navegador y huella estable. */
export type DeviceInfo = { ip: string; userAgent: string; dispositivo: string; so: string; navegador: string; huella: string };
/** Sesión activa tal como la ve `GET /sessions` (sin token); `actual` marca la que consulta. */
export type SessionInfoView = { jti: string; emitido: string | null; expira: string | null; ultimoAcceso: string | null; ip: string | null; userAgent: string | null; dispositivo: string | null; so: string | null; navegador: string | null; actual: boolean };
/** Evento de auditoría tal como lo ve `GET /events`. */
export type AuditEventInfo = { ievento: string; iusuario: string | null; accion: string; entidad: string | null; entidadId: string | null; ip: string | null; userAgent: string | null; dispositivo: string | null; jdata: unknown; creado: string | null };
/** Filtros de `GET /events`. */
export type AuditQuery = { iusuario?: string | undefined; accion?: string | undefined; desde?: string | undefined; hasta?: string | undefined; limit?: number | undefined; offset?: number | undefined };
/** Zod de los filtros de `events` (coerción de `limit`/`offset`, fechas válidas). */
export const ZAuditQuery: z.ZodType<AuditQuery> = z.object({ iusuario: z.string().min(1).optional(), accion: z.string().min(1).optional(), desde: z.string().min(1).optional(), hasta: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional() }).strict().refine((q) => q.desde === undefined || !Number.isNaN(new Date(q.desde).getTime()), { message: "desde no es una fecha válida", path: ["desde"] }).refine((q) => q.hasta === undefined || !Number.isNaN(new Date(q.hasta).getTime()), { message: "hasta no es una fecha válida", path: ["hasta"] });
/** Body de `PUT /password`. */
export type PasswordChangeInput = { actual: string; nueva: string };
/** Zod del body de cambio de contraseña (nueva ≥ 8). */
export const ZPasswordChangeInput: z.ZodType<PasswordChangeInput> = z.object({ actual: z.string().min(1, "Falta la contraseña actual"), nueva: z.string().min(8, "La contraseña debe tener al menos 8 caracteres") }).strict();
/** Estado derivado de la configuración que el server de identidad guarda en `plugin.state` (lo arma `setup`). */
export type IdentityState = { secret: string; pepper: string; alg: "HS384" | "ES256"; iterations: number; expiresIn: number; trustProxy: number; trustedIssuers: TrustedIssuer[]; maxAttempts: number; windowSeconds: number; lockSeconds: number; blockNewDevice: boolean; travelEnabled: boolean; travelMinMinutes: number; travelBlock: boolean; minLength: number; ventanaMs: number; jwksCache: Map<string, JwksCacheEntry>; es256Keys?: Promise<CryptoKeyPair> | undefined };
