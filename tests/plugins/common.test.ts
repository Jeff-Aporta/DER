/** Utilidades comunes de los plugins: IP real según `trustProxy` y datos del dispositivo. */
import { assertEquals } from "@std/assert";
import { clientIp, deviceInfo } from "@Jeff-Aporta/DER/src/03-plugins/common/device.ts";

Deno.test("clientIp: trustProxy=0 toma el primer salto; trustProxy=N el último salto de confianza; sin XFF usa X-Real-IP", () => {
  const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" } });
  assertEquals([clientIp(req, 0), clientIp(req, 1), clientIp(req, 2)], ["1.2.3.4", "10.0.0.1", "1.2.3.4"]);
  assertEquals(clientIp(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }), 1), "9.9.9.9");
});

Deno.test("deviceInfo: SO, navegador, tipo de equipo y huella estable del user-agent", async () => {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
  const a = await deviceInfo(new Request("http://x", { headers: { "user-agent": ua, "x-forwarded-for": "8.8.8.8" } }));
  const b = await deviceInfo(new Request("http://x", { headers: { "user-agent": ua } }));
  assertEquals([a.ip, a.so, a.navegador, a.dispositivo, a.huella === b.huella, a.huella.length], ["8.8.8.8", "Windows", "Chrome", "escritorio", true, 22]);
  assertEquals((await deviceInfo(new Request("http://x", { headers: { "user-agent": "curl/8.0" } }))).dispositivo, "bot");
});
