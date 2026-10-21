/**
 * vendor.ts — entrada del bundle de navegador `vendor/megaretail.js` que el front consume POR CDN (jsDelivr, pineado
 * por SHA). Es la ÚNICA copia de DER + zod + el dominio en el navegador: así el `registry` global de DER es uno solo
 * (las entidades del dominio y las de los plugins `identity`/`permissions` quedan en el mismo registro).
 *
 * Contiene: núcleo DER (schemas, entidades, Obj, registry, zod helpers), el lado cliente (`createClient`,
 * `ClientController`), los plugins de cliente `identity` y `permissions`, `z` de zod y el dominio MegaRetail
 * (entidades, plugin JSON `megaretail`, contratos Zod de flujos y reportes). Sin nada de servidor (ni SQL ni Deno).
 *
 * Construir: `deno task vendor` (desde `api/`). Tipos: el front mapea el especificador `@megaretail/vendor` a este
 * `.ts` por CDN para `deno check`, y en el navegador un import map lo apunta al `.js`.
 */
export * from "@Jeff-Aporta/DER/src/02-controllers/client/index.ts";
export { identity, permissions } from "@Jeff-Aporta/DER/src/03-plugins/client.ts";
export { z } from "zod";
export * from "./domain/index.ts";
