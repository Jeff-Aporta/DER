/**
 * Motor de reglas de purga: valida cada regla contra la definición de las entidades y la compila a un predicado parametrizado
 * sobre la caché (alias `c`). La caché vive en OTRA base que las entidades, así que el cruce con `donde`/`huerfanos` no es un
 * join: `cruce.ts` resuelve los ids contra la base principal y los materializa en una tabla temporal que este módulo referencia.
 * Los identificadores salen del metadata de los controllers (`sql.ref`, `sql.table`) y los valores van como parámetros.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md
 */
import { sql } from "kysely";
import type { ColumnDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { Database } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import { findController } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { Raw } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { Alcance, Condicion, Proyeccion, ReglaPurga } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";

const DIA_MS = 86_400_000;
const COMPARA: Record<string, string> = { eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" };
const NUMERICOS: readonly string[] = ["int", "bigint", "float", "decimal"];
const FECHAS: readonly string[] = ["date", "datetime", "time"];

/** Controller de la entidad `plural` en ESTA base (la principal), o null. */
export function controllerEn(db: Database, plural: string): ServerController<any> | null {
  return db.controllers.find((c) => c.entity.pluralPath.join("/") === plural) ?? null;
}

/** Fecha `dias` antes de `ahora`. */
function hace(ahora: Date, dias: number): Date {
  return new Date(ahora.getTime() - dias * DIA_MS);
}

/** Errores de un valor frente al tipo de su columna. */
function errorDeValor(c: Condicion, columna: ColumnDef): string | null {
  if (c.op === "masDeDias") return FECHAS.includes(columna.type) ? null : `masDeDias requiere una columna de fecha ("${c.columna}" es ${columna.type})`;
  if (c.op === "nulo" || c.op === "noNulo") return null;
  if (columna.type === "bool" && !["eq", "ne"].includes(c.op)) return `"${c.columna}" es bool: solo eq y ne`;
  for (const v of Array.isArray(c.valor) ? c.valor : [c.valor]) {
    if (columna.type === "bool" && typeof v !== "boolean") return `"${c.columna}" espera un booleano`;
    if (NUMERICOS.includes(columna.type) && typeof v !== "number") return `"${c.columna}" espera un número`;
    if (FECHAS.includes(columna.type) && (typeof v !== "string" || Number.isNaN(Date.parse(v)))) return `"${c.columna}" espera una fecha ISO`;
    if (["string", "text", "uuid"].includes(columna.type) && typeof v !== "string") return `"${c.columna}" espera un texto`;
  }
  return null;
}

/** Errores de una regla contra las entidades de `db`: entidad, pk simple, columnas persistidas, visibles y de tipo comparable. */
export function erroresContraEntidades(r: ReglaPurga, db: Database): string[] {
  const cruza = !!r.donde || !!r.huerfanos;
  const entidad = r.alcance?.entidad;
  if (!cruza || !entidad) return [];
  const ctrl = controllerEn(db, entidad);
  if (!ctrl) return [`Regla "${r.nombre}": ${findController(entidad) ? `la entidad "${entidad}" vive en otra base` : `entidad desconocida "${entidad}"`}`];
  const { pks, columns } = ctrl.entity.meta;
  const errores: string[] = [];
  if (pks.length !== 1) errores.push(`Regla "${r.nombre}": "${entidad}" tiene pk compuesta`);
  else if (![...NUMERICOS.slice(0, 2), "string", "text", "uuid"].includes(columns[pks[0]!]?.type ?? "")) errores.push(`Regla "${r.nombre}": la pk de "${entidad}" no es entera ni de texto`);
  for (const c of r.donde ?? []) {
    const columna = columns[c.columna];
    if (!columna || columna.virtual) errores.push(`Regla "${r.nombre}": "${c.columna}" no es una columna persistida de "${entidad}"`);
    else if (ctrl.isHidden(c.columna)) errores.push(`Regla "${r.nombre}": "${c.columna}" es una columna oculta`);
    else if (columna.type === "json") errores.push(`Regla "${r.nombre}": "${c.columna}" es json y no es comparable`);
    else {
      const e = errorDeValor(c, columna);
      if (e) errores.push(`Regla "${r.nombre}": ${e}`);
    }
  }
  return errores;
}

/** Filtro de alcance sobre la caché. */
function partesDeAlcance(a: Alcance | undefined, cache: ServerController<any>): Raw[] {
  const out: Raw[] = [];
  if (a?.entidad) out.push(sql`${cache.col("c", "entidad")} = ${a.entidad}`);
  if (a?.tipo) out.push(sql`${cache.col("c", "tipo")} = ${a.tipo}`);
  if (a?.modelo) out.push(sql`${cache.col("c", "modelo")} = ${a.modelo}`);
  return out;
}

/** Condición sobre la entidad referida (alias `e`), con sus valores ya convertidos al motor de la base principal. */
export function condicionDe(ctrl: ServerController<any>, c: Condicion, ahora: Date): Raw {
  const ref = ctrl.col("e", c.columna);
  if (c.op === "nulo") return sql`${ref} is null`;
  if (c.op === "noNulo") return sql`${ref} is not null`;
  if (c.op === "masDeDias") return sql`${ref} < ${ctrl.toDb(c.columna, hace(ahora, c.valor as number))}`;
  if (c.op === "in") return sql`${ref} in (${sql.join((c.valor as (string | number)[]).map((v) => ctrl.toDb(c.columna, v)))})`;
  return sql`${ref} ${sql.raw(COMPARA[c.op]!)} ${ctrl.toDb(c.columna, c.valor)}`;
}

/** Último uso de una fila: su último hit o, si nunca tuvo, su creación. */
function ultimoUso(cache: ServerController<any>): Raw {
  return sql`coalesce(${cache.col("c", "fultimohit")}, ${cache.col("c", "fcreado")})`;
}

/** Predicado de una regla ya validada. `cruce`: el que armó `cruce.ts` con los ids resueltos contra la base principal. */
export function predicadoRegla(r: ReglaPurga, cache: ServerController<any>, ahora: Date, cruce?: Raw): Raw {
  const partes = partesDeAlcance(r.alcance, cache);
  if (r.sinHitsDias !== undefined) partes.push(sql`${ultimoUso(cache)} < ${cache.toDb("fcreado", hace(ahora, r.sinHitsDias))}`);
  if (r.edadDias !== undefined) partes.push(sql`${cache.col("c", "fcreado")} < ${cache.toDb("fcreado", hace(ahora, r.edadDias))}`);
  if (r.hitsMenorQue !== undefined) partes.push(sql`${cache.col("c", "hits")} < ${r.hitsMenorQue}`);
  if (cruce) partes.push(cruce);
  if (!partes.length) return sql`1 = 1`;
  return sql`(${sql.join(partes, sql` and `)})`;
}

/** Predicado del tiempo general: sin uso en `dias`, salvo los alcances de las reglas con `excluirDeGeneral`. */
export function predicadoGeneral(dias: number, reglas: ReglaPurga[], cache: ServerController<any>, ahora: Date): Raw {
  const fuera = reglas.filter((r) => r.excluirDeGeneral).map((r) => partesDeAlcance(r.alcance, cache));
  const partes: Raw[] = [sql`${ultimoUso(cache)} < ${cache.toDb("fcreado", hace(ahora, dias))}`];
  for (const a of fuera) partes.push(a.length ? sql`not (${sql.join(a, sql` and `)})` : sql`1 = 0`);
  return sql`(${sql.join(partes, sql` and `)})`;
}

/** Predicado de filas de una proyección que ya no es la vigente de su modelo (no sirven: su espacio cambió). */
export function predicadoObsoletas(vigentes: Proyeccion[], cache: ServerController<any>): Raw {
  if (!vigentes.length) return sql`1 = 0`;
  return sql`(${sql.join(vigentes.map((p) => sql`(${cache.col("c", "modelo")} = ${p.modelo} and ${cache.col("c", "iproyeccion")} <> ${p.iproyeccion})`), sql` or `)})`;
}

/** Orden de desalojo: lo menos usado primero. */
export function ordenLru(cache: ServerController<any>): Raw {
  return sql`${ultimoUso(cache)} asc, ${cache.col("c", "icache")} asc`;
}
