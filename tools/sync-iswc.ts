/**
 * Trae lo último de iswc que DER usa por URL (`Obj` virtual y sus contratos) y lo deja al día:
 *   1. recarga la caché de Deno para esas URLs (los imports de `src/00 common/obj.ts` y `schemas.ts`);
 *   2. copia los mismos archivos a `.iswc/` para `tsc` (tsconfig `paths` mapea la URL a esa carpeta).
 * Uso: deno task sync
 */
const BASE = "https://raw.githubusercontent.com/Jeff-Aporta/is-webcomponents/main/src/vendor-distributions/shared/";
const ARCHIVOS = ["lib/obj.ts", "schemas.ts"];
const raiz = new URL("../", import.meta.url);

for (const f of ARCHIVOS) {
  const r = await fetch(BASE + f, { cache: "no-store" });
  if (!r.ok) throw new Error(`${BASE + f}: ${r.status}`);
  const destino = new URL(`.iswc/${f}`, raiz);
  await Deno.mkdir(new URL("./", destino), { recursive: true });
  await Deno.writeTextFile(destino, await r.text());
  console.log(`.iswc/${f}`);
}

// El lockfile fija el hash de cada módulo remoto: se sueltan los de iswc para aceptar su versión vigente.
const lock = new URL("deno.lock", raiz);
try {
  const d = JSON.parse(await Deno.readTextFile(lock));
  for (const k of Object.keys(d.remote ?? {})) if (k.startsWith(BASE)) delete d.remote[k];
  await Deno.writeTextFile(lock, JSON.stringify(d, null, 2) + "\n");
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
}

const cache = new Deno.Command(Deno.execPath(), {
  args: ["cache", `--reload=${BASE}`, "mod.ts"],
  cwd: raiz,
  stdout: "inherit",
  stderr: "inherit",
});
const { code } = await cache.output();
if (code !== 0) Deno.exit(code);
console.log("iswc al día");
