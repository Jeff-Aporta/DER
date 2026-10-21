/**
 * Lado cliente: controllers fetch que reusan las mismas entidades/POJOs/schemas Zod, y `createClient` para plugins JSON.
 * Dependencias: sólo `zod`. Sin nada de SQL.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/02-controllers/index.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/client/controller.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/client/plugin.ts";
