/** `preConfirm`: regla general que corre en TODAS las acciones (antes del pre* específico). */
import { assertEquals, assertRejects } from "@std/assert";
import { type ConfirmInput, ServerController, ValidationError } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { CategoriaEntity, ProductoEntity, type Producto } from "@Jeff-Aporta/DER/examples/domain.ts";
import { CFG_TABLA } from "@Jeff-Aporta/DER/examples/backend.ts";

Deno.test("preConfirm: corre en todas las acciones con su entrada tipada, antes del pre* específico", async () => {
  const db = sqliteDatabase(":memory:", { cfg: CFG_TABLA });
  const vistos: string[] = [];
  const orden: string[] = [];
  new ServerController(CategoriaEntity, { db, table: "categorias" });
  const productos = new ServerController(ProductoEntity, {
    db,
    table: "productos",
    hooks: {
      preConfirm(input: ConfirmInput<Producto>, ctx) {
        vistos.push(input.action === "endpoint" ? `endpoint:${input.name}` : input.action);
        orden.push("confirm");
        if (ctx.state["bloqueado"]) return "Servicio en mantenimiento";
        // estrechamiento por `action`: arg es exactamente el tipo de esa acción
        if (input.action === "post" && input.arg.nombre === "prohibido") return "Nombre prohibido";
        if (input.action === "putCfg" && "secreto" in input.cambios) return "No se puede tocar 'secreto'";
        if (input.action === "query" && (input.arg.pageSize ?? 0) > 100) return "Máximo 100 por página";
        return null;
      },
      prePost() {
        orden.push("prePost");
      },
    },
    endpoints: { ajustarStock: { handler: (p: Producto) => p }, importar: { handler: (l: Producto[]) => l } },
  });
  await db.seed();
  try {
    const p = await productos.post({ nombre: "A", precio: 1 });
    assertEquals(orden, ["confirm", "prePost"]);
    await productos.get(p);
    await productos.put({ iproducto: p.iproducto, precio: 2 });
    await productos.list();
    await productos.query({});
    await productos.postList([{ nombre: "B", precio: 1 }]);
    await productos.putList([{ iproducto: p.iproducto, precio: 3 }]);
    await productos.call("ajustarStock", { iproducto: p.iproducto });
    await productos.call("importar", []);
    await productos.getCfg();
    await productos.putCfg({ stockMinimo: 3 });
    await productos.deleteList([{ iproducto: p.iproducto }]);
    assertEquals(vistos, [
      "post", "get", "put", "list", "query", "postList", "putList",
      "endpoint:ajustarStock", "endpoint:importar", "getCfg", "putCfg", "deleteList",
    ]);

    await assertRejects(() => productos.post({ nombre: "prohibido", precio: 1 }), ValidationError, "prohibido");
    await assertRejects(() => productos.query({ pageSize: 500 }), ValidationError, "Máximo 100");
    await assertRejects(() => productos.list({ state: { bloqueado: true } }), ValidationError, "mantenimiento");
    await assertRejects(async () => {
      for await (const _ of productos.stream("list", undefined, { state: { bloqueado: true } })) { /* */ }
    }, ValidationError, "mantenimiento");
  } finally {
    await db.destroy();
  }
});
