/**
 * Derivación de IP y dispositivo desde el request, sin dependencias: IP real por `X-Forwarded-For`,
 * user-agent, SO, navegador y una huella estable (hash del user-agent) para detectar equipos nuevos.
 */
import type { DeviceInfo } from "@Jeff-Aporta/DER/src/03 plugins/identity/schemas.ts";
import { b64urlEncode } from "@Jeff-Aporta/DER/src/03 plugins/identity/Controladores/crypto.ts";

const UNKNOWN = "desconocido";
const enc = new TextEncoder();

/** IP real: primer salto de `X-Forwarded-For`, luego `X-Real-IP`; sin socket en la API Web. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || UNKNOWN;
}

function soOf(ua: string): string {
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Linux/i.test(ua)) return "Linux";
  return UNKNOWN;
}

function navegadorOf(ua: string): string {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua)) return "Safari";
  return UNKNOWN;
}

function dispositivoOf(ua: string): string {
  if (/bot|crawler|spider|curl\/|wget\/|python-requests|axios\//i.test(ua)) return "bot";
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return "tablet";
  if (/Mobile|Android|iPhone|iPod/i.test(ua)) return "movil";
  return ua ? "escritorio" : UNKNOWN;
}

/** Huella estable del equipo: hash del user-agent (no identifica al usuario, sólo al navegador). */
export async function huellaOf(ua: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(ua || UNKNOWN));
  return b64urlEncode(new Uint8Array(digest)).slice(0, 22);
}

/** Datos de auditoría del request (IP, user-agent, SO, navegador, tipo de equipo y huella). */
export async function deviceInfo(req: Request): Promise<DeviceInfo> {
  const userAgent = req.headers.get("user-agent")?.slice(0, 400) ?? "";
  return {
    ip: clientIp(req),
    userAgent,
    dispositivo: dispositivoOf(userAgent),
    so: soOf(userAgent),
    navegador: navegadorOf(userAgent),
    huella: await huellaOf(userAgent),
  };
}
