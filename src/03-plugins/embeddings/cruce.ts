/**
 * Cruce de las reglas de purga con las entidades de la base PRINCIPAL. La caché vive en otra SQLite, así que `donde` y
 * `huerfanos` no pueden ser un join: aquí se resuelven los ids contra la base principal y se cargan en una tabla temporal de la
 * base de embeddings; el predicado de la regla solo referencia esa tabla. La simulación y la corrida real usan el mismo
 * predicado, así el informe coincide con lo que se borra. Los ids son la pk de la entidad (texto) y los valores de `donde`
 * siguen yendo como parámetros.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md
 */
import { sql } from "kysely";
import { ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { Raw, ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { kyselyDe } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/conexion.ts";
import { condicionDe, controllerEn } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/rules.ts";
import type { ReglaPurga } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";

/** Ids por `insert`/`in` en la base de embeddings: muy por debajo del límite de parámetros de cualquier motor. */
const TROZO_IDS = 500;

/** Trocea una lista. */
function trozos<T>(lista: T[], n: number = TROZO_IDS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

/** Pk única de la entidad referida (ya validada por `erroresContraEntidades`). */
function pkDe(ctrl: ServerController<any>): string {
  const pk = ctrl.entity.meta.pks[0];
  if (!pk || ctrl.entity.meta.pks.length !== 1) throw new ValidationError(`"${ctrl.entity.pluralPath.join("/")}" no tiene pk simple`);
  return pk;
}

/** Ids de la entidad que cumplen `donde` (en la base principal), como texto. */
async function idsQueCumplen(p: ServerPlugin, ctrl: ServerController<any>, r: ReglaPurga, ahora: Date): Promise<string[]> {
  if (!r.donde?.length) return [];
  const pk = pkDe(ctrl);
  const condiciones = r.donde.map((c) => condicionDe(ctrl, c, ahora));
  const filas = await sql<{ id: unknown }>`select ${ctrl.col("e", pk)} as ${sql.id("id")} from ${sql.table(ctrl.table)} as e where ${sql.join(condiciones, sql` and `)}`.execute(p.db.kysely);
  return filas.rows.map((f) => String(f.id));
}

/** Ids que están en la caché de esa entidad y ya no existen en la base principal (documentos huérfanos). */
async function idsHuerfanos(p: ServerPlugin, ctrl: ServerController<any>, cache: ServerController<any>, entidad: string): Promise<string[]> {
  const filas = await sql<{ id: string }>`select distinct ${cache.col("c", "id")} as ${sql.id("id")} from ${sql.table(cache.table)} as c where ${cache.col("c", "tipo")} = ${"documento"} and ${cache.col("c", "entidad")} = ${entidad}`.execute(kyselyDe(p));
  const ids = filas.rows.map((f) => String(f.id)).filter((id) => id !== "");
  const pk = pkDe(ctrl);
  const vivos = new Set<string>();
  for (const trozo of trozos(ids)) {
    const valores = trozo.map((id) => ctrl.toDb(pk, id));
    const existentes = await sql<{ id: unknown }>`select ${ctrl.col("e", pk)} as ${sql.id("id")} from ${sql.table(ctrl.table)} as e where ${ctrl.col("e", pk)} in (${sql.join(valores)})`.execute(p.db.kysely);
    for (const f of existentes.rows) vivos.add(String(f.id));
  }
  return ids.filter((id) => !vivos.has(id));
}

/** Resuelve el cruce de una regla en una tabla temporal de la base de embeddings y devuelve su predicado (`1 = 0` si no hay ids). */
export async function resolverCruce(p: ServerPlugin, r: ReglaPurga, cache: ServerController<any>, ahora: Date, tablas: string[]): Promise<Raw> {
  const entidad = r.alcance?.entidad;
  if (!entidad) throw new ValidationError(`Regla "${r.nombre}": donde y huerfanos requieren alcance.entidad`);
  const ctrl = controllerEn(p.db, entidad);
  if (!ctrl) throw new ValidationError(`Regla "${r.nombre}": entidad desconocida "${entidad}"`);
  const ids = new Set<string>();
  if (r.donde) for (const id of await idsQueCumplen(p, ctrl, r, ahora)) ids.add(id);
  if (r.huerfanos) for (const id of await idsHuerfanos(p, ctrl, cache, entidad)) ids.add(id);
  if (!ids.size) return sql`1 = 0`;
  const n = Number(p.state["cruces"] ?? 0) + 1;
  p.state["cruces"] = n;
  const nombre = `cruce_${n}`;
  const exec = kyselyDe(p);
  await sql`create temp table ${sql.id(nombre)} (id text not null primary key)`.execute(exec);
  tablas.push(nombre);
  for (const trozo of trozos([...ids])) await sql`insert into ${sql.id(nombre)} (id) values ${sql.join(trozo.map((id) => sql`(${id})`), sql`, `)}`.execute(exec);
  return sql`(${cache.col("c", "tipo")} = ${"documento"} and ${cache.col("c", "entidad")} = ${entidad} and ${cache.col("c", "id")} in (select id from ${sql.id(nombre)}))`;
}

/** Borra las tablas temporales que dejó la corrida de purga (si el motor no las admite, no falla). */
export async function limpiarCruces(p: ServerPlugin, tablas: string[]): Promise<void> {
  for (const nombre of tablas) await sql`drop table if exists ${sql.id(nombre)}`.execute(kyselyDe(p)).catch(() => null);
}
