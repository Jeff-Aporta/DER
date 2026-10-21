/**
 * Datos de muestra de MegaRetail (deterministas): 3 sedes, 4 proveedores, 4 categorías, 13 productos (dos obsoletos para
 * la limpieza), inventario por sede, 9 vendedores, 8 clientes y ~40 ventas de los últimos 80 días registradas por el
 * mismo flujo transaccional del API (así el stock y los movimientos quedan coherentes). Idempotente: si ya hay sedes no hace nada.
 */
import type { ServerCtx } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { anularVenta, registrarVenta } from "./flows.ts";
import type { Controllers } from "./schemas.ts";

/** Generador pseudoaleatorio con semilla (LCG): los mismos datos en cada arranque. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Fecha ISO de hace `dias` días (y una hora del día estable). */
function hace(dias: number, hora = 10): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dias);
  d.setUTCHours(hora, 0, 0, 0);
  return d.toISOString();
}

/** `YYYY-MM-DD` de hace `dias` días. */
function fechaHace(dias: number): string {
  return hace(dias).slice(0, 10);
}

/** ¿Ya hay datos? */
export async function haySemilla(c: Controllers): Promise<boolean> {
  return (await c.sedes.query({ pageSize: 1 })).length > 0;
}

/** Siembra los datos de muestra (sólo si la base está vacía). */
export async function seedDatos(c: Controllers): Promise<void> {
  if (await haySemilla(c)) return;
  const ctx = { state: {}, exec: c.sedes.db.kysely } as ServerCtx;
  const rnd = lcg(20261020);
  const sedes = await c.sedes.postList([
    { nombre: "Bogotá Centro", ciudad: "Bogotá", direccion: "Cra 7 # 24-89" },
    { nombre: "Medellín Norte", ciudad: "Medellín", direccion: "Cll 50 # 45-10" },
    { nombre: "Cali Sur", ciudad: "Cali", direccion: "Av Pasoancho # 80-15" },
  ]);
  const proveedores = await c.proveedores.postList([
    { razon_social: "TecnoDistribuciones S.A.S.", nit: "900100100-1", contacto: "ventas@tecnodist.test" },
    { razon_social: "ElectroMundo Ltda.", nit: "900200200-2", contacto: "comercial@electromundo.test" },
    { razon_social: "Alimentos del Valle S.A.", nit: "900300300-3", contacto: "pedidos@alvalle.test" },
    { razon_social: "Hogar y Deporte Import", nit: "900400400-4", contacto: "import@hogardeporte.test" },
  ]);
  const categorias = await c.categorias.postList([{ nombre: "Tecnología" }, { nombre: "Hogar" }, { nombre: "Alimentos" }, { nombre: "Deportes" }]);
  const cat = (n: string) => categorias.find((x) => x.nombre === n)!.id_categoria!;
  const prov = (i: number) => proveedores[i]!.id_proveedor!;
  const productos = await c.productos.postList([
    { id_categoria: cat("Tecnología"), sku: "TEC-001", nombre: "Portátil 14\" i5 16GB", precio_base: 2800000 },
    { id_categoria: cat("Tecnología"), sku: "TEC-002", nombre: "Audífonos Bluetooth", precio_base: 180000 },
    { id_categoria: cat("Tecnología"), sku: "TEC-003", nombre: "Monitor 24\" IPS", precio_base: 750000 },
    { id_categoria: cat("Tecnología"), sku: "TEC-004", nombre: "Teclado mecánico", precio_base: 260000 },
    { id_categoria: cat("Hogar"), sku: "HOG-001", nombre: "Licuadora 600W", precio_base: 190000 },
    { id_categoria: cat("Hogar"), sku: "HOG-002", nombre: "Juego de sábanas", precio_base: 120000 },
    { id_categoria: cat("Hogar"), sku: "HOG-003", nombre: "Lámpara LED de escritorio", precio_base: 65000 },
    { id_categoria: cat("Alimentos"), sku: "ALI-001", nombre: "Café 500 g", precio_base: 28000 },
    { id_categoria: cat("Alimentos"), sku: "ALI-002", nombre: "Aceite 3 L", precio_base: 42000 },
    { id_categoria: cat("Deportes"), sku: "DEP-001", nombre: "Balón de fútbol", precio_base: 85000 },
    { id_categoria: cat("Deportes"), sku: "DEP-002", nombre: "Bicicleta estática", precio_base: 1200000 },
    { id_categoria: cat("Deportes"), sku: "DEP-099", nombre: "Patines retro (descontinuado)", precio_base: 150000 },
    { id_categoria: cat("Tecnología"), sku: "TEC-099", nombre: "Tablet 7\" (descontinuada)", precio_base: 320000 },
  ]);
  const prod = (sku: string) => productos.find((p) => p.sku === sku)!.id_producto!;
  const activos = productos.filter((p) => !p.sku!.endsWith("-099"));
  // proveedores por producto: Tecnología con dos (TecnoDistribuciones más barato), el resto con uno.
  // `costo_anterior` simula el historial: TEC-001 y TEC-003 subieron de costo; TEC-002 bajó; TEC-004 sin historial.
  await c.productosProveedores.postList([
    { id_producto: prod("TEC-001"), id_proveedor: prov(0), costo_compra: 2100000, costo_anterior: 1950000 },
    { id_producto: prod("TEC-001"), id_proveedor: prov(1), costo_compra: 2250000 },
    { id_producto: prod("TEC-002"), id_proveedor: prov(0), costo_compra: 95000, costo_anterior: 110000 },
    { id_producto: prod("TEC-002"), id_proveedor: prov(1), costo_compra: 120000 },
    { id_producto: prod("TEC-003"), id_proveedor: prov(1), costo_compra: 520000, costo_anterior: 480000 },
    { id_producto: prod("TEC-003"), id_proveedor: prov(0), costo_compra: 560000 },
    { id_producto: prod("TEC-004"), id_proveedor: prov(0), costo_compra: 170000 },
    { id_producto: prod("HOG-001"), id_proveedor: prov(3), costo_compra: 120000 },
    { id_producto: prod("HOG-002"), id_proveedor: prov(3), costo_compra: 70000 },
    { id_producto: prod("HOG-003"), id_proveedor: prov(3), costo_compra: 30000 },
    { id_producto: prod("ALI-001"), id_proveedor: prov(2), costo_compra: 17000 },
    { id_producto: prod("ALI-002"), id_proveedor: prov(2), costo_compra: 29000 },
    { id_producto: prod("DEP-001"), id_proveedor: prov(3), costo_compra: 50000 },
    { id_producto: prod("DEP-002"), id_proveedor: prov(3), costo_compra: 800000 },
    { id_producto: prod("TEC-099"), id_proveedor: prov(1), costo_compra: 200000 },
  ]);
  // inventario inicial: amplio para que las ventas de muestra no fallen; tres casos críticos a propósito
  const inventario: { id_sede: number; id_producto: number; stock_actual: number; stock_minimo: number }[] = [];
  for (const s of sedes) {
    for (const p of activos) inventario.push({ id_sede: s.id_sede!, id_producto: p.id_producto!, stock_actual: 60 + Math.floor(rnd() * 80), stock_minimo: 5 + Math.floor(rnd() * 10) });
  }
  const critico = (sede: number, sku: string, stock: number, minimo: number) => {
    const row = inventario.find((i) => i.id_sede === sedes[sede]!.id_sede && i.id_producto === prod(sku))!;
    row.stock_actual = stock;
    row.stock_minimo = minimo;
  };
  critico(0, "TEC-003", 2, 6);
  critico(2, "ALI-001", 0, 20);
  critico(1, "DEP-002", 1, 3);
  await c.inventarios.postList(inventario);
  // producto obsoleto con un único movimiento viejo (hace 3 años): candidato a limpieza; el otro no tiene nada
  await c.inventarios.post({ id_sede: sedes[0]!.id_sede, id_producto: prod("DEP-099"), stock_actual: 4, stock_minimo: 0 });
  await c.movimientos.post({ id_sede: sedes[0]!.id_sede, id_producto: prod("DEP-099"), tipo_movimiento: "Entrada", cantidad: 4, fecha: hace(365 * 3), observaciones: "Compra histórica" });
  const vendedores = await c.vendedores.postList([
    { id_sede: sedes[0]!.id_sede, nombre: "Laura Gómez", email: "laura@megaretail.test", fecha_contratacion: fechaHace(900) },
    { id_sede: sedes[0]!.id_sede, nombre: "Miguel Torres", email: "miguel@megaretail.test", fecha_contratacion: fechaHace(400) },
    { id_sede: sedes[0]!.id_sede, nombre: "Sofía Ramírez", email: "sofia@megaretail.test", fecha_contratacion: fechaHace(120) },
    { id_sede: sedes[1]!.id_sede, nombre: "Juan Pérez", email: "juan@megaretail.test", fecha_contratacion: fechaHace(700) },
    { id_sede: sedes[1]!.id_sede, nombre: "Paula Díaz", email: "paula@megaretail.test", fecha_contratacion: fechaHace(300) },
    { id_sede: sedes[1]!.id_sede, nombre: "Andrés Mora", email: "andres@megaretail.test", fecha_contratacion: fechaHace(60) },
    { id_sede: sedes[2]!.id_sede, nombre: "Camila Ruiz", email: "camila@megaretail.test", fecha_contratacion: fechaHace(500) },
    { id_sede: sedes[2]!.id_sede, nombre: "Diego Castro", email: "diego@megaretail.test", fecha_contratacion: fechaHace(200) },
    { id_sede: sedes[2]!.id_sede, nombre: "Valeria León", email: "valeria@megaretail.test", fecha_contratacion: fechaHace(30) },
  ]);
  const clientes = await c.clientes.postList([
    { documento: "1010101010", nombre: "Carlos Mendoza", email: "carlos@cliente.test", fecha_registro: fechaHace(800) },
    { documento: "2020202020", nombre: "María Fernanda López", email: "mafe@cliente.test", fecha_registro: fechaHace(600) },
    { documento: "3030303030", nombre: "Jorge Herrera", email: "jorge@cliente.test", fecha_registro: fechaHace(450) },
    { documento: "4040404040", nombre: "Lucía Vargas", email: "lucia@cliente.test", fecha_registro: fechaHace(300) },
    { documento: "5050505050", nombre: "Esteban Rojas", email: "esteban@cliente.test", fecha_registro: fechaHace(200) },
    { documento: "6060606060", nombre: "Natalia Ortiz", email: "natalia@cliente.test", fecha_registro: fechaHace(150) },
    { documento: "7070707070", nombre: "Ricardo Salazar", email: "ricardo@cliente.test", fecha_registro: fechaHace(90) },
    { documento: "8080808080", nombre: "Daniela Cárdenas", email: "daniela@cliente.test", fecha_registro: fechaHace(20) },
  ]);
  // ventas: 42 en los últimos 80 días + 3 de hace 5 meses (fuera del último trimestre), por el flujo transaccional
  const elegir = <T>(lista: T[]): T => lista[Math.floor(rnd() * lista.length)]!;
  const ventasIds: number[] = [];
  const diasLista = [...Array.from({ length: 42 }, () => Math.floor(rnd() * 80)), 150, 155, 160];
  for (const dias of diasLista) {
    const sede = elegir(sedes);
    const vendedor = elegir(vendedores.filter((v) => v.id_sede === sede.id_sede));
    const cliente = elegir(clientes);
    const n = 1 + Math.floor(rnd() * 3);
    // los tres casos críticos (stock bajo a propósito) no se venden: así siguen críticos para el reporte de alertas
    const vendibles = activos.filter((p) => inventario.find((i) => i.id_sede === sede.id_sede && i.id_producto === p.id_producto)!.stock_actual >= 20);
    const items = Array.from({ length: n }, () => {
      const p = elegir(vendibles);
      const cantidad = 1 + Math.floor(rnd() * 3);
      const descuento = rnd() < 0.25 ? Math.round((p.precio_base ?? 0) * 0.05) : 0;
      return { id_producto: p.id_producto!, cantidad, descuento };
    });
    const v = await registrarVenta(c, { id_sede: sede.id_sede, id_vendedor: vendedor.id_vendedor, id_cliente: cliente.id_cliente, fecha_venta: hace(dias, 9 + Math.floor(rnd() * 9)), items }, ctx);
    ventasIds.push(v.id_venta!);
  }
  for (const id of [ventasIds[3]!, ventasIds[17]!]) await anularVenta(c, id, { motivo: "Devolución del cliente" }, ctx);
}
