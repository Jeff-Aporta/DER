/** ClientController: cabeceras (config y por llamada), AbortSignal, endpoints GET con `?q=`, 204 y errores 500. */
import { assertEquals, assertRejects } from "@std/assert";
import { ClientController, HttpError } from "../src/02 controllers/client/mod.ts";
import { createRouter, ServerController } from "../src/02 controllers/server/mod.ts";
import { sqliteDatabase } from "../src/02 controllers/server/sqlite/mod.ts";
import { defineEntity } from "../mod.ts";
import { TCategoria } from "../examples/domain.ts";

const Cat = defineEntity({
  pojo: TCategoria,
  name: "cli.categoria",
  singular: "cli/categoria",
  plural: "cli/categorias",
  endpoints: {
    buscar: { method: "GET", scope: "many", returns: "list" },
    tocar: { method: "POST", scope: "one" },
    romper: { method: "POST", scope: "many" },
  },
});

async function setup() {
  const db = sqliteDatabase();
  const ctrl = new ServerController(Cat, {
    db,
    table: "categorias",
    endpoints: {
      buscar: {
        handler(lista) {
          const nombres = (lista as TCategoria[]).map((c) => c.nombre ?? "");
          return this.query({ where: { nombre: nombres } });
        },
      },
      tocar: { handler: () => undefined }, // → 204
      romper: {
        handler() {
          throw new Error("explotó adentro");
        },
      },
    },
  });
  await db.seed();
  await ctrl.postList([{ nombre: "A" }, { nombre: "B" }, { nombre: "C" }]);
  const vistos: Request[] = [];
  const router = createRouter([ctrl], { basePath: "/api", onError: () => {} });
  const fetchFn: typeof fetch = (input, init) => {
    const req = new Request(input, init);
    vistos.push(req);
    return router.fetch(req);
  };
  return { db, router, vistos, fetchFn };
}

Deno.test("client: cabeceras de config (función async) + por llamada, y el server las recibe", async () => {
  const { db, vistos, fetchFn } = await setup();
  try {
    const cli = new ClientController(Cat, {
      baseUrl: "http://t/api/",
      fetch: fetchFn,
      headers: () => Promise.resolve({ authorization: "Bearer abc", "x-app": "pruebas" }), // función que retorna promesa
    });
    await cli.list({ headers: { "x-app": "sobrescrita", "x-traza": "42" } });
    const h = vistos.at(-1)?.headers;
    assertEquals([h?.get("authorization"), h?.get("x-app"), h?.get("x-traza"), h?.get("accept")], [
      "Bearer abc",
      "sobrescrita",
      "42",
      "application/json",
    ]);
    assertEquals(vistos.at(-1)?.url, "http://t/api/cli/categorias"); // barra final del baseUrl normalizada
  } finally {
    await db.destroy();
  }
});

Deno.test("client: endpoint GET viaja como ?q=, 204 da undefined, 500 llega como HttpError", async () => {
  const { db, vistos, fetchFn } = await setup();
  try {
    const cli = new ClientController(Cat, { baseUrl: "http://t/api", fetch: fetchFn });
    const encontrados = await cli.call<TCategoria[]>("buscar", [{ nombre: "A" }, { nombre: "C" }]);
    assertEquals(encontrados.map((c) => c.nombre), ["A", "C"]);
    const url = new URL(vistos.at(-1)?.url ?? "");
    assertEquals([vistos.at(-1)?.method, url.pathname], ["GET", "/api/cli/categorias/buscar"]);
    assertEquals(JSON.parse(url.searchParams.get("q") ?? "null"), [{ nombre: "A" }, { nombre: "C" }]);
    assertEquals(await cli.call("tocar", { icategoria: 1 }), undefined);
    const err = await assertRejects(() => cli.call("romper", []), HttpError);
    assertEquals([err.status, err.message], [500, "Error interno"]); // el detalle no se expone
  } finally {
    await db.destroy();
  }
});

Deno.test("client: AbortSignal cancela la petición", async () => {
  const lento: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      // como fetch real: si la señal ya está abortada rechaza de inmediato; si no, al abortarse
      const cancelar = () => reject(new DOMException("cancelado", "AbortError"));
      if (init?.signal?.aborted) cancelar();
      else init?.signal?.addEventListener("abort", cancelar);
    });
  const cli = new ClientController(Cat, { baseUrl: "http://t/api", fetch: lento });
  const ac = new AbortController();
  const p = cli.list({ signal: ac.signal });
  ac.abort();
  await assertRejects(() => p, DOMException, "cancelado");
});
