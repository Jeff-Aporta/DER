/** Flujos transaccionales: compra, venta (con rollback), transferencia, anulación, ajuste de precios y limpieza. */
import { assert, assertEquals, assertMatch } from "@std/assert";
import { appDePrueba, at, call } from "./_setup.ts";

Deno.test("compra: Entrada en movimientos y suma en inventario (creando la fila si no existe)", async () => {
  const app = await appDePrueba();
  try {
    const c = app.controllers;
    const sede = at(await c.sedes.list(), 0);
    const [obsoleto] = await c.productos.query({ where: { sku: "TEC-099" } });
    assert(obsoleto);
    assertEquals(await c.inventarios.get({ id_sede: sede.id_sede, id_producto: obsoleto.id_producto }), null);
    const r = await call(app, "POST", "inventarios/compra", { usuario: "beto", body: { id_sede: sede.id_sede, id_producto: obsoleto.id_producto, cantidad: 7, id_proveedor: 2 } });
    assertEquals(r.status, 200, JSON.stringify(r.data));
    assertEquals(r.data.stock_actual, 7);
    const movs = await c.movimientos.query({ where: { id_sede: sede.id_sede, id_producto: obsoleto.id_producto, tipo_movimiento: "Entrada" } });
    assertEquals(movs.length, 1);
    assertMatch(String(at(movs, 0).observaciones), /ElectroMundo/);
    const r2 = await call(app, "POST", "inventarios/compra", { usuario: "beto", body: { id_sede: sede.id_sede, id_producto: obsoleto.id_producto, cantidad: 3 } });
    assertEquals(r2.data.stock_actual, 10);
    const malo = await call(app, "POST", "inventarios/compra", { usuario: "beto", body: { id_sede: sede.id_sede, id_producto: obsoleto.id_producto, cantidad: 0 } });
    assertEquals(malo.status, 400);
  } finally {
    await app.db.destroy();
  }
});

Deno.test("venta: inserta cabecera + detalles, descuenta stock y registra Salidas; sin stock revierte TODO", async () => {
  const app = await appDePrueba();
  try {
    const c = app.controllers;
    const sede = at(await c.sedes.list(), 0);
    const vendedor = at(await c.vendedores.query({ where: { id_sede: sede.id_sede } }), 0);
    const cliente = at(await c.clientes.list(), 0);
    const [cafe] = await c.productos.query({ where: { sku: "ALI-001" } });
    const [balon] = await c.productos.query({ where: { sku: "DEP-001" } });
    assert(cafe && balon);
    const invCafe = (await c.inventarios.get({ id_sede: sede.id_sede, id_producto: cafe.id_producto }))!;
    const invBalon = (await c.inventarios.get({ id_sede: sede.id_sede, id_producto: balon.id_producto }))!;
    const ventasAntes = (await c.ventas.list()).length;
    const movsAntes = (await c.movimientos.list()).length;
    // venta correcta
    const ok = await call(app, "POST", "ventas/registrar", { usuario: "ana", body: { id_sede: sede.id_sede, id_vendedor: vendedor.id_vendedor, id_cliente: cliente.id_cliente, items: [{ id_producto: cafe.id_producto, cantidad: 2 }, { id_producto: balon.id_producto, cantidad: 1, descuento: 5000 }] } });
    assertEquals(ok.status, 200, JSON.stringify(ok.data));
    assertEquals(ok.data.estado, "Completada");
    assertMatch(ok.data.consecutivo, /^VTA-\d{6}$/);
    assertEquals(ok.data.total_venta, 2 * cafe.precio_base! + balon.precio_base! - 5000);
    assertEquals(ok.data.detalles.length, 2);
    assertEquals((await c.inventarios.get({ id_sede: sede.id_sede, id_producto: cafe.id_producto }))!.stock_actual, invCafe.stock_actual! - 2);
    assertEquals((await c.inventarios.get({ id_sede: sede.id_sede, id_producto: balon.id_producto }))!.stock_actual, invBalon.stock_actual! - 1);
    assertEquals((await c.movimientos.query({ where: { tipo_movimiento: "Salida", observaciones: { contains: ok.data.consecutivo } } })).length, 2);
    // venta con un ítem sin stock: nada queda escrito (ni cabecera, ni detalles, ni movimientos, ni stock del primer ítem)
    const stockCafe = (await c.inventarios.get({ id_sede: sede.id_sede, id_producto: cafe.id_producto }))!.stock_actual!;
    const ventasMedio = (await c.ventas.list()).length;
    const movsMedio = (await c.movimientos.list()).length;
    const mal = await call(app, "POST", "ventas/registrar", { usuario: "ana", body: { id_sede: sede.id_sede, id_vendedor: vendedor.id_vendedor, id_cliente: cliente.id_cliente, items: [{ id_producto: cafe.id_producto, cantidad: 1 }, { id_producto: balon.id_producto, cantidad: 999999 }] } });
    assertEquals(mal.status, 400);
    assertMatch(mal.data.error, /Stock insuficiente/);
    assertEquals((await c.ventas.list()).length, ventasMedio);
    assertEquals(ventasMedio, ventasAntes + 1);
    assertEquals((await c.movimientos.list()).length, movsMedio);
    assertEquals(movsMedio, movsAntes + 2);
    assertEquals((await c.inventarios.get({ id_sede: sede.id_sede, id_producto: cafe.id_producto }))!.stock_actual, stockCafe);
    assertEquals((await c.detalles.query({ where: { id_venta: { gt: ok.data.id_venta } } })).length, 0);
    // vendedor de otra sede
    const otro = at(await c.vendedores.query({ where: { id_sede: { ne: sede.id_sede } } }), 0);
    const cruzado = await call(app, "POST", "ventas/registrar", { usuario: "ana", body: { id_sede: sede.id_sede, id_vendedor: otro.id_vendedor, id_cliente: cliente.id_cliente, items: [{ id_producto: cafe.id_producto, cantidad: 1 }] } });
    assertEquals(cruzado.status, 400);
    assertMatch(cruzado.data.error, /no pertenece/);
  } finally {
    await app.db.destroy();
  }
});

Deno.test("transferencia: resta en origen, suma en destino (creando la fila) y deja dos movimientos; atómica si falta stock", async () => {
  const app = await appDePrueba();
  try {
    const c = app.controllers;
    const sedes = await c.sedes.list();
    const [obsoleto] = await c.productos.query({ where: { sku: "DEP-099" } });
    assert(obsoleto);
    const origen = at(sedes, 0);
    const destino = at(sedes, 1);
    await call(app, "POST", "inventarios/compra", { body: { id_sede: origen.id_sede, id_producto: obsoleto.id_producto, cantidad: 60 } });
    const antes = (await c.inventarios.get({ id_sede: origen.id_sede, id_producto: obsoleto.id_producto }))!.stock_actual!;
    assertEquals(await c.inventarios.get({ id_sede: destino.id_sede, id_producto: obsoleto.id_producto }), null);
    const r = await call(app, "POST", "inventarios/transferencia", { usuario: "beto", body: { id_sede_origen: origen.id_sede, id_sede_destino: destino.id_sede, id_producto: obsoleto.id_producto, cantidad: 50 } });
    assertEquals(r.status, 200, JSON.stringify(r.data));
    assertEquals(r.data[0].stock_actual, antes - 50);
    assertEquals(r.data[1].stock_actual, 50);
    const movs = await c.movimientos.query({ where: { id_producto: obsoleto.id_producto, tipo_movimiento: "Transferencia" } });
    assertEquals(movs.map((m) => m.cantidad).sort((a, b) => a! - b!), [-50, 50]);
    const mal = await call(app, "POST", "inventarios/transferencia", { usuario: "beto", body: { id_sede_origen: origen.id_sede, id_sede_destino: destino.id_sede, id_producto: obsoleto.id_producto, cantidad: 5000 } });
    assertEquals(mal.status, 400);
    assertEquals((await c.inventarios.get({ id_sede: destino.id_sede, id_producto: obsoleto.id_producto }))!.stock_actual, 50);
    const misma = await call(app, "POST", "inventarios/transferencia", { usuario: "beto", body: { id_sede_origen: origen.id_sede, id_sede_destino: origen.id_sede, id_producto: obsoleto.id_producto, cantidad: 1 } });
    assertEquals(misma.status, 400);
  } finally {
    await app.db.destroy();
  }
});

Deno.test("anulación: estado Anulada, reintegro del stock y movimientos inversos; no se anula dos veces", async () => {
  const app = await appDePrueba();
  try {
    const c = app.controllers;
    const venta = at(await c.ventas.query({ where: { estado: "Completada" }, include: { detalles: true }, pageSize: 1 }), 0);
    const stocks = new Map<number, number>();
    for (const d of venta.detalles ?? []) stocks.set(d.id_producto!, (await c.inventarios.get({ id_sede: venta.id_sede, id_producto: d.id_producto }))!.stock_actual!);
    const r = await call(app, "POST", `venta/${venta.id_venta}/anular`, { usuario: "ana", body: { motivo: "Prueba" } });
    assertEquals(r.status, 200, JSON.stringify(r.data));
    assertEquals(r.data.estado, "Anulada");
    for (const d of venta.detalles ?? []) {
      assertEquals((await c.inventarios.get({ id_sede: venta.id_sede, id_producto: d.id_producto }))!.stock_actual, stocks.get(d.id_producto!)! + d.cantidad!);
    }
    const inversos = await c.movimientos.query({ where: { tipo_movimiento: "Entrada", observaciones: { contains: `Anulación ${venta.consecutivo}` } } });
    assertEquals(inversos.length, (venta.detalles ?? []).length);
    const otra = await call(app, "POST", `venta/${venta.id_venta}/anular`, { usuario: "ana", body: {} });
    assertEquals(otra.status, 400);
    assertEquals((await call(app, "POST", "venta/999999/anular", { body: {} })).status, 404);
  } finally {
    await app.db.destroy();
  }
});

Deno.test("ajuste de precios: +5 % en Tecnología sólo si el proveedor principal subió su costo; no se repite", async () => {
  const app = await appDePrueba();
  try {
    const c = app.controllers;
    const [tec1] = await c.productos.query({ where: { sku: "TEC-001" } });
    const [tec2] = await c.productos.query({ where: { sku: "TEC-002" } });
    const [tec3] = await c.productos.query({ where: { sku: "TEC-003" } });
    assert(tec1 && tec2 && tec3);
    const r = await call(app, "POST", "productos/ajuste-precios", { usuario: "carla", body: {} });
    assertEquals(r.status, 200, JSON.stringify(r.data));
    assertEquals(r.data.categoria, "Tecnología");
    const skus = r.data.ajustados.map((a: { sku: string }) => a.sku).sort();
    assertEquals(skus, ["TEC-001", "TEC-003"]);
    assertEquals((await c.productos.get(tec1))!.precio_base, Math.round(tec1.precio_base! * 1.05 * 100) / 100);
    assertEquals((await c.productos.get(tec2))!.precio_base, tec2.precio_base);
    const otra = await call(app, "POST", "productos/ajuste-precios", { usuario: "carla", body: { porcentaje: 5 } });
    assertEquals(otra.data.ajustados.length, 0);
    // el PUT de producto_proveedor conserva el costo anterior: un alza nueva vuelve a habilitar el ajuste
    const [pp] = await c.productosProveedores.query({ where: { id_producto: tec2.id_producto }, orderBy: "costo_compra", pageSize: 1 });
    assert(pp);
    await call(app, "PUT", `producto-proveedor/${pp.id_producto}/${pp.id_proveedor}`, { body: { costo_compra: pp.costo_compra! + 1000 } });
    const tercera = await call(app, "POST", "productos/ajuste-precios", { usuario: "carla", body: { porcentaje: 10 } });
    assertEquals(tercera.data.ajustados.map((a: { sku: string }) => a.sku), ["TEC-002"]);
    assertEquals((await call(app, "POST", "productos/ajuste-precios", { body: { categoria: "NoExiste" } })).status, 400);
  } finally {
    await app.db.destroy();
  }
});

Deno.test("limpieza: borra productos sin ventas ni movimientos en 2 años junto con sus dependientes (sin huérfanos)", async () => {
  const app = await appDePrueba();
  try {
    const c = app.controllers;
    const antes = (await c.productos.list()).length;
    const dry = await call(app, "POST", "productos/limpieza", { usuario: "carla", body: { dryRun: true } });
    assertEquals(dry.status, 200, JSON.stringify(dry.data));
    assertEquals(dry.data.productos.map((p: { sku: string }) => p.sku).sort(), ["DEP-099", "TEC-099"]);
    assertEquals((await c.productos.list()).length, antes);
    const real = await call(app, "POST", "productos/limpieza", { usuario: "carla", body: {} });
    assertEquals(real.data.borrados, { productos: 2, inventarios: 1, proveedores: 1, movimientos: 1 });
    assertEquals((await c.productos.list()).length, antes - 2);
    for (const p of dry.data.productos as { id_producto: number }[]) {
      assertEquals((await c.inventarios.query({ where: { id_producto: p.id_producto } })).length, 0);
      assertEquals((await c.movimientos.query({ where: { id_producto: p.id_producto } })).length, 0);
      assertEquals((await c.productosProveedores.query({ where: { id_producto: p.id_producto } })).length, 0);
    }
    assertEquals((await call(app, "POST", "productos/limpieza", { body: {} })).data.productos.length, 0);
  } finally {
    await app.db.destroy();
  }
});
