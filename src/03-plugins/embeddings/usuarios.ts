/**
 * Perfiles de usuario embebidos (`embeddings_usuarios`): viven en la base PRINCIPAL, no caducan y solo pierden su vector si el
 * usuario pasa 720 días sin interacción (la fila y sus preferencias se conservan). Sirven para saber qué compra, consulta o
 * repite un usuario y a quién se parece: `perfil` guarda el vector del perfil y `similares` devuelve los N más cercanos por
 * coseno. Se escriben con SQL parametrizado sobre el controller de la base principal (la columna `vector` está oculta).
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md
 */
import { sql } from "kysely";
import { HttpError, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { Raw, ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { cfgDe, claveModelo, embeberDirecto, proyeccionVigente, proyeccionesVigentes } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/cache.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { ActualizarPerfilInput, FilaPerfil, InformeUsuarios, PerfilResultado, SimilaresResultado, SimilaresUsuariosInput, SimilarUsuario } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";
import { TTL_USUARIO_DIAS } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";
import { codificar, coseno, decodificar, normalizarL2, proyectar } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/vectores.ts";

const DIA_MS = 86_400_000;
const MUESTRA = 5;

/** Controller de los perfiles de usuario (base principal). */
function usuariosDe(p: ServerPlugin): ServerController<any> {
  const ctrl = p.controllers["usuarios"];
  if (!ctrl) throw new Error("embeddings: falta la entidad usuarios (base principal)");
  return ctrl;
}

/** Preferencias como objeto, venga ya parseado o como texto JSON. */
function preferenciasDe(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v) as unknown;
      return j && typeof j === "object" && !Array.isArray(j) ? j as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Fila del perfil de un usuario, o null. */
async function leerPerfil(p: ServerPlugin, iusuario: string): Promise<FilaPerfil | null> {
  const ctrl = usuariosDe(p);
  const col = (f: string) => ctrl.col(null, f);
  const r = await sql<FilaPerfil>`select ${col("iusuario")} as ${sql.id("iusuario")}, ${col("vector")} as ${sql.id("vector")}, ${col("dims")} as ${sql.id("dims")}, ${col("modelo")} as ${sql.id("modelo")}, ${col("preferencias")} as ${sql.id("preferencias")}, ${col("fhactualizado")} as ${sql.id("fhactualizado")}, ${col("fhinteraccion")} as ${sql.id("fhinteraccion")} from ${sql.table(ctrl.table)} where ${col("iusuario")} = ${iusuario}`.execute(p.db.kysely);
  const fila = r.rows[0];
  if (!fila) return null;
  return { ...fila, dims: Number(fila.dims), fhactualizado: fila.fhactualizado ? String(fila.fhactualizado) : null, fhinteraccion: fila.fhinteraccion ? String(fila.fhinteraccion) : null };
}

/** Vector del perfil: promedio de los textos (proyectado y normalizado) o el vector crudo del modelo, ya proyectado. */
async function vectorDePerfil(p: ServerPlugin, input: ActualizarPerfilInput): Promise<{ codificado: string; dims: number; modelo: string; iproyeccion: string }> {
  const clave = claveModelo(p, input.modelo);
  const m = cfgDe(p).modelos[clave]!;
  const pr = await proyeccionVigente(p, clave);
  let proyectado: number[];
  if (input.vector) {
    if (input.vector.length !== m.dims) throw new ValidationError(`vector: se esperaban ${m.dims} dimensiones del modelo ${m.id} (llegaron ${input.vector.length})`);
    proyectado = proyectar(input.vector, pr);
  } else {
    const r = await embeberDirecto(p, input.textos ?? [], clave);
    const suma = new Array<number>(r.dims).fill(0);
    for (const v of r.vectores) v.forEach((x, i) => (suma[i]! += x));
    proyectado = normalizarL2(suma);
  }
  return { codificado: codificar(proyectado, pr.decimales), dims: pr.dims, modelo: pr.modelo, iproyeccion: pr.iproyeccion };
}

/** Crea o actualiza el perfil embebido de un usuario: vector (por textos o crudo), preferencias y marcas de tiempo. */
export async function actualizarPerfil(p: ServerPlugin, input: ActualizarPerfilInput): Promise<PerfilResultado> {
  const ctrl = usuariosDe(p);
  const col = (f: string) => ctrl.col(null, f);
  const tabla = sql.table(ctrl.table);
  const ahora = new Date();
  const interactua = input.interaccion ?? true;
  const previo = await leerPerfil(p, input.iusuario);
  const vector = input.textos !== undefined || input.vector !== undefined ? await vectorDePerfil(p, input) : null;
  const tocaVector = vector !== null;
  const sets: Raw[] = [sql`${col("fhactualizado")} = ${ctrl.toDb("fhactualizado", ahora)}`];
  if (vector) sets.push(sql`${col("vector")} = ${vector.codificado}`, sql`${col("dims")} = ${vector.dims}`, sql`${col("modelo")} = ${vector.modelo}`);
  if (input.preferencias !== undefined) sets.push(sql`${col("preferencias")} = ${ctrl.toDb("preferencias", input.preferencias)}`);
  if (interactua) sets.push(sql`${col("fhinteraccion")} = ${ctrl.toDb("fhinteraccion", ahora)}`);
  if (previo) await sql`update ${tabla} set ${sql.join(sets, sql`, `)} where ${col("iusuario")} = ${input.iusuario}`.execute(p.db.kysely);
  else await sql`insert into ${tabla} (${col("iusuario")}, ${col("vector")}, ${col("dims")}, ${col("modelo")}, ${col("preferencias")}, ${col("fhactualizado")}, ${col("fhinteraccion")}) values (${input.iusuario}, ${vector ? vector.codificado : null}, ${vector ? vector.dims : 0}, ${vector ? vector.modelo : null}, ${ctrl.toDb("preferencias", input.preferencias ?? null)}, ${ctrl.toDb("fhactualizado", ahora)}, ${interactua ? ctrl.toDb("fhinteraccion", ahora) : null})`.execute(p.db.kysely);
  const guardado = await leerPerfil(p, input.iusuario);
  return { iusuario: input.iusuario, modelo: guardado?.modelo ?? null, dims: guardado?.dims ?? 0, iproyeccion: tocaVector && vector ? vector.iproyeccion : null, actualizado: true, fhactualizado: guardado?.fhactualizado ?? ahora.toISOString(), fhinteraccion: guardado?.fhinteraccion ?? null };
}

/** Decimales con que se guardó el vector del perfil (los de su proyección; sin proyección conocida, float32). */
async function decimalesDe(p: ServerPlugin, modelo: string, dims: number): Promise<number | null> {
  const pr = (await proyeccionesVigentes(p)).find((x) => x.modelo === modelo && x.dims === dims);
  return pr?.decimales ?? null;
}

/** Los N usuarios más parecidos al perfil dado por coseno (mismo modelo y dimensiones), con sus preferencias. */
export async function similaresDeUsuario(p: ServerPlugin, input: SimilaresUsuariosInput): Promise<SimilaresResultado> {
  const ctrl = usuariosDe(p);
  const col = (f: string) => ctrl.col(null, f);
  const yo = await leerPerfil(p, input.iusuario);
  if (!yo) throw new HttpError(404, `Usuario sin perfil embebido: ${input.iusuario}`);
  if (!yo.vector || !yo.modelo || !yo.dims) return { iusuario: input.iusuario, modelo: yo.modelo, dims: yo.dims, resultados: [] };
  if (input.modelo) {
    const Esperado = cfgDe(p).modelos[claveModelo(p, input.modelo)]!.id;
    if (Esperado !== yo.modelo) return { iusuario: input.iusuario, modelo: yo.modelo, dims: yo.dims, resultados: [] };
  }
  const decimales = await decimalesDe(p, yo.modelo, yo.dims);
  const mío = decodificar(yo.vector, decimales);
  const filas = await sql<{ iusuario: string; vector: string; preferencias: unknown }>`select ${col("iusuario")} as ${sql.id("iusuario")}, ${col("vector")} as ${sql.id("vector")}, ${col("preferencias")} as ${sql.id("preferencias")} from ${sql.table(ctrl.table)} where ${col("modelo")} = ${yo.modelo} and ${col("dims")} = ${yo.dims} and ${col("vector")} is not null`.execute(p.db.kysely);
  const minimo = input.minimo ?? 0;
  const limite = input.limite ?? cfgDe(p).usuarios?.limiteSimilares ?? 10;
  const resultados: SimilarUsuario[] = [];
  for (const fila of filas.rows) {
    const iusuario = String(fila.iusuario);
    if (iusuario === input.iusuario) continue;
    const score = coseno(mío, decodificar(String(fila.vector), decimales));
    if (score < minimo) continue;
    resultados.push({ iusuario, score, preferencias: preferenciasDe(fila.preferencias) });
  }
  resultados.sort((a, b) => b.score - a.score || a.iusuario.localeCompare(b.iusuario));
  return { iusuario: input.iusuario, modelo: yo.modelo, dims: yo.dims, resultados: resultados.slice(0, limite) };
}

/**
 * Paso `usuarios` de la purga: a quien no interactúa hace `diasSinInteraccion` (720) se le retira el vector; la fila y sus
 * preferencias se conservan para poder recalcularlo cuando vuelva. `simular` cuenta sin tocar nada.
 */
export async function purgarPerfiles(p: ServerPlugin, simular: boolean): Promise<InformeUsuarios> {
  const ctrl = usuariosDe(p);
  const dias = cfgDe(p).usuarios?.diasSinInteraccion ?? TTL_USUARIO_DIAS;
  const col = (f: string) => ctrl.col(null, f);
  const ultima = sql`coalesce(${col("fhinteraccion")}, ${col("fhactualizado")})`;
  const corte = new Date(Date.now() - dias * DIA_MS);
  const donde = sql`${col("vector")} is not null and ${ultima} < ${ctrl.toDb("fhinteraccion", corte)}`;
  const filas = await sql<{ iusuario: string; ultima: string | null }>`select ${col("iusuario")} as ${sql.id("iusuario")}, ${ultima} as ${sql.id("ultima")} from ${sql.table(ctrl.table)} where ${donde}`.execute(p.db.kysely);
  const muestra = filas.rows.slice(0, MUESTRA).map((f) => ({ iusuario: String(f.iusuario), fhinteraccion: f.ultima ? String(f.ultima) : null }));
  if (filas.rows.length && !simular) await sql`update ${sql.table(ctrl.table)} set ${col("vector")} = null, ${col("dims")} = ${0}, ${col("modelo")} = null where ${donde}`.execute(p.db.kysely);
  return { dias, expirados: filas.rows.length, muestra };
}