/**
 * ui-config.ts — carga y valida (Zod, `safeParse`) los JSON de UI: `ui/app.json`, `ui/entidades/<plural>.json`,
 * `ui/flujos.json` y `ui/reportes.json`, con caché. Un JSON de entidad que no existe es `{}` (todo derivado del schema).
 */
import { type AppUi, type EntidadUi, type FlujoUi, type ReporteUi, ZAppUi, ZEntidadUi, ZFlujosUi, ZReportesUi } from "../consts/schemas/ui.schemas.ts";
import type { z } from "@megaretail/vendor";

let base = "./ui/";
const cache = new Map<string, Promise<unknown>>();

/** Carpeta de los JSON (relativa a la página). */
export function configurarUi(carpeta: string): void {
  base = carpeta.endsWith("/") ? carpeta : `${carpeta}/`;
  cache.clear();
}

async function leer<T>(ruta: string, schema: z.ZodType<T>, opcional: boolean): Promise<T> {
  const key = ruta;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const res = await fetch(`${base}${ruta}`, { cache: "no-cache" });
      if (res.status === 404 && opcional) return schema.parse({});
      if (!res.ok) throw new Error(`No se pudo cargar ${ruta} (${res.status})`);
      const r = schema.safeParse(await res.json());
      if (!r.success) throw new Error(`${ruta}: ${r.error.issues[0]?.message ?? "JSON inválido"}`);
      return r.data;
    })());
  }
  return await cache.get(key) as T;
}

/** `ui/app.json`. */
export function appUi(): Promise<AppUi> {
  return leer("app.json", ZAppUi, false);
}

/** Nombre de archivo del JSON de una entidad: el plural con `/` → `_` (`permisos/roles` → `permisos_roles.json`). */
export function archivoEntidad(plural: string): string {
  return `entidades/${plural.replace(/\//g, "_")}.json`;
}

/** JSON de UI de una entidad (vacío si no existe). */
export function entidadUi(plural: string): Promise<EntidadUi> {
  return leer(archivoEntidad(plural), ZEntidadUi, true);
}

/** `ui/flujos.json`. */
export function flujosUi(): Promise<Record<string, FlujoUi>> {
  return leer("flujos.json", ZFlujosUi, false);
}

/** `ui/reportes.json`. */
export function reportesUi(): Promise<Record<string, ReporteUi>> {
  return leer("reportes.json", ZReportesUi, false);
}
