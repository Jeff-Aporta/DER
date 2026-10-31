/**
 * Operaciones de la caché: proyección guardada, embeber con caché por huella, búsqueda (exacta primero, luego embeddings),
 * estadísticas y alimentación por cursor. Todas las escrituras van troceadas: D1 admite 100 parámetros por sentencia, no tiene
 * transacciones y una escritura perdida de un contador no invalida el vector servido.
 * Una fila por referencia: dos registros con el mismo texto comparten huella y el modelo solo se llama una vez, pero cada uno tiene
 * su fila, así una regla por entidad borra exactamente lo suyo.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md
 */
import { sql } from "kysely";
import { HttpError, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { Raw, ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { controllerEn } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/rules.ts";
import type { AlimentacionCfg, AvanceAlimentar, BuscarInput, BusquedaCfg, BusquedaResultado, ClaveContador, DeltaContador, DocumentoIndice, EmbeberResultado, EmbeddingsConfig, EstadisticaGrupo, Estadisticas, IndiceEmbeddings, ItemEmbeber, ItemResuelto, ModeloCfg, ProveedorEmbeddings, Proyeccion, ResultadoBusqueda, TipoReferencia } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";
import { coseno, codificar, decodificar, huellaDe, normalizarTexto, proyectar, VERSION_PROYECCION } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/vectores.ts";

/** Elementos por sentencia: deja margen a los filtros fijos dentro del límite de 100 parámetros de D1. */
const TROZO = 80;
/** Columnas de una fila nueva de la caché. */
const COLUMNAS = ["huella", "modelo", "dims", "iproyeccion", "tipo", "entidad", "id", "vector", "bytes", "hits", "fultimohit", "fcreado"];
/** Filas por INSERT (columnas × filas ≤ 100 parámetros). */
const FILAS_INSERT = 8;
/** Máximo de caracteres por texto si el modelo no lo define. */
const MAX_TEXTO = 8000;

/** Configuración tipada del plugin. */
export function cfgDe(p: ServerPlugin): EmbeddingsConfig {
  return p.cfg as EmbeddingsConfig;
}

/** Controller de la caché. */
export function cacheDe(p: ServerPlugin): ServerController<any> {
  return p.controllers["cache"]!;
}

/** Parte una lista en trozos. */
export function trozos<T>(lista: T[], n: number = TROZO): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

/** Clave del modelo pedido (por clave de cfg o por id del proveedor), o el defecto. */
function claveModelo(p: ServerPlugin, pedido?: string): string {
  const c = cfgDe(p);
  const defecto = c.modeloDefecto ?? Object.keys(c.modelos)[0]!;
  if (!pedido) return defecto;
  if (c.modelos[pedido]) return pedido;
  const clave = Object.entries(c.modelos).find(([, m]) => m.id === pedido)?.[0];
  if (!clave) throw new ValidationError(`Modelo desconocido: ${pedido}`);
  return clave;
}

/** Proyección que describe la configuración de un modelo (determinista: mismo id en todo isolate). */
export async function proyeccionDeCfg(m: ModeloCfg): Promise<Proyeccion> {
  const r = m.reduccion;
  const metodo = r ? r.metodo ?? "aleatoria" : "ninguna";
  const dims = metodo === "ninguna" ? m.dims : r!.dims!;
  const decimales = r?.decimales ?? null;
  const semilla = metodo === "aleatoria" ? r?.semilla ?? 20261031 : 0;
  const iproyeccion = (await huellaDe(JSON.stringify([VERSION_PROYECCION, m.id, m.dims, dims, decimales, metodo, semilla]))).slice(0, 40);
  return { iproyeccion, modelo: m.id, dimsorigen: m.dims, dims, decimales, metodo, semilla, version: VERSION_PROYECCION };
}

/** Proyección vigente del modelo: la de la tabla (la crea la primera vez). Se memoiza por isolate. */
export async function proyeccionVigente(p: ServerPlugin, clave: string): Promise<Proyeccion> {
  const memo = (p.state["proyecciones"] ??= {}) as Record<string, Proyeccion>;
  if (memo[clave]) return memo[clave];
  const ctrl = p.controllers["proyecciones"]!;
  const deseada = await proyeccionDeCfg(cfgDe(p).modelos[clave]!);
  const pojo = ctrl.pojo({ ...deseada, fcreado: new Date() });
  let fila = await ctrl.get(pojo.pkOnly(), { include: {} });
  if (!fila) fila = await ctrl.post(pojo).catch(() => ctrl.get(pojo.pkOnly(), { include: {} }));
  if (!fila) throw new Error(`No se pudo guardar la proyección de ${deseada.modelo}`);
  const j = fila.toJSON() as Record<string, unknown>;
  const guardada: Proyeccion = { iproyeccion: String(j["iproyeccion"]), modelo: String(j["modelo"]), dimsorigen: Number(j["dimsorigen"]), dims: Number(j["dims"]), decimales: j["decimales"] === null || j["decimales"] === undefined ? null : Number(j["decimales"]), metodo: j["metodo"] as Proyeccion["metodo"], semilla: Number(j["semilla"]), version: Number(j["version"]) };
  memo[clave] = guardada;
  return guardada;
}

/** Proyecciones vigentes de todos los modelos configurados. */
export async function proyeccionesVigentes(p: ServerPlugin): Promise<Proyeccion[]> {
  const out: Proyeccion[] = [];
  for (const clave of Object.keys(cfgDe(p).modelos)) out.push(await proyeccionVigente(p, clave));
  return out;
}

/** Suma a `embeddings_contadores`: UPDATE y, si no existía la fila, INSERT. */
export async function sumarContador(p: ServerPlugin, clave: ClaveContador, d: DeltaContador): Promise<void> {
  const ctrl = p.controllers["contadores"]!;
  const ahora = ctrl.toDb("factualizado", new Date());
  const col = (f: string) => ctrl.col(null, f);
  const donde = sql`${col("modelo")} = ${clave.modelo} and ${col("dims")} = ${clave.dims} and ${col("tipo")} = ${clave.tipo} and ${col("entidad")} = ${clave.entidad}`;
  const r = await sql`update ${sql.table(ctrl.table)} set ${col("hits")} = ${col("hits")} + ${d.hits}, ${col("misses")} = ${col("misses")} + ${d.misses}, ${col("purgadas")} = ${col("purgadas")} + ${d.purgadas}, ${col("factualizado")} = ${ahora} where ${donde}`.execute(p.db.kysely);
  if (Number(r.numAffectedRows ?? 0) > 0) return;
  await ctrl.post(ctrl.pojo({ ...clave, ...d, factualizado: new Date() })).catch(() => null);
}

/** Proveedor del modelo; 503 si no se inyectó. */
function proveedorDe(p: ServerPlugin, m: ModeloCfg): ProveedorEmbeddings {
  const s = p.services?.[m.proveedor] as ProveedorEmbeddings | undefined;
  if (!s) throw new HttpError(503, `Proveedor de embeddings no disponible: ${m.proveedor}`);
  return s;
}

/** Normaliza entradas a referencias con huella. Un `id` hace documento; sin `entidad` es consulta suelta. */
async function resolverItems(p: ServerPlugin, entradas: (string | ItemEmbeber)[], m: ModeloCfg): Promise<ItemResuelto[]> {
  const minusculas = cfgDe(p).normalizacion?.minusculas ?? true;
  const tope = m.maxTexto ?? MAX_TEXTO;
  const out: ItemResuelto[] = [];
  for (const e of entradas) {
    const item: ItemEmbeber = typeof e === "string" ? { texto: e } : e;
    const texto = normalizarTexto(item.texto, minusculas).slice(0, tope);
    if (!texto) throw new ValidationError("Texto vacío");
    const id = item.id === undefined ? "" : String(item.id);
    const tipo: TipoReferencia = item.tipo ?? (id ? "documento" : "consulta");
    if (tipo === "documento" && (!id || !item.entidad)) throw new ValidationError("Un documento requiere entidad e id");
    if (tipo === "consulta" && id) throw new ValidationError("Una consulta no lleva id");
    out.push({ texto, huella: await huellaDe(texto), tipo, entidad: item.entidad ?? "*", id });
  }
  return out;
}

const llaveRef = (i: { huella: string; tipo: string; entidad: string; id: string }): string => `${i.huella}|${i.tipo}|${i.entidad}|${i.id}`;

/** Filtro por modelo y proyección (también fija las dimensiones). */
function deProyeccion(cache: ServerController<any>, pr: Proyeccion): Raw {
  return sql`${cache.col("c", "modelo")} = ${pr.modelo} and ${cache.col("c", "dims")} = ${pr.dims} and ${cache.col("c", "iproyeccion")} = ${pr.iproyeccion}`;
}

/** Vector guardado por huella: la primera fila de cada huella pedida. */
async function leerPorHuella(p: ServerPlugin, pr: Proyeccion, huellas: string[]): Promise<Map<string, string>> {
  const cache = cacheDe(p);
  const tabla = sql.table(cache.table);
  const col = (f: string) => cache.col("c", f);
  const ids: number[] = [];
  for (const t of trozos(huellas)) {
    const r = await sql<{ icache: number }>`select min(${col("icache")}) as ${sql.id("icache")} from ${tabla} as c where ${col("huella")} in (${sql.join(t)}) and ${deProyeccion(cache, pr)} group by ${col("huella")}`.execute(p.db.kysely);
    ids.push(...r.rows.map((f) => Number(f.icache)));
  }
  const out = new Map<string, string>();
  for (const t of trozos(ids)) {
    const r = await sql<{ huella: string; vector: string }>`select ${col("huella")} as ${sql.id("huella")}, ${col("vector")} as ${sql.id("vector")} from ${tabla} as c where ${col("icache")} in (${sql.join(t)})`.execute(p.db.kysely);
    for (const f of r.rows) out.set(f.huella, f.vector);
  }
  return out;
}

/** Filas que ya existen para estas referencias: llave → icache. */
async function leerReferencias(p: ServerPlugin, pr: Proyeccion, items: ItemResuelto[]): Promise<Map<string, number>> {
  const cache = cacheDe(p);
  const col = (f: string) => cache.col("c", f);
  const out = new Map<string, number>();
  const grupos = Map.groupBy(items, (i) => `${i.tipo}|${i.entidad}`);
  for (const grupo of grupos.values()) {
    for (const t of trozos(grupo, 40)) {
      const r = await sql<{ icache: number; huella: string; id: string }>`select ${col("icache")} as ${sql.id("icache")}, ${col("huella")} as ${sql.id("huella")}, ${col("id")} as ${sql.id("id")} from ${sql.table(cache.table)} as c where ${col("tipo")} = ${t[0]!.tipo} and ${col("entidad")} = ${t[0]!.entidad} and ${col("huella")} in (${sql.join(t.map((i) => i.huella))}) and ${col("id")} in (${sql.join(t.map((i) => i.id))}) and ${deProyeccion(cache, pr)}`.execute(p.db.kysely);
      for (const f of r.rows) out.set(llaveRef({ huella: f.huella, tipo: t[0]!.tipo, entidad: t[0]!.entidad, id: f.id }), Number(f.icache));
    }
  }
  return out;
}

/** INSERT sin fallar si otro request ganó la misma referencia (la caché admite carreras). */
function insertarFilas(cache: ServerController<any>, filas: unknown[][]): Raw {
  const motor = cache.engine.name;
  const verbo = motor === "mysql" ? sql`insert ignore into` : sql`insert into`;
  const cols = sql.join(COLUMNAS.map((c) => cache.col(null, c)));
  const valores = sql.join(filas.map((f) => sql`(${sql.join(f)})`));
  const conflicto = motor === "sqlite" || motor === "pg" ? sql`on conflict do nothing` : sql``;
  return sql`${verbo} ${sql.table(cache.table)} (${cols}) values ${valores} ${conflicto}`;
}

/** Vectores de los textos que nadie tiene, por lotes del modelo. */
async function llamarModelo(p: ServerPlugin, m: ModeloCfg, pr: Proyeccion, textos: Map<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!textos.size) return out;
  const proveedor = proveedorDe(p, m);
  for (const lote of trozos([...textos.entries()], m.lote ?? 32)) {
    const crudos = await proveedor.embeber(lote.map(([, t]) => t), m.id);
    if (crudos.length !== lote.length) throw new HttpError(502, "El proveedor devolvió otro número de vectores");
    lote.forEach(([huella], i) => {
      const crudo = crudos[i]!;
      if (crudo.length !== m.dims) throw new HttpError(502, `El proveedor devolvió ${crudo.length} dimensiones (se esperaban ${m.dims})`);
      out.set(huella, codificar(proyectar(crudo, pr), pr.decimales));
    });
  }
  return out;
}

/**
 * Embeber con caché: un hit incrementa y devuelve sin llamar al modelo. Una referencia nueva de un texto conocido copia el vector
 * (cuenta hit). Una referencia documento con otro texto pierde su fila anterior.
 */
export async function embeberConCache(p: ServerPlugin, entradas: (string | ItemEmbeber)[], modelo?: string): Promise<EmbeberResultado> {
  const clave = claveModelo(p, modelo);
  const m = cfgDe(p).modelos[clave]!;
  const pr = await proyeccionVigente(p, clave);
  const cache = cacheDe(p);
  const items = await resolverItems(p, entradas, m);
  const unicos = [...new Map(items.map((i) => [llaveRef(i), i])).values()];
  const guardados = await leerPorHuella(p, pr, [...new Set(items.map((i) => i.huella))]);
  const existentes = await leerReferencias(p, pr, unicos);
  const faltan = new Map(unicos.filter((i) => !guardados.has(i.huella)).map((i) => [i.huella, i.texto]));
  const nuevos = await llamarModelo(p, m, pr, faltan);
  const ahora = new Date();
  const repetir = new Set<number>();
  const filas: unknown[][] = [];
  const deltas = new Map<string, DeltaContador & ClaveContador>();
  const pendientes = new Set(faltan.keys());
  for (const i of unicos) {
    const vector = guardados.get(i.huella) ?? nuevos.get(i.huella)!;
    const yaEsta = existentes.get(llaveRef(i));
    const esMiss = pendientes.delete(i.huella);
    const d = deltas.get(`${i.tipo}|${i.entidad}`) ?? { modelo: pr.modelo, dims: pr.dims, tipo: i.tipo, entidad: i.entidad, hits: 0, misses: 0, purgadas: 0 };
    deltas.set(`${i.tipo}|${i.entidad}`, d);
    if (esMiss) d.misses++;
    else d.hits++;
    if (yaEsta !== undefined) repetir.add(yaEsta);
    else filas.push([i.huella, pr.modelo, pr.dims, pr.iproyeccion, i.tipo, i.entidad, i.id, vector, vector.length, esMiss ? 0 : 1, esMiss ? null : cache.toDb("fultimohit", ahora), cache.toDb("fcreado", ahora)]);
  }
  await retirarTextoAnterior(p, unicos.filter((i) => i.tipo === "documento" && !existentes.has(llaveRef(i))), pr);
  for (const t of trozos(filas, FILAS_INSERT)) await insertarFilas(cache, t).execute(p.db.kysely);
  const col = (f: string) => cache.col(null, f);
  for (const t of trozos([...repetir])) await sql`update ${sql.table(cache.table)} set ${col("hits")} = ${col("hits")} + 1, ${col("fultimohit")} = ${cache.toDb("fultimohit", ahora)} where ${col("icache")} in (${sql.join(t)})`.execute(p.db.kysely);
  for (const d of deltas.values()) await sumarContador(p, { modelo: d.modelo, dims: d.dims, tipo: d.tipo, entidad: d.entidad }, { hits: d.hits, misses: d.misses, purgadas: 0 });
  const vectores = items.map((i) => decodificar(guardados.get(i.huella) ?? nuevos.get(i.huella)!, pr.decimales));
  const hits = [...deltas.values()].reduce((n, d) => n + d.hits, 0);
  const misses = [...deltas.values()].reduce((n, d) => n + d.misses, 0);
  return { modelo: pr.modelo, dims: pr.dims, iproyeccion: pr.iproyeccion, vectores, hits, misses };
}

/** Un documento cuyo texto cambió deja de servir con la huella anterior. */
async function retirarTextoAnterior(p: ServerPlugin, items: ItemResuelto[], pr: Proyeccion): Promise<void> {
  const cache = cacheDe(p);
  const col = (f: string) => cache.col(null, f);
  for (const grupo of Map.groupBy(items, (i) => i.entidad).values()) {
    for (const t of trozos(grupo)) await sql`delete from ${sql.table(cache.table)} where ${col("tipo")} = ${"documento"} and ${col("entidad")} = ${t[0]!.entidad} and ${col("modelo")} = ${pr.modelo} and ${col("id")} in (${sql.join(t.map((i) => i.id))})`.execute(p.db.kysely);
  }
}

/** Indexa documentos: embebe con caché y, si hay índice externo con `subir`, los sube. */
export async function indexarDocumentos(p: ServerPlugin, docs: (ItemEmbeber & { metadata?: Record<string, unknown> | undefined })[], modelo?: string): Promise<EmbeberResultado> {
  const r = await embeberConCache(p, docs.map(({ texto, entidad, id }) => ({ texto, entidad, id, tipo: "documento" as const })), modelo);
  const indice = indiceDe(p);
  if (indice?.subir && docs.length) await indice.subir(docs.map((d, i): DocumentoIndice => ({ entidad: d.entidad!, id: String(d.id), vector: r.vectores[i]!, metadata: d.metadata })));
  return r;
}

/** Olvida referencias: borra sus filas y las saca del índice externo. */
export async function olvidarDocumentos(p: ServerPlugin, entidad: string, ids: (string | number)[]): Promise<number> {
  const cache = cacheDe(p);
  const col = (f: string) => cache.col(null, f);
  let borradas = 0;
  for (const t of trozos(ids.map(String))) {
    const r = await sql`delete from ${sql.table(cache.table)} where ${col("tipo")} = ${"documento"} and ${col("entidad")} = ${entidad} and ${col("id")} in (${sql.join(t)})`.execute(p.db.kysely);
    borradas += Number(r.numAffectedRows ?? 0);
  }
  const indice = indiceDe(p);
  if (indice?.borrar && ids.length) await indice.borrar(ids.map((id) => ({ entidad, id: String(id) })));
  return borradas;
}

/** Índice externo configurado, o null (búsqueda local). Sus `dims` deben coincidir con la proyección del modelo por defecto. */
export function indiceDe(p: ServerPlugin): IndiceEmbeddings | null {
  const nombre = cfgDe(p).busqueda?.indice;
  return nombre ? (p.services?.[nombre] as IndiceEmbeddings | undefined) ?? null : null;
}

/** Coseno sobre los documentos de la caché: sirve sin Vectorize y compatible con D1, acotado por `maxCandidatos`. */
async function buscarLocal(p: ServerPlugin, pr: Proyeccion, vector: number[], entidades: string[] | null, b: BusquedaCfg): Promise<ResultadoBusqueda[]> {
  const cache = cacheDe(p);
  const col = (f: string) => cache.col("c", f);
  const filtro = entidades ? sql`and ${col("entidad")} in (${sql.join(entidades)})` : sql``;
  const pagina = cache.engine.page(b.maxCandidatos ?? 2000, undefined) ?? sql``;
  const r = await sql<{ entidad: string; id: string; vector: string }>`select ${col("entidad")} as ${sql.id("entidad")}, ${col("id")} as ${sql.id("id")}, ${col("vector")} as ${sql.id("vector")} from ${sql.table(cache.table)} as c where ${col("tipo")} = ${"documento"} and ${deProyeccion(cache, pr)} ${filtro} order by ${col("icache")} desc ${pagina}`.execute(p.db.kysely);
  return r.rows.map((f) => ({ entidad: f.entidad, id: f.id, score: coseno(vector, decodificar(f.vector, pr.decimales)), origen: "embedding" as const }));
}

/** Pk única de una entidad para cruzar resultados. */
function pkDe(ctrl: ServerController<any>): string {
  const pk = ctrl.entity.meta.pks[0];
  if (!pk || ctrl.entity.meta.pks.length !== 1) throw new ValidationError(`"${ctrl.entity.pluralPath.join("/")}" no tiene pk simple`);
  return pk;
}

/** Valor de pk con el tipo de la columna. */
function valorPk(ctrl: ServerController<any>, id: string): string | number {
  const tipo = ctrl.entity.meta.columns[pkDe(ctrl)]!.type;
  return tipo === "int" || tipo === "bigint" ? Number(id) : id;
}

/** Coincidencias de texto por las columnas declaradas: igualdad sin mayúsculas = exacta; contenida = contiene. */
async function coincidenciasExactas(p: ServerPlugin, q: string, entidades: string[] | null, i: BuscarInput, limite: number): Promise<ResultadoBusqueda[]> {
  const out: ResultadoBusqueda[] = [];
  const buscado = q.toLocaleLowerCase();
  for (const [entidad, columnas] of Object.entries(cfgDe(p).busqueda?.exactas ?? {})) {
    if (entidades && !entidades.includes(entidad)) continue;
    const ctrl = controllerEn(p.db, entidad);
    if (!ctrl) throw new ValidationError(`busqueda.exactas: entidad desconocida "${entidad}"`);
    const pk = pkDe(ctrl);
    const filtro = i.filtros?.[entidad];
    const where = { $and: [...(filtro ? [filtro] : []), { $or: columnas.map((c) => ({ [c]: { contains: q } })) }] };
    const filas = await ctrl.query({ where, pageSize: limite * 2, include: {} });
    for (const f of filas) {
      const j = f.toJSON() as Record<string, unknown>;
      const exacta = columnas.some((c) => String(j[c] ?? "").toLocaleLowerCase() === buscado);
      out.push({ entidad, id: String(j[pk]), score: 1, origen: exacta ? "exacta" : "contiene" });
    }
  }
  return out;
}

/** Documentos cuyo texto completo es exactamente la consulta (misma huella). */
async function coincidenciasHuella(p: ServerPlugin, huella: string, pr: Proyeccion, entidades: string[] | null): Promise<ResultadoBusqueda[]> {
  const cache = cacheDe(p);
  const col = (f: string) => cache.col("c", f);
  const filtro = entidades ? sql`and ${col("entidad")} in (${sql.join(entidades)})` : sql``;
  const r = await sql<{ entidad: string; id: string }>`select ${col("entidad")} as ${sql.id("entidad")}, ${col("id")} as ${sql.id("id")} from ${sql.table(cache.table)} as c where ${col("tipo")} = ${"documento"} and ${col("huella")} = ${huella} and ${deProyeccion(cache, pr)} ${filtro}`.execute(p.db.kysely);
  return r.rows.map((f) => ({ entidad: f.entidad, id: f.id, score: 1, origen: "exacta" as const }));
}

/** Aplica `filtros` por entidad a resultados que no pasaron por la entidad (huella y embeddings): sin esto se saltaría el filtro de un inquilino. */
async function aplicarFiltros(p: ServerPlugin, resultados: ResultadoBusqueda[], filtros: BuscarInput["filtros"]): Promise<ResultadoBusqueda[]> {
  if (!filtros) return resultados;
  const permitidos = new Set<string>();
  for (const [entidad, grupo] of Map.groupBy(resultados, (r) => r.entidad)) {
    const filtro = filtros[entidad];
    if (!filtro) {
      for (const r of grupo) permitidos.add(`${entidad}:${r.id}`);
      continue;
    }
    const ctrl = controllerEn(p.db, entidad);
    if (!ctrl) continue;
    const pk = pkDe(ctrl);
    for (const t of trozos(grupo)) {
      const filas = await ctrl.query({ where: { $and: [filtro, { [pk]: { in: t.map((r) => valorPk(ctrl, r.id)) } }] }, pageSize: t.length, include: {} });
      for (const f of filas) permitidos.add(`${entidad}:${String((f.toJSON() as Record<string, unknown>)[pk])}`);
    }
  }
  return resultados.filter((r) => permitidos.has(`${r.entidad}:${r.id}`));
}

const RANGO: Record<ResultadoBusqueda["origen"], number> = { exacta: 0, contiene: 1, embedding: 2 };

/** Búsqueda: exacta primero (columnas y huella), luego contenida y al final embeddings. Sin proveedor degrada a texto. */
export async function buscarConPrioridad(p: ServerPlugin, i: BuscarInput): Promise<BusquedaResultado> {
  const b = cfgDe(p).busqueda ?? {};
  const limite = i.limite ?? b.limite ?? 10;
  const entidades = i.entidades ?? null;
  const clave = claveModelo(p, i.modelo);
  const m = cfgDe(p).modelos[clave]!;
  const pr = await proyeccionVigente(p, clave);
  const [item] = await resolverItems(p, [i.q], m);
  const candidatos = await coincidenciasExactas(p, i.q, entidades, i, limite);
  candidatos.push(...(await coincidenciasHuella(p, item!.huella, pr, entidades)));
  const disponible = !!p.services?.[m.proveedor] || (await leerPorHuella(p, pr, [item!.huella])).size > 0;
  if (disponible) {
    const entidad = entidades?.length === 1 ? entidades[0]! : "*";
    const r = await embeberConCache(p, [{ texto: i.q, entidad, tipo: "consulta" }], clave);
    const indice = indiceDe(p);
    if (indice?.dims !== undefined && indice.dims !== pr.dims) throw new HttpError(500, `El índice tiene ${indice.dims} dimensiones y la proyección ${pr.dims}`);
    const hallados = indice ? (await indice.buscar(r.vectores[0]!, { topK: limite * 4, entidades, filtro: i.filtroIndice })).map((c) => ({ ...c, origen: "embedding" as const })) : await buscarLocal(p, pr, r.vectores[0]!, entidades, b);
    const minScore = b.minScore ?? 0;
    candidatos.push(...hallados.filter((c) => c.score >= minScore).sort((x, y) => y.score - x.score).slice(0, limite * 4));
  }
  const filtrados = await aplicarFiltros(p, candidatos, i.filtros);
  const mejor = new Map<string, ResultadoBusqueda>();
  for (const r of filtrados) {
    const k = `${r.entidad}:${r.id}`;
    const previo = mejor.get(k);
    if (!previo || RANGO[r.origen] < RANGO[previo.origen]) mejor.set(k, r);
  }
  const resultados = [...mejor.values()].sort((x, y) => RANGO[x.origen] - RANGO[y.origen] || y.score - x.score).slice(0, limite);
  return { q: i.q, semantica: disponible, resultados };
}

/** Grupo de estadística desde números crudos. */
function grupo(filas: number, bytes: number, hits: number, misses: number, purgadas: number): EstadisticaGrupo {
  return { filas, bytes, hits, misses, purgadas, tasa: hits + misses ? hits / (hits + misses) : 0 };
}

/** Estadísticas: tamaño actual por modelo y referencia, hits y misses acumulados de los contadores. */
export async function estadisticas(p: ServerPlugin): Promise<Estadisticas> {
  const cache = cacheDe(p);
  const cont = p.controllers["contadores"]!;
  const c = (f: string) => cache.col("c", f);
  const n = (f: string) => cont.col("n", f);
  const tam = await sql<{ modelo: string; dims: number; tipo: string; entidad: string; filas: number; bytes: number }>`select ${c("modelo")} as ${sql.id("modelo")}, ${c("dims")} as ${sql.id("dims")}, ${c("tipo")} as ${sql.id("tipo")}, ${c("entidad")} as ${sql.id("entidad")}, count(*) as ${sql.id("filas")}, sum(${c("bytes")}) as ${sql.id("bytes")} from ${sql.table(cache.table)} as c group by ${c("modelo")}, ${c("dims")}, ${c("tipo")}, ${c("entidad")}`.execute(p.db.kysely);
  const acu = await sql<{ modelo: string; dims: number; tipo: string; entidad: string; hits: number; misses: number; purgadas: number }>`select ${n("modelo")} as ${sql.id("modelo")}, ${n("dims")} as ${sql.id("dims")}, ${n("tipo")} as ${sql.id("tipo")}, ${n("entidad")} as ${sql.id("entidad")}, ${n("hits")} as ${sql.id("hits")}, ${n("misses")} as ${sql.id("misses")}, ${n("purgadas")} as ${sql.id("purgadas")} from ${sql.table(cont.table)} as n`.execute(p.db.kysely);
  const modelos = new Map<string, [string, number, number[]]>();
  const refs = new Map<string, [string, string, number[]]>();
  const sumar = (m: string, dims: number, tipo: string, entidad: string, v: number[]) => {
    const kM = `${m}|${dims}`;
    const kR = `${tipo}|${entidad}`;
    const eM = modelos.get(kM) ?? [m, Number(dims), [0, 0, 0, 0, 0]];
    const eR = refs.get(kR) ?? [tipo, entidad, [0, 0, 0, 0, 0]];
    v.forEach((x, i) => {
      eM[2][i]! += x;
      eR[2][i]! += x;
    });
    modelos.set(kM, eM);
    refs.set(kR, eR);
  };
  for (const f of tam.rows) sumar(f.modelo, f.dims, f.tipo, f.entidad, [Number(f.filas), Number(f.bytes ?? 0), 0, 0, 0]);
  for (const f of acu.rows) sumar(f.modelo, f.dims, f.tipo, f.entidad, [0, 0, Number(f.hits), Number(f.misses), Number(f.purgadas)]);
  const total = [0, 0, 0, 0, 0];
  for (const [, , v] of modelos.values()) v.forEach((x, i) => (total[i]! += x));
  const crear = (v: number[]) => grupo(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!);
  return { total: crear(total), porModelo: [...modelos.values()].map(([modelo, dims, v]) => ({ modelo, dims, ...crear(v) })), porReferencia: [...refs.values()].map(([tipo, entidad, v]) => ({ tipo, entidad, ...crear(v) })) };
}

/** Texto de un registro según su alimentación: `Etiqueta: valor` de las columnas con contenido. */
function textoDe(fila: Record<string, unknown>, a: AlimentacionCfg): string {
  const partes: string[] = [];
  for (const c of a.columnas) {
    const v = fila[c];
    if (v === null || v === undefined || String(v).trim() === "") continue;
    partes.push(a.etiquetas?.[c] ? `${a.etiquetas[c]}: ${String(v)}` : String(v));
  }
  return partes.join(". ");
}

/** Una tanda de una entidad desde su cursor guardado; el cursor no retrocede: lo editado se reindexa con `indexar`. */
export async function alimentarEntidad(p: ServerPlugin, entidad: string, lote: number | undefined, reiniciar: boolean | undefined): Promise<AvanceAlimentar> {
  const a = cfgDe(p).alimentacion?.[entidad];
  if (!a) throw new ValidationError(`Sin alimentación configurada para "${entidad}"`);
  const ctrl = controllerEn(p.db, entidad);
  if (!ctrl) throw new ValidationError(`Entidad desconocida "${entidad}"`);
  const pk = pkDe(ctrl);
  const cursores = p.controllers["cursores"]!;
  const llave = cursores.pojo({ entidad });
  const guardado = reiniciar ? null : await cursores.get(llave.pkOnly(), { include: {} });
  const cursor = guardado ? (guardado.toJSON() as Record<string, unknown>)["cursor"] as string | null : null;
  const tam = lote ?? a.lote ?? 50;
  const where = { $and: [...(a.donde ? [a.donde] : []), ...(cursor === null ? [] : [{ [pk]: { gt: valorPk(ctrl, cursor) } }])] };
  const filas = await ctrl.query({ where, orderBy: pk, pageSize: tam, include: {} });
  const docs = filas.map((f) => f.toJSON() as Record<string, unknown>).map((j) => ({ id: String(j[pk]), texto: textoDe(j, a) }));
  const conTexto = docs.filter((d) => d.texto);
  const r = conTexto.length ? await indexarDocumentos(p, conTexto.map((d) => ({ texto: d.texto, entidad, id: d.id }))) : { hits: 0, misses: 0 };
  const siguiente = docs.at(-1)?.id ?? cursor;
  const fila = cursores.pojo({ entidad, cursor: siguiente, factualizado: new Date() });
  if (await cursores.get(llave.pkOnly(), { include: {} })) await cursores.put(fila);
  else await cursores.post(fila);
  return { entidad, procesados: docs.length, hits: r.hits, misses: r.misses, cursor: siguiente, terminado: filas.length < tam };
}
