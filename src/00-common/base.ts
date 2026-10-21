/**
 * Base transversal: `Obj` (operaciones virtuales sobre JSON, de iswc por CDN), los errores HTTP y los casteos
 * de los setters de los POJOs. Todo en un archivo: sin ramificaciones para lo que es diminuto.
 *
 *   Obj.insert(base, cambios, molde?)  upsert profundo: lo no mencionado se conserva; `null` quita según el molde.
 *   Obj.insertIgnore(base, nuevos)     agrega solo lo que NO existe (no pisa).
 *   Obj.update(base, cambios)          cambia solo lo que YA existe (no crea).
 *   Obj.replace(base, valor)           reemplazo directo (lo que aplica cuando no hay molde Zod).
 *   Obj.delete(base, query)            quita lo que marque la consulta.
 *   Obj.get(base, query)               la estructura desde la raíz con solo lo marcado.
 *   Obj.getValue(base, query)          el valor exacto de la única hoja marcada (`null` si no existe).
 *   Obj.aplicar(base, acciones)        las anteriores en orden (`TAccionObj[]`).
 *
 * Doc de Obj: https://cdn.jsdelivr.net/gh/Jeff-Aporta/is-webcomponents@main/src/vendor-distributions/shared/lib/obj.md
 */
import type { ColumnType } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";

export { Obj, ObjError } from "@Jeff-Aporta/wc-base/lib/obj.ts";

// ===================================================================================== errores

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** Error de verificación (lo que retorna un pre*). HTTP 400. */
export class ValidationError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "No encontrado") {
    super(404, message);
    this.name = "NotFoundError";
  }
}

// ===================================================================================== casteos
// Todos reciben `unknown` y devuelven el tipo destino o `null`. `undefined` nunca llega: el setter lo conserva.

export function toStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function toInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function toFloat(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const TRUE_STRINGS = new Set(["1", "true", "t", "yes", "y", "si", "sí", "s", "on"]);

export function toBool(v: unknown): boolean | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number" || typeof v === "bigint") return Number(v) !== 0;
  if (typeof v === "string") return TRUE_STRINGS.has(v.trim().toLowerCase());
  return Boolean(v);
}

/** Fecha sin hora, siempre `YYYY-MM-DD` (evita corrimientos por zona horaria). */
export function toDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function toDateTime(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(v as string | number);
  return isNaN(d.getTime()) ? null : d;
}

/** Hora sin fecha, siempre `HH:MM:SS`. */
export function toTime(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(11, 19);
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v));
  if (!m) return null;
  const [, h = "0", mm = "00", ss = "00"] = m;
  return `${h.padStart(2, "0")}:${mm}:${ss}`;
}

/** JSON: se conserva el valor tal cual (los drivers/transportes ya entregan objetos). */
export function toJson(v: unknown): unknown {
  return v === undefined ? null : v;
}

export const CASTS: Record<ColumnType, (v: unknown) => unknown> = { string: toStr, text: toStr, uuid: toStr, int: toInt, bigint: toInt, float: toFloat, decimal: toFloat, bool: toBool, date: toDate, datetime: toDateTime, time: toTime, json: toJson };
