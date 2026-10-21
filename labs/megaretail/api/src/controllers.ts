/**
 * Controllers de servidor del dominio: SQL sólo en `computed` (columna virtual `critico`); los flujos de negocio y los
 * reportes se cuelgan como handlers de los `paths` declarados en el dominio (`this` = el controller).
 */
import { ServerController, type Database, type ExtraRouteInput, type ServerCtx } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { CategoriaEntity, ClienteEntity, DetalleVentaEntity, InventarioSedeEntity, MovimientoInventarioEntity, ProductoEntity, ProductoProveedorEntity, ProveedorEntity, SedeEntity, VendedorEntity, VentaEntity } from "./domain/index.ts";
import type { Controllers, ProductoProveedor } from "./schemas.ts";
import { ajustarPrecios, anularVenta, comprar, limpiarProductos, registrarVenta, transferir } from "./flows.ts";
import { alertasStock, clientesFieles, cuboVentas, rankingVendedores } from "./reports.ts";

/** Arma los once controllers sobre la base dada; los handlers de los paths reciben el mapa completo por clausura. */
export function buildControllers(db: Database): Controllers {
  const c = {} as Controllers;
  c.sedes = new ServerController(SedeEntity, { db });
  c.proveedores = new ServerController(ProveedorEntity, { db });
  c.categorias = new ServerController(CategoriaEntity, { db });
  c.productos = new ServerController(ProductoEntity, {
    db,
    paths: {
      ajustePrecios: { handler: (input: ExtraRouteInput, ctx: ServerCtx) => ajustarPrecios(c, input.body, ctx) },
      limpieza: { handler: (input: ExtraRouteInput, ctx: ServerCtx) => limpiarProductos(c, input.body, ctx) },
    },
  });
  c.productosProveedores = new ServerController(ProductoProveedorEntity, {
    db,
    actions: {
      /** Al cambiar `costo_compra` se conserva el costo anterior: así "subió su costo" es un hecho consultable. */
      async put(pp: ProductoProveedor, ctx, next) {
        if (pp.costo_compra == null) return next(pp);
        const actual = await c.productosProveedores.get(pp.pkOnly(), { ...ctx, include: {} });
        if (actual && actual.costo_compra != null && actual.costo_compra !== pp.costo_compra) pp.costo_anterior = actual.costo_compra;
        return next(pp);
      },
    },
  });
  c.inventarios = new ServerController(InventarioSedeEntity, {
    db,
    computed: { critico: "{stock_actual} < {stock_minimo}" },
    paths: {
      compra: { handler: (input: ExtraRouteInput, ctx: ServerCtx) => comprar(c, input.body, ctx) },
      transferencia: { handler: (input: ExtraRouteInput, ctx: ServerCtx) => transferir(c, input.body, ctx) },
      alertas: { handler: (_input: ExtraRouteInput, ctx: ServerCtx) => alertasStock(c, ctx) },
    },
  });
  c.vendedores = new ServerController(VendedorEntity, {
    db,
    paths: {
      ranking: { handler: (input: ExtraRouteInput, ctx: ServerCtx) => rankingVendedores(c, input.query, ctx) },
    },
  });
  c.clientes = new ServerController(ClienteEntity, {
    db,
    paths: {
      fieles: { handler: (input: ExtraRouteInput, ctx: ServerCtx) => clientesFieles(c, input.query, ctx) },
    },
  });
  c.ventas = new ServerController(VentaEntity, {
    db,
    defaultOrder: "-fecha_venta",
    paths: {
      registrar: { handler: (input: ExtraRouteInput, ctx: ServerCtx) => registrarVenta(c, input.body, ctx) },
      anular: { handler: (input: ExtraRouteInput, ctx: ServerCtx) => anularVenta(c, Number(input.pks?.[0]), input.body, ctx) },
      cubo: { handler: (input: ExtraRouteInput, ctx: ServerCtx) => cuboVentas(c, input.query, ctx) },
    },
  });
  c.detalles = new ServerController(DetalleVentaEntity, { db });
  c.movimientos = new ServerController(MovimientoInventarioEntity, { db, defaultOrder: "-fecha" });
  return c;
}
