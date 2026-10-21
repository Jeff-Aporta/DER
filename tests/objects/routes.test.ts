import { assertEquals, assertThrows } from "@std/assert";
import { defineEntity } from "@Jeff-Aporta/DER/index.ts";
import { CrisisEntity, LineaEntity, ProductoEntity, Crisis, Linea, Producto } from "@Jeff-Aporta/DER/examples/domain.ts";

Deno.test("rutas: singular con pks, plural sin pks", () => {
  const p = new Producto({ iproducto: 5 });
  assertEquals(ProductoEntity.route("get", p), { method: "GET", path: "producto/5" });
  assertEquals(ProductoEntity.route("post", p), { method: "POST", path: "producto" });
  assertEquals(ProductoEntity.route("put", p), { method: "PUT", path: "producto/5" });
  assertEquals(ProductoEntity.route("delete", p), { method: "DELETE", path: "producto/5" });
  assertEquals(ProductoEntity.route("list"), { method: "GET", path: "productos" });
  assertEquals(ProductoEntity.route("query"), { method: "GET", path: "productos" }); // el client agrega ?q=<base64url>
  assertEquals(ProductoEntity.route("postList"), { method: "POST", path: "productos" });
  assertEquals(ProductoEntity.route("putList"), { method: "PUT", path: "productos" });
  assertEquals(ProductoEntity.route("deleteList"), { method: "DELETE", path: "productos" });
  assertEquals(ProductoEntity.route("post", p, true), { method: "POST", path: "producto/sse" });
  assertEquals(ProductoEntity.route("ajustarStock", p), { method: "POST", path: "producto/5/ajustarStock" });
  assertEquals(ProductoEntity.route("importar"), { method: "POST", path: "productos/importar" });
});

Deno.test("rutas: pks compuestas y codificación", () => {
  const l = new Linea({ ipedido: 3, ilinea: 9 });
  assertEquals(LineaEntity.route("get", l).path, "pedido/linea/3/9");
  const c = new Crisis({ codigo: "a/b c" });
  assertEquals(CrisisEntity.route("get", c).path, "crisis/a%2Fb%20c");
});

Deno.test("rutas: singular === plural usa sufijo /s en el plural", () => {
  assertEquals(CrisisEntity.route("list").path, "crisis/s");
  assertEquals(CrisisEntity.route("query").path, "crisis/s");
  assertEquals(CrisisEntity.match("GET", ["crisis", "s"])?.name, "list");
  assertEquals(CrisisEntity.match("GET", ["crisis", "x1"]), { name: "get", pks: ["x1"], sse: false });
  const custom = defineEntity({ pojo: Crisis, singular: "crisis", plural: "crisis", pluralSuffix: "todas", singularSuffix: "una" });
  assertEquals(custom.route("list").path, "crisis/todas");
  assertEquals(custom.route("get", new Crisis({ codigo: "x" })).path, "crisis/una/x");
});

Deno.test("rutas: match de acciones, endpoints y sse", () => {
  const m = (method: string, path: string) => ProductoEntity.match(method, path.split("/"));
  assertEquals(m("GET", "producto/5")?.name, "get");
  assertEquals(m("GET", "producto/5/sse"), { name: "get", pks: ["5"], sse: true });
  assertEquals(m("POST", "producto")?.name, "post");
  assertEquals(m("POST", "producto/sse")?.sse, true);
  assertEquals(m("GET", "productos")?.name, "list");
  assertEquals(m("DELETE", "productos")?.name, "deleteList");
  assertEquals(m("POST", "productos/query"), null); // query ya no es una ruta aparte: es GET plural?q=
  assertEquals(m("GET", "productos/query"), null);
  assertEquals(m("POST", "producto/5/ajustarStock")?.name, "ajustarStock");
  assertEquals(m("POST", "productos/importar/sse")?.sse, true);
  assertEquals(m("PATCH", "producto/5"), null);
  assertEquals(m("GET", "producto"), null);
  assertEquals(m("GET", "producto/1/2"), null);
  assertEquals(LineaEntity.match("PUT", ["pedido", "linea", "1", "2"])?.pks, ["1", "2"]);
  assertEquals(LineaEntity.match("GET", ["pedido", "lineas"])?.name, "list");
});

Deno.test("rutas: validaciones de definición", () => {
  assertThrows(() => defineEntity({ pojo: Crisis, singular: "a b", plural: "c" }), Error, "inválido");
  assertThrows(
    () => defineEntity({ pojo: Crisis, singular: "a", plural: "b", endpoints: { get: { method: "GET", scope: "one" } } }),
    Error,
    "choca",
  );
  assertThrows(
    () => defineEntity({ pojo: Crisis, singular: "a", plural: "b", endpoints: { buscar: { method: "GET", scope: "many", path: "sse" } } }),
    Error,
    "reservado",
  );
});
