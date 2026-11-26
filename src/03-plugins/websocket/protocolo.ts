/**
 * protocolo.ts — el CONTRATO del WebSocket de DER: los tipos de mensaje, sus limites y las reglas de seguridad.
 *
 * Este archivo es la fuente unica de verdad: el servidor (el que publica) y el cliente (el que recibe) leen las
 * MISMAS definiciones, asi que nunca puede haber una violacion del contrato entre los dos lados.
 *
 * - El socket solo transporta **avisos** (el servidor -> cliente): el estado de un puesto, una notificacion, un
 *   cambio en la escuadra. Nada de esto muta datos.
 * - El cliente puede pedir una consulta **de solo lectura** («consulta»), que el servidor responde por el mismo
 *   socket. Lo que muta datos SIEMPRE va por HTTP (POST con token y CSRF), nunca por el socket.
 * - Todo mensaje pasa por Zod en los dos lados: lo que no encaja en el contrato se rechaza.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 */

/** Version del contrato (cambia cuando cambia la forma de los mensajes). */
export const VERSION_PROTOCOLO = "1.0.0";

/** Tamano maximo de un mensaje (bytes). Por encima, el servidor cierra el socket. */
export const MAX_BYTES = 64 * 1024;

/** Mensajes por minuto que acepta un socket (anti-abuso). */
export const MAX_POR_MINUTO = 120;

/** Segundos que puede estar callado un socket antes de que el servidor lo cierre. */
export const TIMEOUT_SILENCIO_MS = 60_000;

/** Cada cuanto el servidor manda el latido (para que los proxies no cierren la conexion). */
export const INTERVALO_LATIDO_MS = 25_000;

/** Como se filtra lo que le llega a cada socket (LISTA CERRADA). */
export const FILTROS = ["todos", "para", "mencion"] as const;
export type Filtro = (typeof FILTROS)[number];

/** Los tipos de aviso que el servidor puede mandar (LISTA CERRADA: el autor la fija). */
export const TIPOS_AVISO = [
  "hola",
  "latido",
  "cambio",
  "notificacion",
  "puesto",
  "consulta",
  "error",
  "cerrado",
] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];

/** Los tipos de peticion que el cliente puede hacer (LISTA CERRADA: el autor la fija). */
export const TIPOS_PETICION = ["suscribir", "consultar"] as const;
export type TipoPeticion = (typeof TIPOS_PETICION)[number];
