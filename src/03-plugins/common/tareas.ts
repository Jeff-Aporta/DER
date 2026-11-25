/**
 * Tareas programadas declaradas UNA vez y servidas por el host que toque: `Deno.cron` en el VPS (Deno), cron triggers en
 * Cloudflare Workers (`scheduled`) y temporizadores en Azure (un reloj por minuto). El plugin solo declara
 * `{ nombre, cron, handler }`; el host decide cómo dispararlo. Cron de 5 campos en UTC (`*`, número, lista `a,b`, rango
 * `a-b`, paso `*​/n` o `a-b/n`; día de la semana 0–6, domingo = 0).
 *
 * ```ts
 * const tareas = declararTareas("cloudflare", errores.tareas());          // o "deno" | "azure"
 * export default { fetch: router.fetch, scheduled: tareas.scheduled };    // Cloudflare
 * // wrangler.toml → [triggers] crons = tareas.crons
 * ```
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
import type { HostTareas, TareaProgramada, TareasDeclaradas } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

/** Conjunto de valores de un campo del cron dentro de `[min, max]`; lanza si el campo no es válido. */
function campo(texto: string, min: number, max: number): Set<number> {
  const valores = new Set<number>();
  for (const parte of texto.split(",")) {
    const [rango, pasoTxt] = parte.split("/");
    const paso = pasoTxt === undefined ? 1 : Number(pasoTxt);
    if (!Number.isInteger(paso) || paso < 1) throw new Error(`Cron inválido: paso «${parte}»`);
    let desde = min;
    let hasta = max;
    if (rango !== "*") {
      const [a, b] = rango!.split("-");
      desde = Number(a);
      hasta = b === undefined ? (pasoTxt === undefined ? desde : max) : Number(b);
    }
    if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < min || hasta > max || desde > hasta) throw new Error(`Cron inválido: «${parte}» fuera de ${min}-${max}`);
    for (let v = desde; v <= hasta; v += paso) valores.add(v);
  }
  return valores;
}

/** Valida un cron de 5 campos (lanza si no lo es). */
export function validarCron(cron: string): void {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) throw new Error(`Cron inválido «${cron}»: se esperan 5 campos`);
  [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]].forEach(([min, max], i) => campo(p[i]!, min!, max!));
}

/** ¿El cron (UTC) dispara en el minuto de `fecha`? */
export function cronCoincide(cron: string, fecha: Date): boolean {
  validarCron(cron);
  const [mi, h, d, mes, dow] = cron.trim().split(/\s+/);
  return campo(mi!, 0, 59).has(fecha.getUTCMinutes()) && campo(h!, 0, 23).has(fecha.getUTCHours()) && campo(d!, 1, 31).has(fecha.getUTCDate()) && campo(mes!, 1, 12).has(fecha.getUTCMonth() + 1) && campo(dow!, 0, 6).has(fecha.getUTCDay());
}

/**
 * Declara las tareas para un host: `deno` (`Deno.cron`), `cloudflare` (usa `crons` en el trigger y `scheduled` como handler),
 * `azure` (un reloj por minuto; `detener()` lo apaga) o `manual` (pruebas: solo `ejecutar`). Siempre devuelve `ejecutar(nombre)`.
 */
export function declararTareas(host: HostTareas, tareas: TareaProgramada[]): TareasDeclaradas {
  for (const t of tareas) validarCron(t.cron);
  const porNombre = new Map(tareas.map((t) => [t.nombre, t]));
  const ejecutar = async (nombre: string): Promise<unknown> => {
    const t = porNombre.get(nombre);
    if (!t) throw new Error(`No hay tarea «${nombre}»`);
    return await t.handler();
  };
  const crons = [...new Set(tareas.map((t) => t.cron))];
  const base: TareasDeclaradas = { host, crons, ejecutar, detener: () => {}, scheduled: async () => {} };
  if (host === "deno") {
    const cron = (globalThis as unknown as { Deno?: { cron?: (nombre: string, cron: string, h: () => unknown) => void } }).Deno?.cron;
    if (!cron) throw new Error("Este runtime no tiene Deno.cron");
    for (const t of tareas) cron(nombreCron(t.nombre), t.cron, () => t.handler());
    return base;
  }
  if (host === "cloudflare") {
    return { ...base, scheduled: async (evento: { cron?: string; scheduledTime?: number }) => {
      for (const t of tareas) if (t.cron === evento.cron) await t.handler();
    } };
  }
  if (host === "azure") {
    const reloj = setInterval(() => {
      const ahora = new Date();
      for (const t of tareas) if (cronCoincide(t.cron, ahora)) void Promise.resolve(t.handler()).catch((e) => console.error("[tareas]", t.nombre, e));
    }, 60_000);
    (reloj as unknown as { unref?: () => void }).unref?.();
    return { ...base, detener: () => clearInterval(reloj) };
  }
  return base;
}

/** Nombre apto para `Deno.cron` (solo letras, números, espacios, guiones y guiones bajos): «errores:purgar-atendidos» → «errores-purgar-atendidos». */
export function nombreCron(nombre: string): string {
  return nombre.replace(/[^A-Za-z0-9 _-]+/g, "-");
}
