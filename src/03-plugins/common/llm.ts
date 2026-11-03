/**
 * Controller genérico de proveedor de LLM: DER NO llama a ningún modelo. El consumidor declara sus acciones (transcribir,
 * responder…, con su propia API y su credencial del singleton) y las reglas de qué hacer con cada tipo de entrada; los plugins
 * solo preguntan `planPara(mime)` y ejecutan lo que el consumidor vinculó.
 *
 * ```ts
 * const llm = proveedorLlm({
 *   credencial: "llm",
 *   acciones: { transcribir: ({ bytes, mime }, cred) => miStt(bytes, mime, cred["apiKey"]) },
 *   reglas: [{ mime: "audio/*", accion: "transcribir", conservar: false }, { mime: "image/*", conservar: true }],
 * });
 * servicios.vincular("llm", llm);
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
import { servicios } from "@Jeff-Aporta/DER/src/03-plugins/common/servicios.ts";
import type { EntradaLlm, ImagenEntrada, MensajeEntrada, ProveedorLlm, ProveedorLlmDef, ReglaEntrada } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";

/** ¿Un mime casa con un patrón (`audio/*` o exacto)? */
function casa(patron: string, mime: string): boolean {
  const m = mime.toLowerCase().split(";")[0]!.trim();
  const p = patron.toLowerCase();
  return p.endsWith("/*") ? m.startsWith(p.slice(0, -1)) : m === p;
}

/** Arma el controller a partir de la definición del consumidor. */
export function proveedorLlm(def: ProveedorLlmDef): ProveedorLlm {
  return {
    /** Primera regla que casa con el mime, o `null` (sin regla: se conserva tal cual). */
    planPara(mime: string): ReglaEntrada | null {
      return def.reglas.find((r) => casa(r.mime, mime)) ?? null;
    },
    /** ¿Hay credencial y acción para ejecutar? Sin ellas el servicio es opcional y no se llama. */
    disponible(accion: string): boolean {
      if (!def.acciones[accion]) return false;
      return !def.credencial || servicios.credencial(def.credencial) !== null;
    },
    /** Ejecuta una acción del consumidor con su credencial; devuelve el texto que produjo. */
    ejecutar(accion: string, entrada: EntradaLlm): Promise<string> {
      const fn = def.acciones[accion];
      if (!fn) throw new Error(`El proveedor de LLM no tiene la acción "${accion}"`);
      return fn(entrada, (def.credencial ? servicios.credencial(def.credencial) : null) ?? {});
    },
  };
}

/** Bytes a `data:` URL, para mandar una imagen como parte de la entrada de un modelo. */
export function dataUrl(bytes: Uint8Array, mime: string): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binario)}`;
}

/** Entrada multimodal de un modelo tipo «responses»: un mensaje de usuario con su texto y sus imágenes. */
export function entradaConImagenes(texto: string, imagenes: ImagenEntrada[] = []): MensajeEntrada[] {
  return [{ role: "user", content: [{ type: "input_text", text: texto }, ...imagenes.map((i) => ({ type: "input_image" as const, image_url: i.url }))] }];
}
