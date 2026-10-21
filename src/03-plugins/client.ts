/**
 * 03 plugins (cliente): los JSON transversales `identity` y `permissions`, listos para `createClient(json, { baseUrl })`.
 * Sólo `zod`: nada del servidor.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/permissions/index.ts";
export { createClient } from "@Jeff-Aporta/DER/src/02-controllers/client/plugin.ts";
