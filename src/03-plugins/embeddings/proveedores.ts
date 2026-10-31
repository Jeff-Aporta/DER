/**
 * Adaptadores de Cloudflare para `services`: `workersAi(env.AI)` (proveedor, `@cf/baai/bge-m3` y afines) y
 * `vectorizeIndice(env.VECTORES, { dims })` (índice externo). Sin dependencias: reciben los bindings por contrato estructural.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md
 */
import { HttpError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { IndiceEmbeddings, ProveedorEmbeddings, VectorizeBindingLike, WorkersAiLike } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";

/** Proveedor sobre el binding de Workers AI; `data` o `response` según el modelo. */
export function workersAi(ai: WorkersAiLike): ProveedorEmbeddings {
  return {
    async embeber(textos, modelo) {
      const r = await ai.run(modelo, { text: textos }) as { data?: number[][]; response?: number[][] };
      const datos = r.data ?? r.response;
      if (!Array.isArray(datos) || datos.length !== textos.length) throw new HttpError(502, "Respuesta inesperada de Workers AI");
      return datos;
    },
  };
}

/** Índice sobre Vectorize: clave `entidad:id`. `dims` declara las del índice para detectar una reducción incompatible. */
export function vectorizeIndice(v: VectorizeBindingLike, o: { dims?: number | undefined } = {}): IndiceEmbeddings {
  return {
    dims: o.dims,
    async buscar(vector, { topK, entidades, filtro }) {
      const r = await v.query(vector, { topK: Math.min(100, Math.max(1, topK)), returnMetadata: "indexed", filter: filtro ?? (entidades ? { entidad: { $in: entidades } } : {}) });
      return (r.matches ?? []).map((m) => {
        const corte = m.id.indexOf(":");
        return { entidad: m.id.slice(0, corte), id: m.id.slice(corte + 1), score: m.score };
      });
    },
    subir(docs) {
      return v.upsert(docs.map((d) => ({ id: `${d.entidad}:${d.id}`, values: d.vector, metadata: { entidad: d.entidad, id: d.id, ...d.metadata } })));
    },
    borrar(refs) {
      return v.deleteByIds(refs.map((r) => `${r.entidad}:${r.id}`));
    },
  };
}
