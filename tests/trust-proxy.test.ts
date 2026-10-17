import { assertEquals } from "jsr:@std/assert@1";
import { clientIp } from "../src/03 plugins/identity/Controladores/device.ts";

Deno.test("clientIp: trustProxy=0 legado toma el primer salto", () => {
  const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" } });
  assertEquals(clientIp(req, 0), "1.2.3.4");
});

Deno.test("clientIp: trustProxy=N toma el último salto de confianza", () => {
  const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" } });
  assertEquals(clientIp(req, 1), "10.0.0.1");
  assertEquals(clientIp(req, 2), "1.2.3.4");
});

Deno.test("clientIp: sin X-Forwarded-For usa X-Real-IP", () => {
  const req = new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } });
  assertEquals(clientIp(req, 1), "9.9.9.9");
});
