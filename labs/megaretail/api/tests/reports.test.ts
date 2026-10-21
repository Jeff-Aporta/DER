/** Reportes: ranking por sede, alertas de stock con proveedor principal, clientes fieles y cubo con subtotales. */
import { assert, assertEquals } from "@std/assert";
import { appDePrueba, at, call } from "./_setup.ts";
import type { AlertaStock, ClienteFiel, CuboReport, RankingReport } from "../src/domain/index.ts";

Deno.test("ranking: top 3 por sede del último trimestre con porcentaje del total de la sede", async () => {
  const app = await appDePrueba();
  try {
    const r = await call(app, "GET", "vendedores/ranking", { usuario: "dario" });
    assertEquals(r.status, 200, JSON.stringify(r.data));
    const rep = r.data as RankingReport;
    assertEquals(rep.top, 3);
    assert(rep.totalPorSede.length >= 2);
    for (const s of rep.totalPorSede) {
      const filas = rep.filas.filter((f) => f.id_sede === s.id_sede);
      assert(filas.length >= 1 && filas.length <= 3);
      assertEquals(filas.map((f) => f.posicion), filas.map((_, i) => i + 1));
      for (let i = 1; i < filas.length; i++) assert(at(filas, i - 1).total >= at(filas, i).total);
      const suma = filas.reduce((acc, f) => acc + f.porcentaje, 0);
      assert(suma > 0 && suma <= 100.01, `suma ${suma}`);
      assertEquals(at(filas, 0).porcentaje, Math.round((at(filas, 0).total / s.total) * 10000) / 100);
    }
    // las ventas de hace cinco meses no entran; con un rango amplio sí
    const ventasViejas = await app.controllers.ventas.query({ where: { fecha_venta: { lt: rep.desde }, estado: "Completada" } });
    assert(ventasViejas.length >= 1);
    const amplio = (await call(app, "GET", "vendedores/ranking?desde=2000-01-01T00:00:00Z&top=1")).data as RankingReport;
    assertEquals(amplio.filas.length, amplio.totalPorSede.length);
    const totalAmplio = amplio.totalPorSede.reduce((a, s) => a + s.total, 0);
    const totalTrimestre = rep.totalPorSede.reduce((a, s) => a + s.total, 0);
    assert(totalAmplio > totalTrimestre);
    assertEquals((await call(app, "GET", "vendedores/ranking?desde=ayer")).status, 400);
  } finally {
    await app.db.destroy();
  }
});

Deno.test("alertas: inventarios con stock_actual < stock_minimo (columna calculada) y proveedor de menor costo", async () => {
  const app = await appDePrueba();
  try {
    const r = await call(app, "GET", "inventarios/alertas", { usuario: "dario" });
    assertEquals(r.status, 200, JSON.stringify(r.data));
    const alertas = r.data as AlertaStock[];
    assertEquals(alertas.map((a) => a.sku).sort(), ["ALI-001", "DEP-002", "TEC-003"]);
    for (const a of alertas) {
      assert(a.stock_actual < a.stock_minimo);
      assertEquals(a.faltante, a.stock_minimo - a.stock_actual);
      assert(a.proveedor);
    }
    const monitor = alertas.find((a) => a.sku === "TEC-003")!;
    assertEquals(monitor.proveedor!.razon_social, "ElectroMundo Ltda.");
    assertEquals(monitor.proveedor!.costo_compra, 520000);
    // la columna calculada también sirve en query() del CRUD
    const criticos = await app.controllers.inventarios.query({ where: { critico: true } });
    assertEquals(criticos.length, 3);
  } finally {
    await app.db.destroy();
  }
});

Deno.test("clientes fieles: top 10 por gasto, compras, ticket promedio y sede más frecuente", async () => {
  const app = await appDePrueba();
  try {
    const r = await call(app, "GET", "clientes/fieles", { usuario: "dario" });
    assertEquals(r.status, 200, JSON.stringify(r.data));
    const fieles = r.data as ClienteFiel[];
    assert(fieles.length >= 1 && fieles.length <= 10);
    for (let i = 1; i < fieles.length; i++) assert(at(fieles, i - 1).gasto_total >= at(fieles, i).gasto_total);
    const c = app.controllers;
    for (const f of fieles) {
      const ventas = await c.ventas.query({ where: { id_cliente: f.id_cliente, estado: "Completada" }, pageSize: 1000 });
      assertEquals(f.compras, ventas.length);
      assertEquals(f.gasto_total, Math.round(ventas.reduce((a, v) => a + v.total_venta!, 0) * 100) / 100);
      assertEquals(f.ticket_promedio, Math.round((f.gasto_total / f.compras) * 100) / 100);
      assert(f.sede_frecuente);
    }
    assertEquals(((await call(app, "GET", "clientes/fieles?top=2")).data as ClienteFiel[]).length, 2);
  } finally {
    await app.db.destroy();
  }
});

Deno.test("cubo: sede × categoría con subtotal por sede y gran total (ROLLUP calculado)", async () => {
  const app = await appDePrueba();
  try {
    const r = await call(app, "GET", "ventas/cubo", { usuario: "dario" });
    assertEquals(r.status, 200, JSON.stringify(r.data));
    const cubo = r.data as CuboReport;
    const total = cubo.celdas.filter((x) => x.nivel === "total");
    assertEquals(total.length, 1);
    const subtotales = cubo.celdas.filter((x) => x.nivel === "subtotal");
    assertEquals(subtotales.length, cubo.sedes.length);
    for (const s of subtotales) {
      const detalle = cubo.celdas.filter((x) => x.nivel === "detalle" && x.id_sede === s.id_sede);
      assertEquals(Math.round(detalle.reduce((a, x) => a + x.total, 0) * 100) / 100, s.total);
      assertEquals(detalle.reduce((a, x) => a + x.unidades, 0), s.unidades);
    }
    assertEquals(Math.round(subtotales.reduce((a, x) => a + x.total, 0) * 100) / 100, at(total, 0).total);
    // el gran total coincide con la suma de las ventas completadas
    const ventas = await app.controllers.ventas.query({ where: { estado: "Completada" }, pageSize: 1000 });
    assertEquals(at(total, 0).total, Math.round(ventas.reduce((a, v) => a + v.total_venta!, 0) * 100) / 100);
    // orden: por sede y dentro de la sede por categoría, el subtotal al final de cada sede y el total al final
    assertEquals(at(cubo.celdas, cubo.celdas.length - 1).nivel, "total");
    const vacio = (await call(app, "GET", "ventas/cubo?desde=2090-01-01")).data as CuboReport;
    assertEquals(vacio.celdas.length, 0);
  } finally {
    await app.db.destroy();
  }
});
