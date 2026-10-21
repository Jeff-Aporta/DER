/**
 * Flujos de negocio transaccionales. Cada uno corre completo dentro de `db.transaction` con el `exec` del ctx: si algo
 * falla (stock insuficiente, entidad inexistente), la transacción se revierte y no queda ninguna fila a medias.
 * Nada de SQL a mano: sólo acciones de los controllers (get/post/put/query/delete).
 */
import { NotFoundError, ValidationError, zodMessage, type QuerySpec, type ServerCtx, type Where } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import type { Pojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { z } from "zod";
import { type AjustePreciosResult, type LimpiezaResult, ZAjustePreciosInput, ZAnulacionInput, ZCompraInput, ZLimpiezaInput, ZTransferenciaInput, ZVentaInput } from "../../domain/index.ts";
import type { Controllers, InventarioSede, Producto, Venta } from "./schemas.ts";

/** Valida un body con el mismo Zod que usa el cliente; un fallo es 400. */
export function validar<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

/** Transacción compartida por todos los controllers de la misma base, conservando la sesión del request en el ctx. */
export function enTransaccion<T>(c: Controllers, ctx: ServerCtx, fn: (tx: ServerCtx) => Promise<T>): Promise<T> {
  if (ctx.inTransaction) return fn(ctx);
  return c.sedes.db.transaction((tx) => fn({ ...ctx, ...tx, state: ctx.state }));
}

/** Todas las filas de una consulta, página a página (tope `maxPageSize` por página). */
export async function todas<P extends Pojo>(ctrl: ServerController<P>, spec: QuerySpec<P>, ctx: Partial<ServerCtx>): Promise<P[]> {
  const out: P[] = [];
  const pageSize = ctrl.entity.maxPageSize;
  for (let page = 1;; page++) {
    const rows = await ctrl.query({ ...spec, page, pageSize }, ctx);
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

/** Redondeo a dos decimales (dinero). */
export function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fila de inventario de la sede/producto; si no existe la crea con stock 0 (dentro de la transacción). */
async function inventarioDe(c: Controllers, id_sede: number, id_producto: number, tx: ServerCtx): Promise<InventarioSede> {
  const actual = await c.inventarios.get({ id_sede, id_producto }, { ...tx, include: {} });
  if (actual) return actual;
  return await c.inventarios.post({ id_sede, id_producto, stock_actual: 0, stock_minimo: 0 }, tx);
}

/** Existencia obligatoria de una entidad por pk (400 con mensaje claro si falta). */
async function exige<P extends Pojo>(ctrl: ServerController<P>, pk: Record<string, unknown>, que: string, tx: ServerCtx): Promise<P> {
  const row = await ctrl.get(pk, { ...tx, include: {} });
  if (!row) throw new ValidationError(`${que} ${Object.values(pk).join("/")} no existe`);
  return row;
}

// ===================================================================================== (1) compra de inventario

/** Entrada de mercancía: movimiento `Entrada` + suma en `inventario_sede` (creando la fila con stock 0 si no existe). */
export async function comprar(c: Controllers, body: unknown, ctx: ServerCtx): Promise<InventarioSede> {
  const input = validar(ZCompraInput, body);
  return await enTransaccion(c, ctx, async (tx) => {
    const sede = await exige(c.sedes, { id_sede: input.id_sede }, "La sede", tx);
    const producto = await exige(c.productos, { id_producto: input.id_producto }, "El producto", tx);
    let nota = input.observaciones ?? `Compra de ${producto.nombre} para ${sede.nombre}`;
    if (input.id_proveedor !== undefined) {
      const proveedor = await exige(c.proveedores, { id_proveedor: input.id_proveedor }, "El proveedor", tx);
      nota = `${nota} (proveedor ${proveedor.razon_social})`;
    }
    const inv = await inventarioDe(c, input.id_sede, input.id_producto, tx);
    await c.movimientos.post({ id_sede: input.id_sede, id_producto: input.id_producto, tipo_movimiento: "Entrada", cantidad: input.cantidad, fecha: new Date().toISOString(), observaciones: nota }, tx);
    const actualizado = await c.inventarios.put({ id_sede: input.id_sede, id_producto: input.id_producto, stock_actual: (inv.stock_actual ?? 0) + input.cantidad }, tx);
    if (!actualizado) throw new NotFoundError("Inventario no encontrado");
    return actualizado;
  });
}

// ===================================================================================== (2) venta transaccional

/**
 * Registra una venta: inserta la cabecera, valida el stock de cada ítem (si alguno falta, lanza y la transacción
 * revierte TODO, cabecera incluida), inserta los detalles, descuenta stock y registra una `Salida` por ítem.
 */
export async function registrarVenta(c: Controllers, body: unknown, ctx: ServerCtx): Promise<Venta> {
  const input = validar(ZVentaInput, body);
  return await enTransaccion(c, ctx, async (tx) => {
    const sede = await exige(c.sedes, { id_sede: input.id_sede }, "La sede", tx);
    const vendedor = await exige(c.vendedores, { id_vendedor: input.id_vendedor }, "El vendedor", tx);
    if (vendedor.id_sede !== input.id_sede) throw new ValidationError(`El vendedor ${vendedor.nombre} no pertenece a la sede ${sede.nombre}`);
    await exige(c.clientes, { id_cliente: input.id_cliente }, "El cliente", tx);
    // ítems repetidos se consolidan por producto (cantidades y descuentos se suman)
    const porProducto = new Map<number, { cantidad: number; descuento: number }>();
    for (const it of input.items) {
      const prev = porProducto.get(it.id_producto) ?? { cantidad: 0, descuento: 0 };
      porProducto.set(it.id_producto, { cantidad: prev.cantidad + it.cantidad, descuento: prev.descuento + (it.descuento ?? 0) });
    }
    const fecha = input.fecha_venta ?? new Date().toISOString();
    const venta = await c.ventas.post({ id_sede: input.id_sede, id_vendedor: input.id_vendedor, id_cliente: input.id_cliente, fecha_venta: fecha, total_venta: 0, estado: "Completada" }, tx);
    let total = 0;
    for (const [id_producto, it] of porProducto) {
      const producto = await exige(c.productos, { id_producto }, "El producto", tx);
      const inv = await c.inventarios.get({ id_sede: input.id_sede, id_producto }, { ...tx, include: {} });
      const stock = inv?.stock_actual ?? 0;
      if (stock < it.cantidad) throw new ValidationError(`Stock insuficiente de "${producto.nombre}" en ${sede.nombre}: hay ${stock} y se piden ${it.cantidad}`);
      const precio = producto.precio_base ?? 0;
      const subtotal = redondear(precio * it.cantidad - it.descuento);
      if (subtotal < 0) throw new ValidationError(`El descuento de "${producto.nombre}" supera el valor del ítem`);
      total += subtotal;
      await c.detalles.post({ id_venta: venta.id_venta, id_producto, cantidad: it.cantidad, precio_unitario: precio, descuento: it.descuento }, tx);
      await c.inventarios.put({ id_sede: input.id_sede, id_producto, stock_actual: stock - it.cantidad }, tx);
      await c.movimientos.post({ id_sede: input.id_sede, id_producto, tipo_movimiento: "Salida", cantidad: it.cantidad, fecha, observaciones: `Venta ${venta.consecutivo}` }, tx);
    }
    await c.ventas.put({ id_venta: venta.id_venta, total_venta: redondear(total) }, tx);
    const completa = await c.ventas.get({ id_venta: venta.id_venta }, tx);
    if (!completa) throw new NotFoundError("Venta no encontrada");
    return completa;
  });
}

// ===================================================================================== (5) transferencia entre sedes

/** Mueve unidades entre sedes: resta en origen (exige stock), suma en destino (creando la fila si falta) y deja dos movimientos `Transferencia`. Atómico. */
export async function transferir(c: Controllers, body: unknown, ctx: ServerCtx): Promise<InventarioSede[]> {
  const input = validar(ZTransferenciaInput, body);
  return await enTransaccion(c, ctx, async (tx) => {
    const origen = await exige(c.sedes, { id_sede: input.id_sede_origen }, "La sede de origen", tx);
    const destino = await exige(c.sedes, { id_sede: input.id_sede_destino }, "La sede de destino", tx);
    const producto = await exige(c.productos, { id_producto: input.id_producto }, "El producto", tx);
    const invOrigen = await c.inventarios.get({ id_sede: input.id_sede_origen, id_producto: input.id_producto }, { ...tx, include: {} });
    const stock = invOrigen?.stock_actual ?? 0;
    if (stock < input.cantidad) throw new ValidationError(`Stock insuficiente de "${producto.nombre}" en ${origen.nombre}: hay ${stock} y se transfieren ${input.cantidad}`);
    const invDestino = await inventarioDe(c, input.id_sede_destino, input.id_producto, tx);
    const fecha = new Date().toISOString();
    const nota = input.observaciones ? ` · ${input.observaciones}` : "";
    const salida = await c.inventarios.put({ id_sede: input.id_sede_origen, id_producto: input.id_producto, stock_actual: stock - input.cantidad }, tx);
    const entrada = await c.inventarios.put({ id_sede: input.id_sede_destino, id_producto: input.id_producto, stock_actual: (invDestino.stock_actual ?? 0) + input.cantidad }, tx);
    await c.movimientos.post({ id_sede: input.id_sede_origen, id_producto: input.id_producto, tipo_movimiento: "Transferencia", cantidad: -input.cantidad, fecha, observaciones: `Hacia ${destino.nombre}${nota}` }, tx);
    await c.movimientos.post({ id_sede: input.id_sede_destino, id_producto: input.id_producto, tipo_movimiento: "Transferencia", cantidad: input.cantidad, fecha, observaciones: `Desde ${origen.nombre}${nota}` }, tx);
    if (!salida || !entrada) throw new NotFoundError("Inventario no encontrado");
    return [salida, entrada];
  });
}

// ===================================================================================== (6) anulación de venta

/** Anula una venta: estado `Anulada`, reintegro del stock de cada detalle y un movimiento `Entrada` inverso por ítem. */
export async function anularVenta(c: Controllers, id_venta: number, body: unknown, ctx: ServerCtx): Promise<Venta> {
  const input = validar(ZAnulacionInput, body);
  if (!Number.isInteger(id_venta)) throw new ValidationError("id_venta inválido");
  return await enTransaccion(c, ctx, async (tx) => {
    const venta = await c.ventas.get({ id_venta }, { ...tx, include: { detalles: true } });
    if (!venta) throw new NotFoundError(`La venta ${id_venta} no existe`);
    if (venta.estado === "Anulada") throw new ValidationError(`La venta ${venta.consecutivo} ya está anulada`);
    const fecha = new Date().toISOString();
    const nota = `Anulación ${venta.consecutivo}${input.motivo ? ` · ${input.motivo}` : ""}`;
    for (const d of venta.detalles ?? []) {
      const inv = await inventarioDe(c, venta.id_sede!, d.id_producto!, tx);
      await c.inventarios.put({ id_sede: venta.id_sede, id_producto: d.id_producto, stock_actual: (inv.stock_actual ?? 0) + (d.cantidad ?? 0) }, tx);
      await c.movimientos.post({ id_sede: venta.id_sede, id_producto: d.id_producto, tipo_movimiento: "Entrada", cantidad: d.cantidad, fecha, observaciones: nota }, tx);
    }
    await c.ventas.put({ id_venta, estado: "Anulada" }, tx);
    const anulada = await c.ventas.get({ id_venta }, tx);
    if (!anulada) throw new NotFoundError("Venta no encontrada");
    return anulada;
  });
}

// ===================================================================================== (4) ajuste de precios

/**
 * Sube el precio base (+5 % por defecto) de los productos de una categoría (Tecnología) cuyo proveedor principal (menor
 * `costo_compra`) subió su costo (`costo_compra > costo_anterior`). Tras ajustar, `costo_anterior` se iguala al actual
 * para no volver a aplicar el mismo aumento.
 */
export async function ajustarPrecios(c: Controllers, body: unknown, ctx: ServerCtx): Promise<AjustePreciosResult> {
  const input = validar(ZAjustePreciosInput, body);
  const categoria = input.categoria ?? "Tecnología";
  const porcentaje = input.porcentaje ?? 5;
  return await enTransaccion(c, ctx, async (tx) => {
    const [cat] = await c.categorias.query({ where: { nombre: categoria }, pageSize: 1 }, tx);
    if (!cat) throw new ValidationError(`La categoría "${categoria}" no existe`);
    const productos = await todas(c.productos, { where: { id_categoria: cat.id_categoria }, include: { proveedores: true } }, tx);
    const resultado: AjustePreciosResult = { categoria, porcentaje, revisados: productos.length, ajustados: [] };
    for (const p of productos) {
      const principal = [...(p.proveedores ?? [])].sort((a, b) => (a.costo_compra ?? 0) - (b.costo_compra ?? 0))[0];
      if (!principal || principal.costo_anterior == null || principal.costo_compra == null) continue;
      if (principal.costo_compra <= principal.costo_anterior) continue;
      const anterior = p.precio_base ?? 0;
      const nuevo = redondear(anterior * (1 + porcentaje / 100));
      await c.productos.put({ id_producto: p.id_producto, precio_base: nuevo }, tx);
      await c.productosProveedores.put({ id_producto: p.id_producto, id_proveedor: principal.id_proveedor, costo_anterior: principal.costo_compra }, tx);
      resultado.ajustados.push({ id_producto: p.id_producto!, sku: p.sku ?? null, nombre: p.nombre ?? null, precio_anterior: anterior, precio_nuevo: nuevo, id_proveedor: principal.id_proveedor!, costo_anterior: principal.costo_anterior, costo_actual: principal.costo_compra });
    }
    return resultado;
  });
}

// ===================================================================================== (6b) limpieza de productos

/**
 * Elimina los productos sin ventas (ningún detalle) y sin movimientos en los últimos N años (default 2), borrando antes
 * sus filas dependientes (inventarios, proveedores del producto y movimientos antiguos) para no dejar huérfanos.
 * Con `dryRun` sólo informa.
 */
export async function limpiarProductos(c: Controllers, body: unknown, ctx: ServerCtx): Promise<LimpiezaResult> {
  const input = validar(ZLimpiezaInput, body);
  const anios = input.anios ?? 2;
  const desde = new Date();
  desde.setUTCFullYear(desde.getUTCFullYear() - anios);
  const desdeIso = desde.toISOString();
  return await enTransaccion(c, ctx, async (tx) => {
    // filtros por relación (EXISTS): sin ningún detalle de venta y sin movimientos desde la fecha de corte
    const where: Where<Producto> = { $and: [{ $not: { detalles: {} } as Where<Producto> }, { $not: { movimientos: { fecha: { gte: desdeIso } } } as Where<Producto> }] };
    const candidatos = await todas(c.productos, { where, orderBy: "id_producto" }, tx);
    const resultado: LimpiezaResult = { dryRun: !!input.dryRun, desde: desdeIso, productos: candidatos.map((p) => ({ id_producto: p.id_producto!, sku: p.sku ?? null, nombre: p.nombre ?? null })), borrados: { productos: 0, inventarios: 0, proveedores: 0, movimientos: 0 } };
    if (input.dryRun) return resultado;
    for (const p of candidatos) {
      const where = { id_producto: p.id_producto };
      const movimientos = await todas(c.movimientos, { where }, tx);
      if (movimientos.length) resultado.borrados.movimientos += (await c.movimientos.deleteList(movimientos, tx)).length;
      const inventarios = await todas(c.inventarios, { where }, tx);
      if (inventarios.length) resultado.borrados.inventarios += (await c.inventarios.deleteList(inventarios, tx)).length;
      const proveedores = await todas(c.productosProveedores, { where }, tx);
      if (proveedores.length) resultado.borrados.proveedores += (await c.productosProveedores.deleteList(proveedores, tx)).length;
      if (await c.productos.delete({ id_producto: p.id_producto }, tx)) resultado.borrados.productos++;
    }
    return resultado;
  });
}
