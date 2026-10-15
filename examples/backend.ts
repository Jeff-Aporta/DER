/**
 * Controllers de servidor para el dominio de ejemplo. Sólo aquí aparece lo específico de SQL:
 * nombre de tabla, caso de identificadores, columnas calculadas, acciones y SSE.
 */
import { type Database, ServerController } from "../src/02 controllers/server/mod.ts";
import { Categoria, Crisis, Linea, Pedido, Producto, type TProducto } from "./domain.ts";

export function buildControllers(db: Database) {
  const categorias = new ServerController(Categoria, { db, table: "categorias" });

  const productos = new ServerController(Producto, {
    db,
    table: "productos",
    doc: [new URL("./docs/productos.md", import.meta.url).href, new URL("./docs/productos-faq.md", import.meta.url).href],
    computed: { total: "{precio} * {stock}" },
    hooks: {
      // verificación sólo de servidor (además de las compartidas de la entidad)
      async prePost(p) {
        if (p.icategoria == null) return null;
        const cat = await categorias.get({ icategoria: p.icategoria });
        return cat ? null : `La categoría ${p.icategoria} no existe`;
      },
    },
    endpoints: {
      ajustarStock: {
        async handler(p: TProducto, ctx) {
          const actual = await this.get(p.pkOnly(), ctx);
          if (!actual) return null;
          actual.stock = (actual.stock ?? 0) + (p.stock ?? 0);
          return this.put(actual, ctx);
        },
        async sse(p: TProducto, send) {
          send(`ajustando ${p.iproducto}`);
          await new Promise((r) => setTimeout(r, 5));
          send("listo");
        },
      },
      importar: {
        handler(list: TProducto[], ctx) {
          return this.postList(list, ctx);
        },
      },
    },
    sse: {
      // POST producto/sse: feedback de proceso, el texto lo interpreta el consumidor
      async post(p: TProducto, send, ctx) {
        send(JSON.stringify({ paso: "validado" }));
        const creado = await this.post(p, ctx);
        send(JSON.stringify({ paso: "creado", iproducto: creado.iproducto }));
      },
      // GET productos/sse: efecto "type write" de un texto multilínea
      list(_arg, send) {
        for (const t of ["Hola", "mundo\nmultilínea"]) send(t);
      },
    },
  });

  const pedidos = new ServerController(Pedido, {
    db,
    table: "pedidos",
    cfg: { table: "pedidos_cfg", column: "jdata" },
  });
  const lineas = new ServerController(Linea, { db, table: "pedido_lineas" });
  const crisis = new ServerController(Crisis, { db, table: "crisis", identifierCase: "upper" });

  return { categorias, productos, pedidos, lineas, crisis };
}
