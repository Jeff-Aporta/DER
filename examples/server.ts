/**
 * Servidor de ejemplo: `deno task example` → http://localhost:8000/api
 *   curl localhost:8000/api/productos
 *   curl -X POST localhost:8000/api/productos/query -d '{"where":{"precio":{"gt":2}},"include":{"categoria":true}}'
 *   curl -N localhost:8000/api/productos/sse
 *   curl localhost:8000/api/productos/cfg
 *   curl -X PUT localhost:8000/api/productos/cfg -d '{"catalogo":{"porPagina":12}}'
 */
import { createRouter, sqliteDatabase } from "@Jeff-Aporta/DER/src/02 controllers/server/sqlite/mod.ts";
import { buildControllers, CFG_TABLA } from "@Jeff-Aporta/DER/examples/backend.ts";

// con la tabla de configuración, las entidades que definen `cfg` exponen `plural/cfg`
const db = sqliteDatabase(Deno.env.get("DB") ?? ":memory:", { cfg: CFG_TABLA });
const ctrls = buildControllers(db);
await db.seed();
if (!(await ctrls.categorias.list()).length) {
  const beb = await ctrls.categorias.post({ nombre: "Bebidas" });
  await ctrls.productos.postList([
    { nombre: "Café", precio: 3.5, stock: 10, icategoria: beb.icategoria },
    { nombre: "Té", precio: 2, icategoria: beb.icategoria },
  ]);
}
const router = createRouter(Object.values(ctrls), { basePath: "/api", exposeErrors: true });
Deno.serve({ port: Number(Deno.env.get("PORT") ?? 8000) }, router.fetch);
