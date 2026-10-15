/**
 * Definiciones COMPARTIDAS (front y back): schemas JSON, POJOs y entidades.
 * Este archivo no importa nada de SQL: el front lo puede importar tal cual.
 */
import { defineEntity, defineSchema, pojoOf, z } from "../mod.ts";

/** Molde Zod de la config de producto (columna `jconfig`). */
export const ZProductoCfg = z.object({
  visible: z.boolean().optional(),
  ui: z.object({ color: z.string().optional(), orden: z.number().int().optional() }).optional(),
  etiquetas: z.array(z.string()).optional(),
});

// ------------------------------------------------------------------ Categoria

export const CategoriaSchema = defineSchema({
  columns: {
    icategoria: { type: "int", pk: true, autoincrement: true },
    nombre: { type: "string", length: 60, nullable: false },
    bactivo: { type: "bool", default: true },
  },
  relations: {
    productos: { kind: "many", target: "producto", on: { icategoria: "icategoria" } },
  },
});

export class TCategoria extends pojoOf(CategoriaSchema) {
  declare productos: TProducto[];
}

export const Categoria = defineEntity({
  pojo: TCategoria,
  singular: "categoria",
  plural: "categorias",
});

// ------------------------------------------------------------------ Producto

export const ProductoSchema = defineSchema({
  columns: {
    iproducto: { type: "int", pk: true, autoincrement: true },
    nombre: { type: "string", length: 100, nullable: false },
    precio: { type: "decimal", precision: 12, scale: 2, nullable: false },
    stock: { type: "int", default: 0 },
    tipo: { type: "string", enum: ["fisico", "digital"], default: "fisico" },
    icategoria: { type: "int" },
    lanzamiento: { type: "date" },
    creado: { type: "datetime" },
    meta: { type: "json" },
    jconfig: { type: "json", zod: ZProductoCfg },
    /** Calculada en el server (SQL quemado). */
    total: { type: "float", virtual: true },
  },
  relations: {
    categoria: { kind: "one", target: "categoria", on: { icategoria: "icategoria" } },
  },
});

export class TProducto extends pojoOf(ProductoSchema) {
  declare categoria: TCategoria | null;

  /** Getter propio (no es columna, no se serializa). */
  get etiqueta(): string {
    return `${this.nombre} ($${this.precio})`;
  }
}

export const Producto = defineEntity({
  pojo: TProducto,
  singular: "producto",
  plural: "productos",
  listColumns: ["iproducto", "nombre"],
  getInclude: { categoria: true },
  cfg: { column: "jconfig" },
  hooks: {
    prePost(p) {
      return p.precio != null && p.precio < 0 ? "El precio no puede ser negativo" : null;
    },
    prePut(p) {
      return p.precio != null && p.precio < 0 ? "El precio no puede ser negativo" : null;
    },
  },
  endpoints: {
    ajustarStock: { method: "POST", scope: "one", returns: "pojo" },
    importar: { method: "POST", scope: "many", returns: "list" },
  },
});

// ------------------------------------------------------------------ Pedido / Linea (pk compuesta)

export const PedidoSchema = defineSchema({
  columns: {
    ipedido: { type: "int", pk: true, autoincrement: true },
    cliente: { type: "string", nullable: false },
    fecha: { type: "date" },
  },
  relations: {
    lineas: { kind: "many", target: "pedido/linea", on: { ipedido: "ipedido" } },
  },
});

export class TPedido extends pojoOf(PedidoSchema) {
  declare lineas: TLinea[];
}

/** Config de libre definición (sin Zod), guardada por el server en otra tabla. */
export const Pedido = defineEntity({ pojo: TPedido, singular: "pedido", plural: "pedidos", cfg: {} });

export const LineaSchema = defineSchema({
  columns: {
    ipedido: { type: "int", pk: true },
    ilinea: { type: "int", pk: true },
    iproducto: { type: "int", nullable: false },
    cantidad: { type: "int", nullable: false },
  },
  relations: {
    producto: { kind: "one", target: "producto", on: { iproducto: "iproducto" } },
    pedido: { kind: "one", target: "pedido", on: { ipedido: "ipedido" } },
  },
});

export class TLinea extends pojoOf(LineaSchema) {
  declare producto: TProducto | null;
  declare pedido: TPedido | null;
}

export const Linea = defineEntity({
  pojo: TLinea,
  singular: "pedido/linea",
  plural: "pedido/lineas",
  hooks: {
    prePost(l) {
      return l.cantidad != null && l.cantidad <= 0 ? "La cantidad debe ser mayor a 0" : null;
    },
  },
});

// ------------------------------------------------------------------ Crisis (singular === plural)

export const CrisisSchema = defineSchema({
  columns: {
    codigo: { type: "string", pk: true, length: 20 },
    descripcion: { type: "text" },
  },
});

export class TCrisis extends pojoOf(CrisisSchema) {}

/** singular === plural → el plural usa `crisis/s` automáticamente. */
export const Crisis = defineEntity({ pojo: TCrisis, singular: "crisis", plural: "crisis" });
