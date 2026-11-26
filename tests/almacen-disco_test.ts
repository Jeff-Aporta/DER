/**
 * Tests del almacen en disco (el transversales de los ficheros que NO viven en R2).
 */
import { assertEquals, assertExists } from "@std/assert";
import { discoAlmacen, purgarDisco, rutaDe } from "@Jeff-Aporta/DER/src/03-plugins/common/almacen-disco.ts";

async function carpetaTemporal(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "der-disco-" });
  return dir;
}

Deno.test("disco: sube, baja y borra", async () => {
  const dir = await carpetaTemporal();
  const almacen = discoAlmacen(dir);
  await almacen.subir("voz/nota.ogg", new TextEncoder().encode("AUDIO"), { mime: "audio/ogg", nombre: "nota.ogg" });
  const b = await almacen.bajar("voz/nota.ogg");
  assertExists(b);
  assertEquals(new TextDecoder().decode(b.cuerpo as Uint8Array), "AUDIO");
  assertEquals(b.mime, "audio/ogg");
  await almacen.borrar("voz/nota.ogg");
  assertEquals(await almacen.bajar("voz/nota.ogg"), null);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("disco: la clave no puede salir de la carpeta", async () => {
  const dir = await carpetaTemporal();
  const almacen = discoAlmacen(dir);
  await almacen.subir("../../escapado.txt", new TextEncoder().encode("x"), { mime: "text/plain", nombre: "x.txt" });
  assertExists(await Deno.stat(rutaDe(dir, "../../escapado.txt")));
  assertEquals(await Deno.stat(dir + "/escapado.txt").then(() => true).catch(() => false), true);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("disco: el objeto caduca a los 30 dias y la purga lo borra", async () => {
  const dir = await carpetaTemporal();
  const almacen = discoAlmacen(dir, { ttlSeg: 30 * 86400 });
  await almacen.subir("viejo.txt", new TextEncoder().encode("x"), { mime: "text/plain", nombre: "viejo.txt" });
  const expira = await almacen.expiracion("viejo.txt");
  const dias = Math.round((expira * 1000 - Date.now()) / 86400000);
  assertEquals(dias, 30);
  // Todavia no ha caducado: la purga no lo toca.
  const antes = await purgarDisco(dir, { ttlSeg: 30 * 86400 });
  assertEquals(antes.borrados, 0);
  assertEquals(antes.escaneados, 1);
  // Pasado el plazo, la purga lo borra.
  const despues = await purgarDisco(dir, { ttlSeg: 30 * 86400, ahora: () => Date.now() + 31 * 86400000 });
  assertEquals(despues.borrados, 1);
  assertEquals(await almacen.bajar("viejo.txt"), null);
  await Deno.remove(dir, { recursive: true });
});
