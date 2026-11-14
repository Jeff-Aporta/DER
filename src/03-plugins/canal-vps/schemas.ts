/**
 * Tipos y Zod del plugin del canal propio (el que vive en el VPS con su SQLite): los mismos campos que el Worker
 * `estudio-canal` usaba en D1, para que los bots no cambien ni una linea.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/canal.md
 */
import { z } from "zod";
import { TIPOS_MENSAJE } from "./protocolo.ts";

/** Un canal donde se habla los bots (se crea al vuelo). */
export type Canal = {
  canal: string;
  nombre: string;
  descripcion: string | null;
  ambito: string | null;
  activo: boolean;
  creado: Date | null;
  creadoPor: string | null;
};

/** Un mensaje publicado en un canal. */
export type Mensaje = {
  idmensaje: string;
  canal: string;
  autor: string;
  tipo: string;
  texto: string | null;
  adjuntos: unknown;
  para: unknown;
  fhcre: Date | null;
  fhmod: Date | null;
  borrado: boolean;
  caduca: Date | null;
  jmeta: unknown;
};

/** Una reaccion a un mensaje. */
export type Reaccion = {
  idreaccion: string;
  idmensaje: string;
  bot: string;
  emoji: string;
  fhcre: Date | null;
};

/** La presencia de un bot en un canal (con su ultimo latido). */
export type Presencia = {
  bot: string;
  canal: string;
  estado: string;
  nodo: string | null;
  fhconexion: Date | null;
  fhultimo: Date | null;
};

/** La ficha de un fichero efimero (los bytes estan en el almacen del servicio). */
export type Adjunto = {
  idadjunto: string;
  nombre: string;
  mime: string | null;
  bytes: number | null;
  clave: string | null;
  canal: string | null;
  propietario: string | null;
  fhcre: Date | null;
  caduca: Date | null;
  estado: string | null;
};

/** El tunel por el que se entra al servicio (el hostname publico: lo escribe el conector del tunel). */
export type Tunel = {
  idtunel: string;
  hostname: string;
  actualizado: Date | null;
};

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
