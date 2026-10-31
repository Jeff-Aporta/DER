/**
 * Matemática pura de los vectores: normalización del texto y huella, L2, proyección (truncar o aleatoria dispersa con semilla),
 * decimales y codificación compacta en texto, coseno. Sin dependencias (corre en Workers). La proyección aleatoria se deriva sólo
 * de `semilla` + dimensiones con un PRNG propio (`version` 1): cambiar este algoritmo exige subir `VERSION_PROYECCION`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md
 */
import { b64urlDecode, b64urlEncode } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import type { Proyeccion } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";

/** Versión del algoritmo de proyección (entra al id de la proyección). */
export const VERSION_PROYECCION = 1;

/** Texto canónico de la huella y del modelo: Unicode NFKC, espacios colapsados, recorte y, si se pide, minúsculas. */
export function normalizarTexto(texto: string, minusculas: boolean): string {
  const limpio = texto.normalize("NFKC").replace(/\s+/g, " ").trim();
  return minusculas ? limpio.toLowerCase() : limpio;
}

/** SHA-256 en hexadecimal. */
export async function huellaDe(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Vector con norma L2 = 1 (el vector cero queda igual). */
export function normalizarL2(v: ArrayLike<number>): number[] {
  let suma = 0;
  for (let i = 0; i < v.length; i++) suma += v[i]! * v[i]!;
  const norma = Math.sqrt(suma) || 1;
  return Array.from(v, (x) => x / norma);
}

/** Coseno (tolera vectores no unitarios: el redondeo les quita un poco de norma). */
export function coseno(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let punto = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    punto += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? punto / Math.sqrt(na * nb) : 0;
}

/** PRNG mulberry32: determinista en todo motor de JS. */
function generador(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MATRICES = new Map<string, Int8Array>();

/** Matriz dispersa de Achlioptas (+1 / -1 con probabilidad 1/6 cada uno, 0 con 2/3), memoizada por isolate. */
function matrizDe(p: Proyeccion): Int8Array {
  const memo = MATRICES.get(p.iproyeccion);
  if (memo) return memo;
  const azar = generador(p.semilla);
  const m = new Int8Array(p.dims * p.dimsorigen);
  for (let i = 0; i < m.length; i++) {
    const x = azar();
    m[i] = x < 1 / 6 ? 1 : x < 2 / 6 ? -1 : 0;
  }
  MATRICES.set(p.iproyeccion, m);
  return m;
}

/** Aplica la proyección guardada a un vector crudo: L2, reducción, L2 y decimales. Documentos y consultas pasan por aquí. */
export function proyectar(crudo: ArrayLike<number>, p: Proyeccion): number[] {
  const unit = normalizarL2(crudo);
  let salida = unit;
  if (p.metodo === "truncar") salida = normalizarL2(unit.slice(0, p.dims));
  if (p.metodo === "aleatoria") {
    const m = matrizDe(p);
    const r = new Array<number>(p.dims).fill(0);
    for (let i = 0; i < p.dims; i++) {
      const fila = i * p.dimsorigen;
      for (let j = 0; j < p.dimsorigen; j++) r[i]! += m[fila + j]! * unit[j]!;
    }
    salida = normalizarL2(r);
  }
  if (p.decimales === null) return salida;
  const escala = 10 ** p.decimales;
  return salida.map((x) => Math.round(x * escala) / escala);
}

/** Bytes por dimensión según los decimales: 1-2 → int8, 3-4 → int16, sin decimales → float32. */
export function bytesPorDimension(decimales: number | null): number {
  if (decimales === null) return 4;
  return decimales <= 2 ? 1 : 2;
}

/** Vector → texto compacto (bytes little-endian en base64url). */
export function codificar(v: number[], decimales: number | null): string {
  const ancho = bytesPorDimension(decimales);
  const bytes = new Uint8Array(v.length * ancho);
  const vista = new DataView(bytes.buffer);
  const escala = decimales === null ? 1 : 10 ** decimales;
  v.forEach((x, i) => {
    if (ancho === 4) vista.setFloat32(i * 4, x, true);
    else if (ancho === 2) vista.setInt16(i * 2, Math.round(x * escala), true);
    else vista.setInt8(i, Math.round(x * escala));
  });
  return b64urlEncode(bytes);
}

/** Texto compacto → vector; inverso exacto de `codificar` para vectores ya proyectados. */
export function decodificar(texto: string, decimales: number | null): number[] {
  const bytes = b64urlDecode(texto);
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ancho = bytesPorDimension(decimales);
  const escala = decimales === null ? 1 : 10 ** decimales;
  const out = new Array<number>(bytes.length / ancho);
  for (let i = 0; i < out.length; i++) {
    if (ancho === 4) out[i] = vista.getFloat32(i * 4, true);
    else if (ancho === 2) out[i] = vista.getInt16(i * 2, true) / escala;
    else out[i] = vista.getInt8(i) / escala;
  }
  return out;
}
