/**
 * Tipos y Zod del plugin de catálogo: el catálogo de cada APP (`iapp`) — categorías, items (productos y servicios) y la
 * disponibilidad de los servicios. Todo se filtra por `iapp`: dos apps del mismo sistema (un restaurante y una tienda) no
 * comparten catálogo, y el clon de una app se puede purgar entero.
 *
 *   catalogo_categorias     (iapp, icategoria, nombre, orden, bactivo, fhcre, fhmod)
 *   catalogo_items          (iapp, iitem, icategoria, tipo, codigo, nombre, descripcion, precio, moneda, imagen, imagen_mini, bactivo, bdestacado, duracion_min, jextras, fhcre, fhmod)
 *   catalogo_disponibilidad (iapp, iitem, dia_semana, desde, hasta, cupos, fhcre)
 *
 * El precio es un ENTERO en pesos (COP): no hay centavos ni minor units. `jextras` guarda lo que cada item necesite
 * (adicionales, variantes, notas) como JSON libre. La disponibilidad es de los SERVICIOS: franjas por día de la semana
 * (1 = lunes … 7 = domingo) con sus cupos.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/catalogo.md
 */
import { z } from "zod";
import type { SessionInfo } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";

/** Tipo de item: lo que se compra (producto) o lo que se agenda (servicio). */
export const TIPOS_ITEM = ["producto", "servicio"] as const;

/** Moneda por defecto: el precio es un entero en pesos colombianos (COP), sin centavos. */
export const MONEDA_POR_DEFECTO = "COP";

/** Días de la semana en forma ISO: 1 = lunes … 7 = domingo. */
export const DIAS_SEMANA = [1, 2, 3, 4, 5, 6, 7] as const;

/** Horario en formato `HH:MM` (24 horas). */
export const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Tipo de un item del catálogo. */
export type TipoItem = (typeof TIPOS_ITEM)[number];

/** Día de la semana (1 = lunes … 7 = domingo). */
export type DiaSemana = (typeof DIAS_SEMANA)[number];

/** Una categoría del catálogo de una app. */
export type Categoria = { iapp: string; icategoria: string; nombre: string; orden: number; bactivo: boolean; fhcre: string; fhmod: string | null };

/** Un item del catálogo: un producto (lo que se compra) o un servicio (lo que se agenda). */
export type ItemCatalogo = { iapp: string; iitem: string; icategoria: string | null; tipo: TipoItem; codigo: string; nombre: string; descripcion: string | null; precio: number; moneda: string; imagen: string | null; imagen_mini: string | null; bactivo: boolean; bdestacado: boolean; duracion_min: number | null; jextras: unknown; fhcre: string; fhmod: string | null };

/** Una franja de disponibilidad de un servicio: un día de la semana, de `desde` a `hasta`, con sus cupos. */
export type Disponibilidad = { iapp: string; iitem: string; dia_semana: number; desde: string; hasta: string; cupos: number; fhcre: string };

/** Filtros de la lista de items (todos opcionales). */
export type FiltrosCatalogo = { categoria?: string | undefined; q?: string | undefined; pagina?: number | undefined; porPagina?: number | undefined };

/** Página de items del catálogo (el total es de lo que cumple los filtros, no de la página). */
export type PaginaItems = { items: ItemCatalogo[]; total: number; pagina: number; porPagina: number };

/** Alta de una categoría. */
export type CategoriaInput = { codigo: string; nombre: string; orden?: number | undefined; bactivo?: boolean | undefined };

/** Cambio de una categoría (el código no cambia: es su llave). */
export type CategoriaCambio = { nombre?: string | undefined; orden?: number | undefined; bactivo?: boolean | undefined };

/** Alta de un item. `categoria` es el código de la categoría (o null si no tiene). */
export type ItemInput = { codigo: string; categoria?: string | null | undefined; tipo: TipoItem; nombre: string; descripcion?: string | null | undefined; precio: number; moneda?: string | undefined; imagen?: string | null | undefined; imagen_mini?: string | null | undefined; bactivo?: boolean | undefined; bdestacado?: boolean | undefined; duracion_min?: number | null | undefined; extras?: unknown };

/** Cambio de un item (el código no cambia: es la llave idempotente de la importación). */
export type ItemCambio = { categoria?: string | null | undefined; tipo?: TipoItem | undefined; nombre?: string | undefined; descripcion?: string | null | undefined; precio?: number | undefined; moneda?: string | undefined; imagen?: string | null | undefined; imagen_mini?: string | null | undefined; bactivo?: boolean | undefined; bdestacado?: boolean | undefined; duracion_min?: number | null | undefined; extras?: unknown };

/** Alta o cambio de una franja de disponibilidad de un servicio. */
export type DisponibilidadInput = { iitem: string; dia_semana: number; desde: string; hasta?: string | undefined; cupos?: number | undefined };

/** Una categoría en la importación: su código es su llave. */
export type ImportarCategoria = { codigo: string; nombre: string; orden?: number | undefined; bactivo?: boolean | undefined };

/** Un item en la importación: su código es su llave (idempotente). */
export type ImportarItem = { codigo: string; categoria?: string | null | undefined; tipo: TipoItem; nombre: string; descripcion?: string | null | undefined; precio: number; moneda?: string | undefined; imagen?: string | null | undefined; imagen_mini?: string | null | undefined; bactivo?: boolean | undefined; bdestacado?: boolean | undefined; duracion_min?: number | null | undefined; extras?: unknown };

/** Una franja en la importación: el item se referencia por su código. */
export type ImportarDisponibilidad = { codigo: string; dia_semana: number; desde: string; hasta?: string | undefined; cupos?: number | undefined };

/** Lo que se importa a una app: categorías, items y (opcionalmente) la disponibilidad de los servicios. */
export type ImportarCatalogo = { categorias?: ImportarCategoria[] | undefined; items?: ImportarItem[] | undefined; disponibilidad?: ImportarDisponibilidad[] | undefined };

/** Resultado de una importación: cuántas filas se crearon y cuántas se actualizaron (por grupo). */
export type ResultadoImportacion = { categorias: { creadas: number; actualizadas: number }; items: { creados: number; actualizados: number }; disponibilidad: { creadas: number; actualizadas: number } };

/** Contexto que resuelve el ámbito de la app: la petición (cabecera `X-App`) o la sesión. */
export type ContextoCatalogo = { request?: Request | undefined; session?: SessionInfo | null | undefined };

/** Configuración del plugin: la cabecera que lleva el ámbito (por defecto `x-app`) y la app por defecto si la petición no declara ninguna. */
export type CatalogoConfig = { cabecera?: string | undefined; appPorDefecto?: string | undefined };

/** Verbos de servidor del catálogo (sin HTTP): lo que usa el importador y el resto del sistema. */
export type VerbosCatalogo = { categorias(iapp: string): Promise<Categoria[]>; items(iapp: string, filtros?: FiltrosCatalogo): Promise<PaginaItems>; item(iapp: string, iitem: string): Promise<ItemCatalogo>; disponibilidad(iapp: string, iitem: string, dia?: number): Promise<Disponibilidad[]>; crearCategoria(iapp: string, input: CategoriaInput): Promise<Categoria>; editarCategoria(iapp: string, icategoria: string, cambio: CategoriaCambio): Promise<Categoria>; borrarCategoria(iapp: string, icategoria: string): Promise<Categoria>; crearItem(iapp: string, input: ItemInput): Promise<ItemCatalogo>; editarItem(iapp: string, iitem: string, cambio: ItemCambio): Promise<ItemCatalogo>; borrarItem(iapp: string, iitem: string): Promise<ItemCatalogo>; guardarDisponibilidad(iapp: string, input: DisponibilidadInput): Promise<Disponibilidad>; borrarDisponibilidad(iapp: string, iitem: string): Promise<{ borrados: number }>; importarCatalogo(iapp: string, datos: ImportarCatalogo): Promise<ResultadoImportacion> };

/** Zod de la alta de una categoría. */
export const ZCategoriaInput = z.strictObject({ codigo: z.string().trim().min(1).max(40), nombre: z.string().trim().min(1).max(160), orden: z.number().int().min(0).max(9999).optional(), bactivo: z.boolean().optional() });

/** Zod del cambio de una categoría. */
export const ZCategoriaCambio = z.strictObject({ nombre: z.string().trim().min(1).max(160).optional(), orden: z.number().int().min(0).max(9999).optional(), bactivo: z.boolean().optional() });

/** Zod de la alta de un item. */
export const ZItemInput = z.strictObject({ codigo: z.string().trim().min(1).max(40), categoria: z.string().trim().min(1).max(40).nullish(), tipo: z.enum(TIPOS_ITEM), nombre: z.string().trim().min(1).max(160), descripcion: z.string().max(4000).nullish(), precio: z.number().int().min(0).max(1000000000), moneda: z.string().trim().min(3).max(3).optional(), imagen: z.string().trim().max(500).nullish(), imagen_mini: z.string().trim().max(500).nullish(), bactivo: z.boolean().optional(), bdestacado: z.boolean().optional(), duracion_min: z.number().int().min(1).max(10080).nullish(), extras: z.unknown().optional() });

/** Zod del cambio de un item. */
export const ZItemCambio = z.strictObject({ categoria: z.string().trim().min(1).max(40).nullish(), tipo: z.enum(TIPOS_ITEM).optional(), nombre: z.string().trim().min(1).max(160).optional(), descripcion: z.string().max(4000).nullish(), precio: z.number().int().min(0).max(1000000000).optional(), moneda: z.string().trim().min(3).max(3).optional(), imagen: z.string().trim().max(500).nullish(), imagen_mini: z.string().trim().max(500).nullish(), bactivo: z.boolean().optional(), bdestacado: z.boolean().optional(), duracion_min: z.number().int().min(1).max(10080).nullish(), extras: z.unknown().optional() });

/** Zod de la alta o cambio de una franja de disponibilidad. */
export const ZDisponibilidadInput = z.strictObject({ iitem: z.string().trim().min(1).max(40), dia_semana: z.number().int().min(1).max(7), desde: z.string().trim().min(5).max(5).refine((v) => HORA_RE.test(v), { message: "La hora debe ser HH:MM" }), hasta: z.string().trim().min(5).max(5).refine((v) => HORA_RE.test(v), { message: "La hora debe ser HH:MM" }).optional(), cupos: z.number().int().min(0).max(10000).optional() });

/** Zod de una categoría en la importación. */
export const ZImportarCategoria = z.strictObject({ codigo: z.string().trim().min(1).max(40), nombre: z.string().trim().min(1).max(160), orden: z.number().int().min(0).max(9999).optional(), bactivo: z.boolean().optional() });

/** Zod de un item en la importación. */
export const ZImportarItem = z.strictObject({ codigo: z.string().trim().min(1).max(40), categoria: z.string().trim().min(1).max(40).nullish(), tipo: z.enum(TIPOS_ITEM), nombre: z.string().trim().min(1).max(160), descripcion: z.string().max(4000).nullish(), precio: z.number().int().min(0).max(1000000000), moneda: z.string().trim().min(3).max(3).optional(), imagen: z.string().trim().max(500).nullish(), imagen_mini: z.string().trim().max(500).nullish(), bactivo: z.boolean().optional(), bdestacado: z.boolean().optional(), duracion_min: z.number().int().min(1).max(10080).nullish(), extras: z.unknown().optional() });

/** Zod de una franja en la importación. */
export const ZImportarDisponibilidad = z.strictObject({ codigo: z.string().trim().min(1).max(40), dia_semana: z.number().int().min(1).max(7), desde: z.string().trim().min(5).max(5).refine((v) => HORA_RE.test(v), { message: "La hora debe ser HH:MM" }), hasta: z.string().trim().min(5).max(5).refine((v) => HORA_RE.test(v), { message: "La hora debe ser HH:MM" }).optional(), cupos: z.number().int().min(0).max(10000).optional() });

/** Zod de lo que se importa a una app. */
export const ZImportarCatalogo = z.strictObject({ categorias: z.array(ZImportarCategoria).max(500).optional(), items: z.array(ZImportarItem).max(5000).optional(), disponibilidad: z.array(ZImportarDisponibilidad).max(5000).optional() });

/** Zod de la configuración del plugin. */
export const ZCatalogoConfig = z.strictObject({ cabecera: z.string().trim().min(1).max(40).default("x-app"), appPorDefecto: z.string().trim().min(1).max(40).optional() });
