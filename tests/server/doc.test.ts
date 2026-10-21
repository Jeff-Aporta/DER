/**
 * `/doc`: el md AUTOGENERADO es la base y las fuentes `.md` del controller se concatenan como secciones.
 * `/doc?v=1`: esa misma doc en la vista iswc. Fuentes locales, `file:` y http indistintamente.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ClientController } from "@Jeff-Aporta/DER/src/02-controllers/client/index.ts";
import {
  composeDoc,
  createRouter,
  demoteHeadings,
  ISWC_PIN,
  readDocSource,
  ServerController,
} from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { buildControllers } from "@Jeff-Aporta/DER/examples/backend.ts";
import { CategoriaEntity, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";

async function setup() {
  const db = sqliteDatabase();
  const srv = buildControllers(db);
  await db.seed();
  const router = createRouter(Object.values(srv), { basePath: "/api", onError: () => {} });
  const fetchFn: typeof fetch = (input, init) => router.fetch(new Request(input, init));
  return { db, router, fetchFn };
}

const get = (router: { fetch(r: Request): Promise<Response> }, path: string) =>
  router.fetch(new Request(`http://test${path}`));

/** Datos embebidos de la vista `/doc?v=1`. */
async function viewData(res: Response): Promise<{ main: string; sheets: { path: string; content: string }[] }> {
  const html = await res.text();
  const raw = /<script type="application\/json" id="doc-data">(.*?)<\/script>/s.exec(html)?.[1];
  assert(raw, "sin datos embebidos");
  assert(!raw.includes("<"), "los datos embebidos deben escapar '<'");
  return JSON.parse(raw);
}

Deno.test("doc: secciones = encabezados un nivel abajo, sin tocar bloques de código", () => {
  assertEquals(demoteHeadings("# A\ntexto\n## B\n```\n# no\n```"), "## A\ntexto\n### B\n```\n# no\n```");
  assertEquals(composeDoc("# Base\n", ["# S1", "# S2\n\n- x"]), "# Base\n\n## S1\n\n## S2\n\n- x\n");
});

Deno.test("doc: plural/doc = contrato autogenerado + fuentes del controller como secciones", async () => {
  const { db, router, fetchFn } = await setup();
  try {
    const res = await get(router, "/api/productos/doc");
    assertEquals(res.headers.get("content-type"), "text/markdown; charset=utf-8");
    const md = await res.text();
    assert(md.startsWith("# producto · productos\n")); // la base es el autogenerado
    assertStringIncludes(md, "| ajustarStock | POST | /api/producto/{iproducto}/ajustarStock |");
    const iSec1 = md.indexOf("\n## Productos\n");
    const iSec2 = md.indexOf("\n## Productos · Preguntas frecuentes\n");
    assert(iSec1 > 0 && iSec2 > iSec1, "las secciones van al final y en orden");
    assertStringIncludes(md, "\n### Reglas de negocio\n"); // encabezados de la sección bajan un nivel
    const cli = new ClientController(ProductoEntity, { baseUrl: "http://test/api", fetch: fetchFn });
    assertEquals(await cli.doc(), md);
  } finally {
    await db.destroy();
  }
});

Deno.test("doc: sin fuentes, /doc es solo el autogenerado", async () => {
  const { db, router } = await setup();
  try {
    const md = await (await get(router, "/api/categorias/doc")).text();
    assert(md.startsWith("# categoria · categorias\n"));
    assertStringIncludes(md, "| get | GET | /api/categoria/{icategoria} |");
    assertStringIncludes(md, "| nombre | string |  | no |");
    assertStringIncludes(md, "| productos | 1:N (arreglo) | producto | icategoria = icategoria |");
  } finally {
    await db.destroy();
  }
});

Deno.test("doc: plural/doc?v=1 presenta la doc compuesta con iswc-md-docs-vault", async () => {
  const { db, router } = await setup();
  try {
    const res = await get(router, "/api/productos/doc?v=1");
    assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
    const md = await (await get(router, "/api/productos/doc")).text();
    const data = await viewData(res);
    assertEquals(data.sheets.map((s) => s.path), ["productos.md"]);
    assertEquals(data.sheets[0]?.content, md);
    // un solo endpoint: ?v=0 sigue siendo markdown y la ruta vieja /doc/v ya no existe
    assertEquals((await get(router, "/api/productos/doc?v=0")).headers.get("content-type"), "text/markdown; charset=utf-8");
    assertEquals((await get(router, "/api/productos/doc/v")).status, 404);
    assertEquals((await get(router, "/api/doc/v")).status, 404);
  } finally {
    await db.destroy();
  }
});

Deno.test("doc: general {base}/doc (índice autogenerado) y {base}/doc?v=1 (una hoja por entidad)", async () => {
  const { db, router } = await setup();
  try {
    const index = await (await get(router, "/api/doc")).text();
    assert(index.startsWith("# API · Documentación\n"));
    assertStringIncludes(index, "| producto | `/api/producto` | `/api/productos` | `/api/productos/doc` | [productos](productos.md) |");
    const res = await get(router, "/api/doc?v=1");
    const html = await res.clone().text();
    assertStringIncludes(html, `is-webcomponents@${ISWC_PIN}/dist/cdn/core/loader.min.js`);
    const data = await viewData(res);
    assertEquals(data.sheets.map((s) => s.path), [
      "README.md",
      "categorias.md",
      "productos.md",
      "pedidos.md",
      "pedido-lineas.md",
      "crisis.md",
    ]);
  } finally {
    await db.destroy();
  }
});

Deno.test("doc: fuentes indistintas (ruta relativa, file:, http) y función que retorna el arreglo", async () => {
  const server = Deno.serve({ port: 0, onListen() {} }, () => new Response("# Remoto\n"));
  const db = sqliteDatabase();
  try {
    const url = `http://localhost:${server.addr.port}/remoto.md`;
    assertEquals(await readDocSource(url), "# Remoto\n");
    assertStringIncludes(await readDocSource(import.meta.resolve("@Jeff-Aporta/DER/examples/docs/productos.md")), "# Productos");
    assertStringIncludes(await readDocSource("productos.md", import.meta.resolve("@Jeff-Aporta/DER/examples/docs/")), "# Productos");
    const ctrl = new ServerController(CategoriaEntity, {
      db,
      table: "categorias",
      doc() {
        return [url, import.meta.resolve("@Jeff-Aporta/DER/examples/docs/productos.md")];
      },
    });
    const md = await ctrl.doc();
    assert(md.startsWith("# categoria · categorias\n"));
    assertStringIncludes(md, "\n## Remoto\n");
    assertStringIncludes(md, "\n## Productos\n");
  } finally {
    await server.shutdown();
    await db.destroy();
  }
});
