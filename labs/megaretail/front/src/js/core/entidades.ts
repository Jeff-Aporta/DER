/**
 * entidades.ts — resolución de una entidad para la UI: su `Entity` de DER, su JSON de UI, su título y la función de
 * etiqueta de filas; y la de las entidades destino de sus relaciones (para grillas y selectores).
 */
import type { Entity } from "@Jeff-Aporta/DER/index.ts";
import type { EntidadUi } from "../consts/schemas/ui.schemas.ts";
import { entidad, entidadPorNombre } from "./der.ts";
import { etiquetaFila, relacionesUno } from "./grid-model.ts";
import { etiquetaDe } from "./form-model.ts";
import { appUi, entidadUi } from "./ui-config.ts";

/** Entidad resuelta para la UI. */
export type EntidadResuelta = { plural: string; entity: Entity<any>; ui: EntidadUi; titulo: string; etiqueta(fila: Record<string, unknown>): string };

const cache = new Map<string, Promise<EntidadResuelta>>();

/** Título de una entidad: JSON de UI, luego `app.json`, luego el plural con mayúscula. */
async function tituloDe(plural: string, ui: EntidadUi): Promise<string> {
  if (ui.titulo) return ui.titulo;
  const app = await appUi();
  return app.entidades[plural]?.titulo ?? etiquetaDe(plural.split("/").at(-1) ?? plural);
}

/** Resuelve una entidad por su plural (lanza si no está registrada). */
export function resolverEntidad(plural: string): Promise<EntidadResuelta> {
  if (!cache.has(plural)) {
    cache.set(plural, (async () => {
      const entity = entidad(plural);
      if (!entity) throw new Error(`La entidad "${plural}" no existe en el DER`);
      const ui = await entidadUi(plural);
      const titulo = await tituloDe(plural, ui);
      return { plural, entity, ui, titulo, etiqueta: (fila) => etiquetaFila(entity, ui, fila) };
    })());
  }
  return cache.get(plural)!;
}

/** Resuelve una entidad por su `name` (destino de una relación), o `null` si no existe. */
export async function resolverPorNombre(name: string): Promise<EntidadResuelta | null> {
  const e = entidadPorNombre(name);
  if (!e) return null;
  return await resolverEntidad(e.pluralPath.join("/"));
}

/** Entidades destino de las relaciones `one` de una entidad, por `name` del destino. */
export async function destinos(entity: Entity<any>): Promise<Map<string, EntidadResuelta>> {
  const out = new Map<string, EntidadResuelta>();
  for (const rel of relacionesUno(entity.pojo.schema)) {
    const r = await resolverPorNombre(rel.target);
    if (r) out.set(rel.target, r);
  }
  return out;
}

/** Olvida la caché (pruebas o recarga de JSON). */
export function limpiarEntidades(): void {
  cache.clear();
}
