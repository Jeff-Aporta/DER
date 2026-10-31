/**
 * schemas.ts (plugin de embeddings) — tipos (uno por línea) y contratos Zod compartidos por client y server. Sólo `zod`.
 * Las reglas de purga son datos: identificadores con forma validada aquí y contra las entidades en `rules.ts`; nunca SQL libre.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md
 */
import { z } from "zod";

// ===================================================================================== configuración

/** Método de reducción: `ninguna` (solo decimales), `truncar` (primeras N dimensiones) o `aleatoria` (proyección dispersa con semilla, sirve a modelos no entrenados para truncarse como bge-m3). */
export type MetodoReduccion = "ninguna" | "truncar" | "aleatoria";
/** Reducción por modelo: `dims` destino, `decimales` 1..4 (1-2 ocupan 1 byte por dimensión, 3-4 dos; sin decimales, float32 de 4 bytes) y `semilla` de la proyección aleatoria. */
export type ReduccionCfg = { metodo?: MetodoReduccion | undefined; dims?: number | undefined; decimales?: number | undefined; semilla?: number | undefined };
/** Modelo: `id` del proveedor (columna `modelo`), `dims` que entrega, `proveedor` clave en `services`, `lote` textos por llamada, `maxTexto` caracteres y `reduccion`. */
export type ModeloCfg = { id: string; dims: number; proveedor: string; lote?: number | undefined; maxTexto?: number | undefined; reduccion?: ReduccionCfg | undefined };
/** Tipo de referencia de una fila: `documento` (un registro de una entidad) o `consulta` (texto de búsqueda, `id` vacío). */
export type TipoReferencia = "documento" | "consulta";
/** A qué filas aplica una regla: `entidad` (plural, o `*` en consultas sin entidad), `tipo` y `modelo` (id). Vacío = todo. */
export type Alcance = { entidad?: string | undefined; tipo?: TipoReferencia | undefined; modelo?: string | undefined };
/** Operador de una condición sobre la entidad referida; `masDeDias` compara una fecha con `ahora - valor` días. */
export type OperadorCondicion = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "nulo" | "noNulo" | "masDeDias";
/** Condición sobre una columna de la entidad referida (se valida contra su definición). */
export type Condicion = { columna: string; op: OperadorCondicion; valor?: string | number | boolean | (string | number)[] | undefined };
/**
 * Regla de purga. Criterios en AND: `sinHitsDias` (último hit, o creación si nunca hubo, más viejo que), `edadDias`, `hitsMenorQue`,
 * `donde` (condiciones en AND sobre la entidad de `alcance.entidad`) y `huerfanos` (el registro ya no existe; junto a `donde` cuenta
 * como O: cumple `donde` o ya no existe). `todo: true` confirma borrar todo el alcance. `soloPresion` la reserva para la purga
 * por tamaño. `excluirDeGeneral` saca su alcance del tiempo general. Menor `prioridad` corre antes.
 */
export type ReglaPurga = { nombre: string; descripcion?: string | undefined; prioridad?: number | undefined; activa?: boolean | undefined; alcance?: Alcance | undefined; sinHitsDias?: number | undefined; edadDias?: number | undefined; hitsMenorQue?: number | undefined; donde?: Condicion[] | undefined; huerfanos?: boolean | undefined; todo?: boolean | undefined; soloPresion?: boolean | undefined; excluirDeGeneral?: boolean | undefined };
/** Tiempo general: filas sin hits en `sinHitsDias`, salvo las de reglas con `excluirDeGeneral`. */
export type PurgaGeneral = { sinHitsDias: number };
/** Purga por tamaño: al superar `maxFilas` o `maxBytes` baja hasta `objetivoPct` %, por `orden` (reglas `soloPresion`; sin él, por prioridad) y al final `ultimoRecurso` (`lru` o `ninguno`). */
export type PresionCfg = { maxFilas?: number | undefined; maxBytes?: number | undefined; objetivoPct?: number | undefined; orden?: string[] | undefined; ultimoRecurso?: "lru" | "ninguno" | undefined };
/** Purga: `general`, `obsoletas` (filas de una proyección que ya no es la vigente de su modelo, default true), `reglas`, `presion`, `lote` filas por tanda y `maxLotes` tandas por corrida. */
export type PurgaCfg = { general?: PurgaGeneral | undefined; obsoletas?: boolean | undefined; reglas?: ReglaPurga[] | undefined; presion?: PresionCfg | undefined; lote?: number | undefined; maxLotes?: number | undefined };
/** Alimentación periódica de una entidad: `columnas` que forman el texto, `etiquetas` por columna, `donde` (where de DER) y `lote`. */
export type AlimentacionCfg = { columnas: string[]; etiquetas?: Record<string, string> | undefined; donde?: Record<string, unknown> | undefined; lote?: number | undefined };
/** Búsqueda: `indice` clave en `services` (sin él, coseno sobre la caché), `exactas` columnas por entidad, `limite`, `minScore`, `maxCandidatos` de la búsqueda local. */
export type BusquedaCfg = { indice?: string | undefined; exactas?: Record<string, string[]> | undefined; limite?: number | undefined; minScore?: number | undefined; maxCandidatos?: number | undefined };
/** Normalización del texto antes de la huella y del modelo: `minusculas` (default true); espacios y Unicode siempre. */
export type NormalizacionCfg = { minusculas?: boolean | undefined };
/** Configuración del plugin (`createServer(embeddingsServer, { db, cfg, services })`). */
export type EmbeddingsConfig = { modeloDefecto?: string | undefined; modelos: Record<string, ModeloCfg>; normalizacion?: NormalizacionCfg | undefined; alimentacion?: Record<string, AlimentacionCfg> | undefined; busqueda?: BusquedaCfg | undefined; purga?: PurgaCfg | undefined };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLURAL = /^(\*|[A-Za-z_][A-Za-z0-9_-]*(\/[A-Za-z_][A-Za-z0-9_-]*)*)$/;
const NOMBRE = /^[a-z0-9][a-z0-9_-]{0,59}$/;
/** Nombres de pasos de la corrida: una regla no puede llamarse así. */
export const PASOS_RESERVADOS: readonly string[] = ["general", "obsoletas", "presion", "lru"];
/** Máximo de parámetros que suman las reglas: D1 admite 100 por sentencia y la simulación encadena todas. */
export const MAX_PARAMETROS_REGLAS = 90;

const ZIdent = z.string().regex(IDENT, "identificador inválido");
const ZPlural = z.string().regex(PLURAL, "entidad inválida");
const ZDias = z.number().positive().max(36500);
const ZEscalar = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
const ZAlcance: z.ZodType<Alcance> = z.object({ entidad: ZPlural.optional(), tipo: z.enum(["documento", "consulta"]).optional(), modelo: z.string().min(1).max(120).optional() }).strict();
const SIN_VALOR: readonly string[] = ["nulo", "noNulo"];
const ZCondicion: z.ZodType<Condicion> = z.object({ columna: ZIdent, op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte", "in", "nulo", "noNulo", "masDeDias"]), valor: z.union([ZEscalar, z.array(z.union([z.string().max(500), z.number().finite()])).min(1).max(20)]).optional() }).strict().superRefine((c, ctx) => {
  if (SIN_VALOR.includes(c.op) && c.valor !== undefined) ctx.addIssue({ code: "custom", message: `${c.op} no lleva valor` });
  if (!SIN_VALOR.includes(c.op) && c.valor === undefined) ctx.addIssue({ code: "custom", message: `${c.op} requiere valor` });
  if (c.op === "in" && !Array.isArray(c.valor)) ctx.addIssue({ code: "custom", message: "in requiere una lista" });
  if (c.op !== "in" && Array.isArray(c.valor)) ctx.addIssue({ code: "custom", message: `${c.op} no admite lista` });
  if (c.op === "masDeDias" && (typeof c.valor !== "number" || c.valor <= 0)) ctx.addIssue({ code: "custom", message: "masDeDias requiere días positivos" });
});
/** Zod estricto de una regla de purga (forma; las columnas se validan contra la entidad al armar y al correr). */
export const ZReglaPurga: z.ZodType<ReglaPurga> = z.object({ nombre: z.string().regex(NOMBRE, "nombre inválido: minúsculas, números, - y _"), descripcion: z.string().max(300).optional(), prioridad: z.number().int().min(0).max(100000).optional(), activa: z.boolean().optional(), alcance: ZAlcance.optional(), sinHitsDias: ZDias.optional(), edadDias: ZDias.optional(), hitsMenorQue: z.number().int().min(1).optional(), donde: z.array(ZCondicion).min(1).max(10).optional(), huerfanos: z.boolean().optional(), todo: z.boolean().optional(), soloPresion: z.boolean().optional(), excluirDeGeneral: z.boolean().optional() }).strict().superRefine((r, ctx) => {
  if (PASOS_RESERVADOS.includes(r.nombre)) ctx.addIssue({ code: "custom", message: `"${r.nombre}" es un nombre reservado` });
  const criterio = r.sinHitsDias !== undefined || r.edadDias !== undefined || r.hitsMenorQue !== undefined || !!r.donde || !!r.huerfanos;
  if (!criterio && !r.todo && !r.soloPresion && !r.excluirDeGeneral) ctx.addIssue({ code: "custom", message: `Regla "${r.nombre}" sin criterio: use todo: true para borrar todo su alcance` });
  if (criterio && r.todo) ctx.addIssue({ code: "custom", message: `Regla "${r.nombre}": todo: true no se combina con otros criterios` });
  const cruza = !!r.donde || !!r.huerfanos;
  if (cruza && (!r.alcance?.entidad || r.alcance.entidad === "*")) ctx.addIssue({ code: "custom", message: `Regla "${r.nombre}": donde y huerfanos requieren alcance.entidad` });
  if (cruza && r.alcance?.tipo === "consulta") ctx.addIssue({ code: "custom", message: `Regla "${r.nombre}": una consulta no referencia ningún registro` });
});
const ZPresion: z.ZodType<PresionCfg> = z.object({ maxFilas: z.number().int().positive().optional(), maxBytes: z.number().int().positive().optional(), objetivoPct: z.number().int().min(1).max(100).optional(), orden: z.array(z.string().min(1)).optional(), ultimoRecurso: z.enum(["lru", "ninguno"]).optional() }).strict();
const ZReduccion: z.ZodType<ReduccionCfg> = z.object({ metodo: z.enum(["ninguna", "truncar", "aleatoria"]).optional(), dims: z.number().int().positive().optional(), decimales: z.number().int().min(1).max(4).optional(), semilla: z.number().int().min(0).max(4294967295).optional() }).strict();
const ZModelo: z.ZodType<ModeloCfg> = z.object({ id: z.string().min(1).max(120), dims: z.number().int().positive().max(8192), proveedor: z.string().min(1), lote: z.number().int().min(1).max(500).optional(), maxTexto: z.number().int().positive().optional(), reduccion: ZReduccion.optional() }).strict().superRefine((m, ctx) => {
  const r = m.reduccion;
  if (!r) return;
  const metodo = r.metodo ?? "aleatoria";
  if (metodo === "ninguna" && r.dims !== undefined && r.dims !== m.dims) ctx.addIssue({ code: "custom", message: "metodo ninguna no cambia dims" });
  if (metodo !== "ninguna" && (r.dims === undefined || r.dims >= m.dims)) ctx.addIssue({ code: "custom", message: `reduccion.dims debe ser menor que ${m.dims}` });
});
const ZAlimentacion: z.ZodType<AlimentacionCfg> = z.object({ columnas: z.array(ZIdent).min(1), etiquetas: z.record(ZIdent, z.string()).optional(), donde: z.record(z.string(), z.unknown()).optional(), lote: z.number().int().min(1).max(500).optional() }).strict();
const ZBusqueda: z.ZodType<BusquedaCfg> = z.object({ indice: z.string().min(1).optional(), exactas: z.record(ZPlural, z.array(ZIdent).min(1)).optional(), limite: z.number().int().min(1).max(100).optional(), minScore: z.number().min(-1).max(1).optional(), maxCandidatos: z.number().int().min(1).max(50000).optional() }).strict();

/** Parámetros SQL que aporta una regla en el peor caso (límite de D1). */
function parametrosDe(r: ReglaPurga): number {
  const alcance = Object.keys(r.alcance ?? {}).length;
  const criterios = [r.sinHitsDias, r.edadDias, r.hitsMenorQue].filter((x) => x !== undefined).length;
  const donde = (r.donde ?? []).reduce((n, c) => n + (Array.isArray(c.valor) ? c.valor.length : 1), 0);
  return alcance + criterios + donde + 1;
}

/** Revisa un conjunto de reglas: nombres únicos y presupuesto de parámetros; retorna los errores. */
export function erroresDeReglas(reglas: ReglaPurga[]): string[] {
  const nombres = reglas.map((r) => r.nombre);
  const repetidos = [...new Set(nombres.filter((n, i) => nombres.indexOf(n) !== i))];
  const parametros = reglas.reduce((n, r) => n + parametrosDe(r), 0);
  return [...repetidos.map((n) => `Regla repetida: ${n}`), ...(parametros > MAX_PARAMETROS_REGLAS ? [`Las reglas suman ${parametros} parámetros (máximo ${MAX_PARAMETROS_REGLAS})`] : [])];
}

const ZPurga: z.ZodType<PurgaCfg> = z.object({ general: z.object({ sinHitsDias: ZDias }).strict().optional(), obsoletas: z.boolean().optional(), reglas: z.array(ZReglaPurga).max(20).optional(), presion: ZPresion.optional(), lote: z.number().int().min(1).max(5000).optional(), maxLotes: z.number().int().min(1).max(1000).optional() }).strict().superRefine((p, ctx) => {
  for (const message of erroresDeReglas(p.reglas ?? [])) ctx.addIssue({ code: "custom", message });
  const presion = new Set((p.reglas ?? []).filter((r) => r.soloPresion).map((r) => r.nombre));
  for (const n of p.presion?.orden ?? []) if (!presion.has(n)) ctx.addIssue({ code: "custom", message: `presion.orden: "${n}" no es una regla soloPresion` });
  if (p.presion && p.presion.maxFilas === undefined && p.presion.maxBytes === undefined) ctx.addIssue({ code: "custom", message: "presion requiere maxFilas o maxBytes" });
});
/** Zod estricto de la configuración completa. */
export const ZEmbeddingsConfig: z.ZodType<EmbeddingsConfig> = z.object({ modeloDefecto: z.string().min(1).optional(), modelos: z.record(z.string().min(1), ZModelo), normalizacion: z.object({ minusculas: z.boolean().optional() }).strict().optional(), alimentacion: z.record(ZPlural, ZAlimentacion).optional(), busqueda: ZBusqueda.optional(), purga: ZPurga.optional() }).strict().superRefine((c, ctx) => {
  const claves = Object.keys(c.modelos);
  if (!claves.length) ctx.addIssue({ code: "custom", message: "Falta al menos un modelo" });
  if (c.modeloDefecto && !c.modelos[c.modeloDefecto]) ctx.addIssue({ code: "custom", message: `modeloDefecto "${c.modeloDefecto}" no existe` });
  if (!c.modeloDefecto && claves.length > 1) ctx.addIssue({ code: "custom", message: "Con varios modelos, modeloDefecto es obligatorio" });
});

// ===================================================================================== operaciones

/** Texto a embeber con su referencia. Sin `entidad`: consulta suelta (`entidad` = `*`). Con `id`: documento. */
export type ItemEmbeber = { texto: string; entidad?: string | undefined; id?: string | number | undefined; tipo?: TipoReferencia | undefined };
/** Entrada de `embeber`. */
export type EmbeberInput = { items: (string | ItemEmbeber)[]; modelo?: string | undefined };
/** Resultado de `embeber`: vectores en el orden de entrada, ya reducidos (hit y miss devuelven lo mismo). */
export type EmbeberResultado = { modelo: string; dims: number; iproyeccion: string; vectores: number[][]; hits: number; misses: number };
/** Entrada de `buscar`: `filtros` where de DER por entidad; `filtroIndice` pasa tal cual al índice externo. */
export type BuscarInput = { q: string; entidades?: string[] | undefined; limite?: number | undefined; modelo?: string | undefined; filtros?: Record<string, Record<string, unknown>> | undefined; filtroIndice?: Record<string, unknown> | undefined };
/** Resultado de búsqueda: `origen` exacta > contiene > embedding (ese orden es la prioridad). */
export type ResultadoBusqueda = { entidad: string; id: string; score: number; origen: "exacta" | "contiene" | "embedding" };
/** Respuesta de `buscar`: `semantica` false si faltó el proveedor (solo coincidencias de texto). */
export type BusquedaResultado = { q: string; semantica: boolean; resultados: ResultadoBusqueda[] };
/** Entrada de `purgar`: `simular` no borra; `reglas` reemplaza las configuradas; `solo` limita a esos pasos; `ahora` fija el reloj (ISO). */
export type PurgarInput = { simular?: boolean | undefined; reglas?: ReglaPurga[] | undefined; solo?: string[] | undefined; ahora?: string | undefined };
/** Fila de muestra de un paso de purga (nunca el vector). */
export type MuestraPurga = { huella: string; entidad: string; id: string; tipo: string; modelo: string; hits: number; fultimohit: string | null };
/** Lo que un paso borró o borraría. `estimado`: en simulación bajo presión, la parte proporcional al exceso. */
export type PasoPurga = { paso: string; fase: "regla" | "presion"; filas: number; bytes: number; estimado: boolean; muestra: MuestraPurga[] };
/** Tamaño de la caché. */
export type TamanoCache = { filas: number; bytes: number };
/** Estado de la presión en una corrida. */
export type InformePresion = { activada: boolean; maxFilas: number | null; maxBytes: number | null; objetivoFilas: number | null; objetivoBytes: number | null };
/** Informe de `purgar`. `pendiente`: se agotó el presupuesto de la corrida (`lote` × `maxLotes`); falta otra corrida. */
export type InformePurga = { simulacion: boolean; ahora: string; inicial: TamanoCache; final: TamanoCache; pasos: PasoPurga[]; presion: InformePresion; pendiente: boolean };
/** Fila de estadísticas: `filas`/`bytes` actuales; `hits`/`misses`/`purgadas` acumulados (sobreviven a la purga). */
export type EstadisticaGrupo = { filas: number; bytes: number; hits: number; misses: number; purgadas: number; tasa: number };
/** Estadística por modelo. */
export type EstadisticaModelo = EstadisticaGrupo & { modelo: string; dims: number };
/** Estadística por referencia. */
export type EstadisticaReferencia = EstadisticaGrupo & { tipo: string; entidad: string };
/** Respuesta de `estadisticas`: `tasa` = hits / (hits + misses). */
export type Estadisticas = { total: EstadisticaGrupo; porModelo: EstadisticaModelo[]; porReferencia: EstadisticaReferencia[] };
/** Entrada de `alimentar`: una `entidad` o todas las configuradas; `lote` por entidad; `reiniciar` vuelve al principio. */
export type AlimentarInput = { entidad?: string | undefined; lote?: number | undefined; reiniciar?: boolean | undefined };
/** Avance de `alimentar` por entidad. */
export type AvanceAlimentar = { entidad: string; procesados: number; hits: number; misses: number; cursor: string | null; terminado: boolean };
/** Respuesta de `alimentar`. */
export type AlimentarResultado = { avances: AvanceAlimentar[] };
/** Depuración de `GET embeddings/reglas`: orden efectivo, errores contra las entidades y proyecciones vigentes. */
export type ExplicacionReglas = { orden: string[]; presion: string[]; errores: string[]; reglas: ReglaPurga[]; proyecciones: Proyeccion[] };

/** Zod de `POST embeddings/embeber`. */
export const ZEmbeberInput: z.ZodType<EmbeberInput> = z.object({ items: z.array(z.union([z.string(), z.object({ texto: z.string(), entidad: ZPlural.optional(), id: z.union([z.string().max(200), z.number()]).optional(), tipo: z.enum(["documento", "consulta"]).optional() }).strict()])).min(1).max(500), modelo: z.string().min(1).optional() }).strict();
/** Zod de `POST embeddings/buscar`. */
export const ZBuscarInput: z.ZodType<BuscarInput> = z.object({ q: z.string().trim().min(1).max(2000), entidades: z.array(ZPlural).min(1).max(50).optional(), limite: z.number().int().min(1).max(100).optional(), modelo: z.string().min(1).optional(), filtros: z.record(ZPlural, z.record(z.string(), z.unknown())).optional(), filtroIndice: z.record(z.string(), z.unknown()).optional() }).strict();
/** Zod de `POST embeddings/purgar`. */
export const ZPurgarInput: z.ZodType<PurgarInput> = z.object({ simular: z.boolean().optional(), reglas: z.array(ZReglaPurga).max(20).optional(), solo: z.array(z.string().min(1)).min(1).optional(), ahora: z.iso.datetime().optional() }).strict();
/** Zod de `POST embeddings/alimentar`. */
export const ZAlimentarInput: z.ZodType<AlimentarInput> = z.object({ entidad: ZPlural.optional(), lote: z.number().int().min(1).max(500).optional(), reiniciar: z.boolean().optional() }).strict();

// ===================================================================================== proveedores y estado

/** Proveedor inyectable (`services`): vectores crudos de `textos`, en orden. */
export type ProveedorEmbeddings = { embeber(textos: string[], modelo: string): Promise<ArrayLike<number>[]> };
/** Coincidencia de un índice externo. */
export type CoincidenciaIndice = { entidad: string; id: string; score: number };
/** Documento para subir a un índice externo. */
export type DocumentoIndice = { entidad: string; id: string; vector: number[]; metadata?: Record<string, unknown> | undefined };
/** Índice inyectable (`services`): `dims` declaradas (se valida contra la reducción), `buscar` y, opcionales, `subir` y `borrar`. */
export type IndiceEmbeddings = { dims?: number | undefined; buscar(vector: number[], o: { topK: number; entidades: string[] | null; filtro?: Record<string, unknown> | undefined }): Promise<CoincidenciaIndice[]>; subir?(docs: DocumentoIndice[]): Promise<unknown>; borrar?(refs: { entidad: string; id: string }[]): Promise<unknown> };
/** Lo mínimo del binding de Workers AI. */
export type WorkersAiLike = { run(modelo: string, input: { text: string[] }): Promise<unknown> };
/** Lo mínimo del binding de Vectorize. */
export type VectorizeBindingLike = { query(vector: number[], o: Record<string, unknown>): Promise<{ matches?: { id: string; score: number; metadata?: Record<string, unknown> | null }[] }>; upsert(v: { id: string; values: number[]; metadata?: Record<string, unknown> }[]): Promise<unknown>; deleteByIds(ids: string[]): Promise<unknown> };
/** Proyección guardada (`embeddings_proyecciones`): lo que se aplica a documentos y consultas por igual. */
export type Proyeccion = { iproyeccion: string; modelo: string; dimsorigen: number; dims: number; decimales: number | null; metodo: MetodoReduccion; semilla: number; version: number };
/** Fila aplanada de una referencia pedida a `embeber`. */
export type ItemResuelto = { texto: string; huella: string; tipo: TipoReferencia; entidad: string; id: string };
/** Conteos acumulables de `embeddings_contadores`. */
export type DeltaContador = { hits: number; misses: number; purgadas: number };
/** Clave de `embeddings_contadores`. */
export type ClaveContador = { modelo: string; dims: number; tipo: string; entidad: string };
/** Paso interno de la corrida de purga. */
export type PasoPlan<R> = { paso: string; fase: "regla" | "presion"; pred: R };
