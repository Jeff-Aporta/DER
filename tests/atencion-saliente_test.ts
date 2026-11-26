/**
 * El saliente que ya envio el canal: el bot respondio y el CRM tiene que verlo en la conversacion.
 */
import { assertEquals } from "@std/assert";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import { atencionServer } from "@Jeff-Aporta/DER/src/03-plugins/atencion/server.ts";

Deno.test("atencion: el saliente que ya envio el canal queda en la conversacion con su id externo", async () => {
  const db = sqliteDatabase(":memory:");
  const p = createServer(atencionServer, { db, cfg: { canales: [{ iempresa: "acme", canal: "whatsapp", icuenta: "123", nombre: "Soporte" }] } } as never);
  await p.seed();
  const at = p as unknown as { registrarEntrante(i: unknown): Promise<{ nuevo: boolean; chat: { id: string } | null }>; registrarSaliente(i: unknown): Promise<{ nuevo: boolean; mensaje: { iexterno: string | null; direccion: string; estado: string } | null }>; mensajes(iempresa: string, ichat: string): Promise<{ direccion: string; texto: string | null; iexterno: string | null; estado: string }[]> };

  const e = await at.registrarEntrante({ canal: "whatsapp", icuenta: "123", cliente: { iexterno: "573100000000", nombre: "Ana" }, mensaje: { iexterno: "wamid-in-1", texto: "Hola" } });
  assertEquals(e.nuevo, true);

  const s = await at.registrarSaliente({ canal: "whatsapp", icuenta: "123", cliente: { iexterno: "573100000000" }, mensaje: { iexterno: "wamid-out-1", texto: "Buenas" } });
  assertEquals(s.nuevo, true);
  assertEquals(s.mensaje?.iexterno, "wamid-out-1");
  assertEquals(s.mensaje?.direccion, "saliente");
  assertEquals(s.mensaje?.estado, "enviado");

  // el mismo wamid dos veces: no se duplica
  const otra = await at.registrarSaliente({ canal: "whatsapp", icuenta: "123", cliente: { iexterno: "573100000000" }, mensaje: { iexterno: "wamid-out-1", texto: "Buenas" } });
  assertEquals(otra.nuevo, false);

  const mensajes = await at.mensajes("acme", e.chat!.id);
  assertEquals(mensajes.map((m) => m.direccion), ["entrante", "saliente"]);
  assertEquals(mensajes[1]?.iexterno, "wamid-out-1");
  await db.destroy();
});
