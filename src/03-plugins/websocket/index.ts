/**
 * index.ts — el plugin del WebSocket de DER: el contrato que comparten el servidor y el cliente.
 *
 * A diferencia de los plugins de datos, este NO tiene entidades: no toca la base de datos. Es el transporte en
 * vivo (avisos y consultas de solo lectura) con el mismo contrato en los dos lados.
 *
 * ```ts
 * // servidor (Deno)
 * const sala = new SalaWebSocket({ secreto: env.JWT_SECRET, emisor: "peon" });
 * // en el manejador: Deno.upgradeWebSocket(req) -> la sala.entrar(socket, token)
 *
 * // cliente (navegador)
 * const ws = crearClienteWebSocket({ url: "wss://api.peon.app/api/ws", token });
 * ```
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 */
export * from "@Jeff-Aporta/DER/src/03-plugins/websocket/protocolo.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/websocket/schemas.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/websocket/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/websocket/client.ts";
