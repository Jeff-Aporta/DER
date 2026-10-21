import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { defineSchema, Pojo, pojoOf, toDateTime, toIso, toStr, zodOf } from "@Jeff-Aporta/DER/index.ts";
import { Categoria, Linea, Producto } from "@Jeff-Aporta/DER/examples/domain.ts";

Deno.test("pojo: los setters castean según el tipo de columna", () => {
  const p = new Producto({
    iproducto: "7",
    nombre: 123,
    precio: "10.50",
    stock: "3.9",
    lanzamiento: "2024-02-03T10:00:00Z",
    creado: "2024-02-03T10:00:00Z",
    meta: { a: 1 },
  });
  assertEquals(p.iproducto, 7);
  assertEquals(p.nombre, "123");
  assertEquals(p.precio, 10.5);
  assertEquals(p.stock, 3);
  assertEquals(p.lanzamiento, "2024-02-03");
  assertInstanceOf(p.creado, Date);
  assertEquals(p.meta, { a: 1 });
  assertEquals(p.etiqueta, "123 ($10.5)");
});

Deno.test("pojo: bool acepta 0/1/'true'/'si' y undefined se conserva como no definido", () => {
  const c = new Categoria({ bactivo: 0 });
  assertEquals(c.bactivo, false);
  (c as { bactivo: unknown }).bactivo = "si";
  assertEquals(c.bactivo, true);
  assertEquals(c.nombre, undefined);
  assertEquals(Object.keys(c.toJSON()), ["bactivo"]);
});

Deno.test("pojo: relaciones se castean a POJOs (objeto 1:1, lista 1:N) incluso desde texto JSON", () => {
  const c = new Categoria({
    icategoria: 1,
    productos: JSON.stringify([{ iproducto: "1", nombre: "A", precio: "1" }]),
  });
  assertInstanceOf(c.productos[0], Producto);
  assertEquals(c.productos[0].iproducto, 1);
  const l = new Linea({ ipedido: 1, ilinea: 2, producto: { iproducto: 5, categoria: { icategoria: 9 } } });
  assertInstanceOf(l.producto, Producto);
  assertInstanceOf(l.producto!.categoria, Categoria);
  assertEquals(l.toJSON(), { ipedido: 1, ilinea: 2, producto: { iproducto: 5, categoria: { icategoria: 9 } } });
});

Deno.test("pojo: toJSON omite undefined, serializa fechas e ignora llaves desconocidas", () => {
  const p = Producto.fromJSON({ iproducto: 1, creado: new Date("2024-01-01T00:00:00Z"), otra: "x" });
  assertEquals(p.toJSON(), { iproducto: 1, creado: "2024-01-01T00:00:00.000Z" });
  assertEquals(p.pkValues(), [1]);
  assertEquals(new Linea({ ipedido: 1, ilinea: 2, cantidad: 3 }).pkOnly().toJSON(), { ipedido: 1, ilinea: 2 });
});

Deno.test("pojo: estilo manual con getters/setters propios", () => {
  const S = defineSchema({ columns: { id: { type: "int", pk: true }, nombre: { type: "string" } } });
  class Manual extends Pojo {
    static override schema = S;
    get id(): number | null {
      return this.f["id"] as number;
    }
    set id(v: unknown) {
      this.f["id"] = Number(v);
    }
    get nombre(): string | null {
      return this.f["nombre"] as string;
    }
    set nombre(v: unknown) {
      this.f["nombre"] = toStr(v)?.trim() ?? null;
    }
  }
  const m = Manual.fromJSON({ id: "4", nombre: "  x  " });
  assertEquals(m.toJSON(), { id: 4, nombre: "x" });
});

Deno.test("schema: valida pks, nombres y reservados", () => {
  assertThrows(() => pojoOf({ columns: { a: { type: "int" } } }), Error, "pk");
  assertThrows(() => pojoOf({ columns: { "a-b": { type: "int", pk: true } } }), Error, "inválido");
  assertThrows(() => pojoOf({ columns: { f: { type: "int", pk: true } } }), Error, "reservado");
});

Deno.test("fechas: datetime solo ISO 8601, sin zona es UTC y toJSON siempre emite ISO UTC", () => {
  assertEquals(toDateTime("2024-02-29T05:00:00-05:00")?.toISOString(), "2024-02-29T10:00:00.000Z");
  assertEquals(toDateTime("2024-02-29T05:00:00+0530")?.toISOString(), "2024-02-28T23:30:00.000Z");
  assertEquals(toDateTime("2024-02-29 10:00")?.toISOString(), "2024-02-29T10:00:00.000Z"); // sin zona: UTC, no la del proceso
  assertEquals(toDateTime("2024-02-29")?.toISOString(), "2024-02-29T00:00:00.000Z");
  assertEquals(toDateTime("2024-02-29T10:00:00.123456Z")?.toISOString(), "2024-02-29T10:00:00.123Z"); // microsegundos (MySQL)
  assertEquals(toDateTime(0)?.toISOString(), "1970-01-01T00:00:00.000Z");
  assertEquals([toDateTime("29/02/2024"), toDateTime("Feb 29 2024"), toDateTime("2024-13-01"), toIso("x")], [null, null, null, null]);
  assertEquals(toIso("2024-02-29T10:00:00+02:00"), "2024-02-29T08:00:00.000Z");
  const p = new Producto({ creado: "2024-02-29T05:00:00-05:00" });
  assertEquals(p.toJSON()["creado"], "2024-02-29T10:00:00.000Z");
  assertEquals(zodOf(Producto).insert.safeParse({ nombre: "A", precio: 1, creado: "2024-02-29T10:00:00Z" }).success, true);
  assertEquals(zodOf(Producto).insert.safeParse({ nombre: "A", precio: 1, creado: "29/02/2024" }).success, false);
});
