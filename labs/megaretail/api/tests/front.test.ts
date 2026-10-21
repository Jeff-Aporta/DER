/** `GET /app`: el API sirve el front leído por ruta relativa (index, dist, ui), sin salir de la carpeta. */
import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { appDePrueba, call } from "./_setup.ts";
import { aliasApp, frontPorDefecto } from "../src/front.ts";

/** Front de prueba en una carpeta temporal. */
async function frontTemporal(): Promise<URL> {
  const dir = await Deno.makeTempDir({ prefix: "mr-front-" });
  await Deno.mkdir(`${dir}/dist`);
  await Deno.mkdir(`${dir}/ui`);
  await Deno.writeTextFile(`${dir}/index.html`, "<!doctype html><html><body><mr-app></mr-app><script type=\"module\" src=\"./dist/app.js\"></script></body></html>");
  await Deno.writeTextFile(`${dir}/dist/app.js`, "console.log('app');");
  await Deno.writeTextFile(`${dir}/ui/app.json`, "{\"titulo\":\"MegaRetail\"}");
  await Deno.writeTextFile(`${dir}/secreto.txt`, "no");
  return new URL(`file:///${dir.replace(/\\/g, "/")}/`);
}

Deno.test("front: index, archivos de dist/ui con content-type, redirección a la barra y 404 fuera de lo público", async () => {
  const front = await frontTemporal();
  const app = await appDePrueba({ front });
  try {
    const redir = await call(app, "GET", "app", { usuario: null, raw: true });
    assertEquals(redir.status, 302);
    assertMatch(redir.res.headers.get("location") ?? "", /\/api\/app\/$/);
    const index = await call(app, "GET", "app/", { usuario: null });
    assertEquals(index.status, 200);
    assertStringIncludes(index.res.headers.get("content-type") ?? "", "text/html");
    assertStringIncludes(String(index.data), "<mr-app>");
    const js = await call(app, "GET", "app/dist/app.js", { usuario: null });
    assertEquals(js.status, 200);
    assertStringIncludes(js.res.headers.get("content-type") ?? "", "text/javascript");
    const json = await call(app, "GET", "app/ui/app.json", { usuario: null });
    assertEquals(json.data, { titulo: "MegaRetail" });
    assertEquals((await call(app, "GET", "app/secreto.txt", { usuario: null })).status, 404);
    assertEquals((await call(app, "GET", "app/dist/../secreto.txt", { usuario: null })).status, 404);
    assertEquals((await call(app, "GET", "app/dist/nada.js", { usuario: null })).status, 404);
    // alias en la raíz: `/app/...` → `/api/app/...`
    const alias = aliasApp(new Request("http://t/app/ui/app.json"), "/api");
    assertEquals(new URL(alias.url).pathname, "/api/app/ui/app.json");
    assertEquals(new URL(aliasApp(new Request("http://t/apple"), "/api").url).pathname, "/apple");
    assertEquals((await app.router.fetch(alias)).status, 200);
  } finally {
    await app.db.destroy();
    await Deno.remove(new URL(front), { recursive: true });
  }
});

Deno.test("front real: labs/megaretail/front/index.html existe y monta <mr-app>", async () => {
  const index = await Deno.readTextFile(new URL("index.html", frontPorDefecto()));
  assert(index.includes("<mr-app"));
});
