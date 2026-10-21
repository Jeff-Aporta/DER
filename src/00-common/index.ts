/**
 * 00 common — lo transversal: TODOS los tipos y contratos Zod (`schemas.ts`), casteos, errores, `Obj`, SSE.
 * Dependencias: sólo `zod`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
export * from "@Jeff-Aporta/DER/src/00-common/cast.ts";
export * from "@Jeff-Aporta/DER/src/00-common/errors.ts";
export * from "@Jeff-Aporta/DER/src/00-common/obj.ts";
export * from "@Jeff-Aporta/DER/src/00-common/sse.ts";
/** El mismo `z` que usan los contratos (el del consumidor). */
export { z } from "zod";
