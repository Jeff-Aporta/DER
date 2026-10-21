/**
 * vendor.ts (script) — construye `vendor/megaretail.js`: bundle ESM de navegador, minificado, de `src/vendor.ts`
 * (DER cliente + zod + dominio MegaRetail). Se versiona en git para que jsDelivr lo sirva:
 * `https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@<sha>/labs/megaretail/api/vendor/megaretail.js`.
 */
const raiz = new URL("../", import.meta.url);
const ruta = (u: URL) => decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const salida = new URL("vendor/megaretail.js", raiz);

await Deno.mkdir(new URL("vendor/", raiz), { recursive: true });
const cmd = new Deno.Command(Deno.execPath(), {
  args: ["bundle", "--platform", "browser", "--format", "esm", "--minify", "-o", ruta(salida), ruta(new URL("src/vendor.ts", raiz))],
  cwd: ruta(raiz),
  stdout: "inherit",
  stderr: "inherit",
});
const { success } = await cmd.output();
if (!success) throw new Error("deno bundle falló: src/vendor.ts");
console.log(`[vendor] ${ruta(salida)} (${(await Deno.stat(salida)).size} bytes)`);
