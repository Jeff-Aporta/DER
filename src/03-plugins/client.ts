/**
 * 03 plugins (cliente): los JSON transversales `identity`, `permissions`, `embeddings`, `archivosPlugin`, `erroresPlugin` y `penalizaciones`, listos para `createClient(json, { baseUrl })`.
 * Sólo `zod`: nada del servidor.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
export * from "@Jeff-Aporta/DER/src/03-plugins/archivos/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/auditoria.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/embeddings/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/errores/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/tks/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/mensajes/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/calificaciones/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/reacciones/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/common/social.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/canal/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/penalizaciones/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/permissions/index.ts";
export { createClient } from "@Jeff-Aporta/DER/src/02-controllers/client/plugin.ts";
