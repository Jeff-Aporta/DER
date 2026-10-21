/**
 * Definiciones COMPARTIDAS (front y back): schemas JSON, POJOs y entidades.
 * Este archivo no importa nada de SQL: el front lo puede importar tal cual.
 */
import { defineEntity, defineSchema, pojoOf, z } from "@Jeff-Aporta/DER/index.ts";

/**
 * Molde Zod del JSON propio de CADA producto (columna `jconfig`). Se ajusta con el PUT singular del producto, que
 * por defecto aplica `insert` (ajustes parciales: una sola llave basta).
 */
export const ZProductoCfg = z.object({
  visible: z.boolean().optional(),
  ui: z.object({ color: z.string().optional(), orden: z.number().int().optional() }).optional(),
  etiquetas: z.array(z.string()).optional(),
});

/**
 * Molde Zod de la configuración de la ENTIDAD productos (`GET/PUT productos/cfg`): sus valores por defecto.
 * Los `.default(...)` son el punto de partida; el PUT sólo ajusta estas llaves (`Obj.update`).
 */
export const ZProductosCfg = z.object({
  moneda: z.string().default("COP"),
  stockMinimo: z.number().int().min(0).default(5),
  catalogo: z.object({ porPagina: z.number().int().min(1).default(24), mostrarAgotados: z.boolean().default(false) })
    .default({ porPagina: 24, mostrarAgotados: false }),
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

export class Categoria extends pojoOf(CategoriaSchema) {
  declare productos: Producto[];
}

export const CategoriaEntity = defineEntity({
  pojo: Categoria,
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

export class Producto extends pojoOf(ProductoSchema) {
  declare categoria: Categoria | null;

  /** Getter propio (no es columna, no se serializa). */
  get etiqueta(): string {
    return `${this.nombre} ($${this.precio})`;
  }
}

export const ProductoEntity = defineEntity({
  pojo: Producto,
  singular: "producto",
  plural: "productos",
  listColumns: ["iproducto", "nombre"],
  getInclude: { categoria: true },
  cfg: { zod: ZProductosCfg },
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

export class Pedido extends pojoOf(PedidoSchema) {
  declare lineas: Linea[];
}

export const PedidoEntity = defineEntity({ pojo: Pedido, singular: "pedido", plural: "pedidos" });

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

export class Linea extends pojoOf(LineaSchema) {
  declare producto: Producto | null;
  declare pedido: Pedido | null;
}

export const LineaEntity = defineEntity({
  pojo: Linea,
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

export class Crisis extends pojoOf(CrisisSchema) {}

/** singular === plural → el plural usa `crisis/s` automáticamente. */
export const CrisisEntity = defineEntity({ pojo: Crisis, singular: "crisis", plural: "crisis" });
