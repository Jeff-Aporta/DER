/**
 * Tipos y Zod del plugin de CONTRATOS: el contrato homogéneo que el servidor publica (`GET contratos`) y que cualquier
 * front descarga y valida (con el mismo JSON Schema que el servidor sirve).
 *
 * El contrato describe lo que el servidor REALMENTE publica: las entidades montadas (con sus pks, su `iapp`, su esquema
 * y sus rutas) y las rutas irregulares. Nada de lo que el servidor no expone, nada de campos ocultos.
 *
 * La convención REST es la de DER (la que generan sus controllers): con `plural` y `singular` de la entidad,
 * `GET {plural}` (lista), `GET {plural}?q=` (consulta con filtros y página), `GET {singular}/{pk}` (detalle),
 * `POST {singular}` (alta), `PUT {singular}/{pk}` (cambio) y `DELETE {singular}/{pk}` (baja).
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/contratos.md
 */
import { z } from "zod";

/** Un JSON Schema (draft 2020-12) como el que produce `z.toJSONSchema` (zod 4). */
export type JsonSchema = { type?: string | undefined; properties?: Record<string, JsonSchema> | undefined; required?: string[] | undefined; [k: string]: unknown };

/** El JSON Schema que acepta `z.fromJSONSchema` (el tipo de Zod). */
export type JsonSchemaZod = Parameters<typeof z.fromJSONSchema>[0];

/** Las cinco rutas REST que el servidor publica de una entidad (las que genera su controller: ninguna inventada). */
export type RutasEntidad = { list: string; get: string; post: string; put: string; delete: string };

/** Qué rutas de la entidad son públicas (no piden sesión). */
export type PublicaEntidad = { list: boolean; get: boolean };

/** Una entidad del contrato: cómo se llama, sus pks, si es de app (`iapp`), su esquema y sus rutas. */
export type ContratoEntidad = { nombre: string; singular: string; plural: string; pk: string[]; iapp: boolean; publica: PublicaEntidad; esquema: JsonSchema; rutas: RutasEntidad };

/** Una ruta irregular (la que no es el CRUD de una entidad): su método, su camino y si es pública. */
export type ContratoRutaExtra = { metodo: string; path: string; publica: boolean; entrada?: JsonSchema | undefined; salida?: JsonSchema | undefined };

/** El contrato completo que sirve `GET contratos`. */
export type Contratos = { version: string; generado: string; entidades: ContratoEntidad[]; rutasExtra: ContratoRutaExtra[] };

/** Opciones de la lista: `q` (texto), `pagina`, `tamano`, `orden` y `filtros` por campo (viajan en el `q` de DER). */
export type OpcionesLista = { q?: string | undefined; pagina?: number | undefined; tamano?: number | undefined; orden?: string | string[] | undefined; filtros?: Record<string, unknown> | undefined; incluir?: Record<string, unknown> | undefined; campos?: string[] | undefined };

/** Opciones de `llamar`: el método (si el contrato no lo dice), los parámetros de la ruta y el cuerpo. */
export type OpcionesLlamar = { metodo?: string | undefined; params?: Record<string, string> | undefined };

/** Almacén tipo `localStorage` donde el cliente cachea el contrato (con su versión). */
export type AlmacenContratos = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

/** Opciones del cliente de contratos: dónde está el API, de qué app se trata, qué plugins se piden y cómo se pide. */
export type OpcionesClienteContratos = { servidor: string; iapp?: string | undefined; fetch?: typeof fetch | undefined; plugins?: string[] | undefined; almacen?: AlmacenContratos | undefined };

/** El cliente: descarga el contrato, valida lo que llega y hace el CRUD genérico de cualquier entidad. */
export type ClienteContratos = { contratos(): Promise<Contratos>; recargar(): Promise<Contratos>; entidad(nombre: string): Promise<ContratoEntidad>; listar(nombre: string, opciones?: OpcionesLista): Promise<unknown[]>; ver(nombre: string, id: string | string[]): Promise<unknown>; crear(nombre: string, cuerpo: unknown): Promise<unknown>; editar(nombre: string, id: string | string[], cuerpo: unknown): Promise<unknown>; borrar(nombre: string, id: string | string[]): Promise<unknown>; llamar(ruta: string, cuerpo?: unknown, opciones?: OpcionesLlamar): Promise<unknown> };

/** Zod de un JSON Schema (lo que sirve el servidor: libre, con `type`, `properties` y `required`). */
export const ZJsonSchema = z.looseObject({ type: z.string().optional(), properties: z.record(z.string(), z.any()).optional(), required: z.array(z.string()).optional() });

/** Zod de las cinco rutas de una entidad. */
export const ZRutasEntidad = z.object({ list: z.string(), get: z.string(), post: z.string(), put: z.string(), delete: z.string() });

/** Zod de la publicación de una entidad. */
export const ZPublicaEntidad = z.object({ list: z.boolean(), get: z.boolean() });

/** Zod de una entidad del contrato. */
export const ZContratoEntidad = z.object({ nombre: z.string(), singular: z.string(), plural: z.string(), pk: z.array(z.string()), iapp: z.boolean(), publica: ZPublicaEntidad, esquema: ZJsonSchema, rutas: ZRutasEntidad });

/** Zod de una ruta irregular. */
export const ZContratoRutaExtra = z.looseObject({ metodo: z.string(), path: z.string(), publica: z.boolean(), entrada: ZJsonSchema.optional(), salida: ZJsonSchema.optional() });

/** Zod del contrato completo (lo que el cliente valida al descargarlo). */
export const ZContratos = z.object({ version: z.string(), generado: z.string(), entidades: z.array(ZContratoEntidad), rutasExtra: z.array(ZContratoRutaExtra) });
