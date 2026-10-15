/**
 * 00 common — lo transversal: TODOS los tipos y contratos Zod (`schemas.ts`), casteos, errores, `Obj`, SSE.
 * Dependencias: sólo `zod`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/Controllers@main/docs/README.md
 */
export * from "./schemas.ts";
export * from "./cast.ts";
export * from "./errors.ts";
export * from "./obj.ts";
export * from "./sse.ts";
/** El mismo `z` que usan los contratos (el del consumidor). */
export { z } from "zod";
