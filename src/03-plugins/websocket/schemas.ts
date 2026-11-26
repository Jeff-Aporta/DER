/**
 * schemas.ts — los tipos y el Zod del WebSocket de DER: el contrato que comparten el servidor y el cliente.
 *
 * El servidor valida lo que llega con estos esquemas y el cliente valida lo que recibe: si alguien cambia el
 * contrato en un lado, el otro lo rechaza en vez de romperse en silencio.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 */
import { z } from "zod";
import { FILTROS, TIPOS_AVISO, TIPOS_PETICION } from "@Jeff-Aporta/DER/src/03-plugins/websocket/protocolo.ts";

/** Quien es el socket (lo que el servidor deduce del token, nunca lo que dice el cliente). */
export type Identidad = { sub: string; rol: string; ref: string | null };

/** Un aviso del servidor al cliente. `para` = a quien va; vacio = a todos los que pueden verlo. */
export type Aviso = {
  tipo: (typeof TIPOS_AVISO)[number];
  ts: string;
  version: string;
  para: string[];
  datos: Record<string, unknown>;
};

/** Una peticion del cliente al servidor. `suscribir` cambia el filtro; `consultar` es de solo lectura. */
export type Peticion = {
  tipo: (typeof TIPOS_PETICION)[number];
  id: string;
  ts: string;
  filtro?: (typeof FILTROS)[number] | undefined;
  ref?: string | undefined;
};

/** Lo que el socket puede hacer (lo que el servidor le entrega). Transport-agnostico: sirve para Deno y para Workers. */
export type Socket = {
  enviar(texto: string): void;
  cerrar(codigo?: number, motivo?: string): void;
};

/** Lo que el servidor guarda de cada socket conectado. */
export type AdjuntoSocket = {
  id: string;
  identidad: Identidad;
  filtro: (typeof FILTROS)[number];
  desde: string;
  ultimoLatido: number;
  /** Ventana del limite anti-abuso (cuando empieza a contar). */
  ventana: number;
  /** Mensajes enviados en la ventana actual. */
  cuenta: number;
  socket: Socket;
};

/** Avisos que el servidor difunde (lo pone el consumidor: `publicar`). */
export type Difusion = { tipo: string; para?: string[] | "todos"; datos: Record<string, unknown> };

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
