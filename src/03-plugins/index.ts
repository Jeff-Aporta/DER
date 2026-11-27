/**
 * 03 plugins (server) — seguridad como plugins JSON: `identityServer` (usuarios, hash, JWT, sesiones, auditoría),
 * `permissionsServer` (DER grupos/roles/acciones, vector de acciones), `embeddingsServer` (caché de embeddings), `archivosServer` (carpetas y archivos),
 * `erroresServer` (reportes para agentes) y `penalizacionesServer` (vectores de intentos fallidos). Cada uno es un JSON que el consumidor arma con
 * `createServer(json, { db, cfg })` y pasa al Router en `plugins`; las puertas (`extract`, `permissions`) entran al registro
 * global sólo donde el consumidor no definió las suyas: cualquiera de los dos se reemplaza por un sistema propio.
 *
 * ```ts
 * const auth = createServer(identityServer, { db, cfg: { secret: "env:JWT_SECRET", admin: { usuario: "admin", password: "env:ADMIN_PASSWORD" } } });
 * const permisos = createServer(permissionsServer, { db, cfg: { grupo: "API", admins: ["admin"] } });
 * const router = createRouter(ctrls, { basePath: "/api", plugins: [auth, permisos] });
 * await router.seed();
 * ```
 * Dependencias: `zod` + `kysely` (las del server).
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
export * from "@Jeff-Aporta/DER/src/03-plugins/archivos/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/auditoria.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/almacen-disco.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/device.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/llm.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/jwt.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/r2.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/servicios.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/tareas.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/canal/server.ts";
// El canal propio (el que vive en el VPS con su SQLite): se exporta con nombre para no chocar con los tipos del
// plugin de referencia (Mensaje, Adjunto, Reaccion...) y con los demas plugins.
export { canalVpsPlugin } from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/index.ts";
export { canalVpsServer, purgar as purgarCanalVps } from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/embeddings/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/errores/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/tks/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/tiquetes/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/mensajes/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/calificaciones/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/reacciones/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/whatsapp/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/crm/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/atencion/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/reportes/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/penalizaciones/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/voz/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/voz/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/permissions/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/permisos/server.ts";
// El WebSocket: el contrato en vivo (avisos y consultas de solo lectura) que comparten servidor y cliente.
// No es un plugin de datos (no tiene entidades): es el transporte en vivo con el mismo contrato en los dos lados.
export { SalaWebSocket } from "@Jeff-Aporta/DER/src/03-plugins/websocket/server.ts";
export { crearClienteWebSocket } from "@Jeff-Aporta/DER/src/03-plugins/websocket/client.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/websocket/protocolo.ts";
