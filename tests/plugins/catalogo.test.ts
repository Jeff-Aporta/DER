/**
 * Pruebas de caja negra del plugin de catalogo sobre el router real: aislamiento por app (iapp), lectura publica
 * (solo GET) contra escritura con el permiso `catalogo.editar`, importacion idempotente por codigo y la
 * disponibilidad de un servicio por dia de la semana.
 */
import { assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { catalogoServer, diaDe, importarCatalogo } from "@Jeff-Aporta/DER/src/03-plugins/catalogo/server.ts";
import type { Categoria, Disponibilidad, ItemCatalogo, PaginaItems } from "@Jeff-Aporta/DER/src/03-plugins/catalogo/schemas.ts";
import { call } from "@Jeff-Aporta/DER/tests/_util.ts";

/** Sesion sin JWT: `x-usuario` dice quien es. */
function sesionDe(req: Request): { id: string; claims: Record<string, unknown> } | null {
  const usuario = req.headers.get("x-usuario");
  if (!usuario) return null;
  return { id: usuario, claims: {} };
}

/** API con el catalogo sobre SQLite en memoria. El permiso `catalogo.editar` es solo del admin. */
async function montar() {
  registry.secure(null);
  const db = sqliteDatabase();
  const catalogo = createServer(catalogoServer, { db, cfg: {} });
  const router = createRouter([], { basePath: "/api", plugins: [catalogo] });
  registry.secure({
    extract: sesionDe,
    permissions: (info, action) => {
      if (!info) return { allowed: false, reason: "Requiere autenticacion" };
      if (action === "catalogo.editar") return info.id === "admin" ? { allowed: true, value: true } : { allowed: false, reason: "Sin permiso" };
      return { allowed: true, value: true };
    },
  });
  await router.seed();
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { router, catalogo, cerrar };
}

/** Cabeceras de la app (la cabecera `X-App` dice a qué app se le pregunta). */
const de = (app: string, usuario?: string): Record<string, string> => (usuario ? { "x-app": app, "x-usuario": usuario } : { "x-app": app });

Deno.test("catalogo: el catalogo esta filtrado por iapp (una app no ve el de otra)", async () => {
  const { router, catalogo, cerrar } = await montar();
  await importarCatalogo(catalogo, "riogo24", {
    categorias: [{ codigo: "bebidas", nombre: "Bebidas", orden: 1 }],
    items: [
      { codigo: "lim-001", categoria: "bebidas", tipo: "producto", nombre: "Limonada de maracuyá", precio: 12000 },
      { codigo: "corte-001", tipo: "servicio", nombre: "Corte de pelo", precio: 30000, duracion_min: 30 },
    ],
  });
  await importarCatalogo(catalogo, "hotelcafe", {
    categorias: [{ codigo: "habitaciones", nombre: "Habitaciones", orden: 1 }],
    items: [{ codigo: "hab-101", categoria: "habitaciones", tipo: "servicio", nombre: "Habitación 101", precio: 180000 }],
  });

  const categorias = await call(router, "GET", "catalogo/categorias", { headers: de("riogo24") });
  assertEquals(categorias.status, 200, JSON.stringify(categorias.data));
  assertEquals((categorias.data as Categoria[]).length, 1);
  assertEquals((categorias.data as Categoria[])[0]?.icategoria, "bebidas");

  const lista = await call(router, "GET", "catalogo/items", { headers: de("riogo24") });
  assertEquals(lista.status, 200, JSON.stringify(lista.data));
  const pagina = lista.data as PaginaItems;
  assertEquals(pagina.total, 2, "solo los items de la app");
  assertEquals(pagina.items.map((x) => x.codigo).sort(), ["corte-001", "lim-001"]);

  const otra = await call(router, "GET", "catalogo/items", { headers: de("hotelcafe") });
  assertEquals((otra.data as PaginaItems).total, 1);
  assertEquals((otra.data as PaginaItems).items[0]?.codigo, "hab-101");

  // el item de otra app es 404 (nunca se distingue de que no exista)
  const iitemAjeno = (otra.data as PaginaItems).items[0]?.iitem ?? "";
  const ajeno = await call(router, "GET", `catalogo/item/${iitemAjeno}`, { headers: de("riogo24") });
  assertEquals(ajeno.status, 404);
  const propio = await call(router, "GET", `catalogo/item/${iitemAjeno}`, { headers: de("hotelcafe") });
  assertEquals(propio.status, 200, JSON.stringify(propio.data));

  // sin app declarada no hay catálogo que servir
  const sinApp = await call(router, "GET", "catalogo/items");
  assertEquals(sinApp.status, 400, "falta la cabecera X-App");
  await cerrar();
});

Deno.test("catalogo: la lectura es publica (solo GET) y la escritura exige catalogo.editar", async () => {
  const { router, cerrar } = await montar();
  // GET sin sesion: es publico
  const publico = await call(router, "GET", "catalogo/categorias", { headers: de("riogo24") });
  assertEquals(publico.status, 200, JSON.stringify(publico.data));
  const items = await call(router, "GET", "catalogo/items", { headers: de("riogo24") });
  assertEquals(items.status, 200);
  const detalle = await call(router, "GET", "catalogo/item/lo-que-sea", { headers: de("riogo24") });
  assertEquals(detalle.status, 404);

  // POST sin sesion: 401
  const sinSesion = await call(router, "POST", "catalogo/categorias", { body: { codigo: "postres", nombre: "Postres" }, headers: de("riogo24") });
  assertEquals(sinSesion.status, 401, "la escritura pide sesion");
  // POST con sesion pero sin el permiso: 403
  const sinPermiso = await call(router, "POST", "catalogo/categorias", { body: { codigo: "postres", nombre: "Postres" }, headers: de("riogo24", "carla") });
  assertEquals(sinPermiso.status, 403, "sin catalogo.editar no se escribe");
  // POST con el permiso: 200
  const conPermiso = await call(router, "POST", "catalogo/categorias", { body: { codigo: "postres", nombre: "Postres", orden: 2 }, headers: de("riogo24", "admin") });
  assertEquals(conPermiso.status, 200, JSON.stringify(conPermiso.data));
  assertEquals((conPermiso.data as Categoria).icategoria, "postres");
  // y ya se ve en la lectura publica
  const cats = await call(router, "GET", "catalogo/categorias", { headers: de("riogo24") });
  assertEquals((cats.data as Categoria[]).map((x) => x.icategoria), ["postres"]);
  await cerrar();
});

Deno.test("catalogo: la importacion es idempotente por codigo", async () => {
  const { router, catalogo, cerrar } = await montar();
  const datos = {
    categorias: [{ codigo: "bebidas", nombre: "Bebidas", orden: 1 }],
    items: [{ codigo: "lim-001", categoria: "bebidas", tipo: "producto" as const, nombre: "Limonada", precio: 12000 }],
  };
  const uno = await importarCatalogo(catalogo, "riogo24", datos);
  assertEquals(uno.categorias.creadas, 1);
  assertEquals(uno.categorias.actualizadas, 0);
  assertEquals(uno.items.creados, 1);
  assertEquals(uno.items.actualizados, 0);

  const dos = await importarCatalogo(catalogo, "riogo24", datos);
  assertEquals(dos.categorias.creadas, 0, "no se crea otra vez");
  assertEquals(dos.categorias.actualizadas, 1);
  assertEquals(dos.items.creados, 0);
  assertEquals(dos.items.actualizados, 1);

  const lista = await call(router, "GET", "catalogo/items", { headers: de("riogo24") });
  assertEquals((lista.data as PaginaItems).total, 1, "no se duplica el item");

  // la segunda importacion cambia lo que trae: el mismo item (mismo id), con el dato nuevo
  const tres = await importarCatalogo(catalogo, "riogo24", { items: [{ codigo: "lim-001", tipo: "producto", nombre: "Limonada de maracuyá", precio: 13000 }] });
  assertEquals(tres.items.actualizados, 1);
  const detalle = await call(router, "GET", "catalogo/items?categoria=bebidas", { headers: de("riogo24") });
  const items = (detalle.data as PaginaItems).items;
  assertEquals(items.length, 1);
  assertEquals(items[0]?.nombre, "Limonada de maracuyá");
  assertEquals(items[0]?.precio, 13000);
  assertEquals(items[0]?.icategoria, "bebidas", "lo que no viene en la importacion se conserva");
  await cerrar();
});

Deno.test("catalogo: la disponibilidad de un servicio sale por dia de la semana", async () => {
  const { router, catalogo, cerrar } = await montar();
  assertEquals(diaDe("2026-12-07"), 1, "lunes");
  assertEquals(diaDe("2026-12-08"), 2, "martes");
  await importarCatalogo(catalogo, "barberia", {
    categorias: [{ codigo: "servicios", nombre: "Servicios", orden: 1 }],
    items: [{ codigo: "corte-001", categoria: "servicios", tipo: "servicio", nombre: "Corte de pelo", precio: 30000, duracion_min: 30 }],
  });
  const lista = await call(router, "GET", "catalogo/items?categoria=servicios", { headers: de("barberia") });
  const item = (lista.data as PaginaItems).items[0] as ItemCatalogo;
  assertEquals(item.tipo, "servicio");
  assertEquals(item.duracion_min, 30);

  // franja del lunes de 09:00 a 12:00 con 3 cupos
  const alta = await call(router, "POST", "catalogo/disponibilidad", { body: { iitem: item.iitem, dia_semana: 1, desde: "09:00", hasta: "12:00", cupos: 3 }, headers: de("barberia", "admin") });
  assertEquals(alta.status, 200, JSON.stringify(alta.data));
  assertEquals((alta.data as Disponibilidad).cupos, 3);
  assertEquals((alta.data as Disponibilidad).desde, "09:00");

  // el lunes tiene la franja
  const lunes = await call(router, "GET", `catalogo/disponibilidad?iitem=${item.iitem}&fecha=2026-12-07`, { headers: de("barberia") });
  assertEquals(lunes.status, 200, JSON.stringify(lunes.data));
  assertEquals((lunes.data as Disponibilidad[]).length, 1);
  assertEquals((lunes.data as Disponibilidad[])[0]?.hasta, "12:00");
  // el martes no
  const martes = await call(router, "GET", `catalogo/disponibilidad?iitem=${item.iitem}&fecha=2026-12-08`, { headers: de("barberia") });
  assertEquals(martes.status, 200);
  assertEquals((martes.data as Disponibilidad[]).length, 0, "el martes no abre");
  // sin fecha: todas las franjas del servicio
  const todas = await call(router, "GET", `catalogo/disponibilidad?iitem=${item.iitem}`, { headers: de("barberia") });
  assertEquals((todas.data as Disponibilidad[]).length, 1);
  // sin iitem no hay disponibilidad que decir
  const sinItem = await call(router, "GET", "catalogo/disponibilidad", { headers: de("barberia") });
  assertEquals(sinItem.status, 400, "falta iitem");
  await cerrar();
});

Deno.test("catalogo: filtros de la lista (categoria, busqueda y pagina)", async () => {
  const { router, catalogo, cerrar } = await montar();
  await importarCatalogo(catalogo, "tienda", {
    categorias: [{ codigo: "bebidas", nombre: "Bebidas", orden: 1 }, { codigo: "comidas", nombre: "Comidas", orden: 2 }],
    items: [
      { codigo: "lim-001", categoria: "bebidas", tipo: "producto", nombre: "Limonada", precio: 12000 },
      { codigo: "agu-002", categoria: "bebidas", tipo: "producto", nombre: "Agua de coco", precio: 5000 },
      { codigo: "are-003", categoria: "comidas", tipo: "producto", nombre: "Arepa", precio: 7000 },
    ],
  });
  const porCategoria = await call(router, "GET", "catalogo/items?categoria=bebidas", { headers: de("tienda") });
  assertEquals((porCategoria.data as PaginaItems).total, 2);
  const busqueda = await call(router, "GET", "catalogo/items?q=arepa", { headers: de("tienda") });
  assertEquals((busqueda.data as PaginaItems).total, 1);
  assertEquals((busqueda.data as PaginaItems).items[0]?.codigo, "are-003");
  const pagina = await call(router, "GET", "catalogo/items?pagina=2&porPagina=2", { headers: de("tienda") });
  const p = pagina.data as PaginaItems;
  assertEquals(p.total, 3);
  assertEquals(p.pagina, 2);
  assertEquals(p.porPagina, 2);
  assertEquals(p.items.length, 1);
  await cerrar();
});
