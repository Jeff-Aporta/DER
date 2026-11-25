/**
 * Utilidades de tablas para plugins (CRM, atención…): filas planas, lectura/escritura por llave, ids ordenables por llegada y la
 * resolución de la empresa activa de una petición. Sin estado: todo recibe el plugin armado.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
import type { z } from "zod";
import { ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { randomId } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";

/** Valida con un Zod y lanza 400 con el detalle. */
export function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

/** Fila plana de un pojo (o lo que ya sea plano). */
export const fila = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && "toJSON" in p && typeof (p as { toJSON: unknown }).toJSON === "function" ? (p as { toJSON(): Record<string, unknown> }).toJSON() : (p as Record<string, unknown>));

/** Controller de una entidad del plugin. */
export const ctrl = (plugin: ServerPlugin, nombre: string) => plugin.controllers[nombre]!;

/** Milisegundos de una fecha (texto ISO o Date, según el motor). */
export function ms(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  return Date.parse(String(v));
}

/** Fecha de ahora en ISO (las columnas `datetime` se guardan así en todos los motores). */
export const ahora = (): string => new Date().toISOString();

/** Fecha en ISO desde lo que devuelva el motor (texto o Date). */
export const isoDe = (v: unknown): string => (v == null ? "" : new Date(ms(v)).toISOString());

/** Id ordenable por llegada (base 36 del reloj + azar): el historial se ordena por id sin empates. */
export const idNuevo = (): string => `${Date.now().toString(36).padStart(9, "0")}${randomId(6)}`;

/** Un registro por llave primaria, como fila plana (o null). */
export async function porPk<T>(plugin: ServerPlugin, entidad: string, pk: Record<string, unknown>): Promise<T | null> {
  const c = ctrl(plugin, entidad);
  const p = await c.get(c.pojo(pk), { include: {} } as never);
  return p ? (fila(p) as T) : null;
}

/** Inserta o cambia por llave (mezcla con lo que había) y devuelve la fila final. */
export async function guardar<T>(plugin: ServerPlugin, entidad: string, pk: Record<string, unknown>, datos: Record<string, unknown>): Promise<T> {
  const c = ctrl(plugin, entidad);
  const previa = await porPk<Record<string, unknown>>(plugin, entidad, pk);
  const final = { ...(previa ?? {}), ...datos, ...pk };
  if (previa) await c.put(c.pojo(final));
  else await c.post(c.pojo(final));
  return final as T;
}

/** Filas de una entidad que cumplen `where`, como filas planas. */
export async function filas<T>(plugin: ServerPlugin, entidad: string, consulta: Record<string, unknown>): Promise<T[]> {
  return (await ctrl(plugin, entidad).query(consulta as never)).map(fila) as T[];
}

/** Texto acotado y sin espacios en los bordes (null si queda vacío). */
export function acotado(v: unknown, max: number): string | null {
  const t = typeof v === "string" ? v.trim().slice(0, max) : "";
  return t || null;
}

/** Copia de `obj` sin las claves `undefined` (para mezclar cambios parciales). */
export function sinIndefinidos(obj: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
