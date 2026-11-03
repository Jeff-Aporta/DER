/**
 * Tipos y Zod del plugin de gestión de archivos.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/archivos.md
 */
import { z } from "zod";
import type { BaseCtx } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { SelloAuditoria } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

/** Extensiones ejecutables que nunca se aceptan. */
export const EXTENSIONES_BLOQUEADAS = ["exe", "msi", "msp", "bat", "cmd", "com", "scr", "pif", "cpl", "vbs", "vbe", "js", "jse", "wsf", "wsh", "ps1", "psm1", "jar", "app", "dmg", "pkg", "deb", "rpm", "apk", "sh", "lnk", "reg", "hta", "dll", "sys", "gadget", "msc"] as const;
/** Mimes ejecutables que nunca se aceptan. */
export const MIMES_BLOQUEADOS = ["application/x-msdownload", "application/x-msdos-program", "application/x-ms-installer", "application/x-msi", "application/x-sh", "application/x-bat", "application/java-archive", "application/vnd.android.package-archive", "application/x-executable", "application/x-dosexec", "application/vnd.microsoft.portable-executable"] as const;

/** Configuración: secreto de las URLs firmadas, vida de la URL y tamaño máximo por archivo. */
export const ZArchivosConfig = z.strictObject({ secret: z.string().min(16), ttlSeg: z.number().int().positive().default(900), maxMb: z.number().positive().default(30) });
/** Configuración ya validada. */
export type ArchivosConfig = z.infer<typeof ZArchivosConfig>;
/** Query de `POST archivos/subir`: lo común; el resto de la query llega a la política del consumidor. */
export const ZSubirQuery = z.looseObject({ nombre: z.string().min(1).max(200).optional(), icarpeta: z.coerce.number().int().positive().optional(), origin: z.string().min(1).max(60).optional(), idorigin: z.string().min(1).max(120).optional(), ancho: z.coerce.number().int().positive().optional(), alto: z.coerce.number().int().positive().optional(), duracion: z.coerce.number().positive().optional() });
/** Query de subida ya validada. */
export type SubirQuery = z.infer<typeof ZSubirQuery>;
/** Cuerpo de `POST archivo/{id}/mover`. */
export const ZMoverInput = z.strictObject({ icarpeta: z.number().int().positive().nullable() });
/** Datos de `POST archivo/{id}/mover`. */
export type MoverInput = z.infer<typeof ZMoverInput>;

/** Fila de carpeta. */
export type Carpeta = SelloAuditoria & { icarpeta: number; ipadre: number | null; nombre: string; ruta: string };
/** Fila de archivo; `origin` + `idorigin` lo relacionan con una fila de cualquier otra tabla. */
export type Archivo = SelloAuditoria & { iarchivo: number; icarpeta: number | null; nombre: string; clave: string; mime: string; bytes: number; ancho: number | null; alto: number | null; duracion: number | null; origin: string | null; idorigin: string | null };
/** Archivo como lo ve un cliente: con su URL firmada. */
export type ArchivoPublico = { iarchivo: number; nombre: string; mime: string; bytes: number; ancho: number | null; alto: number | null; duracion: number | null; origin: string | null; idorigin: string | null; url: string; expira: string };
/** Contenido de una carpeta (raíz si `carpeta` es null), lista para pintar un explorador. */
export type ArbolArchivos = { carpeta: Carpeta | null; carpetas: Carpeta[]; archivos: ArchivoPublico[] };
/** Opciones de la subida desde el cliente; cualquier otra clave viaja en la query. */
export type SubirOpciones = { nombre?: string | undefined; icarpeta?: number | undefined; origin?: string | undefined; idorigin?: string | undefined; ancho?: number | undefined; alto?: number | undefined; duracion?: number | undefined } & Record<string, string | number | undefined>;
/** Objeto bajado del almacén. */
export type ObjetoAlmacen = { cuerpo: BodyInit | null; mime?: string | undefined; bytes?: number | undefined };
/** Contrato del almacén: lo implementa el consumidor con el servicio que use. */
export type AlmacenArchivos = { subir(clave: string, bytes: Uint8Array, meta: { mime: string; nombre: string }): Promise<void>; bajar(clave: string): Promise<ObjetoAlmacen | null>; borrar(clave: string): Promise<void> };
/** Lo que se guarda desde el servidor con la op `guardar`. */
export type DatosGuardar = { bytes: Uint8Array; nombre: string; mime: string; icarpeta?: number | null | undefined; origin?: string | null | undefined; idorigin?: string | null | undefined; ancho?: number | null | undefined; alto?: number | null | undefined; duracion?: number | null | undefined; prefijo?: string | undefined; extras?: Record<string, unknown> | undefined; apporigin?: string | null | undefined; pagina?: string | null | undefined; ip?: string | null | undefined; maxBytes?: number | undefined };
/** Política del consumidor: quién sube y ve qué, y columnas propias. Todo opcional: sin ella hace falta sesión y se ve lo propio o lo sin dueño. */
export type PoliticaArchivos = { limiteBytes?(ctx: BaseCtx): Promise<number> | number; alSubir?(q: SubirQuery, ctx: BaseCtx): Promise<{ prefijo?: string; extras?: Record<string, unknown> } | void> | { prefijo?: string; extras?: Record<string, unknown> } | void; puedeVer?(a: Archivo, ctx: BaseCtx): Promise<boolean> | boolean };
