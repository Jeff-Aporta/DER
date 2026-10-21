/** Generador de formularios: derivación desde el schema DER, personalización por JSON (Obj.insert), valores y validación Zod. */
import { assert, assertEquals, assertMatch } from "@std/assert";
import { ProductoEntity, ProductoSchema, VentaEntity, VentaSchema } from "@megaretail/vendor";
import { aplicarUi, camposVisibles, cuerpoDe, isoALocal, localAIso, modeloDeSchema, plantilla, validarConZod } from "../src/js/core/form-model.ts";

Deno.test("modelo base: tipos → controles, pk autoincrement oculta al crear, enum → select, relación one → selector", () => {
  const m = modeloDeSchema(ProductoSchema, "crear");
  assertEquals(m.orden.slice(0, 5), ["id_producto", "id_categoria", "sku", "nombre", "precio_base"]);
  assertEquals(m.campos["id_producto"]!.oculto, true);
  assertEquals(m.campos["id_categoria"]!.control, "relacion");
  assertEquals(m.campos["id_categoria"]!.relacion, { entidad: "categoria", kind: "one", local: "id_categoria", remoto: "id_categoria" });
  assertEquals(m.campos["id_categoria"]!.label, "Categoria");
  assertEquals(m.campos["precio_base"]!.control, "numero");
  assertEquals(m.campos["precio_base"]!.requerido, true);
  assertEquals(m.campos["sku"]!.max, 40);
  // relaciones many: selector múltiple, oculto por defecto (el JSON lo puede mostrar)
  assertEquals(m.campos["proveedores"]!.relacion?.kind, "many");
  assertEquals(m.campos["proveedores"]!.oculto, true);
  const v = modeloDeSchema(VentaSchema, "editar");
  assertEquals(v.campos["estado"]!.control, "select");
  assertEquals(v.campos["estado"]!.opciones, [{ value: "Completada", label: "Completada" }, { value: "Anulada", label: "Anulada" }]);
  assertEquals(v.campos["estado"]!.valor, "Completada");
  assertEquals(v.campos["fecha_venta"]!.control, "fechahora");
  assertEquals(v.campos["id_venta"]!.soloLectura, true);
  assertEquals(v.campos["consecutivo"]!.soloLectura, true);
  assertEquals(modeloDeSchema(VentaSchema, "crear").campos["consecutivo"]!.oculto, true);
});

Deno.test("JSON de UI: Obj.insert convierte a radio, oculta con valor por defecto, agrega campos extra y ordena", () => {
  const base = modeloDeSchema(VentaSchema, "crear");
  const m = aplicarUi(base, { campos: { estado: { control: "radio", label: "Estado de la venta" }, total_venta: { oculto: true, valor: 0 }, nota: { control: "textarea", label: "Nota interna" } }, orden: ["id_cliente", "estado"] });
  assertEquals(m.campos["estado"]!.control, "radio");
  assertEquals(m.campos["estado"]!.label, "Estado de la venta");
  assertEquals(m.campos["estado"]!.opciones?.length, 2, "lo no mencionado se conserva");
  assertEquals(m.campos["total_venta"]!.oculto, true);
  assertEquals(m.campos["nota"]!.extra, true);
  assertEquals(m.orden.slice(0, 2), ["id_cliente", "estado"]);
  assert(m.orden.includes("nota"));
  const visibles = camposVisibles(m).map((c) => c.nombre);
  assert(!visibles.includes("total_venta"));
  assert(!visibles.includes("id_venta"));
  // el base no se muta
  assertEquals(base.campos["estado"]!.control, "select");
});

Deno.test("cuerpo: valores de controles → API (números, fechas locales → ISO UTC, ocultos con valor, listas) y validación Zod de DER", () => {
  const m = aplicarUi(modeloDeSchema(ProductoSchema, "crear"), { campos: { proveedores: { oculto: false } } });
  const cuerpo = cuerpoDe(m, { id_categoria: "3", sku: "X-1", nombre: "Cosa", precio_base: "1500.5", proveedores: [1, 2] }, "crear");
  assertEquals(cuerpo, { id_categoria: 3, sku: "X-1", nombre: "Cosa", precio_base: 1500.5, proveedores: [1, 2] });
  assertEquals(validarConZod(ProductoEntity.zod, cuerpo, "crear"), null);
  assertMatch(validarConZod(ProductoEntity.zod, { ...cuerpo, precio_base: "caro" }, "crear") ?? "", /precio_base/);
  assertMatch(validarConZod(ProductoEntity.zod, { sku: "X" }, "crear") ?? "", /nombre|id_categoria/);
  const v = aplicarUi(modeloDeSchema(VentaSchema, "editar"), { campos: { total_venta: { oculto: true, valor: 0 } } });
  const ed = cuerpoDe(v, { id_venta: 7, estado: "Anulada", fecha_venta: "2026-02-01T10:30" }, "editar");
  assertEquals(ed["total_venta"], 0);
  assertEquals(ed["estado"], "Anulada");
  assertMatch(String(ed["fecha_venta"]), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  assertEquals(validarConZod(VentaEntity.zod, { id_venta: 7, ...ed }, "editar"), null);
  assertEquals(localAIso(""), null);
  assertEquals(localAIso("2024-02-29T10:00:00Z"), "2024-02-29T10:00:00.000Z");
  assertEquals(isoALocal(null), "");
  assertEquals(localAIso(isoALocal("2024-02-29T10:00:00.000Z")), "2024-02-29T10:00:00.000Z");
  assertEquals(plantilla("{sku} · {nombre} ({categoria.nombre})", { sku: "A", nombre: "B", categoria: { nombre: "C" } }), "A · B (C)");
});

Deno.test("flujos: el schema JSON de un flujo (sin pk) también genera formulario, con listas anidadas", () => {
  const schema = { columns: { id_sede: { type: "int", nullable: false }, cantidad: { type: "int", nullable: false, default: 1 } }, relations: { sede: { kind: "one", target: "sede", on: { id_sede: "id_sede" } } } } as const;
  const m = aplicarUi(modeloDeSchema(schema, "crear"), { campos: { items: { control: "lista", label: "Carrito", schema: { columns: { id_producto: { type: "int" } } } } } });
  assertEquals(m.campos["id_sede"]!.control, "relacion");
  assertEquals(m.campos["cantidad"]!.valor, 1);
  assertEquals(m.campos["items"]!.control, "lista");
  const cuerpo = cuerpoDe(m, { id_sede: 1, items: [{ id_producto: 2, cantidad: 1 }] }, "crear");
  assertEquals(cuerpo, { id_sede: 1, cantidad: 1, items: [{ id_producto: 2, cantidad: 1 }] });
});
