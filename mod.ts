/**
 * Entrada raíz = núcleo compartido (00 common + 01 objects + controller base). Sólo depende de `zod`.
 * Dimensiones: `src/02 controllers/client/mod.ts` y `src/02 controllers/server/<sqlite|pg|pglite>/mod.ts`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/02 controllers/mod.ts";
