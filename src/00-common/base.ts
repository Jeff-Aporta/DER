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
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/objetos.md
 */
import type { ColumnType } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";

export { Obj, ObjError } from "@Jeff-Aporta/wc-base/lib/obj.ts";

// ===================================================================================== errores

/** Error con status HTTP: el Router lo responde tal cual (`{ error: message }`) y el client lo relanza. */
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

/** No encontrado (404): en el client, cuando una ruta que no es get/put/delete singular responde 404. */
export class NotFoundError extends HttpError {
  constructor(message = "No encontrado") {
    super(404, message);
    this.name = "NotFoundError";
  }
}

// ===================================================================================== casteos
// Todos reciben `unknown` y devuelven el tipo destino o `null`. `undefined` nunca llega: el setter lo conserva.

/** Texto: `Date` → ISO, objeto → JSON, `null`/`undefined` → `null`. */
export function toStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Entero truncado (`"3.9"` → 3, `true` → 1); no numérico → `null`. */
export function toInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Número decimal; no numérico → `null`. */
export function toFloat(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const TRUE_STRINGS = new Set(["1", "true", "t", "yes", "y", "si", "sí", "s", "on"]);

/** Booleano permisivo: números ≠ 0, `"1" "true" "si" "s" "on"…` → `true`. */
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

/** Fecha-hora ISO 8601: `YYYY-MM-DD`, opcional `T`/espacio + `HH:MM[:SS[.fff]]`, opcional zona `Z`/`±HH:MM`/`±HHMM`. */
export const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Fecha-hora como `Date` (copia). Texto: SOLO ISO 8601 (`ISO_DATETIME`); sin zona se lee como UTC, nunca como la
 * zona local del proceso (así el dato no se corre al cambiar país o servidor). Número: epoch ms. Inválido → `null`.
 */
export function toDateTime(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date || typeof v === "number") {
    const d = new Date(v instanceof Date ? v.getTime() : v);
    return isNaN(d.getTime()) ? null : d;
  }
  const m = ISO_DATETIME.exec(String(v).trim());
  if (!m) return null;
  const [, dia, hm = "00:00", ss = "00", frac = "", zona = "Z"] = m;
  const ms = (frac + "000").slice(0, 3);
  const z = zona.length === 5 ? `${zona.slice(0, 3)}:${zona.slice(3)}` : zona.toUpperCase();
  const d = new Date(`${dia}T${hm}:${ss}.${ms}${z}`);
  return isNaN(d.getTime()) ? null : d;
}

/** Fecha-hora como texto ISO 8601 en UTC (`2024-02-29T10:00:00.000Z`), el formato único de transporte y almacenamiento. */
export function toIso(v: unknown): string | null {
  return toDateTime(v)?.toISOString() ?? null;
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

/** Casteo por tipo de columna (lo que aplica cada setter del POJO). */
export const CASTS: Record<ColumnType, (v: unknown) => unknown> = { string: toStr, text: toStr, uuid: toStr, int: toInt, bigint: toInt, float: toFloat, decimal: toFloat, bool: toBool, date: toDate, datetime: toDateTime, time: toTime, json: toJson };
