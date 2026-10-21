/** Mensajes de validación de query/include, `Entity.patch`/`aplicar`, el registro global (plurales únicos, tabla por defecto, pojos por plural) y las secuencias con base. */
import { assertEquals, assertThrows } from "@std/assert";
import { defineEntity, defineSchema, pojoOf, registry, sequenceOf, validateQuery } from "@Jeff-Aporta/DER/index.ts";
import { Producto, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";

Deno.test("validateQuery: mensajes claros para cada forma inválida", () => {
  const meta = ProductoEntity.meta;
  const lim = { pageSize: 50, maxPageSize: 100 };
  const v = (q: unknown) => validateQuery(meta, q as never, lim);
  assertEquals(v([]), "La consulta debe ser un objeto");
  assertEquals(v({ select: ["nada"] }), 'select: "nada" no es una columna');
  assertEquals(v({ orderBy: "-nada" }), 'orderBy: "nada" no es una columna');
  assertEquals(v({ where: { precio: { in: 5 } } }), "where.precio.in debe ser un arreglo");
  assertEquals(v({ where: { precio: { nin: "x" } } }), "where.precio.nin debe ser un arreglo");
  assertEquals(v({ where: { precio: { between: [1] } } }), "where.precio.between debe ser [desde, hasta]");
  assertEquals(v({ where: { $or: {} } }), "where.$or debe ser un arreglo");
  assertEquals(v({ where: { $and: [{ nada: 1 }] } }), 'where.$and[0]: "nada" no es columna ni relación');
  assertEquals(v({ where: { $not: { nada: 1 } } }), 'where.$not: "nada" no es columna ni relación');
  assertEquals(v({ where: { categoria: { nada: 1 } } }), 'where.categoria: "nada" no es columna ni relación');
  assertEquals(v({ include: { categoria: { nada: true } } }), 'include.categoria: "nada" no es una relación');
  assertEquals(v({ include: { categoria: { productos: true } } }), null);
  assertEquals(v({ pageSize: 101 }), "pageSize no puede superar 100");
  assertEquals(v({ otra: 1 })?.length !== 0, true); // clave desconocida (ZQuerySpec estricto)
});

Deno.test("Entity.patch (copia con push, el original no cambia) y Entity.aplicar (acciones Obj)", () => {
  const p = new Producto({ iproducto: 1, nombre: "A", precio: 1, jconfig: { ui: { color: "rojo" } } });
  const q = ProductoEntity.patch(p, { precio: 2, jconfig: { ui: { orden: 1 } } });
  assertEquals([p.precio, q.precio], [1, 2]);
  assertEquals(q.jconfig, { ui: { color: "rojo", orden: 1 } });
  const r = ProductoEntity.aplicar(p, [{ op: "update", valor: { nombre: "B", nada: 1 } }, { op: "delete", query: { jconfig: true } }]);
  assertEquals(r.toJSON(), { iproducto: 1, nombre: "B", precio: 1 });
});

Deno.test("registro: entidad por plural, pojo indirecto, tabla por defecto (plural con / → _) y plural duplicado", () => {
  const S = defineSchema({ columns: { id: { type: "int", pk: true }, nombre: { type: "string" } } });
  const e = defineEntity({ schema: S, singular: "reg/cosa", plural: "reg/cosas" });
  assertEquals([registry.entity("reg/cosas"), e.table, e.name], [e, "reg_cosas", "reg/cosa"]);
  assertEquals(defineEntity({ schema: S, singular: "reg/otra", plural: "reg/otras", table: "t_otras" }).table, "t_otras");
  assertEquals(registry.pojo("reg/cosas", { id: "7", nombre: 3 }).toJSON(), { id: 7, nombre: "3" });
  assertEquals(registry.entity("productos").pojo, Producto);
  assertThrows(() => defineEntity({ schema: S, singular: "reg/cosa2", plural: "reg/cosas" }), Error, 'plural "reg/cosas"');
  assertThrows(() => defineEntity({ schema: S, name: "reg/cosa", singular: "reg/cosa3", plural: "reg/cosas3" }), Error, "nombre");
  assertThrows(() => registry.entity("no/existe"), Error, "no/existe");
  assertEquals(registry.entities().some((x) => x.key === "productos" && x.entity === ProductoEntity), true);
});

Deno.test("secuencias con base: 2..36, base > 10 exige texto, numérica exige columna numérica, defaults", () => {
  assertEquals(sequenceOf("a", { type: "int", sequence: true }), { base: 10, as: "number" });
  assertEquals(sequenceOf("a", { type: "string", sequence: true }), { base: 10, as: "string" });
  assertEquals(sequenceOf("a", { type: "string", sequence: { base: 36 } })?.as, "string");
  assertEquals(sequenceOf("a", { type: "int" }), null);
  assertThrows(() => sequenceOf("a", { type: "int", sequence: { base: 36 } }), Error, "texto");
  assertThrows(() => sequenceOf("a", { type: "string", sequence: { base: 16, as: "number" } }), Error, "numérica");
  assertThrows(() => sequenceOf("a", { type: "int", sequence: { as: "string" } }), Error, "string/text");
  assertThrows(() => sequenceOf("a", { type: "string", sequence: { base: 1 } }), Error, "entre 2 y 36");
  assertThrows(() => sequenceOf("a", { type: "string", sequence: { base: 37 } }), Error, "entre 2 y 36");
  assertThrows(() => pojoOf(defineSchema({ columns: { id: { type: "int", pk: true, sequence: { base: 36 } } } })), Error, "texto");
});
