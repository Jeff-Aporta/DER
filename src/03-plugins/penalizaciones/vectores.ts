/**
 * Cálculo puro de las penalizaciones: qué vector decide y cuántos minutos tocan. Sin base de datos, para probarlo solo.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/penalizaciones.md
 */
import type { PenalizacionesConfig, VectorActivo, Veredicto } from "@Jeff-Aporta/DER/src/03-plugins/penalizaciones/schemas.ts";

const MINUTO = 60_000;

/** Minutos de penalización tras el intento fallido número `n` (1 = el primero); desde el último de la escala, se repite. */
export function minutosDe(n: number, escala: number[]): number {
  if (n <= 0) return 0;
  return escala[Math.min(n, escala.length) - 1] ?? 0;
}

/** Intentos dentro de una ventana. */
export function enVentana(intentos: number[], ventanaMin: number, ahora: number): number[] {
  return intentos.filter((t) => ahora - t < ventanaMin * MINUTO);
}

/** Vector que decide: el global si no hay IP o si en la ventana global se llegó al umbral (señal de fuerza bruta); si no, el de la IP. */
export function vectorActivo(ip: string | null | undefined, global: number[], cfg: PenalizacionesConfig, ahora: number): VectorActivo {
  if (!ip) return "global";
  return enVentana(global, cfg.ventanaGlobalMin, ahora).length >= cfg.umbralGlobal ? "global" : "ip";
}

/** Veredicto de un vector: penalizado mientras no pasen los minutos que tocan desde su último fallo. */
export function veredicto(vector: VectorActivo, intentos: number[], cfg: PenalizacionesConfig, ahora: number): Veredicto {
  const vivos = enVentana(intentos, cfg.ventanaMin, ahora);
  const ultimo = vivos.at(-1) ?? 0;
  const restanteMs = Math.max(0, ultimo + minutosDe(vivos.length, cfg.escalaMin) * MINUTO - ahora);
  return { penalizado: restanteMs > 0, restanteMs, vector, fallidos: vivos.length };
}
