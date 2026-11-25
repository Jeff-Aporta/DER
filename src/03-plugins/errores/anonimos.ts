/**
 * Reportes anónimos del plugin de errores (sin sesión): llave pública que rota cada día (seguridad débil a propósito: solo
 * evita el ruido de bots tontos), límite de 5 por minuto por IP y por huella de equipo, y bloqueo por abuso de 24 h que, si
 * persiste, sube a 48 h. Con sesión confiable nada de esto aplica. El estado vive en memoria del proceso (un isolate de
 * Workers lo pierde al reciclarse): para una barrera que sobreviva, combina con `penalizaciones` (tabla) en el consumidor.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/errores.md
 */
import { HttpError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { firmarHmac, timingSafeEqual } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { ipReal } from "@Jeff-Aporta/DER/src/03-plugins/common/servicios.ts";
import type { ErroresConfig, LlaveDelDia } from "@Jeff-Aporta/DER/src/03-plugins/errores/schemas.ts";

const MINUTO = 60_000;
const HORA = 3_600_000;
const DIA = 86_400_000;
const SEMANA = 7 * DIA;

/** Estado de abuso por clave (IP o huella): marcas del último minuto, infracciones y bloqueos pasados. */
const estados = new WeakMap<object, Map<string, { marcas: number[]; infracciones: number[]; bloqueos: number[]; hasta: number }>>();

const diaDe = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Llave pública de un día (`yyyy-mm-dd` UTC): HMAC del día con el secreto del plugin, recortada. */
export async function llaveDe(p: ServerPlugin, dia: string): Promise<string> {
  return (await firmarHmac((p.cfg as ErroresConfig).secret, `llave-publica:${dia}`)).slice(0, 24);
}

/** La llave de hoy con su día y cuándo vence (medianoche UTC). */
export async function llaveDelDia(p: ServerPlugin, ahora = Date.now()): Promise<LlaveDelDia> {
  const dia = diaDe(ahora);
  return { llave: await llaveDe(p, dia), dia, expira: new Date(Date.parse(`${dia}T00:00:00Z`) + DIA).toISOString() };
}

/** ¿La llave es la de hoy o la de ayer (gracia pasada la medianoche)? Comparación en tiempo constante. */
async function llaveValida(p: ServerPlugin, llave: string | undefined, ahora: number): Promise<boolean> {
  if (!llave) return false;
  const dado = new TextEncoder().encode(llave);
  for (const dia of [diaDe(ahora), diaDe(ahora - DIA)]) {
    const esperada = new TextEncoder().encode(await llaveDe(p, dia));
    if (esperada.length === dado.length && timingSafeEqual(esperada, dado)) return true;
  }
  return false;
}

/** 429 con `Retry-After`. */
const limitado = (mensaje: string, seg: number): Response => Response.json({ error: mensaje }, { status: 429, headers: { "retry-after": String(Math.ceil(seg)) } });

/**
 * Puerta de un reporte anónimo: llave del día (403 si falta o es vieja), bloqueo vigente (429), y 5 por minuto por IP y
 * por huella (`x-huella`). Tres excesos en 24 h bloquean 24 h; un nuevo bloqueo dentro de la semana siguiente dura 48 h.
 * Devuelve la respuesta 429 si rechaza, o `null` si pasa.
 */
export async function exigirAnonimo(p: ServerPlugin, llave: string | undefined, req: Request | undefined, ahora = Date.now()): Promise<Response | null> {
  const cfg = p.cfg as ErroresConfig;
  if (!(await llaveValida(p, llave, ahora))) throw new HttpError(403, "Llave pública del día inválida o vencida: pídela en errores/llave");
  const mapa = estados.get(p) ?? new Map<string, { marcas: number[]; infracciones: number[]; bloqueos: number[]; hasta: number }>();
  estados.set(p, mapa);
  const claves = [`ip:${ipReal(p, req) ?? "?"}`, ...(req?.headers.get("x-huella") ? [`huella:${req.headers.get("x-huella")!.slice(0, 120)}`] : [])];
  const estadosClave = claves.map((k) => {
    const e = mapa.get(k) ?? { marcas: [], infracciones: [], bloqueos: [], hasta: 0 };
    mapa.set(k, e);
    return e;
  });
  const bloqueado = estadosClave.find((e) => e.hasta > ahora);
  if (bloqueado) return limitado("Los reportes anónimos están bloqueados por abuso; inicia sesión para reportar", (bloqueado.hasta - ahora) / 1000);
  for (const e of estadosClave) {
    e.marcas = e.marcas.filter((t) => t > ahora - MINUTO);
    e.infracciones = e.infracciones.filter((t) => t > ahora - DIA);
    e.bloqueos = e.bloqueos.filter((t) => t > ahora - SEMANA);
  }
  if (estadosClave.some((e) => e.marcas.length >= cfg.anonimoPorMin)) {
    for (const e of estadosClave) {
      e.infracciones.push(ahora);
      if (e.infracciones.length >= cfg.infraccionesParaBloqueo) {
        const horas = e.bloqueos.length ? cfg.bloqueoPersistenteHoras : cfg.bloqueoHoras;
        e.hasta = ahora + horas * HORA;
        e.bloqueos.push(ahora);
        e.infracciones = [];
      }
    }
    const hasta = Math.max(...estadosClave.map((e) => e.hasta));
    return limitado(hasta > ahora ? "Abuso de reportes anónimos: bloqueado" : `Máximo ${cfg.anonimoPorMin} reportes por minuto`, hasta > ahora ? (hasta - ahora) / 1000 : 60);
  }
  for (const e of estadosClave) e.marcas.push(ahora);
  return null;
}
