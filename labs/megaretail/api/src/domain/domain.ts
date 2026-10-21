/**
 * domain.ts — el DER de MegaRetail Global S.A. definido UNA vez (schemas JSON + entidades) y compartido por `api/` y `front/`.
 *
 * Once entidades: sede, proveedor, categoria, producto, producto_proveedor (N:M), inventario_sede, vendedor, cliente,
 * venta, detalle_venta y movimiento_inventario. Las relaciones son `one` (N:1) o `many` (1:N). Las claves son
 * autoincrement; la venta además lleva un consecutivo por secuencia (`VTA-000001`). `security: true` en todas: cada
 * ruta exige sesión (la cabecera `x-usuario` del lab) y pasa por el plugin de permisos.
 *
 * Los flujos de negocio son `paths` de las entidades (JSON transversal con su Zod): el server pone el handler y el
 * front los llama con `createClient(megaretail).call("registrarVenta", …)`.
 */
import { defineEntity, defineSchema, type PluginDef, type PluginEntity } from "@Jeff-Aporta/DER/index.ts";
import { ZAjustePreciosInput, ZAnulacionInput, ZCompraInput, ZLimpiezaInput, ZTransferenciaInput, ZVentaInput } from "./schemas.ts";

/** Columna de dinero: decimal con dos decimales. */
const dinero = { type: "decimal", precision: 14, scale: 2, nullable: false } as const;

// ===================================================================================== sede

export const SedeSchema = defineSchema({
  columns: {
    id_sede: { type: "int", pk: true, autoincrement: true },
    nombre: { type: "string", length: 120, nullable: false },
    ciudad: { type: "string", length: 80, nullable: false },
    direccion: { type: "string", length: 200 },
  },
  relations: {
    vendedores: { kind: "many", target: "vendedor", on: { id_sede: "id_sede" } },
    ventas: { kind: "many", target: "venta", on: { id_sede: "id_sede" } },
    inventarios: { kind: "many", target: "inventario_sede", on: { id_sede: "id_sede" } },
    movimientos: { kind: "many", target: "movimiento_inventario", on: { id_sede: "id_sede" } },
  },
});

export const SedeEntity = defineEntity({ schema: SedeSchema, singular: "sede", plural: "sedes", name: "sede", security: true, exposed: true, administrable: true });

// ===================================================================================== proveedor

export const ProveedorSchema = defineSchema({
  columns: {
    id_proveedor: { type: "int", pk: true, autoincrement: true },
    razon_social: { type: "string", length: 160, nullable: false },
    nit: { type: "string", length: 30, nullable: false, unique: true },
    contacto: { type: "string", length: 160 },
  },
  relations: {
    productos: { kind: "many", target: "producto_proveedor", on: { id_proveedor: "id_proveedor" } },
  },
});

export const ProveedorEntity = defineEntity({ schema: ProveedorSchema, singular: "proveedor", plural: "proveedores", name: "proveedor", security: true, exposed: true, administrable: true });

// ===================================================================================== categoria

export const CategoriaSchema = defineSchema({
  columns: {
    id_categoria: { type: "int", pk: true, autoincrement: true },
    nombre: { type: "string", length: 80, nullable: false, unique: true },
  },
  relations: {
    productos: { kind: "many", target: "producto", on: { id_categoria: "id_categoria" } },
  },
});

export const CategoriaEntity = defineEntity({ schema: CategoriaSchema, singular: "categoria", plural: "categorias", name: "categoria", security: true, exposed: true, administrable: true });

// ===================================================================================== producto

export const ProductoSchema = defineSchema({
  columns: {
    id_producto: { type: "int", pk: true, autoincrement: true },
    id_categoria: { type: "int", nullable: false },
    sku: { type: "string", length: 40, nullable: false, unique: true },
    nombre: { type: "string", length: 160, nullable: false },
    precio_base: dinero,
  },
  relations: {
    categoria: { kind: "one", target: "categoria", on: { id_categoria: "id_categoria" } },
    proveedores: { kind: "many", target: "producto_proveedor", on: { id_producto: "id_producto" } },
    inventarios: { kind: "many", target: "inventario_sede", on: { id_producto: "id_producto" } },
    detalles: { kind: "many", target: "detalle_venta", on: { id_producto: "id_producto" } },
    movimientos: { kind: "many", target: "movimiento_inventario", on: { id_producto: "id_producto" } },
  },
});

export const ProductoEntity = defineEntity({
  schema: ProductoSchema,
  singular: "producto",
  plural: "productos",
  name: "producto",
  listColumns: ["id_producto", "id_categoria", "sku", "nombre", "precio_base"],
  getInclude: { categoria: true },
  hooks: {
    prePost(p) {
      return p.precio_base != null && p.precio_base < 0 ? "El precio base no puede ser negativo" : null;
    },
    prePut(p) {
      return p.precio_base != null && p.precio_base < 0 ? "El precio base no puede ser negativo" : null;
    },
  },
  paths: {
    ajustePrecios: { method: "POST", path: "ajuste-precios", security: true, zod: ZAjustePreciosInput, returns: "json" },
    limpieza: { method: "POST", path: "limpieza", security: true, zod: ZLimpiezaInput, returns: "json" },
  },
  security: true,
  exposed: true,
  administrable: true,
});

// ===================================================================================== producto_proveedor (N:M)

export const ProductoProveedorSchema = defineSchema({
  columns: {
    id_producto: { type: "int", pk: true },
    id_proveedor: { type: "int", pk: true },
    costo_compra: dinero,
    /** Costo anterior al último cambio (lo deja el server al actualizar `costo_compra`): permite saber si el proveedor subió su costo. */
    costo_anterior: { type: "decimal", precision: 14, scale: 2 },
  },
  relations: {
    producto: { kind: "one", target: "producto", on: { id_producto: "id_producto" } },
    proveedor: { kind: "one", target: "proveedor", on: { id_proveedor: "id_proveedor" } },
  },
});

export const ProductoProveedorEntity = defineEntity({
  schema: ProductoProveedorSchema,
  singular: "producto-proveedor",
  plural: "productos-proveedores",
  name: "producto_proveedor",
  table: "productos_proveedores",
  hooks: {
    prePost(pp) {
      return pp.costo_compra != null && pp.costo_compra < 0 ? "El costo de compra no puede ser negativo" : null;
    },
  },
  security: true,
  exposed: true,
  administrable: true,
});

// ===================================================================================== inventario_sede

export const InventarioSedeSchema = defineSchema({
  columns: {
    id_sede: { type: "int", pk: true },
    id_producto: { type: "int", pk: true },
    stock_actual: { type: "int", nullable: false, default: 0 },
    stock_minimo: { type: "int", nullable: false, default: 0 },
    /** Calculada en el server: `stock_actual < stock_minimo`. */
    critico: { type: "bool", virtual: true },
  },
  relations: {
    sede: { kind: "one", target: "sede", on: { id_sede: "id_sede" } },
    producto: { kind: "one", target: "producto", on: { id_producto: "id_producto" } },
  },
});

export const InventarioSedeEntity = defineEntity({
  schema: InventarioSedeSchema,
  singular: "inventario",
  plural: "inventarios",
  name: "inventario_sede",
  table: "inventarios_sede",
  hooks: {
    prePost(i) {
      return (i.stock_actual ?? 0) < 0 || (i.stock_minimo ?? 0) < 0 ? "El stock no puede ser negativo" : null;
    },
    prePut(i) {
      return (i.stock_actual ?? 0) < 0 || (i.stock_minimo ?? 0) < 0 ? "El stock no puede ser negativo" : null;
    },
  },
  paths: {
    compra: { method: "POST", path: "compra", security: true, zod: ZCompraInput, returns: "pojo" },
    transferencia: { method: "POST", path: "transferencia", security: true, zod: ZTransferenciaInput, returns: "list" },
    alertas: { method: "GET", path: "alertas", security: true, returns: "json" },
  },
  security: true,
  exposed: true,
  administrable: true,
});

// ===================================================================================== vendedor

export const VendedorSchema = defineSchema({
  columns: {
    id_vendedor: { type: "int", pk: true, autoincrement: true },
    id_sede: { type: "int", nullable: false },
    nombre: { type: "string", length: 160, nullable: false },
    email: { type: "string", length: 160 },
    fecha_contratacion: { type: "date" },
  },
  relations: {
    sede: { kind: "one", target: "sede", on: { id_sede: "id_sede" } },
    ventas: { kind: "many", target: "venta", on: { id_vendedor: "id_vendedor" } },
  },
});

export const VendedorEntity = defineEntity({
  schema: VendedorSchema,
  singular: "vendedor",
  plural: "vendedores",
  name: "vendedor",
  getInclude: { sede: true },
  paths: {
    ranking: { method: "GET", path: "ranking", security: true, returns: "json" },
  },
  security: true,
  exposed: true,
  administrable: true,
});

// ===================================================================================== cliente

export const ClienteSchema = defineSchema({
  columns: {
    id_cliente: { type: "int", pk: true, autoincrement: true },
    documento: { type: "string", length: 30, nullable: false, unique: true },
    nombre: { type: "string", length: 160, nullable: false },
    email: { type: "string", length: 160 },
    fecha_registro: { type: "date" },
  },
  relations: {
    ventas: { kind: "many", target: "venta", on: { id_cliente: "id_cliente" } },
  },
});

export const ClienteEntity = defineEntity({
  schema: ClienteSchema,
  singular: "cliente",
  plural: "clientes",
  name: "cliente",
  paths: {
    fieles: { method: "GET", path: "fieles", security: true, returns: "json" },
  },
  security: true,
  exposed: true,
  administrable: true,
});

// ===================================================================================== venta

/** Estados de una venta. */
export const ESTADOS_VENTA = ["Completada", "Anulada"] as const;

export const VentaSchema = defineSchema({
  columns: {
    id_venta: { type: "int", pk: true, autoincrement: true },
    consecutivo: { type: "string", length: 20, sequence: { name: "ventas_consecutivo", pattern: "VTA-{n:6}" } },
    id_sede: { type: "int", nullable: false },
    id_vendedor: { type: "int", nullable: false },
    id_cliente: { type: "int", nullable: false },
    fecha_venta: { type: "datetime", nullable: false },
    total_venta: { ...dinero, default: 0 },
    estado: { type: "string", length: 20, enum: ESTADOS_VENTA, default: "Completada" },
  },
  relations: {
    sede: { kind: "one", target: "sede", on: { id_sede: "id_sede" } },
    vendedor: { kind: "one", target: "vendedor", on: { id_vendedor: "id_vendedor" } },
    cliente: { kind: "one", target: "cliente", on: { id_cliente: "id_cliente" } },
    detalles: { kind: "many", target: "detalle_venta", on: { id_venta: "id_venta" } },
  },
});

/** Las ventas sólo se crean y anulan por sus flujos (`registrar`, `anular`): el CRUD es de lectura (`administrable: false`). */
export const VentaEntity = defineEntity({
  schema: VentaSchema,
  singular: "venta",
  plural: "ventas",
  name: "venta",
  getInclude: { detalles: { producto: true }, cliente: true, vendedor: true, sede: true },
  paths: {
    registrar: { method: "POST", path: "registrar", security: true, zod: ZVentaInput, returns: "pojo" },
    anular: { method: "POST", path: "anular", prefix: "singular", pks: true, security: true, zod: ZAnulacionInput, returns: "pojo" },
    cubo: { method: "GET", path: "cubo", security: true, returns: "json" },
  },
  security: true,
  exposed: true,
  administrable: false,
});

// ===================================================================================== detalle_venta

export const DetalleVentaSchema = defineSchema({
  columns: {
    id_detalle: { type: "int", pk: true, autoincrement: true },
    id_venta: { type: "int", nullable: false },
    id_producto: { type: "int", nullable: false },
    cantidad: { type: "int", nullable: false },
    precio_unitario: dinero,
    descuento: { ...dinero, default: 0 },
  },
  relations: {
    venta: { kind: "one", target: "venta", on: { id_venta: "id_venta" } },
    producto: { kind: "one", target: "producto", on: { id_producto: "id_producto" } },
  },
});

export const DetalleVentaEntity = defineEntity({
  schema: DetalleVentaSchema,
  singular: "detalle",
  plural: "detalles",
  name: "detalle_venta",
  table: "detalles_venta",
  getInclude: { producto: true },
  security: true,
  exposed: true,
  administrable: false,
});

// ===================================================================================== movimiento_inventario

/** Tipos de movimiento de inventario. */
export const TIPOS_MOVIMIENTO = ["Entrada", "Salida", "Transferencia", "Merma"] as const;

export const MovimientoInventarioSchema = defineSchema({
  columns: {
    id_movimiento: { type: "int", pk: true, autoincrement: true },
    id_sede: { type: "int", nullable: false },
    id_producto: { type: "int", nullable: false },
    tipo_movimiento: { type: "string", length: 20, enum: TIPOS_MOVIMIENTO, nullable: false },
    cantidad: { type: "int", nullable: false },
    fecha: { type: "datetime", nullable: false },
    observaciones: { type: "text" },
  },
  relations: {
    sede: { kind: "one", target: "sede", on: { id_sede: "id_sede" } },
    producto: { kind: "one", target: "producto", on: { id_producto: "id_producto" } },
  },
});

/** Los movimientos los escriben los flujos (compra, venta, transferencia, anulación): lectura por CRUD, Merma por POST directo no se expone. */
export const MovimientoInventarioEntity = defineEntity({
  schema: MovimientoInventarioSchema,
  singular: "movimiento",
  plural: "movimientos",
  name: "movimiento_inventario",
  table: "movimientos_inventario",
  getInclude: { producto: true, sede: true },
  security: true,
  exposed: true,
  administrable: false,
});

// ===================================================================================== plugin JSON (lado cliente)

/** Las once entidades, por su clave de plugin. */
export const ENTIDADES = {
  sedes: SedeEntity,
  proveedores: ProveedorEntity,
  categorias: CategoriaEntity,
  productos: ProductoEntity,
  productosProveedores: ProductoProveedorEntity,
  inventarios: InventarioSedeEntity,
  vendedores: VendedorEntity,
  clientes: ClienteEntity,
  ventas: VentaEntity,
  detalles: DetalleVentaEntity,
  movimientos: MovimientoInventarioEntity,
} as const;

/** La `EntityDef` como `PluginEntity` (misma `name`, así `createClient` reusa la entidad ya registrada). */
function comoPluginEntity(e: typeof SedeEntity | typeof ProductoEntity | typeof VentaEntity | typeof InventarioSedeEntity | typeof VendedorEntity | typeof ClienteEntity | typeof ProveedorEntity | typeof CategoriaEntity | typeof ProductoProveedorEntity | typeof DetalleVentaEntity | typeof MovimientoInventarioEntity): PluginEntity {
  const def = e.def;
  return { ...def, schema: def.schema!, name: e.name, exposed: def.exposed !== false, administrable: def.administrable !== false };
}

/**
 * JSON del plugin "megaretail" para el front: `createClient(megaretail, { baseUrl, headers })` entrega un ClientController por
 * entidad y `call("registrar" | "compra" | "transferencia" | "anular" | "ajustePrecios" | "limpieza" | "ranking" | "alertas" | "fieles" | "cubo", body, pks?)`.
 */
export const megaretail: PluginDef = {
  name: "megaretail",
  entities: Object.fromEntries(Object.entries(ENTIDADES).map(([k, e]) => [k, comoPluginEntity(e)])),
};
