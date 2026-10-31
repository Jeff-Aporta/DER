/** Utilidades de las pruebas de embeddings: exportes del plugin y proveedor determinista. */
import type { ProveedorEmbeddings } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/embeddings/server.ts";
export { erroresContraEntidades } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/rules.ts";

/** Proveedor determinista: bolsa de palabras a `dims` (textos con palabras comunes quedan cerca), sin normalizar; registra las llamadas. */
export function proveedorFalso(dims: number): ProveedorEmbeddings & { llamadas: string[][] } {
  const llamadas: string[][] = [];
  return {
    llamadas,
    embeber(textos) {
      llamadas.push(textos);
      return Promise.resolve(textos.map((t) => {
        const v = new Array<number>(dims).fill(0.001);
        for (const w of t.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
          let h = 7;
          for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          v[h % dims]! += 2;
        }
        return v;
      }));
    },
  };
}
