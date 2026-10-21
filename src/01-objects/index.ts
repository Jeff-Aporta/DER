/**
 * 01 objects — POJOs (getters/setters casteados + acciones JSON tipadas), schemas JSON → Zod, entidades
 * REST (singular/plural/rutas/hooks) y query spec. Reusable tal cual en front y back.
 * Dependencias: sólo `zod`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/00-common/index.ts";
export * from "@Jeff-Aporta/DER/src/01-objects/meta.ts";
export * from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
export * from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
export * from "@Jeff-Aporta/DER/src/01-objects/query.ts";
export * from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
export * from "@Jeff-Aporta/DER/src/01-objects/diagram.ts";
