/**
 * Criptografía de identidad sobre WebCrypto (Deno, Node, Workers, navegador): sin dependencias.
 *
 * - Contraseñas: PBKDF2-SHA256 (sal aleatoria de 16 bytes) sobre HMAC-SHA256(secret, contraseña): la secret
 *   key actúa de *pepper*, así un volcado de la tabla sin la secret no sirve para atacar los hashes.
 *   Formato guardado: `pbkdf2-sha256$<iteraciones>$<sal b64url>$<hash b64url>`.
 * - JWT: HS384. La verificación SOLO acepta HS384 (un `alg: none` u otro se rechaza aunque la firma cuadre),
 *   compara la firma con `crypto.subtle.verify` (tiempo constante) y distingue vencido de inválido.
 */
import { HttpError } from "@Jeff-Aporta/DER/src/00 common/errors.ts";
import { type JwtClaims, ZJwtClaims } from "@Jeff-Aporta/DER/src/03 plugins/identity/schemas.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Id aleatorio url-safe (sesiones, `jti`). */
export function randomId(bytes = 16): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

function hmacKey(secret: string, hash: "SHA-256" | "SHA-384"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign", "verify"]);
}

/** Comparación en tiempo constante de dos arreglos de bytes. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function derive(password: string, secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const peppered = await crypto.subtle.sign("HMAC", await hmacKey(secret, "SHA-256"), enc.encode(password));
  const key = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, secret: string, iterations = 100_000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, secret, salt, iterations);
  return ["pbkdf2-sha256", String(iterations), b64urlEncode(salt), b64urlEncode(hash)].join("$");
}

export async function verifyPassword(password: string, stored: string, secret: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split("$");
  if (algo !== "pbkdf2-sha256" || !iter || !salt || !hash) return false;
  const iterations = Number(iter);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const computed = await derive(password, secret, b64urlDecode(salt), iterations);
  return timingSafeEqual(computed, b64urlDecode(hash));
}

const JWT_HEADER = b64urlEncode(enc.encode(JSON.stringify({ alg: "HS384", typ: "JWT" })));

export async function signJwt(claims: JwtClaims, secret: string): Promise<string> {
  const body = `${JWT_HEADER}.${b64urlEncode(enc.encode(JSON.stringify(claims)))}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "SHA-384"), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

const invalid = (detalle: string) => new HttpError(401, `Token inválido: ${detalle}`);

/** Verifica firma, algoritmo, forma y vigencia. Lanza `HttpError(401)` ("Token vencido" / "Token inválido: ..."). */
export async function verifyJwt(
  token: string,
  secret: string,
  opts: { issuer?: string | undefined; now?: number } = {},
): Promise<JwtClaims> {
  const parts = token.split(".");
  const [h, p, s] = parts;
  if (parts.length !== 3 || !h || !p || !s) throw invalid("formato");
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(dec.decode(b64urlDecode(h)));
    payload = JSON.parse(dec.decode(b64urlDecode(p)));
  } catch {
    throw invalid("no es JSON");
  }
  if (!header || typeof header !== "object" || (header as Record<string, unknown>)["alg"] !== "HS384") {
    throw invalid("algoritmo no admitido");
  }
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "SHA-384"), b64urlDecode(s), enc.encode(`${h}.${p}`));
  if (!ok) throw invalid("firma");
  const claims = ZJwtClaims.safeParse(payload);
  if (!claims.success) throw invalid("claims");
  if (opts.issuer !== undefined && claims.data.iss !== opts.issuer) throw invalid("emisor");
  if (claims.data.exp * 1000 <= (opts.now ?? Date.now())) throw new HttpError(401, "Token vencido");
  return claims.data;
}
