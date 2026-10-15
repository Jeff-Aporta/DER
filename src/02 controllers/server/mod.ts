/**
 * Core de servidor (agnóstico de motor): ServerController, Database, Router, SSE.
 * Dependencias: `kysely` + `zod`. Importa una dimensión (`server/sqlite`, `server/pg`, `server/pglite`)
 * para obtener la fábrica de conexión; cada una reexporta todo este módulo.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/Controllers@main/docs/README.md
 */
export * from "../mod.ts";
export * from "./schemas.ts";
export * from "./engine.ts";
export * from "./database.ts";
export * from "./controller.ts";
export * from "./router.ts";
export * from "./doc.ts";
export * from "./routes.ts";
export { type Kysely, sql } from "kysely";
