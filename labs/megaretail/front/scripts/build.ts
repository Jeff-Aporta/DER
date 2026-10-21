/**
 * build.ts — construye `dist/`: cada `.scss` de los componentes → `dist/<tag>.css` (sass), `src/styles/app.scss` →
 * `dist/app.css`, `src/js/boot.ts` → `dist/boot.js` y el bundle único `src/js/main.ts` → `dist/app.js`
 * (`deno bundle --platform browser`: resuelve DER por CDN y zod por npm). `--watch` reconstruye al cambiar `src/`.
 */
import * as sass from "sass";

const raiz = new URL("../", import.meta.url);
const dist = new URL("dist/", raiz);
const ruta = (u: URL) => decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, "$1"));

async function listar(dir: URL, ext: string): Promise<URL[]> {
  const out: URL[] = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile && e.name.endsWith(ext)) out.push(new URL(e.name, dir));
  return out.sort((a, b) => a.href.localeCompare(b.href));
}

async function scss(): Promise<void> {
  const estilos = new URL("src/styles/", raiz);
  const componentes = new URL("src/js/components/mr/", raiz);
  const compilar = async (archivo: URL, salida: string) => {
    const r = sass.compile(ruta(archivo), { loadPaths: [ruta(estilos)], style: "compressed" });
    await Deno.writeTextFile(new URL(salida, dist), r.css);
  };
  await compilar(new URL("app.scss", estilos), "app.css");
  for (const f of await listar(componentes, ".scss")) {
    const nombre = f.pathname.split("/").at(-1)!.replace(/\.scss$/, "");
    await compilar(f, `${nombre}.css`);
  }
}

async function bundle(entrada: string, salida: string): Promise<void> {
  const cmd = new Deno.Command(Deno.execPath(), { args: ["bundle", "--platform", "browser", "--minify", "--external", "@megaretail/vendor", "-o", ruta(new URL(salida, dist)), ruta(new URL(entrada, raiz))], cwd: ruta(raiz), stdout: "inherit", stderr: "inherit" });
  const { success } = await cmd.output();
  if (!success) throw new Error(`deno bundle falló: ${entrada}`);
}

/** Construye todo una vez. */
export async function construir(): Promise<void> {
  await Deno.mkdir(dist, { recursive: true });
  await scss();
  await bundle("src/js/boot.ts", "boot.js");
  await bundle("src/js/main.ts", "app.js");
  const stamp = { build: new Date().toISOString() };
  await Deno.writeTextFile(new URL("build-stamp.json", dist), JSON.stringify(stamp, null, 2));
  console.log(`[build] dist listo (${stamp.build})`);
}

if (import.meta.main) {
  await construir();
  if (Deno.args.includes("--watch")) {
    console.log("[build] vigilando src/ …");
    let pendiente: number | null = null;
    for await (const _ of Deno.watchFs(ruta(new URL("src/", raiz)))) {
      if (pendiente !== null) clearTimeout(pendiente);
      pendiente = setTimeout(() => void construir().catch((e: unknown) => console.error(e)), 120);
    }
  }
}
