/**
 * boot.ts — tema y paleta ANTES del primer pintado. Script plano (IIFE), síncrono en <head>.
 * Orden: localStorage del kit (`iswc-theme`, `iswc-palette`) > `light` / `contapyme`. El lab es de tema claro.
 */
(function () {
  const raiz = document.documentElement;
  const leer = (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const tema = leer("iswc-theme") === "dark" ? "dark" : "light";
  raiz.dataset["theme"] = tema;
  raiz.classList.toggle("theme-dark", tema === "dark");
  raiz.classList.toggle("theme-light", tema === "light");
  raiz.dataset["palette"] = leer("iswc-palette") || "contapyme";
})();
