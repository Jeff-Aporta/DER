/**
 * 01 objects — POJOs (getters/setters casteados + acciones JSON tipadas), schemas JSON → Zod, entidades
 * REST (singular/plural/rutas/hooks) y query spec. Reusable tal cual en front y back.
 * Dependencias: sólo `zod`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/Controllers@main/docs/README.md
 */
export * from "../00 common/mod.ts";
export * from "./meta.ts";
export * from "./zod.ts";
export * from "./pojo.ts";
export * from "./query.ts";
export * from "./entity.ts";
