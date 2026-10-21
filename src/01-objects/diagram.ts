/**
 * Payloads para los diagramas del kit is-webcomponents, derivados de defineSchema / defineEntity (columnas,
 * relaciones, cardinalidades y propagación). No dibuja ni conoce el motor de ISWC: produce el `ErSpec` /
 * `ClassSpec` del kit (tipos importados por CDN, idénticos a los del componente), ya normalizados como lo haría
 * `resolveErSpec` / `resolveClassSpec`: direction, ratio, ids de relación, `identifying`, `methods`.
 *
 * - one  → la entidad origen guarda un destino (N:1): fromCard "many", toCard "one".
 * - many → el destino guarda la entidad origen (1:N): fromCard "one", toCard "many".
 * - Una relación marcada como propagación se emite con dashStyle "dashed" (ER) y kind "dependency" (clases).
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/objetos.md
 */
import type { ClassPayload, ClassSpec, ClassSpecClass, ClassSpecRelation, ColumnDef, DiagramOptions, ErCardinality, ErPayload, ErSpec, ErSpecAttribute, ErSpecEntity, ErSpecRelation, RelationDef, SchemaMeta } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import { resolvePojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";

/** Ratio guía ancho/alto que usa el kit cuando el payload no lo trae. */
const DEFAULT_RATIO = 1.4;
/** Nombres de tipos SQL compactos por tipo DER. */
const SQL_TYPE: Record<string, string> = { bigint: "bigint", bool: "bool", date: "date", datetime: "datetime", decimal: "decimal", float: "float", int: "int", json: "json", string: "varchar", text: "text", time: "time", uuid: "uuid" };

/** Tipo legible de una columna (varchar(100) cuando hay longitud). */
function columnType(c: ColumnDef): string {
  const base = SQL_TYPE[c.type] ?? c.type;
  return base === "varchar" && c.length ? "varchar(" + c.length + ")" : base;
}

/** Nombre de la entidad destino de una relación (string o thunk resuelto). */
function targetName(rel: RelationDef): string {
  if (typeof rel.target === "string") return rel.target;
  try {
    return resolvePojo(rel.target).name;
  } catch {
    return "desconocido";
  }
}

/** Columnas locales que son FK, con el nombre de la relación que las origina. */
function foreignKeys(meta: SchemaMeta): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, rel] of Object.entries(meta.relations)) {
    for (const local of Object.keys(rel.on)) if (!out.has(local)) out.set(local, name);
  }
  return out;
}

/** true si todas las columnas locales de la relación admiten null. */
function fkNullable(meta: SchemaMeta, rel: RelationDef): boolean {
  const locals = Object.keys(rel.on);
  if (!locals.length) return false;
  return locals.every((c) => meta.columns[c] !== undefined && meta.columns[c].nullable !== false && !meta.columns[c].pk);
}

/** Cardinalidades de los dos extremos según kind y nulabilidad de la FK. */
function cards(rel: RelationDef, nullable: boolean): { fromCard: ErCardinality; toCard: ErCardinality } {
  if (nullable && rel.kind === "many") return { fromCard: "zeroOrOne", toCard: "zeroOrMany" };
  if (nullable) return { fromCard: "zeroOrMany", toCard: "zeroOrOne" };
  if (rel.kind === "many") return { fromCard: "one", toCard: "many" };
  return { fromCard: "many", toCard: "one" };
}

/** Etiqueta corta de cardinalidad para el diagrama de clases (1..N). */
function cardLabel(c: ErCardinality): string {
  if (c === "many") return "1..N";
  if (c === "zeroOrMany") return "0..N";
  if (c === "zeroOrOne") return "0..1";
  return "1";
}

/** Payload { erDiagram } (un `ErSpec` del kit) a partir de una lista de entidades. */
export function erDiagramPayload(entities: readonly Entity<any>[], options: DiagramOptions = {}): ErPayload {
  const out: ErSpecEntity[] = [];
  const relations: ErSpecRelation[] = [];
  for (const entity of entities) {
    const meta = entity.meta;
    const fks = foreignKeys(meta);
    const group = options.groupOf?.(entity);
    const attributes: ErSpecAttribute[] = meta.persisted.map((name) => {
      const attr: ErSpecAttribute = { name, type: columnType(meta.column(name)) };
      if (meta.pks.includes(name)) attr.key = "PK";
      else if (fks.has(name)) attr.key = "FK";
      return attr;
    });
    const box: ErSpecEntity = { id: entity.name, name: entity.singular, attributes };
    if (group !== undefined) box.group = group;
    out.push(box);
    for (const [relName, rel] of Object.entries(meta.relations)) {
      const { fromCard, toCard } = cards(rel, options.nullableCards === true && fkNullable(meta, rel));
      const propagated = options.propagations?.[entity.name]?.includes(relName) === true;
      const edge: ErSpecRelation = { id: `${entity.name}.${relName}`, from: entity.name, to: targetName(rel), fromCard, toCard, label: propagated ? relName + " (propaga)" : relName, identifying: rel.kind === "many" };
      if (propagated) edge.dashStyle = "dashed";
      relations.push(edge);
    }
  }
  const er: ErSpec = { direction: options.direction ?? "LR", ratio: options.ratio ?? DEFAULT_RATIO, entities: out, relations };
  if (options.title !== undefined) er.title = options.title;
  if (options.subtitle !== undefined) er.subtitle = options.subtitle;
  if (options.groups !== undefined) er.groups = options.groups;
  return { erDiagram: er };
}

/** Payload { classDiagram } (un `ClassSpec` del kit) a partir de una lista de entidades. */
export function classDiagramPayload(entities: readonly Entity<any>[], options: DiagramOptions = {}): ClassPayload {
  const classes: ClassSpecClass[] = [];
  const relations: ClassSpecRelation[] = [];
  for (const entity of entities) {
    const meta = entity.meta;
    const group = options.groupOf?.(entity);
    const box: ClassSpecClass = { id: entity.name, name: entity.singular, stereotype: "<<entity>>", attributes: meta.persisted.map((name) => "+" + name + ": " + columnType(meta.column(name))), methods: [] };
    if (group !== undefined) box.group = group;
    classes.push(box);
    for (const [relName, rel] of Object.entries(meta.relations)) {
      const propagated = options.propagations?.[entity.name]?.includes(relName) === true;
      const { toCard } = cards(rel, options.nullableCards === true && fkNullable(meta, rel));
      relations.push({ id: `${entity.name}.${relName}`, from: entity.name, to: targetName(rel), kind: propagated ? "dependency" : "association", label: propagated ? "propaga" : cardLabel(toCard) });
    }
  }
  const classDiagram: ClassSpec = { direction: options.direction ?? "TB", classes, relations };
  if (options.title !== undefined) classDiagram.title = options.title;
  if (options.subtitle !== undefined) classDiagram.subtitle = options.subtitle;
  if (options.groups !== undefined) classDiagram.groups = options.groups;
  return { classDiagram };
}

/** Utilidad única: emite los dos payloads desde la misma lista de entidades. */
export function diagramPayloads(entities: readonly Entity<any>[], options: DiagramOptions = {}): { er: ErPayload; class: ClassPayload } {
  return { er: erDiagramPayload(entities, options), class: classDiagramPayload(entities, options) };
}
