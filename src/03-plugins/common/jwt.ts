/**
 * JWT HS256 para servicios de bots: firma, verificación y middleware de autorización sin base de datos.
 * Sobre WebCrypto (Deno, Node y Workers), sin dependencias. El secreto vive en el entorno y nunca se imprime.
 *
 * ```ts
 * registry.secure(jwtSecurityHooks({ secret: env.JWT_SECRET, issuer: "bots" }));
 * const token = await signJwtHs256({ sub: "bot-1", canales: ["general"] }, env.JWT_SECRET, { expiresIn: 3600 });
 * ```
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
import { HttpError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { SecurityHooks, SessionInfo } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { b64urlDecode, b64urlEncode } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import type { JwtHs256Claims, JwtHs256EnvOptions, JwtHs256MiddlewareOptions, JwtHs256SignOptions, JwtHs256VerifyOptions } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const invalid = (detalle: string) => new HttpError(401, `Token inválido: ${detalle}`);
const BEARER = /^Bearer\s+([^\s]+)$/i;

/** Clave HMAC-SHA256 a partir del secreto del entorno. */
async function claveHs256(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error("El secreto JWT HS256 debe tener al menos 32 caracteres");
  return await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Firma un JWT HS256 con `sub`, `iat` y `exp` obligatorios; acepta claims propios del bot. */
export async function signJwtHs256(claims: JwtHs256Claims, secret: string, options: JwtHs256SignOptions = {}): Promise<string> {
  if (!claims.sub) throw new Error("El token JWT necesita `sub`");
  const nowMs = options.now ?? Date.now();
  const now = Math.floor(nowMs / 1000);
  const expiresIn = options.expiresIn ?? 3600;
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("La vida del token JWT debe ser positiva");
  const payload: Record<string, unknown> = { ...claims };
  payload["iat"] = claims.iat ?? now;
  payload["exp"] = claims.exp ?? now + expiresIn;
  if (options.issuer !== undefined) payload["iss"] = options.issuer;
  if (options.audience !== undefined) payload["aud"] = options.audience;
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = `${header}.${b64urlEncode(enc.encode(JSON.stringify(payload)))}`;
  const firma = await crypto.subtle.sign("HMAC", await claveHs256(secret), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(firma))}`;
}

/** Verifica firma, algoritmo, claims, emisor, audiencia y vigencia de un JWT HS256. */
export async function verifyJwtHs256(token: string, secret: string, options: JwtHs256VerifyOptions = {}): Promise<JwtHs256Claims> {
  const partes = token.split(".");
  const [h, p, s] = partes;
  if (partes.length !== 3 || !h || !p || !s) throw invalid("formato");
  let header: unknown;
  let payload: unknown;
  let firma: Uint8Array<ArrayBuffer>;
  try {
    header = JSON.parse(dec.decode(b64urlDecode(h)));
    payload = JSON.parse(dec.decode(b64urlDecode(p)));
    firma = b64urlDecode(s);
  } catch {
    throw invalid("no es JSON");
  }
  if (!header || typeof header !== "object" || (header as Record<string, unknown>)["alg"] !== "HS256") {
    throw invalid("algoritmo no admitido");
  }
  const ok = await crypto.subtle.verify("HMAC", await claveHs256(secret), firma, enc.encode(`${h}.${p}`));
  if (!ok) throw invalid("firma");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw invalid("claims");
  const claims = payload as Record<string, unknown>;
  if (typeof claims["sub"] !== "string" || !claims["sub"]) throw invalid("claims");
  if (typeof claims["exp"] !== "number" || !Number.isFinite(claims["exp"])) throw invalid("claims");
  if (options.issuer !== undefined && claims["iss"] !== options.issuer) throw invalid("emisor");
  if (options.audience !== undefined) {
    const aud = claims["aud"];
    const coincide = aud === options.audience || Array.isArray(aud) && aud.includes(options.audience);
    if (!coincide) throw invalid("audiencia");
  }
  const nowMs = options.now ?? Date.now();
  const tolerancia = (options.clockToleranceSec ?? 0) * 1000;
  if (claims["exp"] * 1000 <= nowMs - tolerancia) throw new HttpError(401, "Token vencido");
  if (typeof claims["nbf"] === "number" && claims["nbf"] * 1000 > nowMs + tolerancia) {
    throw new HttpError(401, "Token todavía no válido");
  }
  return claims as JwtHs256Claims;
}

/** Convierte los claims de un bot en la sesión transversal de DER. */
export function jwtSession(claims: JwtHs256Claims): SessionInfo {
  const role = claims["role"] ?? claims["rol"];
  return { id: claims.sub, claims, ...(typeof role === "string" ? { role } : {}) };
}

/** Middleware: `Authorization: Bearer` → sesión; sin cabecera devuelve `null`. Un token inválido lanza 401. */
export function jwtAuthMiddleware(options: JwtHs256MiddlewareOptions): (req: Request) => Promise<SessionInfo | null> {
  return async (req: Request): Promise<SessionInfo | null> => {
    const header = req.headers.get("authorization");
    if (!header) return null;
    const token = BEARER.exec(header)?.[1];
    if (!token) throw new HttpError(401, "Token inválido: se espera `Authorization: Bearer <token>`");
    const claims = await verifyJwtHs256(token, options.secret, options);
    return jwtSession(claims);
  };
}

/** Middleware HS256 que toma el secreto del entorno (`JWT_SECRET` por defecto). */
export function jwtAuthMiddlewareFromEnv(env: Record<string, string | undefined>, options: JwtHs256EnvOptions = {}): (req: Request) => Promise<SessionInfo | null> {
  const nombre = options.secretEnv ?? "JWT_SECRET";
  const secret = env[nombre];
  if (!secret) throw new Error(`Variable de entorno no definida: ${nombre}`);
  return jwtAuthMiddleware({
    secret,
    ...(options.issuer !== undefined ? { issuer: options.issuer } : {}),
    ...(options.audience !== undefined ? { audience: options.audience } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.clockToleranceSec !== undefined ? { clockToleranceSec: options.clockToleranceSec } : {}),
  });
}

/** Puertas de seguridad DER con JWT HS256: el registro extrae la sesión de cada request. */
export function jwtSecurityHooks(options: JwtHs256MiddlewareOptions): SecurityHooks {
  return { extract: jwtAuthMiddleware(options) };
}
