/**
 * Utilidades comunes a los motores. El contrato `Engine` está en `./schema.ts`; cada implementación vive
 * en su carpeta (`server/pg`, `server/sqlite`, ...) y el ServerController sólo arma la consulta con esas
 * primitivas (Kysely compila la sintaxis y los parámetros).
 */
import type { IdentifierCase } from "@Jeff-Aporta/DER/src/02 controllers/server/schemas.ts";

export function dateToIso(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

export function parseMaybe(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export function applyCase(name: string, c: IdentifierCase): string {
  return c === "lower" ? name.toLowerCase() : c === "upper" ? name.toUpperCase() : name;
}
