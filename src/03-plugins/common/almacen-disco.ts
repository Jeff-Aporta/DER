/**
 * Helper de almacenamiento en disco para DER: implementa el contrato `AlmacenArchivos` del plugin de archivos
 * (igual que `r2.ts` lo hace con R2), pero en una carpeta del disco.
 *
 * Sirve para el consumidor que corre en un servidor propio y no en un Worker de Cloudflare: el API guarda los
 * ficheros en una carpeta y los sirve con las URLs firmadas que ya da el plugin de archivos.
 *
 * ```ts
 * const archivos = createServer(archivosServer, { db, cfg: { secret: "env:JWT_SECRET" }, services: { almacen: discoAlmacen("datos/archivos", { ttlSeg: 30 * 86400 }) } });
 * export const purgar = () => purgarDisco("datos/archivos", { ttlSeg: 30 * 86400 });
 * ```
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/archivos.md
 */
import type { AlmacenArchivos, MetaDisco, ObjetoAlmacen, OpcionesDisco } from "@Jeff-Aporta/DER/src/03-plugins/archivos/schemas.ts";

/** Vida por defecto de un fichero en disco: 30 dias. */
export const TTL_DISCO_30D = 30 * 24 * 60 * 60;

/** Extension del fichero de metadatos que va al lado del objeto (caducidad, mime, nombre). */
export const META_DISCO = ".meta.json";

/** La clave del objeto es una ruta relativa dentro de la carpeta: se limpian los `..` y las barras. */
export function claveSegura(clave: string): string {
  return clave
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .map((p) => p.replace(/[^A-Za-z0-9._-]+/g, "_"))
    .join("/");
}

/** La carpeta de un fichero (sin node:path, para que tambien funcione en Workers). */
export function dirnameDe(ruta: string): string {
  const i = ruta.lastIndexOf("/");
  return i <= 0 ? "/" : ruta.slice(0, i);
}

/** La ruta absoluta del objeto dentro de la carpeta. */
export function rutaDe(base: string, clave: string): string {
  const limpio = claveSegura(clave);
  const raiz = base.replace(/[/\\]+$/, "");
  return limpio ? raiz + "/" + limpio : raiz;
}

/** El fichero de metadatos de un objeto. */
export function metaDe(base: string, clave: string): string {
  return rutaDe(base, clave) + META_DISCO;
}

/** Escribe los metadatos al lado del objeto. */
async function escribirMeta(base: string, clave: string, meta: MetaDisco): Promise<void> {
  const ruta = metaDe(base, clave);
  await Deno.mkdir(dirnameDe(ruta), { recursive: true });
  await Deno.writeTextFile(ruta, JSON.stringify(meta));
}

/** Lee los metadatos de un objeto (o null si no estan). */
async function leerMeta(base: string, clave: string): Promise<MetaDisco | null> {
  try {
    const texto = await Deno.readTextFile(metaDe(base, clave));
    const v = JSON.parse(texto) as MetaDisco;
    return typeof v?.expira === "number" ? v : null;
  } catch {
    return null;
  }
}

/**
 * El almacen en disco: cumple el contrato `AlmacenArchivos` y ademas deja el fichero con su caducidad.
 * Con `ttlSeg` de 30 dias, el objeto se purga a los 30 dias con `purgarDisco`.
 */
export function discoAlmacen(base: string, options: OpcionesDisco = {}): AlmacenArchivos & {
  /** Sube el objeto y devuelve su caducidad (epoch en segundos). */
  subirConCaducidad(clave: string, bytes: Uint8Array, meta: { mime: string; nombre: string; ttlSeg?: number | undefined }): Promise<{ clave: string; expira: number }>;
  /** La caducidad que tendria un objeto (la guardada o la de ahora + TTL). */
  expiracion(clave: string): Promise<number>;
} {
  const ttlSeg = options.ttlSeg ?? TTL_DISCO_30D;
  const ahora = options.ahora ?? Date.now;

  return {
    async subir(clave: string, bytes: Uint8Array, meta: { mime: string; nombre: string }): Promise<void> {
      await this.subirConCaducidad(clave, bytes, meta);
    },

    async subirConCaducidad(
      clave: string,
      bytes: Uint8Array,
      meta: { mime: string; nombre: string; ttlSeg?: number | undefined },
    ): Promise<{ clave: string; expira: number }> {
      const vida = meta.ttlSeg ?? ttlSeg;
      const expira = Math.floor((ahora() + vida * 1000) / 1000);
      const ruta = rutaDe(base, clave);
      await Deno.mkdir(dirnameDe(ruta), { recursive: true });
      await Deno.writeFile(ruta, bytes);
      await escribirMeta(base, clave, { expira, mime: meta.mime || "application/octet-stream", nombre: meta.nombre, bytes: bytes.length });
      return { clave, expira };
    },

    async expiracion(clave: string): Promise<number> {
      const meta = await leerMeta(base, clave);
      if (meta) return meta.expira;
      return Math.floor((ahora() + ttlSeg * 1000) / 1000);
    },

    async bajar(clave: string): Promise<ObjetoAlmacen | null> {
      const ruta = rutaDe(base, clave);
      try {
        const bytes = await Deno.readFile(ruta);
        const meta = await leerMeta(base, clave);
        return { cuerpo: bytes as unknown as BodyInit, mime: meta?.mime, bytes: bytes.length };
      } catch {
        return null;
      }
    },

    async borrar(clave: string): Promise<void> {
      for (const ruta of [rutaDe(base, clave), metaDe(base, clave)]) {
        try {
          await Deno.remove(ruta);
        } catch {
          // si no esta, no hay nada que borrar
        }
      }
    },
  };
}

/**
 * Purga los objetos vencidos de la carpeta (los que pasaron su caducidad). Borra tambien su fichero de
 * metadatos y las carpetas que quedan vacias.
 */
export async function purgarDisco(
  base: string,
  options: OpcionesDisco & { prefijo?: string | undefined } = {},
): Promise<{ borrados: number; escaneados: number }> {
  const ttlSeg = options.ttlSeg ?? TTL_DISCO_30D;
  const ahora = (options.ahora ?? Date.now)();
  let escaneados = 0;
  let borrados = 0;

  const visitar = async (dir: string): Promise<void> => {
    let entradas: Deno.DirEntry[];
    try {
      entradas = await Array.fromAsync(Deno.readDir(dir));
    } catch {
      return;
    }
    for (const e of entradas) {
      const ruta = dir + "/" + e.name;
      if (e.isDirectory) {
        await visitar(ruta);
        continue;
      }
      if (e.name.endsWith(META_DISCO)) continue;
      escaneados++;
      const clave = ruta.slice(base.length + 1);
      if (options.prefijo && !clave.startsWith(options.prefijo)) continue;
      const meta = await leerMeta(base, clave);
      const expira = meta?.expira ?? Math.floor((ahora + ttlSeg * 1000) / 1000);
      if (expira * 1000 <= ahora) {
        try {
          await Deno.remove(ruta);
        } catch {
          // ya no estaba
        }
        try {
          await Deno.remove(metaDe(base, clave));
        } catch {
          // ya no estaba
        }
        borrados++;
      }
    }
  };

  await visitar(base.replace(/[/\\]+$/, ""));
  return { borrados, escaneados };
}
