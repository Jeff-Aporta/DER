/**
 * 00 common — lo transversal: TODOS los tipos y contratos Zod (`schemas.ts`), `Obj` + errores + casteos (`base.ts`) y SSE.
 * Dependencias: sólo `zod` (y `Obj` de iswc por CDN).
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/objetos.md
 */
export * from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
export * from "@Jeff-Aporta/DER/src/00-common/base.ts";
export * from "@Jeff-Aporta/DER/src/00-common/sse.ts";
export { z } from "zod";
