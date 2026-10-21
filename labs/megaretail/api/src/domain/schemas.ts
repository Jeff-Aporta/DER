/**
 * schemas.ts (dominio MegaRetail) — tipos (uno por línea) y contratos Zod de los flujos de negocio.
 * Los comparten el API (validación en el server) y el front (validación antes del fetch con `createClient`).
 * Las entidades viven en `domain.ts`; aquí sólo lo que no es una entidad: cuerpos de los paths y resultados de los reportes.
 */
import { z } from "zod";

/** Cuerpo de `POST inventarios/compra`: entrada de mercancía en una sede (opcionalmente desde un proveedor). */
export type CompraInput = { id_sede: number; id_producto: number; cantidad: number; id_proveedor?: number | undefined; observaciones?: string | undefined };
/** Zod de `CompraInput`. */
export const ZCompraInput: z.ZodType<CompraInput> = z.object({ id_sede: z.number().int().positive(), id_producto: z.number().int().positive(), cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"), id_proveedor: z.number().int().positive().optional(), observaciones: z.string().max(500).optional() }).strict();
/** Ítem del carrito de una venta. */
export type VentaItemInput = { id_producto: number; cantidad: number; descuento?: number | undefined };
/** Cuerpo de `POST ventas/registrar`: cabecera + carrito. `fecha_venta` ISO 8601 (default: ahora). */
export type VentaInput = { id_sede: number; id_vendedor: number; id_cliente: number; fecha_venta?: string | undefined; items: VentaItemInput[] };
/** Zod de `VentaInput` (al menos un ítem, cantidades positivas, descuento no negativo). */
export const ZVentaInput: z.ZodType<VentaInput> = z.object({ id_sede: z.number().int().positive(), id_vendedor: z.number().int().positive(), id_cliente: z.number().int().positive(), fecha_venta: z.string().min(1).optional(), items: z.array(z.object({ id_producto: z.number().int().positive(), cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"), descuento: z.number().min(0).optional() }).strict()).min(1, "La venta necesita al menos un ítem") }).strict();
/** Cuerpo de `POST inventarios/transferencia`: mueve unidades de una sede a otra. */
export type TransferenciaInput = { id_sede_origen: number; id_sede_destino: number; id_producto: number; cantidad: number; observaciones?: string | undefined };
/** Zod de `TransferenciaInput` (sedes distintas). */
export const ZTransferenciaInput: z.ZodType<TransferenciaInput> = z.object({ id_sede_origen: z.number().int().positive(), id_sede_destino: z.number().int().positive(), id_producto: z.number().int().positive(), cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"), observaciones: z.string().max(500).optional() }).strict().refine((t) => t.id_sede_origen !== t.id_sede_destino, { message: "La sede de origen y la de destino deben ser distintas", path: ["id_sede_destino"] });
/** Cuerpo de `POST venta/{id_venta}/anular` (sólo un motivo opcional; la venta va en la ruta). */
export type AnulacionInput = { motivo?: string | undefined };
/** Zod de `AnulacionInput`. */
export const ZAnulacionInput: z.ZodType<AnulacionInput> = z.object({ motivo: z.string().max(500).optional() }).strict();
/** Cuerpo de `POST productos/ajuste-precios`: categoría afectada y porcentaje (default Tecnología, +5 %). */
export type AjustePreciosInput = { categoria?: string | undefined; porcentaje?: number | undefined };
/** Zod de `AjustePreciosInput`. */
export const ZAjustePreciosInput: z.ZodType<AjustePreciosInput> = z.object({ categoria: z.string().min(1).optional(), porcentaje: z.number().gt(-100).lte(1000).optional() }).strict();
/** Resultado del ajuste: productos revisados y los ajustados con su precio anterior y nuevo. */
export type AjustePreciosResult = { categoria: string; porcentaje: number; revisados: number; ajustados: { id_producto: number; sku: string | null; nombre: string | null; precio_anterior: number; precio_nuevo: number; id_proveedor: number; costo_anterior: number; costo_actual: number }[] };
/** Cuerpo de `POST productos/limpieza`: años sin actividad (default 2) y `dryRun` (sólo informa). */
export type LimpiezaInput = { anios?: number | undefined; dryRun?: boolean | undefined };
/** Zod de `LimpiezaInput`. */
export const ZLimpiezaInput: z.ZodType<LimpiezaInput> = z.object({ anios: z.number().int().min(1).max(50).optional(), dryRun: z.boolean().optional() }).strict();
/** Resultado de la limpieza: qué se borró (o se borraría) por tabla. */
export type LimpiezaResult = { dryRun: boolean; desde: string; productos: { id_producto: number; sku: string | null; nombre: string | null }[]; borrados: { productos: number; inventarios: number; proveedores: number; movimientos: number } };
/** Fila del ranking de vendedores: posición dentro de su sede y porcentaje sobre el total de la sede. */
export type RankingVendedor = { id_sede: number; sede: string | null; posicion: number; id_vendedor: number; vendedor: string | null; ventas: number; total: number; porcentaje: number };
/** Reporte de ranking: periodo y filas (top N por sede). */
export type RankingReport = { desde: string; hasta: string; top: number; totalPorSede: { id_sede: number; sede: string | null; total: number }[]; filas: RankingVendedor[] };
/** Alerta de stock crítico con el proveedor principal (menor costo de compra). */
export type AlertaStock = { id_sede: number; sede: string | null; id_producto: number; sku: string | null; producto: string | null; stock_actual: number; stock_minimo: number; faltante: number; proveedor: { id_proveedor: number; razon_social: string | null; costo_compra: number } | null };
/** Cliente fiel: gasto total, compras, ticket promedio y sede más frecuente. */
export type ClienteFiel = { id_cliente: number; documento: string | null; nombre: string | null; gasto_total: number; compras: number; ticket_promedio: number; sede_frecuente: { id_sede: number; sede: string | null; compras: number } | null };
/** Celda del cubo sede × categoría; `nivel` distingue detalle, subtotal de sede y gran total. */
export type CuboCelda = { nivel: "detalle" | "subtotal" | "total"; id_sede: number | null; sede: string | null; id_categoria: number | null; categoria: string | null; unidades: number; total: number };
/** Reporte del cubo de ventas con subtotales por sede y gran total (equivalente a ROLLUP). */
export type CuboReport = { desde: string | null; hasta: string | null; sedes: string[]; categorias: string[]; celdas: CuboCelda[] };
