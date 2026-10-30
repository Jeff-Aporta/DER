/**
 * Hooks `after*` (efectos tras escribir: indexar, notificar, auditar) y cuerpos binarios en rutas propias: el router no
 * consume un cuerpo `application/octet-stream` y el handler lo lee de `input.request`.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { createRouter, ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { CategoriaEntity } from "@Jeff-Aporta/DER/examples/domain.ts";

Deno.test("after*: corren tras post/put/delete y sus listas, entidad y controller, con la fila resultante", async () => {
  const db = sqliteDatabase();
  const log: string[] = [];
  const categorias = new ServerController(CategoriaEntity, {
    db,
    table: "after_categorias",
    register: false,
    hooks: {
      afterPost(c) {
        log.push(`post:${c.nombre}:${c.icategoria}`);
      },
      async afterPut(c) {
        await Promise.resolve();
        log.push(`put:${c.nombre}`);
      },
      afterDelete(c) {
        log.push(`delete:${c.icategoria}`);
      },
      afterPostList(l) {
        log.push(`postList:${l.length}`);
      },
      afterPutList(l) {
        log.push(`putList:${l.length}`);
      },
      afterDeleteList(l) {
        log.push(`deleteList:${l.length}`);
      },
    },
  });
  try {
    await categorias.seed();
    const a = await categorias.post(categorias.pojo({ nombre: "A" }));
    await categorias.put(categorias.pojo({ icategoria: a.icategoria, nombre: "A2" }));
    assertEquals(await categorias.put(categorias.pojo({ icategoria: 999, nombre: "X" })), null);
    const lista = await categorias.postList([{ nombre: "B" }, { nombre: "C" }]);
    await categorias.putList(lista.map((c) => ({ icategoria: c.icategoria, nombre: `${c.nombre}!` })));
    await categorias.deleteList(lista.map((c) => ({ icategoria: c.icategoria })));
    await categorias.delete({ icategoria: a.icategoria });
    assertEquals(await categorias.delete({ icategoria: a.icategoria }), null);
    await categorias.query({});
    assertEquals(log, [`post:A:${a.icategoria}`, "put:A2", "postList:2", "putList:2", "deleteList:2", `delete:${a.icategoria}`]);
  } finally {
    await db.destroy();
  }
});

Deno.test("after*: un error del hook sube al llamador y la escritura ya quedó hecha", async () => {
  const db = sqliteDatabase();
  const categorias = new ServerController(CategoriaEntity, {
    db,
    table: "after_errores",
    register: false,
    hooks: {
      afterPost() {
        throw new Error("falló el índice");
      },
    },
  });
  try {
    await categorias.seed();
    await assertRejects(() => categorias.post(categorias.pojo({ nombre: "A" })), Error, "falló el índice");
    assertEquals((await categorias.list()).length, 1);
  } finally {
    await db.destroy();
  }
});

Deno.test("router: un cuerpo binario no se parsea como JSON y queda para el handler", async () => {
  const db = sqliteDatabase();
  const categorias = new ServerController(CategoriaEntity, { db, table: "after_binario", register: false });
  const router = createRouter([categorias], {
    basePath: "/api",
    routes: [
      {
        method: "POST",
        path: "subir",
        security: "public",
        async handler(i) {
          const bytes = new Uint8Array(await i.request.arrayBuffer());
          return { body: i.body ?? null, bytes: bytes.length, primero: bytes[0] };
        },
      },
      { method: "POST", path: "eco", security: "public", handler: (i) => ({ body: i.body }) },
    ],
  });
  try {
    const bin = await router.fetch(new Request("http://t/api/subir", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array([255, 0, 1, 2]) }));
    assertEquals(await bin.json(), { body: null, bytes: 4, primero: 255 });
    const img = await router.fetch(new Request("http://t/api/subir", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([137, 80]) }));
    assertEquals((await img.json()).bytes, 2);
    const eco = await router.fetch(new Request("http://t/api/eco", { method: "POST", body: JSON.stringify({ a: 1 }) }));
    assertEquals(await eco.json(), { body: { a: 1 } }, "sin content-type explícito (text/plain) sigue siendo JSON");
    const ecoJson = await router.fetch(new Request("http://t/api/eco", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ b: 2 }) }));
    assertEquals(await ecoJson.json(), { body: { b: 2 } });
  } finally {
    await db.destroy();
  }
});
