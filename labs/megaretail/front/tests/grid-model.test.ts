/** Columnas del grid derivadas del schema + JSON de UI, filas con id sintético y etiquetas de relaciones. */
import { assert, assertEquals } from "@std/assert";
import { InventarioSedeEntity, InventarioSedeSchema, ProductoEntity, ProductoSchema } from "@megaretail/vendor";
import { aplanar, columnasDe, etiquetaFila, filaGrid, includeDe, ROW_ID } from "../src/js/core/grid-model.ts";
import { valorStat } from "../src/js/core/stats.ts";

Deno.test("columnas: tipos de celda, columna de etiqueta por relación one (FK oculta), personalización y orden del JSON", () => {
  const cols = columnasDe(ProductoSchema, { grid: { columnas: { precio_base: { header: "Precio", type: "currency" } }, ocultar: ["sku"], orden: ["nombre"] } }, (target) => (target === "categoria" ? "categoria" : null));
  assertEquals(cols[0]!.field, "nombre");
  const precio = cols.find((c) => c.field === "precio_base")!;
  assertEquals(precio.header, "Precio");
  assertEquals(precio.type, "currency");
  assertEquals(cols.find((c) => c.field === "sku")!.hide, true);
  assertEquals(cols.find((c) => c.field === "id_categoria")!.hide, true, "la FK se oculta cuando hay etiqueta");
  assert(cols.some((c) => c.field === "categoria"));
  assertEquals(cols.find((c) => c.field === "id_producto")!.decimals, 0);
  // sin entidad destino resuelta no se agrega la columna de etiqueta
  assert(!columnasDe(ProductoSchema, {}, () => null).some((c) => c.field === "categoria"));
  assertEquals(includeDe(InventarioSedeSchema, { grid: { include: { sede: false } } }), { sede: false, producto: true });
});

Deno.test("filas: id sintético con pks compuestas, etiqueta de relación incluida y aplanado de rutas", () => {
  const fila = filaGrid(InventarioSedeEntity, { id_sede: 1, id_producto: 7, stock_actual: 3, sede: { id_sede: 1, nombre: "Bogotá" } }, (target, rel) => (target === "sede" ? String(rel["nombre"]) : ""));
  assertEquals(fila[ROW_ID], "1/7");
  assertEquals(fila["sede"], "Bogotá");
  assertEquals(fila["producto"], "");
  assertEquals(etiquetaFila(ProductoEntity, { etiqueta: "{sku} · {nombre}" }, { sku: "A", nombre: "B" }), "A · B");
  assertEquals(etiquetaFila(ProductoEntity, {}, { id_producto: 9, sku: "A", nombre: "B" }), "A (9)");
  assertEquals(aplanar({ a: { b: 2 } }, [{ field: "a.b" }])["a.b"], 2);
});

Deno.test("stats: consulta Obj.getValue sobre el resultado con formato", () => {
  const datos = { celdas: [{ nivel: "detalle", total: 1 }, { nivel: "total", total: 1234.5 }], sedes: ["a", "b"] };
  assertEquals(valorStat({ label: "x", consulta: { celdas: { "[nivel=total]": { total: true } } }, formato: "entero" }, datos), "1.235");
  assertEquals(valorStat({ label: "x", consulta: { sedes: true }, formato: "entero" }, datos), "2");
  assertEquals(valorStat({ label: "x", consulta: { nada: true } }, datos), "—");
});
