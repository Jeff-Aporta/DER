/**
 * almacen.ts — los ficheros que se comparten entre bots: el almacen del servicio (el disco del VPS) en vez de R2.
 *
 * El plugin no sabe de donde sale el almacen: lo inyecta el servicio (`cfg.almacen`). Asi el transversal no depende
 * del sistema de ficheros y el servicio decide (en el VPS, una carpeta).
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/canal.md
 */
import { firmarHmac, verificarHmac } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { PREFIJO_ARCHIVOS } from "./protocolo.ts";

/** Los metadatos que viajan con el fichero. */
export type MetadatosFichero = {
  /** Quien lo subio. */
  propietario: string;
  /** En que canal se compartio. */
  canal: string;
  /** El nombre original del fichero. */
  nombre: string;
  /** Su tipo. */
  mime: string;
  /** Cuantos bytes tiene. */
  bytes: number;
  /** Cuando caduca (ISO). */
  caduca: string;
};

/** Lo que el servicio da al plugin para guardar los ficheros (el disco del VPS). */
export type AlmacenFicheros = {
  /** Sube un fichero (lo escribe con sus metadatos). */
  subir(clave: string, bytes: Uint8Array, meta: MetadatosFichero): Promise<void>;
  /** Lee un fichero (o `null` si no esta). */
  leer(clave: string): Promise<{ cuerpo: Uint8Array<ArrayBuffer>; mime: string | null } | null>;
  /** Borra un fichero (si existe). */
  borrar(clave: string): Promise<void>;
};

/** La clave del fichero: `canal/<canal>/<aaaa-mm>/<id>-<nombre>` (la misma que usaba R2). */
export function claveDe(canal: string, id: string, nombre: string): string {
  const mes = new Date().toISOString().slice(0, 7);
  const limpio = nombre.replace(/[^\w.\-]+/g, "_").slice(-80) || "fichero";
  return `${PREFIJO_ARCHIVOS}${canal}/${mes}/${id}-${limpio}`;
}

/** La firma de una URL de descarga (base64url): lo que permite bajar sin token. */
export async function firmarDescarga(secreto: string, id: string, exp: number): Promise<string> {
  return await firmarHmac(secreto, `${id}|${exp}`);
}

/** ¿La firma de la descarga es la de ese fichero y ese instante? */
export async function verificarDescarga(
  secreto: string,
  id: string,
  exp: number,
  firma: string,
): Promise<boolean> {
  return await verificarHmac(secreto, `${id}|${exp}`, firma);
}
