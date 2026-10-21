/**
 * Controllers de servidor para el dominio de ejemplo. Sólo aquí aparece lo específico de SQL:
 * nombre de tabla, caso de identificadores, columnas calculadas, acciones y SSE.
 */
import { type CfgTableDef, type Database, ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { CategoriaEntity, CrisisEntity, LineaEntity, PedidoEntity, ProductoEntity, type Producto } from "@Jeff-Aporta/DER/examples/domain.ts";

/**
 * Tabla de configuración de las entidades (`plural/cfg`), se pasa al crear la base (`sqliteDatabase(ruta, { cfg })`).
 * El consumidor elige los nombres y declara cuál es cada columna: pk con el plural, JSON y fecha de actualización.
 */
export const CFG_TABLA: CfgTableDef = { table: "der_cfg", columns: { pk: "id", json: "jcfg", fecha: "fhultact" } };

export function buildControllers(db: Database) {
  const categorias = new ServerController(CategoriaEntity, { db, table: "categorias" });

  const productos = new ServerController(ProductoEntity, {
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
        async handler(p: Producto, ctx) {
          const actual = await this.get(p.pkOnly(), ctx);
          if (!actual) return null;
          actual.stock = (actual.stock ?? 0) + (p.stock ?? 0);
          return this.put(actual, ctx);
        },
        async sse(p: Producto, send) {
          send(`ajustando ${p.iproducto}`);
          await new Promise((r) => setTimeout(r, 5));
          send("listo");
        },
      },
      importar: {
        handler(list: Producto[], ctx) {
          return this.postList(list, ctx);
        },
      },
    },
    sse: {
      // POST producto/sse: feedback de proceso, el texto lo interpreta el consumidor
      async post(p: Producto, send, ctx) {
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

  const pedidos = new ServerController(PedidoEntity, { db, table: "pedidos" });
  const lineas = new ServerController(LineaEntity, { db, table: "pedido_lineas" });
  const crisis = new ServerController(CrisisEntity, { db, table: "crisis", identifierCase: "upper" });

  return { categorias, productos, pedidos, lineas, crisis };
}
