/**
 * Tests del plugin de voz: la configuracion por app y la sintesis.
 */
import { assertEquals } from "@std/assert";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import { vozServer } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import type { MotorVoz } from "@Jeff-Aporta/DER/src/03-plugins/voz/schemas.ts";

/** Motor de mentira: devuelve los bytes del texto y anota lo que le pidieron. */
function motorFalso(): { motor: MotorVoz; llamadas: { texto: string; voz: string; perfil: string; idioma: string; tono?: string | undefined }[] } {
  const llamadas: { texto: string; voz: string; perfil: string; idioma: string; tono?: string | undefined }[] = [];
  return {
    llamadas,
    motor: {
      sintetizar(p) {
        llamadas.push(p);
        return Promise.resolve(new TextEncoder().encode("AUDIO:" + p.texto));
      },
      voces() {
        return Promise.resolve([{ clave: "aiden", nombre: "Aiden" }, { clave: "serena", nombre: "Serena" }]);
      },
    },
  };
}

/** El plugin de voz armado, con su motor y su almacen opcionales. */
async function vozCon(motor?: MotorVoz, guardar?: (d: { bytes: Uint8Array; mime: string; nombre: string; origin?: string | undefined; idorigin?: string | undefined }) => Promise<{ clave: string; url?: string | undefined }>) {
  const db = sqliteDatabase(":memory:");
  const plugin = createServer(vozServer, {
    db,
    cfg: { vidaDias: 30 },
    services: { ...(motor ? { motor } : {}), ...(guardar ? { guardar } : {}) },
  } as never);
  await plugin.seed();
  return { db, plugin };
}

Deno.test("voz: sin configuracion propia sale la de por defecto", async () => {
  const { db, plugin } = await vozCon(motorFalso().motor);
  const c = await plugin["configDe"]!("chat-assistant");
  assertEquals(c.voz, "aiden");
  assertEquals(c.perfil, "rapido");
  assertEquals(c.activa, true);
  await db.destroy();
});

Deno.test("voz: configurar guarda y se relee", async () => {
  const { db, plugin } = await vozCon(motorFalso().motor);
  await plugin["configurar"]!("chat-assistant", { voz: "serena", perfil: "rapido", idioma: "es" });
  const c = await plugin["configDe"]!("chat-assistant");
  assertEquals(c.voz, "serena");
  assertEquals(c.idioma, "es");
  await db.destroy();
});

Deno.test("voz: la voz de una app no toca la de otra", async () => {
  const { db, plugin } = await vozCon(motorFalso().motor);
  await plugin["configurar"]!("chat-assistant", { voz: "serena" });
  const otro = await plugin["configDe"]!("crm");
  assertEquals(otro.voz, "aiden");
  await db.destroy();
});

Deno.test("voz: sintetizar usa la voz de la app", async () => {
  const { motor, llamadas } = motorFalso();
  const { db, plugin } = await vozCon(motor);
  await plugin["configurar"]!("chat-assistant", { voz: "serena", perfil: "rapido" });
  const a = await plugin["sintetizar"]!({ texto: "Listo", iapp: "chat-assistant" });
  assertEquals(new TextDecoder().decode(a.bytes), "AUDIO:Listo");
  assertEquals(llamadas[0]?.voz, "serena");
  assertEquals(llamadas[0]?.perfil, "rapido");
  await db.destroy();
});

Deno.test("voz: sintetizar guarda el audio con su origen", async () => {
  const guardado: { nombre: string; origin?: string | undefined; idorigin?: string | undefined }[] = [];
  const { db, plugin } = await vozCon(motorFalso().motor, (d) => {
    guardado.push({ nombre: d.nombre, origin: d.origin, idorigin: d.idorigin });
    return Promise.resolve({ clave: "voz/chat-assistant.ogg", url: "https://r2/ejemplo.ogg" });
  });
  const a = await plugin["sintetizar"]!({ texto: "Hola", iapp: "chat-assistant", origin: "atencion", idorigin: "17" });
  assertEquals(guardado[0]?.origin, "atencion");
  assertEquals(guardado[0]?.idorigin, "17");
  assertEquals(a.guardado?.url, "https://r2/ejemplo.ogg");
  await db.destroy();
});

/** El mensaje del error que tira la operacion (falla el test si no es error). */
async function mensajeDeError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("Se esperaba un error y no lo hubo");
}

Deno.test("voz: app sin motor da 503", async () => {
  const { db, plugin } = await vozCon();
  const m = await mensajeDeError(() => plugin["sintetizar"]!({ texto: "Hola", iapp: "chat-assistant" }));
  assertEquals(/motor de voz/i.test(m), true, m);
  await db.destroy();
});

Deno.test("voz: app con la voz desactivada da 409", async () => {
  const { db, plugin } = await vozCon(motorFalso().motor);
  await plugin["configurar"]!("chat-assistant", { activa: false });
  const m = await mensajeDeError(() => plugin["sintetizar"]!({ texto: "Hola", iapp: "chat-assistant" }));
  assertEquals(/desactivada/i.test(m), true, m);
  await db.destroy();
});

Deno.test("voz: el motor expone sus voces", async () => {
  const { db, plugin } = await vozCon(motorFalso().motor);
  const v = await plugin["voces"]!();
  assertEquals(v.length, 2);
  assertEquals(v[0]?.clave, "aiden");
  await db.destroy();
});
