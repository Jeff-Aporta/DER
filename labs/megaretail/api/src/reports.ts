/**
 * Reportes (paths GET). Los datos salen de `query()` de DER (filtros, include anidado, columna calculada `critico`);
 * las agregaciones (ranking, top 10, cubo con subtotales) se calculan aquí porque DER no expone GROUP BY ni ROLLUP.
 */
import { ValidationError, type ServerCtx } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import type { AlertaStock, ClienteFiel, CuboCelda, CuboReport, RankingReport, RankingVendedor } from "./domain/index.ts";
import type { Controllers } from "./schemas.ts";
import { redondear, todas } from "./flows.ts";

/** Fecha ISO de un parámetro de query (o `null` si no viene); inválida → 400. */
function fechaParam(query: URLSearchParams, nombre: string): string | null {
  const v = query.get(nombre);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${nombre} debe ser una fecha ISO 8601`);
  return d.toISOString();
}

/** Entero positivo de un parámetro (o el default). */
function enteroParam(query: URLSearchParams, nombre: string, def: number): number {
  const v = query.get(nombre);
  if (v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError(`${nombre} debe ser un entero >= 1`);
  return n;
}

/** Último trimestre: desde hace tres meses (UTC) hasta ahora. */
export function ultimoTrimestre(ahora = new Date()): { desde: string; hasta: string } {
  const desde = new Date(ahora);
  desde.setUTCMonth(desde.getUTCMonth() - 3);
  return { desde: desde.toISOString(), hasta: ahora.toISOString() };
}

// ===================================================================================== ranking de vendedores

/** Top N (default 3) de vendedores por sede en un periodo (default: último trimestre), con porcentaje sobre el total de la sede. */
export async function rankingVendedores(c: Controllers, query: URLSearchParams, ctx: ServerCtx): Promise<RankingReport> {
  const trimestre = ultimoTrimestre();
  const desde = fechaParam(query, "desde") ?? trimestre.desde;
  const hasta = fechaParam(query, "hasta") ?? trimestre.hasta;
  const top = enteroParam(query, "top", 3);
  const ventas = await todas(c.ventas, { where: { estado: "Completada", fecha_venta: { between: [desde, hasta] } }, include: { vendedor: true, sede: true } }, ctx);
  type Acum = { id_sede: number; sede: string | null; total: number; vendedores: Map<number, { nombre: string | null; ventas: number; total: number }> };
  const sedes = new Map<number, Acum>();
  for (const v of ventas) {
    const id_sede = v.id_sede!;
    const s = sedes.get(id_sede) ?? { id_sede, sede: v.sede?.nombre ?? null, total: 0, vendedores: new Map() };
    const monto = v.total_venta ?? 0;
    s.total += monto;
    const id_vendedor = v.id_vendedor!;
    const ve = s.vendedores.get(id_vendedor) ?? { nombre: v.vendedor?.nombre ?? null, ventas: 0, total: 0 };
    ve.ventas++;
    ve.total += monto;
    s.vendedores.set(id_vendedor, ve);
    sedes.set(id_sede, s);
  }
  const filas: RankingVendedor[] = [];
  const totalPorSede = [...sedes.values()].sort((a, b) => a.id_sede - b.id_sede).map((s) => {
    const orden = [...s.vendedores].sort((a, b) => b[1].total - a[1].total || a[0] - b[0]).slice(0, top);
    orden.forEach(([id_vendedor, ve], i) => filas.push({ id_sede: s.id_sede, sede: s.sede, posicion: i + 1, id_vendedor, vendedor: ve.nombre, ventas: ve.ventas, total: redondear(ve.total), porcentaje: s.total ? redondear((ve.total / s.total) * 100) : 0 }));
    return { id_sede: s.id_sede, sede: s.sede, total: redondear(s.total) };
  });
  return { desde, hasta, top, totalPorSede, filas };
}

// ===================================================================================== alertas de stock

/** Inventarios con `stock_actual < stock_minimo` (columna calculada en SQL) y el proveedor principal (menor costo) de cada producto. */
export async function alertasStock(c: Controllers, ctx: ServerCtx): Promise<AlertaStock[]> {
  const filas = await todas(c.inventarios, { where: { critico: true }, include: { sede: true, producto: { proveedores: { proveedor: true } } }, orderBy: ["id_sede", "id_producto"] }, ctx);
  return filas.map((inv) => {
    const principal = [...(inv.producto?.proveedores ?? [])].sort((a, b) => (a.costo_compra ?? 0) - (b.costo_compra ?? 0))[0];
    return {
      id_sede: inv.id_sede!,
      sede: inv.sede?.nombre ?? null,
      id_producto: inv.id_producto!,
      sku: inv.producto?.sku ?? null,
      producto: inv.producto?.nombre ?? null,
      stock_actual: inv.stock_actual ?? 0,
      stock_minimo: inv.stock_minimo ?? 0,
      faltante: (inv.stock_minimo ?? 0) - (inv.stock_actual ?? 0),
      proveedor: principal ? { id_proveedor: principal.id_proveedor!, razon_social: principal.proveedor?.razon_social ?? null, costo_compra: principal.costo_compra ?? 0 } : null,
    };
  });
}

// ===================================================================================== clientes fieles

/** Top 10 clientes por gasto total (ventas completadas): compras, ticket promedio y sede más frecuente. */
export async function clientesFieles(c: Controllers, query: URLSearchParams, ctx: ServerCtx): Promise<ClienteFiel[]> {
  const top = enteroParam(query, "top", 10);
  const ventas = await todas(c.ventas, { where: { estado: "Completada" }, include: { cliente: true, sede: true } }, ctx);
  type Acum = { id_cliente: number; documento: string | null; nombre: string | null; gasto: number; compras: number; sedes: Map<number, { sede: string | null; compras: number }> };
  const clientes = new Map<number, Acum>();
  for (const v of ventas) {
    const id = v.id_cliente!;
    const a = clientes.get(id) ?? { id_cliente: id, documento: v.cliente?.documento ?? null, nombre: v.cliente?.nombre ?? null, gasto: 0, compras: 0, sedes: new Map() };
    a.gasto += v.total_venta ?? 0;
    a.compras++;
    const s = a.sedes.get(v.id_sede!) ?? { sede: v.sede?.nombre ?? null, compras: 0 };
    s.compras++;
    a.sedes.set(v.id_sede!, s);
    clientes.set(id, a);
  }
  return [...clientes.values()].sort((a, b) => b.gasto - a.gasto || a.id_cliente - b.id_cliente).slice(0, top).map((a) => {
    const frecuente = [...a.sedes].sort((x, y) => y[1].compras - x[1].compras || x[0] - y[0])[0];
    return { id_cliente: a.id_cliente, documento: a.documento, nombre: a.nombre, gasto_total: redondear(a.gasto), compras: a.compras, ticket_promedio: redondear(a.gasto / a.compras), sede_frecuente: frecuente ? { id_sede: frecuente[0], sede: frecuente[1].sede, compras: frecuente[1].compras } : null };
  });
}

// ===================================================================================== cubo sede × categoría

/** Ventas por sede y categoría (unidades y total de los detalles), con subtotal por sede y gran total (ROLLUP calculado aquí). */
export async function cuboVentas(c: Controllers, query: URLSearchParams, ctx: ServerCtx): Promise<CuboReport> {
  const desde = fechaParam(query, "desde");
  const hasta = fechaParam(query, "hasta");
  const where: Record<string, unknown> = { estado: "Completada" };
  if (desde && hasta) where["fecha_venta"] = { between: [desde, hasta] };
  else if (desde) where["fecha_venta"] = { gte: desde };
  else if (hasta) where["fecha_venta"] = { lte: hasta };
  const ventas = await todas(c.ventas, { where, include: { sede: true, detalles: { producto: { categoria: true } } } }, ctx);
  const sedes = new Map<number, string | null>();
  const categorias = new Map<number, string | null>();
  const celdas = new Map<string, CuboCelda>();
  const suma = (key: string, celda: CuboCelda, unidades: number, total: number) => {
    const actual = celdas.get(key) ?? celda;
    actual.unidades += unidades;
    actual.total = redondear(actual.total + total);
    celdas.set(key, actual);
  };
  for (const v of ventas) {
    sedes.set(v.id_sede!, v.sede?.nombre ?? null);
    for (const d of v.detalles ?? []) {
      const cat = d.producto?.categoria;
      const id_categoria = cat?.id_categoria ?? d.producto?.id_categoria ?? 0;
      categorias.set(id_categoria, cat?.nombre ?? null);
      const unidades = d.cantidad ?? 0;
      const total = redondear((d.precio_unitario ?? 0) * unidades - (d.descuento ?? 0));
      suma(`${v.id_sede}:${id_categoria}`, { nivel: "detalle", id_sede: v.id_sede!, sede: v.sede?.nombre ?? null, id_categoria, categoria: cat?.nombre ?? null, unidades: 0, total: 0 }, unidades, total);
      suma(`${v.id_sede}:*`, { nivel: "subtotal", id_sede: v.id_sede!, sede: v.sede?.nombre ?? null, id_categoria: null, categoria: null, unidades: 0, total: 0 }, unidades, total);
      suma("*:*", { nivel: "total", id_sede: null, sede: null, id_categoria: null, categoria: null, unidades: 0, total: 0 }, unidades, total);
    }
  }
  const ordenadas = [...celdas.values()].sort((a, b) => {
    const sa = a.id_sede ?? Number.MAX_SAFE_INTEGER;
    const sb = b.id_sede ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return (a.id_categoria ?? Number.MAX_SAFE_INTEGER) - (b.id_categoria ?? Number.MAX_SAFE_INTEGER);
  });
  return { desde, hasta, sedes: [...sedes.values()].map((s) => s ?? ""), categorias: [...categorias.values()].map((x) => x ?? ""), celdas: ordenadas };
}
