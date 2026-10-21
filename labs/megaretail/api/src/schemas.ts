/**
 * schemas.ts (api) — tipos del servidor del lab (uno por línea): POJOs de cada entidad, el mapa de controllers y la app armada.
 */
import type { PojoOf, ServerController, ServerPlugin, Router, Database } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import type { CategoriaSchema, ClienteSchema, DetalleVentaSchema, InventarioSedeSchema, MovimientoInventarioSchema, ProductoProveedorSchema, ProductoSchema, ProveedorSchema, SedeSchema, VendedorSchema, VentaSchema } from "./domain/index.ts";

export type Sede = PojoOf<typeof SedeSchema>;
export type Proveedor = PojoOf<typeof ProveedorSchema>;
export type Categoria = PojoOf<typeof CategoriaSchema>;
export type Producto = PojoOf<typeof ProductoSchema> & { categoria?: Categoria | null; proveedores?: ProductoProveedor[] };
export type ProductoProveedor = PojoOf<typeof ProductoProveedorSchema> & { proveedor?: Proveedor | null; producto?: Producto | null };
export type InventarioSede = PojoOf<typeof InventarioSedeSchema> & { sede?: Sede | null; producto?: Producto | null };
export type Vendedor = PojoOf<typeof VendedorSchema> & { sede?: Sede | null };
export type Cliente = PojoOf<typeof ClienteSchema>;
export type Venta = PojoOf<typeof VentaSchema> & { sede?: Sede | null; vendedor?: Vendedor | null; cliente?: Cliente | null; detalles?: DetalleVenta[] };
export type DetalleVenta = PojoOf<typeof DetalleVentaSchema> & { producto?: Producto | null; venta?: Venta | null };
export type MovimientoInventario = PojoOf<typeof MovimientoInventarioSchema>;
/** Un ServerController por entidad del dominio. */
export type Controllers = { sedes: ServerController<Sede>; proveedores: ServerController<Proveedor>; categorias: ServerController<Categoria>; productos: ServerController<Producto>; productosProveedores: ServerController<ProductoProveedor>; inventarios: ServerController<InventarioSede>; vendedores: ServerController<Vendedor>; clientes: ServerController<Cliente>; ventas: ServerController<Venta>; detalles: ServerController<DetalleVenta>; movimientos: ServerController<MovimientoInventario> };
/** Plugins de seguridad armados: identidad (usuarios) y permisos (roles). */
export type SecurityPlugins = { auth: ServerPlugin; permisos: ServerPlugin };
/** Opciones de `buildApp`: `front` = carpeta del front a servir en `GET /app` (default `../front/`). */
export type AppOptions = { front?: URL | undefined };
/** La app armada: base, controllers, plugins, router y el seed completo (tablas + DER de permisos + usuarios de muestra). */
export type App = { db: Database; controllers: Controllers; plugins: SecurityPlugins; router: Router; seed(): Promise<void>; seedDatos(): Promise<void> };
/** Usuario del lab para el selector del front: id, nombre, activo y roles asignados. */
export type UsuarioLab = { iusuario: string; nombre: string | null; bactivo: boolean; roles: string[] };
/** Usuario de muestra que siembra el lab. */
export type UsuarioSemilla = { iusuario: string; nombre: string; email: string; roles: string[] };
