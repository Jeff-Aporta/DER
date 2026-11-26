/**
 * schemas.ts — los tipos y el Zod del WebSocket de DER: el contrato que comparten el servidor y el cliente.
 *
 * El servidor valida lo que llega con estos esquemas y el cliente valida lo que recibe: si alguien cambia el
 * contrato en un lado, el otro lo rechaza en vez de romperse en silencio.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
import { z } from "zod";
import { FILTROS, TIPOS_AVISO, TIPOS_PETICION } from "@Jeff-Aporta/DER/src/03-plugins/websocket/protocolo.ts";

/** Quien es el socket (lo que el servidor deduce del token, nunca lo que dice el cliente). */
export type Identidad = { sub: string; rol: string; ref: string | null };

/** Como se filtra lo que le llega a cada socket (LISTA CERRADA, la de `FILTROS`). */
export type Filtro = (typeof FILTROS)[number];

/** Los tipos de aviso del servidor (LISTA CERRADA, la de `TIPOS_AVISO`). */
export type TipoAviso = (typeof TIPOS_AVISO)[number];

/** Los tipos de peticion del cliente (LISTA CERRADA, la de `TIPOS_PETICION`). */
export type TipoPeticion = (typeof TIPOS_PETICION)[number];

/** Un aviso del servidor al cliente. `para` = a quien va; vacio = a todos los que pueden verlo. */
export type Aviso = { tipo: TipoAviso; ts: string; version: string; para: string[]; datos: Record<string, unknown> };

/** Una peticion del cliente al servidor. `suscribir` cambia el filtro; `consultar` es de solo lectura. */
export type Peticion = { tipo: TipoPeticion; id: string; ts: string; filtro?: Filtro | undefined; ref?: string | undefined };

/** Lo que el socket puede hacer (lo que el servidor le entrega). Transport-agnostico: sirve para Deno y para Workers. */
export type Socket = { enviar(texto: string): void; cerrar(codigo?: number, motivo?: string): void };

/** Lo que el servidor guarda de cada socket conectado. */
export type AdjuntoSocket = { id: string; identidad: Identidad; filtro: Filtro; desde: string; ultimoLatido: number; ventana: number; cuenta: number; socket: Socket };

/** Avisos que el servidor difunde (lo pone el consumidor: `publicar`). */
export type Difusion = { tipo: string; para?: string[] | "todos"; datos: Record<string, unknown> };

/** Lo que el cliente necesita para conectar. */
export type OpcionesCliente = { url: string; token: string; alAbrir?: (() => void) | undefined; alCerrar?: (() => void) | undefined };

/** El cliente: los sockets que oyen un tipo de aviso. */
export type ClienteWebSocket = { alRecibir(tipo: string, fn: (datos: Record<string, unknown>) => void): () => void; pedir(datos: Record<string, unknown>): void; cerrar(): void; readonly conectado: boolean };

/** Lo que el consumidor le da al servidor. */
export type ConfigServidor = { secreto: string; emisor?: string | undefined; sesionValida?: ((claims: Record<string, unknown>) => boolean | Promise<boolean>) | undefined; identidad?: ((claims: Record<string, unknown>) => Identidad) | undefined; consultar?: ((p: Peticion, identidad: Identidad) => Promise<Record<string, unknown>>) | undefined };

/**
 * La peticion del cliente. Estricta (`strictObject`): un campo de mas se rechaza, no se ignora en silencio.
 * El `ref` es una referencia publica (la que la app ya usa para pedir las personas), nunca la cedula.
 */
export const ZPeticion = z.strictObject({
  tipo: z.enum(TIPOS_PETICION),
  id: z.string().min(1).max(64),
  ts: z.string().max(40),
  filtro: z.enum(FILTROS).optional(),
  ref: z.string().min(1).max(64).optional(),
});

/** El aviso que el servidor manda. Estricto tambien. */
export const ZAviso = z.strictObject({
  tipo: z.enum(TIPOS_AVISO),
  ts: z.string().max(40),
  version: z.string().max(20),
  para: z.array(z.string().min(1).max(64)).max(200),
  datos: z.record(z.string(), z.unknown()),
});
