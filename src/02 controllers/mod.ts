/**
 * 02 controllers — controller base común (CRUD, query, list, listas, pre*, endpoints, SSE, /cfg).
 * Las dimensiones concretas: `client/` (fetch) y `server/<motor>/` (SQL).
 * Dependencias: sólo `zod`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/Controllers@main/docs/README.md
 */
export * from "../01 objects/mod.ts";
export * from "./controller.ts";
