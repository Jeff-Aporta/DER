/**
 * 02 controllers — controller base común (CRUD, query, list, listas, pre*, endpoints, SSE, /cfg).
 * Las dimensiones concretas: `client/` (fetch) y `server/<motor>/` (SQL).
 * Dependencias: sólo `zod`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/01-objects/index.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/controller.ts";
