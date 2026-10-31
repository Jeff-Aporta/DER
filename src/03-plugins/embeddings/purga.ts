/**
 * Corrida de purga: pasos normales (`obsoletas`, reglas por prioridad, `general`) y, si la caché supera el umbral, pasos de presión
 * (`orden` de reglas `soloPresion`, luego `lru`). La simulación recorre el mismo plan contando en vez de borrar y excluye de cada paso
 * lo que ya tomaron los anteriores, así informa lo mismo que borraría. Se borra por tandas `select` + `delete` por `icache`: D1 no
 * tiene transacciones ni `delete ... limit`, y `lote` × `maxLotes` acota lo que hace una invocación del Worker.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md
 */
import { sql } from "kysely";
import { ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { Raw, ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { cacheDe, cfgDe, proyeccionesVigentes, sumarContador, trozos } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/cache.ts";
import { erroresContraEntidades, ordenLru, predicadoGeneral, predicadoObsoletas, predicadoRegla } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/rules.ts";
import { erroresDeReglas, type ExplicacionReglas, type InformePurga, type MuestraPurga, type PasoPlan, type PasoPurga, type PresionCfg, type PurgarInput, type ReglaPurga, type TamanoCache, ZPurgarInput } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";

const MUESTRA = 5;

/** Reglas activas ordenadas por prioridad (y nombre, para que el orden sea estable). */
function ordenadas(reglas: ReglaPurga[]): ReglaPurga[] {
  return reglas.filter((r) => r.activa !== false).sort((a, b) => (a.prioridad ?? 100) - (b.prioridad ?? 100) || a.nombre.localeCompare(b.nombre));
}

/** Reglas de presión en su orden efectivo. */
function ordenPresion(reglas: ReglaPurga[], presion: PresionCfg | undefined): ReglaPurga[] {
  const propias = ordenadas(reglas).filter((r) => r.soloPresion);
  if (!presion?.orden) return propias;
  return presion.orden.flatMap((n) => propias.filter((r) => r.nombre === n));
}

/** Todos los errores de un conjunto de reglas contra las entidades de la base. */
function erroresDe(p: ServerPlugin, reglas: ReglaPurga[]): string[] {
  return [...erroresDeReglas(reglas), ...reglas.flatMap((r) => erroresContraEntidades(r, p.db))];
}

/** Explica la configuración sin tocar datos: orden real de los pasos, errores y proyecciones vigentes. */
export async function explicarReglas(p: ServerPlugin): Promise<ExplicacionReglas> {
  const c = cfgDe(p).purga ?? {};
  const reglas = c.reglas ?? [];
  const normales = ordenadas(reglas).filter((r) => !r.soloPresion).map((r) => r.nombre);
  const orden = [...(c.obsoletas === false ? [] : ["obsoletas"]), ...normales, ...(c.general ? ["general"] : [])];
  const presion = [...ordenPresion(reglas, c.presion).map((r) => r.nombre), ...((c.presion?.ultimoRecurso ?? "lru") === "lru" && c.presion ? ["lru"] : [])];
  return { orden, presion, errores: erroresDe(p, reglas), reglas, proyecciones: await proyeccionesVigentes(p) };
}

/** Falla si alguna regla no coincide con las entidades. */
export function exigirReglasValidas(p: ServerPlugin, reglas: ReglaPurga[]): void {
  const errores = erroresDe(p, reglas);
  if (errores.length) throw new ValidationError(errores.join("; "));
}

/** Filas y bytes de la caché. */
async function medir(p: ServerPlugin): Promise<TamanoCache> {
  const cache = cacheDe(p);
  const r = await sql<{ filas: number; bytes: number | null }>`select count(*) as ${sql.id("filas")}, sum(${cache.col("c", "bytes")}) as ${sql.id("bytes")} from ${sql.table(cache.table)} as c`.execute(p.db.kysely);
  return { filas: Number(r.rows[0]?.filas ?? 0), bytes: Number(r.rows[0]?.bytes ?? 0) };
}

/** Predicado de un paso sin lo que ya tomaron los anteriores (simulación). */
function sinPrevios(pred: Raw, previos: Raw[]): Raw {
  return previos.length ? sql`${pred} and not (${sql.join(previos, sql` or `)})` : pred;
}

/** Cuenta lo que un paso tomaría y trae la muestra. */
async function contar(p: ServerPlugin, pred: Raw, previos: Raw[]): Promise<{ filas: number; bytes: number; muestra: MuestraPurga[] }> {
  const cache = cacheDe(p);
  const col = (f: string) => cache.col("c", f);
  const donde = sinPrevios(pred, previos);
  const tabla = sql.table(cache.table);
  const r = await sql<{ filas: number; bytes: number | null }>`select count(*) as ${sql.id("filas")}, sum(${col("bytes")}) as ${sql.id("bytes")} from ${tabla} as c where ${donde}`.execute(p.db.kysely);
  const campos = ["huella", "entidad", "id", "tipo", "modelo", "hits", "fultimohit"];
  const seleccion = sql.join(campos.map((f) => sql`${col(f)} as ${sql.id(f)}`));
  const pagina = cache.engine.page(MUESTRA, undefined) ?? sql``;
  const m = await sql<MuestraPurga>`select ${seleccion} from ${tabla} as c where ${donde} order by ${ordenLru(cache)} ${pagina}`.execute(p.db.kysely);
  const muestra = m.rows.map((f) => ({ ...f, hits: Number(f.hits), fultimohit: f.fultimohit ? String(f.fultimohit) : null }));
  return { filas: Number(r.rows[0]?.filas ?? 0), bytes: Number(r.rows[0]?.bytes ?? 0), muestra };
}

/** Falta por quitar para llegar al objetivo. */
function exceso(t: TamanoCache, objetivoFilas: number | null, objetivoBytes: number | null): TamanoCache {
  return { filas: objetivoFilas === null ? 0 : Math.max(0, t.filas - objetivoFilas), bytes: objetivoBytes === null ? 0 : Math.max(0, t.bytes - objetivoBytes) };
}

/** Purga: `simular` informa sin borrar. Reglas ajenas a la configuración llegan en `reglas` y pasan la misma validación. */
export async function purgar(p: ServerPlugin, entrada: unknown = {}): Promise<InformePurga> {
  const parsed = ZPurgarInput.safeParse(entrada ?? {});
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const input: PurgarInput = parsed.data;
  const c = cfgDe(p).purga ?? {};
  const reglas = input.reglas ?? c.reglas ?? [];
  exigirReglasValidas(p, reglas);
  const cache = cacheDe(p);
  const simular = input.simular ?? false;
  const ahora = input.ahora ? new Date(input.ahora) : new Date();
  const incluido = (paso: string) => !input.solo || input.solo.includes(paso);
  const predicado = (r: ReglaPurga): PasoPlan<Raw> => ({ paso: r.nombre, fase: "regla", pred: predicadoRegla(r, cache, p.db, ahora) });
  const normales: PasoPlan<Raw>[] = ordenadas(reglas).filter((r) => !r.soloPresion).map(predicado);
  if (c.obsoletas !== false) normales.unshift({ paso: "obsoletas", fase: "regla", pred: predicadoObsoletas(await proyeccionesVigentes(p), cache) });
  if (c.general) normales.push({ paso: "general", fase: "regla", pred: predicadoGeneral(c.general.sinHitsDias, reglas, cache, ahora) });
  const presion = c.presion;
  const planPresion: PasoPlan<Raw>[] = ordenPresion(reglas, presion).map((r) => ({ ...predicado(r), fase: "presion" as const }));
  if (presion && (presion.ultimoRecurso ?? "lru") === "lru") planPresion.push({ paso: "lru", fase: "presion", pred: sql`1 = 1` });

  const inicial = await medir(p);
  const actual: TamanoCache = { ...inicial };
  const pasos: PasoPurga[] = [];
  const previos: Raw[] = [];
  const lote = c.lote ?? 500;
  let presupuesto = lote * (c.maxLotes ?? 20);
  let pendiente = false;
  const purgadas = new Map<string, { modelo: string; dims: number; tipo: string; entidad: string; n: number }>();

  /** Borra por tandas, lo menos usado primero, hasta `basta`; acumula por contador. */
  const borrar = async (plan: PasoPlan<Raw>, basta: () => boolean): Promise<PasoPurga> => {
    const col = (f: string) => cache.col("c", f);
    const salida: PasoPurga = { paso: plan.paso, fase: plan.fase, filas: 0, bytes: 0, estimado: false, muestra: [] };
    const campos = sql.join(["icache", "bytes", "modelo", "dims", "tipo", "entidad", "huella", "id", "hits", "fultimohit"].map((f) => sql`${col(f)} as ${sql.id(f)}`));
    while (!basta()) {
      if (presupuesto <= 0) {
        pendiente = true;
        break;
      }
      const pedido = Math.min(lote, presupuesto);
      const pagina = cache.engine.page(pedido, undefined) ?? sql``;
      const r = await sql<MuestraPurga & { icache: number; bytes: number; dims: number }>`select ${campos} from ${sql.table(cache.table)} as c where ${plan.pred} order by ${ordenLru(cache)} ${pagina}`.execute(p.db.kysely);
      if (!r.rows.length) break;
      const ids: number[] = [];
      for (const f of r.rows) {
        if (basta()) break;
        ids.push(Number(f.icache));
        salida.filas++;
        salida.bytes += Number(f.bytes);
        actual.filas--;
        actual.bytes -= Number(f.bytes);
        presupuesto--;
        if (salida.muestra.length < MUESTRA) salida.muestra.push({ huella: f.huella, entidad: f.entidad, id: f.id, tipo: f.tipo, modelo: f.modelo, hits: Number(f.hits), fultimohit: f.fultimohit ? String(f.fultimohit) : null });
        const k = `${f.modelo}|${f.dims}|${f.tipo}|${f.entidad}`;
        const g = purgadas.get(k) ?? { modelo: f.modelo, dims: Number(f.dims), tipo: f.tipo, entidad: f.entidad, n: 0 };
        g.n++;
        purgadas.set(k, g);
      }
      for (const t of trozos(ids)) await sql`delete from ${sql.table(cache.table)} where ${cache.col(null, "icache")} in (${sql.join(t)})`.execute(p.db.kysely);
      if (r.rows.length < pedido) break;
    }
    return salida;
  };

  for (const plan of normales.filter((n) => incluido(n.paso))) {
    if (simular) {
      const n = await contar(p, plan.pred, previos);
      actual.filas -= n.filas;
      actual.bytes -= n.bytes;
      previos.push(plan.pred);
      pasos.push({ paso: plan.paso, fase: plan.fase, estimado: false, ...n });
      continue;
    }
    pasos.push(await borrar(plan, () => false));
  }

  const maxFilas = presion?.maxFilas ?? null;
  const maxBytes = presion?.maxBytes ?? null;
  const pct = (presion?.objetivoPct ?? 80) / 100;
  const objetivoFilas = maxFilas === null ? null : Math.floor(maxFilas * pct);
  const objetivoBytes = maxBytes === null ? null : Math.floor(maxBytes * pct);
  const activada = incluido("presion") && ((maxFilas !== null && actual.filas > maxFilas) || (maxBytes !== null && actual.bytes > maxBytes));
  if (activada) {
    const sobra = () => exceso(actual, objetivoFilas, objetivoBytes);
    const listo = () => sobra().filas === 0 && sobra().bytes === 0;
    for (const plan of planPresion) {
      if (listo()) break;
      if (!simular) {
        const hecho = await borrar(plan, listo);
        pasos.push(hecho);
        continue;
      }
      const n = await contar(p, plan.pred, previos);
      if (!n.filas) continue;
      const porFila = n.bytes / n.filas;
      const filas = Math.min(n.filas, Math.max(sobra().filas, Math.ceil(sobra().bytes / (porFila || 1))));
      const bytes = Math.round(filas * porFila);
      actual.filas -= filas;
      actual.bytes -= bytes;
      previos.push(plan.pred);
      pasos.push({ paso: plan.paso, fase: plan.fase, filas, bytes, estimado: filas < n.filas, muestra: n.muestra.slice(0, filas) });
    }
  }
  for (const g of purgadas.values()) await sumarContador(p, { modelo: g.modelo, dims: g.dims, tipo: g.tipo, entidad: g.entidad }, { hits: 0, misses: 0, purgadas: g.n });
  return { simulacion: simular, ahora: ahora.toISOString(), inicial, final: actual, pasos, presion: { activada, maxFilas, maxBytes, objetivoFilas, objetivoBytes }, pendiente };
}
