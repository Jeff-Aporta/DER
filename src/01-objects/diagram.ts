/**
 * Payloads declarativos para los diagramas del kit is-webcomponents, derivados de
 * defineSchema / defineEntity (columnas, relaciones, cardinalidades y propagación).
 *
 * No dibuja ni conoce el motor de ISWC: sólo produce el JSON que esperan
 * <iswc-er-diagram> ({ erDiagram }) y <iswc-class-diagram> ({ classDiagram }).
 *
 * - one  → la entidad origen guarda un destino (N:1): fromCard "many", toCard "one".
 * - many → el destino guarda la entidad origen (1:N): fromCard "one", toCard "many".
 * - Una relación marcada como propagación se emite con dashStyle "dashed" (ER) y
 *   kind "dependency" (clases), con la etiqueta «propaga».
 *
 * @module
 */
import type {
  ClassBox,
  ClassDiagram,
  ClassPayload,
  ClassRelation,
  ColumnDef,
  DiagramAttribute,
  DiagramOptions,
  ErCardinality,
  ErDiagram,
  ErEntityBox,
  ErPayload,
  ErRelation,
  RelationDef,
  SchemaMeta,
} from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import { resolvePojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";

/** Nombres de tipos SQL compactos por tipo DER. */
const SQL_TYPE: Record<string, string> = {
  bigint: "bigint",
  bool: "bool",
  date: "date",
  datetime: "datetime",
  decimal: "decimal",
  float: "float",
  int: "int",
  json: "json",
  string: "varchar",
  text: "text",
  time: "time",
  uuid: "uuid",
};

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
    for (const local of Object.keys(rel.on)) {
      if (!out.has(local)) out.set(local, name);
    }
  }
  return out;
}

/** true si todas las columnas locales de la relación admiten null. */
function fkNullable(meta: SchemaMeta, rel: RelationDef): boolean {
  const locals = Object.keys(rel.on);
  if (!locals.length) return false;
  return locals.every((c) => {
    const col = meta.columns[c];
    return col !== undefined && col.nullable !== false && !col.pk;
  });
}

/** Cardinalidades de los dos extremos según kind y nulabilidad de la FK. */
function cards(rel: RelationDef, nullable: boolean): { fromCard: ErCardinality; toCard: ErCardinality } {
  if (nullable) {
    return rel.kind === "many"
      ? { fromCard: "zeroOrOne", toCard: "zeroOrMany" }
      : { fromCard: "zeroOrMany", toCard: "zeroOrOne" };
  }
  return rel.kind === "many"
    ? { fromCard: "one", toCard: "many" }
    : { fromCard: "many", toCard: "one" };
}

/** Etiqueta corta de cardinalidad para el diagrama de clases (1..N). */
function cardLabel(c: ErCardinality): string {
  if (c === "many") return "1..N";
  if (c === "zeroOrMany") return "0..N";
  if (c === "zeroOrOne") return "0..1";
  return "1";
}

/** ¿La relación está marcada como propagación? */
function isPropagated(entity: Entity<any>, rel: string, options: DiagramOptions): boolean {
  return options.propagations?.[entity.name]?.includes(rel) === true;
}

/** Payload { erDiagram } a partir de una lista de entidades. */
export function erDiagramPayload(entities: readonly Entity<any>[], options: DiagramOptions = {}): ErPayload {
  const out: ErEntityBox[] = [];
  const relations: ErRelation[] = [];
  for (const entity of entities) {
    const meta = entity.meta;
    const fks = foreignKeys(meta);
    const group = options.groupOf?.(entity);
    const attributes: DiagramAttribute[] = meta.persisted.map((name) => {
      const col = meta.columns[name]!;
      const attr: DiagramAttribute = { name, type: columnType(col) };
      if (meta.pks.includes(name)) attr.key = "PK";
      else if (fks.has(name)) attr.key = "FK";
      return attr;
    });
    const box: ErEntityBox = { id: entity.name, name: entity.singular, attributes };
    if (group !== undefined) box.group = group;
    out.push(box);

    for (const [relName, rel] of Object.entries(meta.relations)) {
      const nullable = options.nullableCards === true && fkNullable(meta, rel);
      const { fromCard, toCard } = cards(rel, nullable);
      const propagated = isPropagated(entity, relName, options);
      const edge: ErRelation = {
        from: entity.name,
        to: targetName(rel),
        fromCard,
        toCard,
        label: propagated ? relName + " (propaga)" : relName,
        identifying: rel.kind === "many",
      };
      if (propagated) edge.dashStyle = "dashed";
      relations.push(edge);
    }
  }
  const er: ErDiagram = { entities: out, relations };
  if (options.title !== undefined) er.title = options.title;
  if (options.direction !== undefined) er.direction = options.direction;
  if (options.groups !== undefined) er.groups = options.groups;
  return { erDiagram: er };
}

/** Payload { classDiagram } a partir de una lista de entidades. */
export function classDiagramPayload(
  entities: readonly Entity<any>[],
  options: DiagramOptions = {},
): ClassPayload {
  const classes: ClassBox[] = [];
  const relations: ClassRelation[] = [];
  for (const entity of entities) {
    const meta = entity.meta;
    const group = options.groupOf?.(entity);
    const box: ClassBox = {
      id: entity.name,
      name: entity.singular,
      stereotype: "<<entity>>",
      attributes: meta.persisted.map((name) => "+" + name + ": " + columnType(meta.columns[name]!)),
    };
    if (group !== undefined) box.group = group;
    classes.push(box);

    for (const [relName, rel] of Object.entries(meta.relations)) {
      const propagated = isPropagated(entity, relName, options);
      const nullable = options.nullableCards === true && fkNullable(meta, rel);
      const { toCard } = cards(rel, nullable);
      relations.push({
        from: entity.name,
        to: targetName(rel),
        kind: propagated ? "dependency" : "association",
        label: propagated ? "propaga" : cardLabel(toCard),
      });
    }
  }
  const classDiagram: ClassDiagram = { classes, relations };
  if (options.title !== undefined) classDiagram.title = options.title;
  if (options.direction !== undefined) classDiagram.direction = options.direction;
  if (options.groups !== undefined) classDiagram.groups = options.groups;
  return { classDiagram };
}

/** Utilidad única: emite los dos payloads desde la misma lista de entidades. */
export function diagramPayloads(
  entities: readonly Entity<any>[],
  options: DiagramOptions = {},
): { er: ErPayload; class: ClassPayload } {
  return {
    er: erDiagramPayload(entities, options),
    class: classDiagramPayload(entities, options),
  };
}
