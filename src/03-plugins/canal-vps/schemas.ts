/**
 * Tipos y Zod del plugin del canal propio (el que vive en el VPS con su SQLite): los mismos campos que el Worker
 * `estudio-canal` usaba en D1, para que los bots no cambien ni una linea.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/canal.md
 */
import { z } from "zod";
import { TIPOS_MENSAJE } from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/protocolo.ts";

/** Un canal donde se habla los bots (se crea al vuelo). */
export type Canal = { canal: string; nombre: string; descripcion: string | null; ambito: string | null; activo: boolean; creado: Date | null; creadoPor: string | null; };

/** Un mensaje publicado en un canal. */
export type Mensaje = { idmensaje: string; canal: string; autor: string; tipo: string; texto: string | null; adjuntos: unknown; para: unknown; fhcre: Date | null; fhmod: Date | null; borrado: boolean; caduca: Date | null; jmeta: unknown; };

/** Una reaccion a un mensaje. */
export type Reaccion = { idreaccion: string; idmensaje: string; bot: string; emoji: string; fhcre: Date | null; };

/** La presencia de un bot en un canal (con su ultimo latido). */
export type Presencia = { bot: string; canal: string; estado: string; nodo: string | null; fhconexion: Date | null; fhultimo: Date | null; };

/** La ficha de un fichero efimero (los bytes estan en el almacen del servicio). */
export type Adjunto = { idadjunto: string; nombre: string; mime: string | null; bytes: number | null; clave: string | null; canal: string | null; propietario: string | null; fhcre: Date | null; caduca: Date | null; estado: string | null; };

/** El tunel por el que se entra al servicio (el hostname publico: lo escribe el conector del tunel). */
export type Tunel = { idtunel: string; hostname: string; actualizado: Date | null; };

/** Publicar un mensaje. */
export const ZPublicar = z.strictObject({
  canal: z.string().min(1).max(60),
  texto: z.string().max(100000).optional(),
  tipo: z.enum(TIPOS_MENSAJE).optional(),
  adjuntos: z.array(z.string().max(64)).max(20).optional(),
  para: z.array(z.string().min(1).max(120)).max(20).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** Editar un mensaje. */
export const ZEditar = z.strictObject({
  texto: z.string().max(100000).optional(),
  tipo: z.enum(TIPOS_MENSAJE).optional(),
});

/** Reaccionar a un mensaje. */
export const ZReaccionar = z.strictObject({
  idmensaje: z.string().min(1).max(40),
  emoji: z.string().min(1).max(24),
});

/** Crear un canal. */
export const ZCanal = z.strictObject({
  canal: z.string().min(1).max(60),
  nombre: z.string().min(1).max(120).optional(),
  descripcion: z.string().max(300).optional(),
  ambito: z.string().max(40).optional(),
});

/** El latido del bot. */
export const ZLatido = z.strictObject({
  canales: z.array(z.string().min(1).max(60)).max(20).optional(),
});

/** Publicar el hostname del tunel (lo hace el conector del tunel al arrancar). */
export const ZTunel = z.strictObject({
  idtunel: z.string().min(1).max(64).optional(),
  hostname: z.string().min(1).max(300),
});

/**
 * Los metadatos que viajan con el fichero.
 * - `propietario`: Quien lo subio.
 * - `canal`: En que canal se compartio.
 * - `nombre`: El nombre original del fichero.
 * - `mime`: Su tipo.
 * - `bytes`: Cuantos bytes tiene.
 * - `caduca`: Cuando caduca (ISO).
 */
export type MetadatosFichero = { propietario: string; canal: string; nombre: string; mime: string; bytes: number; caduca: string; };

/**
 * Lo que el servicio da al plugin para guardar los ficheros (el disco del VPS).
 * - `subir`: Sube un fichero (lo escribe con sus metadatos).
 * - `leer`: Lee un fichero (o `null` si no esta).
 * - `borrar`: Borra un fichero (si existe).
 */
export type AlmacenFicheros = { subir(clave: string, bytes: Uint8Array, meta: MetadatosFichero): Promise<void>; leer(clave: string): Promise<{ cuerpo: Uint8Array<ArrayBuffer>; mime: string | null } | null>; borrar(clave: string): Promise<void>; };

/**
 * Un socket de la sala (lo que el servicio entrega: su WebSocket).
 * - `enviar`: Envia un texto al bot.
 * - `cerrar`: Cierra el socket.
 */
export type SocketSala = { enviar(texto: string): void; cerrar(codigo?: number, motivo?: string): void; };

/**
 * Lo que la sala guarda de cada socket.
 * - `bot`: Quien es el bot.
 * - `canales`: A que canales esta suscrito.
 * - `filtro`: Que filtro quiere: `todos`, `para` o `mencion`.
 * - `nodo`: La maquina donde vive.
 * - `desde`: Cuando entro.
 */
export type AdjuntoSocket = { bot: string; canales: string[]; filtro: string; nodo: string; desde: string; };

/**
 * Avisos de la sala: el servicio los usa para marcar la presencia en la base.
 * - `alEntrar`: Un bot entra (o cambia de canales): se marca su presencia.
 * - `alSalir`: Un bot se va (no le queda ningun socket): su presencia pasa a desconectado.
 */
export type SalaAvisos = { alEntrar?(bot: string, canales: string[], nodo: string): void | Promise<void>; alSalir?(bot: string, canales: string[], nodo: string): void | Promise<void>; };

/** Un bot conectado (para la presencia). */
export type PresenciaSala = { bot: string; canal: string; nodo: string; desde: string };

/**
 * La configuracion del plugin (la resuelve `createServer`: el secreto llega por `"env:CANAL_JWT"`).
 * - `secreto`: El secreto HS256 con el que se firman y verifican los tokens (`CANAL_JWT`): nunca se imprime.
 * - `almacen`: El almacen de ficheros (el disco del VPS).
 * - `urlBase`: La URL publica del servicio (para firmar las descargas). Si no, se usa la del request.
 * - `difundir`: Difunde un evento en la sala (lo pone el servicio: el realtime).
 */
export type CanalVpsConfig = { secreto: string; almacen?: AlmacenFicheros | undefined; urlBase?: string | undefined; difundir?: ((evento: Record<string, unknown>, canal: string) => void) | undefined; };
