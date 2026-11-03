/**
 * Singleton de servicios del consumidor. DER no ejecuta nada externo: aquí solo guarda las credenciales (con `"env:NOMBRE"`
 * resuelto) y las implementaciones que la API le vincula (almacenamiento, proveedor de LLM, agente…). Los plugins las piden por
 * nombre; el `services` propio de un plugin gana sobre el singleton.
 *
 * ```ts
 * servicios.configurar({ credenciales: { llm: { apiKey: "env:LLM_KEY" }, agente: { url: "env:AGENTE_URL", apiKey: "env:AGENTE_KEY" } } }, env);
 * servicios.vincular("almacen", miAlmacen);
 * servicios.credencial("llm")?.["apiKey"];
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
import { resolveEnv } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type { ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { clientIp } from "@Jeff-Aporta/DER/src/03-plugins/common/device.ts";
import type { ConfigServicios, Credencial } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

const credenciales = new Map<string, Credencial>();
const vinculados = new Map<string, unknown>();

/** El singleton: una sola configuración por proceso (o isolate). */
export const servicios = {
  /** Fija las credenciales (reemplaza las anteriores) y, si vienen, las implementaciones. Un `env:` sin definir deja el campo fuera: el servicio es opcional. */
  configurar(cfg: ConfigServicios, env?: Record<string, string | undefined>): void {
    credenciales.clear();
    for (const [nombre, datos] of Object.entries(cfg.credenciales ?? {})) credenciales.set(nombre, resolverCredencial(datos, env));
    for (const [nombre, impl] of Object.entries(cfg.vinculos ?? {})) vinculados.set(nombre, impl);
  },
  /** Datos de una credencial, o `null` si no está configurada. */
  credencial(nombre: string): Credencial | null {
    return credenciales.get(nombre) ?? null;
  },
  /** Vincula la implementación de un servicio (la escribe el consumidor). */
  vincular(nombre: string, impl: unknown): void {
    vinculados.set(nombre, impl);
  },
  /** Implementación vinculada, o `null`. */
  servicio<T>(nombre: string): T | null {
    return (vinculados.get(nombre) as T | undefined) ?? null;
  },
  /** Vacía el singleton (tests). */
  limpiar(): void {
    credenciales.clear();
    vinculados.clear();
  },
};

/** Resuelve cada `env:`; el que no existe queda fuera en vez de tumbar el arranque. */
function resolverCredencial(datos: Credencial, env?: Record<string, string | undefined>): Credencial {
  const out: Credencial = {};
  for (const [k, v] of Object.entries(datos)) {
    try {
      out[k] = resolveEnv(v, env);
    } catch {
      continue;
    }
  }
  return out;
}

/** Servicio de un plugin: su `services` propio y, si no, el del singleton. */
export function servicioDe<T>(plugin: ServerPlugin, nombre: string): T | null {
  return (plugin.services?.[nombre] as T | undefined) ?? servicios.servicio<T>(nombre);
}

/** IP real del request: la que diga el servicio `ipDe` del consumidor (cada host sabe qué cabecera es confiable); si no, `clientIp`. `null` si no se conoce. */
export function ipReal(plugin: ServerPlugin, req: Request | undefined): string | null {
  if (!req) return null;
  const ipDe = servicioDe<(r: Request) => string | null>(plugin, "ipDe");
  if (ipDe) return ipDe(req);
  const ip = clientIp(req);
  return ip === "desconocido" ? null : ip;
}
