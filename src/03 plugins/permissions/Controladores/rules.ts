/**
 * Reglas puras (sin BD) del vector de acciones, las mismas de SEG de ISS:
 *
 * - Valor efectivo de un id para un método: el del rol y, si no lo trae, el del rol base. `"*"` es el
 *   comodín de cualquier id (el del id exacto gana).
 * - Un valor partido por verbo (`{ "GET": true, "PUT": false }`: todas sus claves son verbos) aporta sólo
 *   el del método; si no lo trae, cae al siguiente.
 * - Decisión (la ruta ya exigió JWT): sin valor o `{ "protected": true }` pasa; `false` niega;
 *   `true`, un objeto o un texto pasan y el valor viaja al handler (`ctx.state.permiso`).
 */
import type { AuthDecision } from "@Jeff-Aporta/DER/src/02 controllers/server/schemas.ts";

const VERBOS: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** `{ protected: boolean }` sola: sólo pide JWT. */
function isProtectedOnly(v: unknown): boolean {
  return isRecord(v) && Object.keys(v).length === 1 && typeof v["protected"] === "boolean";
}

function byVerb(v: unknown, method: string): { found: boolean; value: unknown } {
  if (!isRecord(v) || !Object.keys(v).length || !Object.keys(v).every((k) => VERBOS.has(k.toUpperCase()))) {
    return { found: true, value: v };
  }
  const entry = Object.entries(v).find(([k]) => k.toUpperCase() === method.toUpperCase());
  return entry ? { found: true, value: entry[1] } : { found: false, value: undefined };
}

/** Valor efectivo de `id` para `method` (rol primero, luego base; id exacto antes que `"*"`). */
export function effectiveValue(
  base: ReadonlyMap<string, unknown>,
  rol: ReadonlyMap<string, unknown> | null,
  id: string,
  method: string,
): unknown {
  for (const map of [rol, base]) {
    if (!map) continue;
    for (const key of [id, "*"]) {
      if (!map.has(key)) continue;
      const r = byVerb(map.get(key), method);
      if (r.found) return r.value;
    }
  }
  return undefined;
}

/** Decisión para una ruta protegida (con identidad). */
export function decide(
  base: ReadonlyMap<string, unknown>,
  rol: ReadonlyMap<string, unknown> | null,
  id: string,
  method: string,
  denyByDefault = false,
): AuthDecision {
  const v = effectiveValue(base, rol, id, method);
  if (v === undefined && denyByDefault) return { allowed: false, reason: `Sin permiso definido: ${id}` };
  if (v === undefined || isProtectedOnly(v)) return { allowed: true, value: true };
  if (v === false || v === "false") return { allowed: false, reason: `Sin permiso: ${id}` };
  return { allowed: true, value: v };
}
