/**
 * schemas.ts (plugin de identidad) — tipos y contratos Zod compartidos por client y server. Sólo `zod`:
 * lo puede importar el front sin arrastrar nada del servidor.
 */
import { z } from "zod";

/** Configuración del plugin de identidad (sección `identity` del JSON global). */
export interface IdentityConfig {
  /** Default true cuando la sección existe. */
  enabled?: boolean | undefined;
  /** Secret key: firma de JWT y pepper del hash. Admite `"env:NOMBRE"` (se lee de `env`). Mínimo 32 caracteres. */
  secret: string;
  /** Vigencia del token en segundos (default 86400 = 24 h). */
  expiresIn?: number | undefined;
  /** Claim `iss` (opcional; si se define, también se exige al verificar). */
  issuer?: string | undefined;
  /** Iteraciones PBKDF2 (default 100000, el máximo que admite Cloudflare Workers). */
  iterations?: number | undefined;
  /** Usuario administrador que se crea en `router.seed()` si no existe. */
  admin?: { usuario: string; password: string; nombre?: string | undefined } | undefined;
}

export const ZIdentityConfig: z.ZodType<IdentityConfig> = z.object({
  enabled: z.boolean().optional(),
  secret: z.string().min(1, "identity.secret es obligatorio"),
  expiresIn: z.number().int().positive().optional(),
  issuer: z.string().optional(),
  iterations: z.number().int().min(10000).max(100000).optional(),
  admin: z.object({ usuario: z.string().min(1), password: z.string().min(8), nombre: z.string().optional() }).strict()
    .optional(),
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
