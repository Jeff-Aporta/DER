/**
 * Diagramas DER: payloads declarativos para <iswc-er-diagram> y <iswc-class-diagram>
 * derivados de defineSchema / defineEntity, con propagación como arista punteada.
 */
import { assertEquals, assert, assertStringIncludes } from "@std/assert";
import {
  CategoriaEntity,
  CrisisEntity,
  LineaEntity,
  PedidoEntity,
  ProductoEntity,
} from "@Jeff-Aporta/DER/examples/domain.ts";
import {
  classDiagramPayload,
  diagramPayloads,
  erDiagramPayload,
} from "@Jeff-Aporta/DER/src/01 objects/diagram.ts";
import { apiIndexMd, entityContractMd } from "@Jeff-Aporta/DER/src/02 controllers/server/doc.ts";

const entities = [CategoriaEntity, ProductoEntity, PedidoEntity, LineaEntity, CrisisEntity];

Deno.test("diagram: ER cubre todas las entidades y marca PK/FK", () => {
  const { erDiagram } = erDiagramPayload(entities);
  assertEquals(erDiagram.entities.length, 5);
  const producto = erDiagram.entities.find((e) => e.id === "producto");
  assert(producto, "falta la caja producto");
  const pk = producto.attributes.find((a) => a.name === "iproducto");
  assertEquals(pk?.key, "PK");
  const fk = producto.attributes.find((a) => a.name === "icategoria");
  assertEquals(fk?.key, "FK");
  assertEquals(fk?.type, "int");
});

Deno.test("diagram: cardinalidades one→1 y many→N", () => {
  const { erDiagram } = erDiagramPayload(entities);
  const aCategoria = erDiagram.relations.find((r) => r.from === "producto" && r.to === "categoria");
  assert(aCategoria, "falta producto→categoria");
  assertEquals(aCategoria.fromCard, "many");
  assertEquals(aCategoria.toCard, "one");
  assertEquals(aCategoria.identifying, false);

  const aLineas = erDiagram.relations.find((r) => r.from === "pedido" && r.to === "pedido/linea");
  assert(aLineas, "falta pedido→linea");
  assertEquals(aLineas.fromCard, "one");
  assertEquals(aLineas.toCard, "many");
  assertEquals(aLineas.identifying, true);
});

Deno.test("diagram: FK nullable usa zeroOrOne / zeroOrMany", () => {
  const { erDiagram } = erDiagramPayload(entities, { nullableCards: true });
  const rel = erDiagram.relations.find((r) => r.from === "producto" && r.to === "categoria");
  assert(rel, "falta producto→categoria");
  assertEquals(rel.fromCard, "zeroOrMany");
  assertEquals(rel.toCard, "zeroOrOne");
});

Deno.test("diagram: propagación se dibuja punteada y etiquetada", () => {
  const { erDiagram } = erDiagramPayload(entities, { propagations: { pedido: ["lineas"] } });
  const rel = erDiagram.relations.find((r) => r.from === "pedido" && r.to === "pedido/linea");
  assert(rel, "falta pedido→linea");
  assertEquals(rel.dashStyle, "dashed");
  assertEquals(rel.label, "lineas (propaga)");
});

Deno.test("diagram: clases usan dependency para propagación", () => {
  const { classDiagram } = classDiagramPayload(entities, { propagations: { pedido: ["lineas"] } });
  const rel = classDiagram.relations.find((r) => r.from === "pedido" && r.to === "pedido/linea");
  assert(rel, "falta pedido→linea");
  assertEquals(rel.kind, "dependency");
  assertEquals(rel.label, "propaga");
  const normal = classDiagram.relations.find((r) => r.from === "producto" && r.to === "categoria");
  assert(normal, "falta producto→categoria");
  assertEquals(normal.kind, "association");
  assertEquals(normal.label, "1");
});

Deno.test("diagram: diagramPayloads emite los dos payloads", () => {
  const { er, class: cls } = diagramPayloads(entities);
  assert(er.erDiagram, "falta erDiagram");
  assert(cls.classDiagram, "falta classDiagram");
  assertEquals(cls.classDiagram.classes.length, 5);
  assertStringIncludes(cls.classDiagram.classes[0]!.attributes[0]!, "+");
});

Deno.test("diagram: /doc de la entidad incrusta el payload ER", () => {
  const md = entityContractMd(ProductoEntity, { entities });
  assertStringIncludes(md, "## Diagrama");
  assertStringIncludes(md, "\"erDiagram\"");
  assertStringIncludes(md, "categoria");
});

Deno.test("diagram: índice del API incrusta ER y clases", () => {
  const md = apiIndexMd(entities, "/api");
  assertStringIncludes(md, "## Diagrama ER");
  assertStringIncludes(md, "## Diagrama de clases");
  assertStringIncludes(md, "\"classDiagram\"");
});

Deno.test("diagram: se puede desactivar el diagrama en la doc", () => {
  const md = entityContractMd(ProductoEntity, { entities, diagram: false });
  assert(!md.includes("## Diagrama"), "no debe incluir diagrama");
});
