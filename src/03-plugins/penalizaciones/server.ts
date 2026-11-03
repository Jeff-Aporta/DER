/**
 * Plugin de penalizaciones (server): dos vectores por ámbito, el de la IP y el GLOBAL. Decide el de la IP; sin IP, o si en una hora
 * llegan 10 fallos entre todos (señal de fuerza bruta), decide el global. Un intento rechazado por estar penalizado no cuenta.
 *
 * ```ts
 * const multas = createServer(penalizacionesServer, { db, cfg: {} });
 * const v = await multas.verificar({ ambito: "errores", ip });
 * if (v.penalizado) throw new HttpError(429, "Espera");
 * if (malo) await multas.fallo({ ambito: "errores", ip }); else await multas.acierto({ ambito: "errores", ip });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/penalizaciones.md
 */
import { Obj } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { penalizaciones } from "@Jeff-Aporta/DER/src/03-plugins/penalizaciones/index.ts";
import { type Intento, type PenalizacionesConfig, type Veredicto, ZPenalizacionesConfig } from "@Jeff-Aporta/DER/src/03-plugins/penalizaciones/schemas.ts";
import { vectorActivo, veredicto } from "@Jeff-Aporta/DER/src/03-plugins/penalizaciones/vectores.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/penalizaciones/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/penalizaciones/vectores.ts";

const idIp = (i: Intento): string => `${i.ambito}:ip:${i.ip}`;
const idGlobal = (i: Intento): string => `${i.ambito}:global`;

/** Intentos guardados de un vector (la columna json puede llegar como texto). */
async function leer(p: ServerPlugin, id: string): Promise<number[]> {
  const fila = await p.controllers["penalizaciones"]!.get({ id });
  const v = typeof fila?.intentos === "string" ? JSON.parse(fila.intentos) : fila?.intentos;
  return Array.isArray(v) ? v.map(Number) : [];
}

/** Agrega un fallo a un vector y recorta a los últimos `maxIntentos`. */
async function anotar(p: ServerPlugin, id: string, ahora: number): Promise<void> {
  const ctrl = p.controllers["penalizaciones"]!;
  const cfg = p.cfg as PenalizacionesConfig;
  const previos = await leer(p, id);
  const pojo = ctrl.pojo({ id, intentos: [...previos, ahora].slice(-cfg.maxIntentos), fhmod: new Date(ahora) });
  if (previos.length) await ctrl.put(pojo);
  else await ctrl.post(pojo);
}

/** JSON del server de penalizaciones: `penalizaciones` + las `ops`. */
export const penalizacionesServer: ServerPluginDef = Obj.insert(penalizaciones, {
  cfg: ZPenalizacionesConfig,
  setup(this: ServerPlugin) {
    /** ¿Este intento está penalizado ahora? */
    this["verificar"] = async (i: Intento): Promise<Veredicto> => {
      const ahora = Date.now();
      const cfg = this.cfg as PenalizacionesConfig;
      const global = await leer(this, idGlobal(i));
      const vector = vectorActivo(i.ip, global, cfg, ahora);
      return veredicto(vector, vector === "global" ? global : await leer(this, idIp(i)), cfg, ahora);
    };
    /** Registra un intento fallido en el vector de la IP (si la hay) y en el global. */
    this["fallo"] = async (i: Intento): Promise<void> => {
      const ahora = Date.now();
      await anotar(this, idGlobal(i), ahora);
      if (i.ip) await anotar(this, idIp(i), ahora);
    };
    /** Un acierto limpia el vector de esa IP; el global se vacía solo con su ventana. */
    this["acierto"] = async (i: Intento): Promise<void> => {
      if (i.ip) await this.controllers["penalizaciones"]!.delete({ id: idIp(i) }).catch(() => null);
    };
  },
}) as ServerPluginDef;
