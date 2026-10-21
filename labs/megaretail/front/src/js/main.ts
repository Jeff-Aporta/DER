/**
 * main.ts — arranque del front (bundle único `dist/app.js`): espera el loader del kit (CDN pineado), carga los CSS base
 * y los tags `iswc-*` que usa la app, y recién entonces define los componentes `mr-*` y monta `<mr-app>`.
 */
import { KIT_TAGS } from "./kit-tags.ts";

type Loader = { loadPageStyles(hrefs: string[]): Promise<unknown>; load(...ids: string[]): Promise<unknown> };

/** Espera a que el loader del kit exista en `globalThis` (lo pone `loader.min.js`). */
async function esperarLoader(ms = 8000): Promise<Loader> {
  const inicio = Date.now();
  while (Date.now() - inicio < ms) {
    const L = (globalThis as { iswcLoader?: Loader }).iswcLoader;
    if (L) return L;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("No se encontró iswcLoader: ¿falló el CDN del kit?");
}

/** Arranque: kit → componentes propios. */
export async function arrancar(): Promise<void> {
  const L = await esperarLoader();
  // el loader ya inyecta is-base.min.css al inicializar; la paleta por defecto se pide por alias
  await L.loadPageStyles(["iswc-palettes-default"]);
  await L.load(...KIT_TAGS);
  await import("./components/mr/mr-app.ts");
}

const listo = () => document.documentElement.setAttribute("data-app-ready", "");
const watchdog = setTimeout(() => {
  console.warn("[mr] el arranque excedió 8 s; se revela la página");
  listo();
}, 8000);
arrancar().catch((e: unknown) => {
  console.error("[mr] arranque", e);
  listo();
}).finally(() => clearTimeout(watchdog));
