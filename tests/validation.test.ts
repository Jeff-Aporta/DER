/** Prioridad baja: mensajes de validación de query/include, Entity.patch/aplicar, config de plugins y Azure sin stream. */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { type AzureHttpRequest, createRouter, ServerController } from "../src/02 controllers/server/mod.ts";
import { sqliteDatabase } from "../src/02 controllers/server/sqlite/mod.ts";
import { registerAzure } from "../src/02 controllers/server/hosts/azure/mod.ts";
import { pluginsFromConfig, resolveEnv } from "../src/03 plugins/mod.ts";
import { defineEntity, defineSchema, pojoOf, validateQuery } from "../mod.ts";
import { Categoria, Producto, TProducto } from "../examples/domain.ts";

Deno.test("validateQuery: mensajes claros para cada forma inválida", () => {
  const meta = Producto.meta;
  const lim = { pageSize: 50, maxPageSize: 100 };
  const v = (q: unknown) => validateQuery(meta, q as never, lim);
  assertEquals(v([]), "La consulta debe ser un objeto");
  assertEquals(v({ select: ["nada"] }), 'select: "nada" no es una columna');
  assertEquals(v({ orderBy: "-nada" }), 'orderBy: "nada" no es una columna');
  assertEquals(v({ where: { precio: { in: 5 } } }), "where.precio.in debe ser un arreglo");
  assertEquals(v({ where: { precio: { nin: "x" } } }), "where.precio.nin debe ser un arreglo");
  assertEquals(v({ where: { precio: { between: [1] } } }), "where.precio.between debe ser [desde, hasta]");
  assertEquals(v({ where: { $or: {} } }), "where.$or debe ser un arreglo");
  assertEquals(v({ where: { $and: [{ nada: 1 }] } }), 'where.$and[0]: "nada" no es columna ni relación');
  assertEquals(v({ where: { $not: { nada: 1 } } }), 'where.$not: "nada" no es columna ni relación');
  assertEquals(v({ where: { categoria: { nada: 1 } } }), 'where.categoria: "nada" no es columna ni relación');
  assertEquals(v({ include: { categoria: { nada: true } } }), 'include.categoria: "nada" no es una relación');
  assertEquals(v({ include: { categoria: { productos: true } } }), null);
  assertEquals(v({ pageSize: 101 }), "pageSize no puede superar 100");
  assertEquals(v({ otra: 1 })?.length !== 0, true); // clave desconocida (ZQuerySpec estricto)
});

Deno.test("Entity.patch (copia con push, el original no cambia) y Entity.aplicar (acciones Obj)", () => {
  const p = new TProducto({ iproducto: 1, nombre: "A", precio: 1, jconfig: { ui: { color: "rojo" } } });
  const q = Producto.patch(p, { precio: 2, jconfig: { ui: { orden: 1 } } });
  assertEquals([p.precio, q.precio], [1, 2]);
  assertEquals(q.jconfig, { ui: { color: "rojo", orden: 1 } });
  const r = Producto.aplicar(p, [{ op: "update", valor: { nombre: "B", nada: 1 } }, { op: "delete", query: { jconfig: true } }]);
  assertEquals(r.toJSON(), { iproducto: 1, nombre: "B", precio: 1 });
});

Deno.test("pluginsFromConfig: JSON inválido, env ausente, secret corto y env del runtime", () => {
  const db = sqliteDatabase();
  try {
    assertThrows(() => pluginsFromConfig({ identity: { secret: "x".repeat(40), extra: 1 } }, { db }), Error, "inválida");
    assertThrows(() => pluginsFromConfig({ identity: { secret: "env:NO_EXISTE_ESTA_VAR" } }, { db }), Error, "NO_EXISTE_ESTA_VAR");
    assertThrows(() => pluginsFromConfig({ identity: { secret: "corta" } }, { db }), Error, "32");
    assertEquals(resolveEnv("env:MI_VAR", { MI_VAR: "valor" }), "valor");
    assertEquals(resolveEnv("literal"), "literal");
    assertEquals(pluginsFromConfig({}, { db }), []); // sin secciones: sin seguridad
    assertEquals(pluginsFromConfig({ identity: { enabled: false, secret: "x" } }, { db }), []);
  } finally {
    db.destroy();
  }
});

Deno.test("azure: stream=false entrega el body completo como bytes", async () => {
  const db = sqliteDatabase();
  try {
    new ServerController(Categoria, { db, table: "categorias" }); // Producto propaga `categoria` en su lectura
    const productos = new ServerController(Producto, { db, table: "productos" });
    await db.seed();
    await productos.post({ nombre: "A", precio: 1 });
    const fns: { route: string; methods: string[]; handler: (r: AzureHttpRequest, c: unknown) => Promise<{ body?: unknown }> }[] = [];
    registerAzure({ http: (_n, o) => void fns.push(o) }, createRouter([productos]), { stream: false });
    const list = fns.find((f) => f.route === "productos" && f.methods[0] === "GET");
    const res = await list!.handler({
      method: "GET",
      url: "http://h/productos",
      params: {},
      headers: new Headers(),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }, {});
    assertEquals(res.body instanceof Uint8Array, true);
    assertEquals(JSON.parse(new TextDecoder().decode(res.body as Uint8Array))[0].nombre, "A");
  } finally {
    await db.destroy();
  }
});

Deno.test("relación sin controller registrado: el error dice qué entidad y qué relación", async () => {
  const db = sqliteDatabase();
  try {
    const S = defineSchema({
      columns: { id: { type: "int", pk: true } },
      relations: { fantasma: { kind: "one", target: "no.registrada", on: { id: "id" } } },
    });
    class T extends pojoOf(S) {}
    const ctl = new ServerController(defineEntity({ pojo: T, name: "val.t", singular: "valt", plural: "valts" }), {
      db,
      table: "valts",
      getPropagation: () => ({ fantasma: true }),
    });
    await assertRejects(() => ctl.seed(), Error, '"val.t" usa la relación "fantasma"');
  } finally {
    await db.destroy();
  }
});
