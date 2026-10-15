import { assertEquals, assertThrows } from "@std/assert";
import { defineEntity } from "../mod.ts";
import { Crisis, Linea, Producto, TCrisis, TLinea, TProducto } from "../examples/domain.ts";

Deno.test("rutas: singular con pks, plural sin pks", () => {
  const p = new TProducto({ iproducto: 5 });
  assertEquals(Producto.route("get", p), { method: "GET", path: "producto/5" });
  assertEquals(Producto.route("post", p), { method: "POST", path: "producto" });
  assertEquals(Producto.route("put", p), { method: "PUT", path: "producto/5" });
  assertEquals(Producto.route("delete", p), { method: "DELETE", path: "producto/5" });
  assertEquals(Producto.route("list"), { method: "GET", path: "productos" });
  assertEquals(Producto.route("query"), { method: "POST", path: "productos/query" });
  assertEquals(Producto.route("postList"), { method: "POST", path: "productos" });
  assertEquals(Producto.route("putList"), { method: "PUT", path: "productos" });
  assertEquals(Producto.route("deleteList"), { method: "DELETE", path: "productos" });
  assertEquals(Producto.route("post", p, true), { method: "POST", path: "producto/sse" });
  assertEquals(Producto.route("ajustarStock", p), { method: "POST", path: "producto/5/ajustarStock" });
  assertEquals(Producto.route("importar"), { method: "POST", path: "productos/importar" });
});

Deno.test("rutas: pks compuestas y codificación", () => {
  const l = new TLinea({ ipedido: 3, ilinea: 9 });
  assertEquals(Linea.route("get", l).path, "pedido/linea/3/9");
  const c = new TCrisis({ codigo: "a/b c" });
  assertEquals(Crisis.route("get", c).path, "crisis/a%2Fb%20c");
});

Deno.test("rutas: singular === plural usa sufijo /s en el plural", () => {
  assertEquals(Crisis.route("list").path, "crisis/s");
  assertEquals(Crisis.route("query").path, "crisis/s/query");
  assertEquals(Crisis.match("GET", ["crisis", "s"])?.name, "list");
  assertEquals(Crisis.match("GET", ["crisis", "x1"]), { name: "get", pks: ["x1"], sse: false });
  const custom = defineEntity({ pojo: TCrisis, singular: "crisis", plural: "crisis", pluralSuffix: "todas", singularSuffix: "una" });
  assertEquals(custom.route("list").path, "crisis/todas");
  assertEquals(custom.route("get", new TCrisis({ codigo: "x" })).path, "crisis/una/x");
});

Deno.test("rutas: match de acciones, endpoints y sse", () => {
  const m = (method: string, path: string) => Producto.match(method, path.split("/"));
  assertEquals(m("GET", "producto/5")?.name, "get");
  assertEquals(m("GET", "producto/5/sse"), { name: "get", pks: ["5"], sse: true });
  assertEquals(m("POST", "producto")?.name, "post");
  assertEquals(m("POST", "producto/sse")?.sse, true);
  assertEquals(m("GET", "productos")?.name, "list");
  assertEquals(m("DELETE", "productos")?.name, "deleteList");
  assertEquals(m("POST", "productos/query")?.name, "query");
  assertEquals(m("GET", "productos/query")?.name, "query");
  assertEquals(m("POST", "producto/5/ajustarStock")?.name, "ajustarStock");
  assertEquals(m("POST", "productos/importar/sse")?.sse, true);
  assertEquals(m("PATCH", "producto/5"), null);
  assertEquals(m("GET", "producto"), null);
  assertEquals(m("GET", "producto/1/2"), null);
  assertEquals(Linea.match("PUT", ["pedido", "linea", "1", "2"])?.pks, ["1", "2"]);
  assertEquals(Linea.match("GET", ["pedido", "lineas"])?.name, "list");
});

Deno.test("rutas: validaciones de definición", () => {
  assertThrows(() => defineEntity({ pojo: TCrisis, singular: "a b", plural: "c" }), Error, "inválido");
  assertThrows(
    () => defineEntity({ pojo: TCrisis, singular: "a", plural: "b", endpoints: { get: { method: "GET", scope: "one" } } }),
    Error,
    "choca",
  );
  assertThrows(
    () => defineEntity({ pojo: TCrisis, singular: "a", plural: "b", endpoints: { buscar: { method: "GET", scope: "many", path: "query" } } }),
    Error,
    "reservado",
  );
});
