/**
 * Tipos de lo común de los plugins: auditoría, singleton de servicios y controller de proveedor de LLM.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */

/** Qué es el dueño de una fila. */
export type TipoPropietario = "usuario" | "pagina" | "ninguno";
/** Dueño de una fila: un usuario, una página con su ruta o nadie. */
export type Propietario = { propietario_tipo: TipoPropietario; propietario: string | null };
/** Lo que el consumidor aporta al sello de un alta. */
export type DatosSello = { apporigin?: string | null | undefined; pagina?: string | null | undefined; ip?: string | null | undefined };
/** Columnas de auditoría ya selladas. */
export type SelloAuditoria = Propietario & { apporigin: string | null; iporigin: string | null; fhcre: Date; fhmod: Date };

/** Datos de una credencial (`apiKey`, `url`…); sus valores admiten `"env:NOMBRE"`. */
export type Credencial = Record<string, string>;
/** Configuración del singleton de servicios. */
export type ConfigServicios = { credenciales?: Record<string, Credencial> | undefined; vinculos?: Record<string, unknown> | undefined };

/** Lo que recibe una acción del proveedor de LLM. */
export type EntradaLlm = { bytes?: Uint8Array | undefined; mime?: string | undefined; nombre?: string | undefined; texto?: string | undefined };
/** Una acción del consumidor: recibe la entrada y su credencial, devuelve texto. */
export type AccionLlm = (entrada: EntradaLlm, credencial: Credencial) => Promise<string>;
/** Qué hacer con una entrada de cierto mime: qué acción correrle y si el original se conserva. */
export type ReglaEntrada = { mime: string; accion?: string | undefined; conservar: boolean };
/** Definición del proveedor de LLM: credencial del singleton, acciones y reglas. */
export type ProveedorLlmDef = { credencial?: string | undefined; acciones: Record<string, AccionLlm>; reglas: ReglaEntrada[] };
/** El controller de proveedor de LLM ya armado. */
export type ProveedorLlm = { planPara(mime: string): ReglaEntrada | null; disponible(accion: string): boolean; ejecutar(accion: string, entrada: EntradaLlm): Promise<string> };
/** Una imagen de la entrada de un modelo. */
export type ImagenEntrada = { url: string };
/** Una parte de un mensaje de entrada. */
export type ParteEntrada = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
/** Mensaje de entrada de un modelo tipo «responses». */
export type MensajeEntrada = { role: "user"; content: ParteEntrada[] };
