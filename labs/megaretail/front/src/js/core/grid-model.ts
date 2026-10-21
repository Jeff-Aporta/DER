/**
 * grid-model.ts — columnas de `<iswc-ag-grid>` derivadas del schema DER (tipo de columna → tipo de celda) más el JSON
 * de UI de la entidad (`grid.columnas`, `grid.ocultar`, `grid.orden`), y utilidades de filas: id sintético para pks
 * compuestas, aplanado de relaciones incluidas (`categoria.nombre`) y etiqueta de una fila (plantilla de UI).
 */
import type { ColumnDef, Entity, Schema } from "@megaretail/vendor";
import type { ColumnaUi, EntidadUi } from "../consts/schemas/ui.schemas.ts";
import { etiquetaDe, plantilla } from "./form-model.ts";

/** Campo id que usa el grid (`get-row-id`). */
export const ROW_ID = "__id";

/** Tipo de celda de ag-grid según la columna DER. */
export function tipoCelda(c: ColumnDef): ColumnaUi["type"] {
  switch (c.type) {
    case "int":
    case "bigint":
    case "float":
      return "number";
    case "decimal":
      return "currency";
    case "bool":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "dateTime";
    default:
      return "string";
  }
}

/** Relaciones `one` del schema con su nombre y entidad destino (lo que se incluye por defecto para mostrar etiquetas). */
export function relacionesUno(schema: Schema): { nombre: string; target: string }[] {
  return Object.entries(schema.relations ?? {}).filter(([, r]) => r.kind === "one" && typeof r.target === "string").map(([nombre, r]) => ({ nombre, target: r.target as string }));
}

/** Columnas base del schema: una por columna persistida (las virtuales con expresión también llegan del server). */
export function columnasDeSchema(schema: Schema): ColumnaUi[] {
  return Object.entries(schema.columns).map(([field, c]) => {
    const col: ColumnaUi = { field, header: etiquetaDe(field), type: tipoCelda(c), sortable: true, filter: true };
    if (c.type === "int" || c.type === "bigint") col.decimals = 0;
    if (c.pk) col.width = 90;
    else if (c.type === "bool") col.width = 110;
    else if (c.type === "text") col.flex = 2;
    else if (c.type === "string" || c.type === "uuid") col.flex = 1;
    else col.width = 140;
    return col;
  });
}

/**
 * Columnas finales: schema + columnas de etiqueta de cada relación `one` (`categoria` → texto de la fila relacionada)
 * + JSON de UI (`grid.columnas` por `Obj.insert` superficial, `grid.ocultar`, `grid.orden`).
 */
export function columnasDe(schema: Schema, ui: EntidadUi, etiquetaRelacion: (target: string) => string | null): ColumnaUi[] {
  const base = columnasDeSchema(schema);
  for (const rel of relacionesUno(schema)) {
    const localKeys = Object.keys(schema.relations?.[rel.nombre]?.on ?? {});
    const idx = base.findIndex((c) => localKeys.includes(c.field));
    const col: ColumnaUi = { field: rel.nombre, header: etiquetaDe(rel.nombre), type: "string", sortable: false, filter: true, flex: 1 };
    if (etiquetaRelacion(rel.target) === null) continue;
    base.splice(idx >= 0 ? idx + 1 : base.length, 0, col);
    // la FK cruda se oculta por defecto cuando se muestra la etiqueta
    const fk = base.find((c) => localKeys.includes(c.field));
    if (fk && !schema.columns[fk.field]?.pk) fk.hide = true;
  }
  const personalizadas = ui.grid?.columnas ?? {};
  const porField = new Map(base.map((c) => [c.field, c]));
  for (const [field, cambios] of Object.entries(personalizadas)) {
    const actual = porField.get(field) ?? { field, header: etiquetaDe(field) };
    porField.set(field, { ...actual, ...cambios, field });
  }
  for (const field of ui.grid?.ocultar ?? []) {
    const c = porField.get(field);
    if (c) c.hide = true;
  }
  const todas = [...porField.values()];
  const orden = ui.grid?.orden ?? [];
  const primero = orden.map((f) => porField.get(f)).filter((c): c is ColumnaUi => !!c);
  return [...primero, ...todas.filter((c) => !orden.includes(c.field))];
}

/** Include de la consulta del grid: las relaciones `one` (para las etiquetas) más lo que pida el JSON. */
export function includeDe(schema: Schema, ui: EntidadUi): Record<string, boolean> {
  const inc: Record<string, boolean> = {};
  for (const rel of relacionesUno(schema)) inc[rel.nombre] = true;
  for (const [k, v] of Object.entries(ui.grid?.include ?? {})) inc[k] = v;
  return inc;
}

/** Etiqueta de una fila de la entidad: plantilla del JSON (`{sku} · {nombre}`) o la primera columna de texto. */
export function etiquetaFila(entity: Entity<any>, ui: EntidadUi, fila: Record<string, unknown>): string {
  if (ui.etiqueta) return plantilla(ui.etiqueta, fila);
  const texto = Object.entries(entity.meta.columns).find(([k, c]) => (c.type === "string" || c.type === "text") && !entity.meta.pks.includes(k) && !c.virtual)?.[0];
  const pk = entity.meta.pks.map((k) => fila[k]).join("/");
  return texto && fila[texto] != null ? `${fila[texto]} (${pk})` : pk;
}

/**
 * Fila del grid: el JSON de la API más `__id` (pks unidas) y, por cada relación `one` incluida, su etiqueta como texto.
 */
export function filaGrid(entity: Entity<any>, fila: Record<string, unknown>, etiquetaRelacion: (target: string, rel: Record<string, unknown>) => string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fila, [ROW_ID]: entity.meta.pks.map((k) => String(fila[k] ?? "")).join("/") };
  for (const rel of relacionesUno(entity.pojo.schema)) {
    const v = fila[rel.nombre];
    out[rel.nombre] = v && typeof v === "object" ? etiquetaRelacion(rel.target, v as Record<string, unknown>) : "";
  }
  return out;
}

/** Valor por ruta con puntos (`proveedor.razon_social`). */
export function valorRuta(fila: unknown, ruta: string): unknown {
  return ruta.split(".").reduce<unknown>((acc, k) => (acc != null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), fila);
}

/** Aplana una fila para columnas con rutas (`a.b` → `fila["a.b"]`), sin perder el resto. */
export function aplanar(fila: Record<string, unknown>, columnas: ColumnaUi[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fila };
  for (const c of columnas) if (c.field.includes(".")) out[c.field] = valorRuta(fila, c.field);
  return out;
}
