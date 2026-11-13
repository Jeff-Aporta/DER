/**
 * Tipos de lo común de los plugins: auditoría, singleton de servicios, controller de proveedor de LLM y el dominio
 * social (mensajes, calificaciones y reacciones) que comparten los plugins de tiquetes y conversación.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
import { z } from "zod";

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
// ===================================================================================== social (mensajes, calificaciones, reacciones)

/** Referencia a la entidad que se comenta, califica o reacciona: el espacio y el id de esa entidad. */
export type EspacioRef = { tdespacio: string; iref: string };
/** Índice de un mensaje dentro de su hilo: §x§, §x.y§, §x.y.z§… (el número de niveles no tiene límite). */
export type IndiceMensaje = string;
/** Una versión del contenido de un mensaje: el texto, cuándo se escribió y sus adjuntos. */
export type VersionMensaje = { contenido: string; fhcre: string; adjuntos: string[] };
/** Historial de versiones de un mensaje (la última es la vigente; las anteriores se conservan). */
export type ContenidoMensaje = VersionMensaje[];
/** Perfil de una sesión para evaluar las asignaciones: usuario, roles y grupos. */
export type PerfilAsignado = { usuario: string; roles: string[]; grupos: string[] };
/** A quién se asigna un tk: usuarios, roles y grupos; §*§ en grupos significa "todos". */
export type Asignados = { usuarios: string[]; roles: string[]; grupos: string[] };
/** Un pendiente de un tk: si está hecho, su contenido y la última edición. */
export type Pendiente = { hecho: boolean; contenido: string; jedit: { fh: string; iusuario: string } | null };
/** Los pendientes de un tk. */
export type Pendientes = Pendiente[];
/** Calificación de una entidad: entero de -10 (lo peor) a 10 (lo mejor); 0 es neutro. */
export type ValorCalificacion = number;
/** Reacción de un usuario sobre una entidad: el emoji (o clave corta) que puso. */
export type Reaccion = string;

/** Zod de la referencia a una entidad (espacio + id). */
export const ZEspacioRef = z.strictObject({ tdespacio: z.string().min(1).max(60), iref: z.string().min(1).max(120) });
/** Zod del índice de un mensaje: §0§, §0.0§, §0.0.0§… */
export const ZIndiceMensaje = z.string().regex(/^\d+(\.\d+)*$/, "El índice debe ser 0, 0.0, 0.0.0…");
/** Zod de una versión de contenido de mensaje. */
export const ZVersionMensaje = z.strictObject({ contenido: z.string(), fhcre: z.string(), adjuntos: z.array(z.string()) });
/** Zod del historial de versiones de un mensaje. */
export const ZContenidoMensaje = z.array(ZVersionMensaje);
/** Zod de las asignaciones (usuarios, roles y grupos). */
export const ZAsignados = z.strictObject({ usuarios: z.array(z.string()), roles: z.array(z.string()), grupos: z.array(z.string()) });
/** Zod de un pendiente de un tk. */
export const ZPendiente = z.strictObject({ hecho: z.boolean(), contenido: z.string(), jedit: z.object({ fh: z.string(), iusuario: z.string() }).nullable() });
/** Zod de la calificación: entero de -10 a 10 (0 es neutro). */
export const ZValorCalificacion = z.number().int().min(-10).max(10);
/** Zod de la reacción. */
export const ZReaccion = z.string().min(1).max(64);

// ===================================================================================== JWT HS256 para bots

/** Claims de un token HS256: `sub` identifica al bot; `exp` se exige al verificar. */
export type JwtHs256Claims = { sub: string; exp?: number; iat?: number; nbf?: number; jti?: string; iss?: string; aud?: string | string[]; [key: string]: unknown };
/** Opciones para firmar un token HS256: vida, emisor, audiencia y reloj (ms). */
export type JwtHs256SignOptions = { expiresIn?: number; issuer?: string; audience?: string; now?: number };
/** Opciones para verificar un token HS256: emisor, audiencia, reloj (ms) y tolerancia (s). */
export type JwtHs256VerifyOptions = { issuer?: string; audience?: string; now?: number; clockToleranceSec?: number };
/** Configuración del middleware HS256 reutilizable por un Worker. */
export type JwtHs256MiddlewareOptions = { secret: string; issuer?: string; audience?: string; now?: number; clockToleranceSec?: number };
/** Opciones para tomar el secreto HS256 del entorno. */
export type JwtHs256EnvOptions = { secretEnv?: string; issuer?: string; audience?: string; now?: number; clockToleranceSec?: number };

// ===================================================================================== R2

/** Metadatos HTTP de un objeto R2. */
export type R2HttpMetadata = { contentType?: string; contentDisposition?: string; cacheControl?: string; cacheExpiry?: Date };
/** Opciones mínimas de `R2Bucket.put`. */
export type R2PutOptionsLike = { httpMetadata?: R2HttpMetadata; customMetadata?: Record<string, string> };
/** Objeto R2 con su cuerpo opcional (lo devuelve `get`; `head` no trae cuerpo). */
export type R2ObjectLike = { key: string; size: number; uploaded: Date; httpMetadata?: R2HttpMetadata; customMetadata?: Record<string, string>; body?: ReadableStream<Uint8Array> };
/** Opciones mínimas de `R2Bucket.list`. */
export type R2ListOptionsLike = { prefix?: string; cursor?: string; limit?: number; include?: string[] };
/** Página de objetos R2. */
export type R2ObjectsLike = { objects: R2ObjectLike[]; truncated: boolean; cursor?: string };
/** Binding `R2Bucket` de Cloudflare (la superficie que usa el helper). */
export type R2BucketLike = { put(key: string, value: Uint8Array, options?: R2PutOptionsLike): Promise<unknown>; get(key: string): Promise<R2ObjectLike | null>; delete(key: string | string[]): Promise<void>; list(options?: R2ListOptionsLike): Promise<R2ObjectsLike> };
/** Opciones del almacén R2: vida, prefijo y reloj (ms). */
export type R2Opciones = { ttlSeg?: number; prefix?: string; now?: () => number };
/** Ficha de un objeto subido a R2. */
export type R2Descriptor = { clave: string; bytes: number; mime: string; expira: string };
/** Resultado de purgar objetos vencidos. */
export type R2PurgeResult = { escaneados: number; borrados: number };
/** Almacén R2 compatible con el contrato de archivos de DER. */
export type R2Almacen = { subir(clave: string, bytes: Uint8Array, meta: { mime: string; nombre: string }): Promise<void>; subirConCaducidad(clave: string, bytes: Uint8Array, meta: { mime: string; nombre: string; ttlSeg?: number }): Promise<R2Descriptor>; bajar(clave: string): Promise<{ cuerpo: BodyInit | null; mime?: string; bytes?: number } | null>; borrar(clave: string): Promise<void>; purgarVencidos(): Promise<R2PurgeResult> };
