/**
 * Entrada raíz = núcleo compartido (00 common + 01 objects + controller base). Sólo depende de `zod`.
 * Dimensiones: `src/02-controllers/client/index.ts` y `src/02-controllers/server/<sqlite|pg|pglite>/index.ts`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/02-controllers/index.ts";
