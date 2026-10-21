/**
 * 02 controllers — controller base común (CRUD, query, list, listas, pre*, endpoints, SSE, /cfg, permisos) y lo común
 * de los plugins JSON. Las dimensiones concretas: `client/` (fetch) y `server/` (SQL).
 * Dependencias: sólo `zod`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/controllers.md
 */
export * from "@Jeff-Aporta/DER/src/01-objects/index.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/controller.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/plugin.ts";
