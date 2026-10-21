/**
 * Core de servidor (agnóstico de motor): ServerController, Database, Router, SSE.
 * Dependencias: `kysely` + `zod`. Importa una dimensión (`server/sqlite`, `server/pg`, `server/pglite`)
 * para obtener la fábrica de conexión; cada una reexporta todo este módulo.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/02-controllers/index.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/server/engines.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/server/router.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/server/doc.ts";
export * from "@Jeff-Aporta/DER/src/02-controllers/server/routes.ts";
export { type Kysely, sql } from "kysely";
