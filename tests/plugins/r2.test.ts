/**
 * Helper R2 sin red: caducidad de 72 horas, lectura, borrado al vencer y purga de objetos vencidos.
 */
import { assertEquals } from "@std/assert";
import { META_EXPIRA_R2, TTL_R2_72H, r2Almacen, r2CronHandler, r2PurgeExpired } from "@Jeff-Aporta/DER/src/03-plugins/common/r2.ts";
import type { R2BucketLike, R2ObjectLike } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";
import type { AlmacenArchivos } from "@Jeff-Aporta/DER/src/03-plugins/archivos/schemas.ts";

/** R2 simulado en memoria. */
function r2Falso(reloj: { ahora: number }): R2BucketLike {
  const objetos = new Map<string, R2ObjectLike>();
  return {
    put(key: string, value: Uint8Array, options) {
      const body = new Uint8Array(value);
      objetos.set(key, {
        key,
        size: body.length,
        uploaded: new Date(reloj.ahora),
        ...(options?.httpMetadata !== undefined ? { httpMetadata: options.httpMetadata } : {}),
        ...(options?.customMetadata !== undefined ? { customMetadata: options.customMetadata } : {}),
        body: new ReadableStream({ start(controller) { controller.enqueue(body); controller.close(); } }),
      });
      return Promise.resolve(objetos.get(key));
    },
    get(key: string) {
      return Promise.resolve(objetos.get(key) ?? null);
    },
    delete(key: string | string[]) {
      for (const k of Array.isArray(key) ? key : [key]) objetos.delete(k);
      return Promise.resolve();
    },
    list(options) {
      const todos = [...objetos.values()].filter((o) => !options?.prefix || o.key.startsWith(options.prefix));
      return Promise.resolve({ objects: todos, truncated: false });
    },
  };
}

Deno.test("r2: subir y bajar guarda mime, bytes y caducidad de 72 horas", async () => {
  const reloj = { ahora: Date.parse("2026-11-13T12:00:00.000Z") };
  const bucket = r2Falso(reloj);
  const almacen = r2Almacen(bucket, { now: () => reloj.ahora });
  const descriptor = await almacen.subirConCaducidad("canal/2026/11/a.txt", new TextEncoder().encode("hola"), { mime: "text/plain", nombre: "a.txt" });
  assertEquals(descriptor.bytes, 4);
  assertEquals(descriptor.mime, "text/plain");
  assertEquals(descriptor.expira, new Date(reloj.ahora + TTL_R2_72H * 1000).toISOString());
  const bajada = await almacen.bajar("canal/2026/11/a.txt");
  assertEquals(bajada?.mime, "text/plain");
  assertEquals(bajada?.bytes, 4);
  assertEquals(await new Response(bajada?.cuerpo).text(), "hola");
});

Deno.test("r2: un objeto vencido no se baja y se borra", async () => {
  const reloj = { ahora: Date.parse("2026-11-13T12:00:00.000Z") };
  const bucket = r2Falso(reloj);
  const almacen = r2Almacen(bucket, { now: () => reloj.ahora });
  await almacen.subirConCaducidad("viejo", new Uint8Array([1]), { mime: "application/octet-stream", nombre: "x", ttlSeg: 1 });
  reloj.ahora += 2000;
  assertEquals(await almacen.bajar("viejo"), null);
  assertEquals(await bucket.get("viejo"), null);
});

Deno.test("r2: la purga borra los vencidos y el helper encaja con AlmacenArchivos", async () => {
  const reloj = { ahora: Date.parse("2026-11-13T12:00:00.000Z") };
  const bucket = r2Falso(reloj);
  const almacen: AlmacenArchivos = r2Almacen(bucket, { now: () => reloj.ahora });
  await almacen.subir("a", new Uint8Array([1]), { mime: "text/plain", nombre: "a" });
  await almacen.subir("b", new Uint8Array([2]), { mime: "text/plain", nombre: "b" });
  reloj.ahora += TTL_R2_72H * 1000 + 1;
  const resultado = await r2CronHandler(bucket, { now: () => reloj.ahora })();
  assertEquals(resultado, { escaneados: 2, borrados: 2 });
  assertEquals(await bucket.get("a"), null);
  assertEquals(await bucket.get("b"), null);
});

Deno.test("r2: el metadato de caducidad es epoch en segundos", async () => {
  const reloj = { ahora: Date.parse("2026-11-13T12:00:00.000Z") };
  const bucket = r2Falso(reloj);
  const almacen = r2Almacen(bucket, { now: () => reloj.ahora });
  await almacen.subir("a", new Uint8Array([1]), { mime: "text/plain", nombre: "a" });
  const objeto = await bucket.get("a");
  assertEquals(Number(objeto?.customMetadata?.[META_EXPIRA_R2]), Math.floor((reloj.ahora + TTL_R2_72H * 1000) / 1000));
  assertEquals((await r2PurgeExpired(bucket, { now: () => reloj.ahora })).borrados, 0);
});
