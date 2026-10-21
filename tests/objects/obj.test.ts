import { assertEquals, assertThrows } from "@std/assert";
import { Obj, ValidationError, zodOf } from "@Jeff-Aporta/DER/index.ts";
import { Linea, Producto } from "@Jeff-Aporta/DER/examples/domain.ts";

Deno.test("obj: nomenclatura insert · insertIgnore · update · delete · get · getValue · replace", () => {
  const base: Record<string, unknown> = { a: 1, b: { c: 2 } };
  assertEquals(Obj.insert(base, { b: { d: 3 } }), { a: 1, b: { c: 2, d: 3 } });
  assertEquals(Obj.insertIgnore(base, { a: 9, e: 5 }), { a: 1, b: { c: 2 }, e: 5 });
  assertEquals(Obj.update(base, { a: 9, z: 1 }), { a: 9, b: { c: 2 } });
  assertEquals(Obj.delete(base, { b: { c: true } }), { a: 1, b: {} });
  assertEquals(Obj.get(base, { b: true }), { b: { c: 2 } });
  assertEquals(Obj.getValue(base, { b: { c: true } }), 2);
  assertEquals(Obj.replace(base, { x: 1 }), { x: 1 });
  assertEquals(
    Obj.aplicar(base, [{ op: "insertIgnore", valor: { n: 1 } }, { op: "replace", valor: { y: 2 } }]),
    { y: 2 },
  );
  assertEquals(base, { a: 1, b: { c: 2 } }); // nada muta
});

Deno.test("pojo: push parcial tipado entra al json con molde y respeta columnas", () => {
  const p = new Producto({ iproducto: 1, nombre: "A", precio: 1, jconfig: { ui: { color: "rojo" } } });
  p.insert({ precio: 2.5, jconfig: { ui: { orden: 3 } } });
  assertEquals(p.precio, 2.5);
  assertEquals(p.jconfig, { ui: { color: "rojo", orden: 3 } });
  // null en columna nullable → null; en columna no nula → se quita (queda sin definir)
  p.insert({ stock: null, nombre: null });
  assertEquals(p.stock, null);
  assertEquals(p.nombre, undefined);
  // fuera del molde → ValidationError y el pojo no cambia
  assertThrows(() => p.insert({ jconfig: { ui: { orden: "x" } } } as never), ValidationError);
  assertEquals(p.jconfig?.ui?.orden, 3);
});

Deno.test("pojo: json SIN molde se reemplaza directo; insertIgnore/update/delete/get/replace", () => {
  const p = new Producto({ iproducto: 1, nombre: "A", meta: { a: 1, b: 2 } });
  p.insert({ meta: { c: 3 } });
  assertEquals(p.meta, { c: 3 }); // replace directo
  p.insertIgnore({ nombre: "B", precio: 7 });
  assertEquals([p.nombre, p.precio], ["A", 7]);
  p.update({ stock: 5, precio: 8 });
  assertEquals([p.stock, p.precio], [undefined, 8]);
  p.delete({ meta: true });
  assertEquals(p.meta, undefined);
  assertEquals(p.get({ nombre: true, precio: true }), { nombre: "A", precio: 8 });
  p.replace({ iproducto: 2 });
  assertEquals(p.toJSON(), { iproducto: 2 });
});

Deno.test("pojo: push sobre relaciones usa el molde del detalle", () => {
  const l = new Linea({ ipedido: 1, ilinea: 1, producto: { iproducto: 1, nombre: "A" } });
  l.insert({ producto: { precio: 3 } });
  assertEquals(l.producto!.toJSON(), { iproducto: 1, nombre: "A", precio: 3 });
});

Deno.test("zod: schemas generados por acción", () => {
  const z = zodOf(Producto);
  assertEquals(z.insert.safeParse({ nombre: "A", precio: 1 }).success, true);
  assertEquals(z.insert.safeParse({ precio: 1 }).success, false);
  assertEquals(z.update.safeParse({ iproducto: 1 }).success, true);
  assertEquals(z.update.safeParse({ nombre: "A" }).success, false);
  assertEquals(z.pk.safeParse({ iproducto: 1 }).success, true);
  assertEquals(z.row.safeParse({ tipo: "otro" }).success, false);
  assertEquals(z.row.safeParse({ jconfig: { ui: { orden: 1.5 } } }).success, false);
});
