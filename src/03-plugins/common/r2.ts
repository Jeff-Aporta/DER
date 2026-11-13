/**
 * Helper de Cloudflare R2 para DER: subida, bajada, caducidad por objeto y purga automática.
 * Implementa el contrato `AlmacenArchivos` del plugin de archivos, por lo que ambos se pueden enlazar sin adaptadores.
 *
 * ```ts
 * const archivos = createServer(archivosServer, { db, cfg: { secret: env.SIGN_SECRET }, services: { almacen: r2Almacen(env.FILES) } });
 * export const scheduled = r2CronHandler(env.FILES);
 * ```
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
import type { R2Almacen, R2BucketLike, R2Descriptor, R2ObjectLike, R2Opciones, R2PurgeResult } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

/** Vida predeterminada de un objeto del canal: 72 horas. */
export const TTL_R2_72H = 72 * 60 * 60;
/** Metadato R2 donde se guarda la caducidad del objeto (epoch en segundos). */
export const META_EXPIRA_R2 = "der-expira";
/** Metadato R2 con el tamaño del objeto al subirlo. */
export const META_BYTES_R2 = "der-bytes";

/** Instante de caducidad de un objeto: el metadato explícito o, si falta, su subida más la vida predeterminada. */
export function r2Expiration(object: R2ObjectLike, ttlSeg = TTL_R2_72H): number {
  const guardada = Number(object.customMetadata?.[META_EXPIRA_R2]);
  if (Number.isFinite(guardada) && guardada > 0) return guardada * 1000;
  return object.uploaded.getTime() + ttlSeg * 1000;
}

/** Purga los objetos vencidos recorriendo todas las páginas del prefijo. */
export async function r2PurgeExpired(bucket: R2BucketLike, options: R2Opciones = {}): Promise<R2PurgeResult> {
  const ttlSeg = options.ttlSeg ?? TTL_R2_72H;
  const ahora = (options.now ?? Date.now)();
  let cursor: string | undefined;
  let escaneados = 0;
  let borrados = 0;
  do {
    const pagina = await bucket.list({
      limit: 1000,
      include: ["customMetadata"],
      ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    for (const objeto of pagina.objects) {
      escaneados++;
      if (r2Expiration(objeto, ttlSeg) <= ahora) {
        await bucket.delete(objeto.key);
        borrados++;
      }
    }
    cursor = pagina.truncated ? pagina.cursor : undefined;
  } while (cursor !== undefined);
  return { escaneados, borrados };
}

/** Fábrica del almacén DER sobre un binding R2: TTL de 72 horas por defecto. */
export function r2Almacen(bucket: R2BucketLike, options: R2Opciones = {}): R2Almacen {
  const ttlSeg = options.ttlSeg ?? TTL_R2_72H;
  const ahora = options.now ?? Date.now;
  return {
    /** Sube un objeto con la vida predeterminada (cumple el contrato `AlmacenArchivos`). */
    async subir(clave: string, bytes: Uint8Array, meta: { mime: string; nombre: string }): Promise<void> {
      await this.subirConCaducidad(clave, bytes, meta);
    },
    /** Sube un objeto y devuelve su ficha con la caducidad calculada. */
    async subirConCaducidad(clave: string, bytes: Uint8Array, meta: { mime: string; nombre: string; ttlSeg?: number }): Promise<R2Descriptor> {
      const vida = meta.ttlSeg ?? ttlSeg;
      if (!Number.isFinite(vida) || vida <= 0) throw new Error("La caducidad R2 debe ser positiva");
      const expiraMs = ahora() + vida * 1000;
      await bucket.put(clave, bytes, {
        httpMetadata: { contentType: meta.mime || "application/octet-stream" },
        customMetadata: {
          [META_EXPIRA_R2]: String(Math.floor(expiraMs / 1000)),
          [META_BYTES_R2]: String(bytes.length),
        },
      });
      return { clave, bytes: bytes.length, mime: meta.mime || "application/octet-stream", expira: new Date(expiraMs).toISOString() };
    },
    /** Baja un objeto; si venció, lo borra y devuelve `null`. */
    async bajar(clave: string): Promise<{ cuerpo: BodyInit | null; mime?: string; bytes?: number } | null> {
      const objeto = await bucket.get(clave);
      if (!objeto) return null;
      if (r2Expiration(objeto, ttlSeg) <= ahora()) {
        await bucket.delete(clave);
        return null;
      }
      return {
        cuerpo: objeto.body ?? null,
        ...(objeto.httpMetadata?.contentType !== undefined ? { mime: objeto.httpMetadata.contentType } : {}),
        bytes: objeto.size,
      };
    },
    /** Borra un objeto (si no existe, no falla). */
    async borrar(clave: string): Promise<void> {
      await bucket.delete(clave);
    },
    /** Purga los vencidos de este almacén. */
    async purgarVencidos(): Promise<R2PurgeResult> {
      return await r2PurgeExpired(bucket, { ...options, ttlSeg });
    },
  };
}

/** Handler de Cron de Cloudflare: purga los objetos vencidos de R2. */
export function r2CronHandler(bucket: R2BucketLike, options: R2Opciones = {}): () => Promise<R2PurgeResult> {
  return async (): Promise<R2PurgeResult> => await r2PurgeExpired(bucket, options);
}
