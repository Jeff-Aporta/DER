/**
 * componente.ts — base común de los componentes `mr-*` (estándar iswc-foundation, adaptada al bundle único del lab).
 *
 * Cuatro cosas: adopción del CSS hermano (`adoptCss`), plantillas (`html`), registro idempotente (`define`) y la
 * fábrica `crearComponente`. En este lab todos los componentes viven en `dist/app.js`, así que la hoja de cada tag
 * se resuelve como `dist/<tag>.css` (misma carpeta del bundle). Hojas adoptadas: sin parpadeo al repintar.
 */

const HOJAS = new Map<string, CSSStyleSheet>();
const CARGAS = new Map<string, Promise<CSSStyleSheet | null>>();
const SOPORTA_HOJAS = (() => {
  try {
    return "adoptedStyleSheets" in ShadowRoot.prototype && typeof new CSSStyleSheet().replaceSync === "function";
  } catch {
    return false;
  }
})();

/** `…/app.js` → `…/<nombre>.css` (la hoja hermana vive junto al bundle). */
function hrefCss(moduleUrl: string, nombre: string): string {
  const u = new URL(moduleUrl);
  u.pathname = u.pathname.replace(/[^/]+$/, `${nombre}.css`);
  u.search = "";
  return u.href;
}

function descargarHoja(href: string): Promise<CSSStyleSheet | null> {
  const enCurso = CARGAS.get(href);
  if (enCurso) return enCurso;
  const carga = fetch(href)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status} ${href}`))))
    .then((texto) => {
      const hoja = new CSSStyleSheet();
      hoja.replaceSync(texto);
      HOJAS.set(href, hoja);
      return hoja;
    })
    .catch(() => null);
  CARGAS.set(href, carga);
  return carga;
}

/** Empieza a bajar la hoja al definir el componente (el primer pintado tampoco parpadea). */
export function precargarCss(moduleUrl: string, nombre: string): void {
  if (SOPORTA_HOJAS) void descargarHoja(hrefCss(moduleUrl, nombre));
}

/** Adopta la hoja hermana. Llamar DESPUÉS de rellenar el shadow (el <link> de respaldo es un hijo). */
export function adoptCss(shadow: ShadowRoot, moduleUrl: string, nombre: string): void {
  const href = hrefCss(moduleUrl, nombre);
  const adoptar = (h: CSSStyleSheet) => {
    if (!shadow.adoptedStyleSheets.includes(h)) shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, h];
  };
  const enlazar = () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    shadow.prepend(link);
    return link;
  };
  if (!SOPORTA_HOJAS) {
    if (!shadow.querySelector("link[rel=\"stylesheet\"]")) enlazar();
    return;
  }
  const hoja = HOJAS.get(href);
  if (hoja) return adoptar(hoja);
  const link = enlazar();
  void descargarHoja(href).then((h) => {
    if (!h) return;
    adoptar(h);
    link.remove();
  });
}

/* ── Plantillas ─────────────────────────────────────────────── */

/** Escape HTML de un valor (lo que hace seguro pintar datos de terceros). */
export const esc = (s: unknown): string => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const CRUDO = Symbol("html-crudo");
/** HTML de confianza (ya saneado) dentro de `html`. */
export const raw = (valor: unknown): Record<symbol, string> => ({ [CRUDO]: String(valor ?? "") });
const esCrudo = (v: unknown): v is Record<symbol, string> => typeof v === "object" && v !== null && CRUDO in v;

/**
 * `html` — plantilla etiquetada que devuelve un DocumentFragment.
 *   primitivo → texto escapado · Node/fragmento → se monta tal cual · array → cada elemento
 *   `on<evento>=${fn}` → addEventListener (admite guiones: `oniswc-change`) · `raw(x)` → HTML crudo
 *   `?attr=${bool}` → atributo booleano · `attr=${valor}` → valor citado y escapado · null/false/true → nada.
 */
export const html = (strings: TemplateStringsArray, ...values: unknown[]): DocumentFragment => {
  const nodos: Node[] = [];
  const handlers: Array<{ evento: string; fn: EventListener }> = [];
  let acc = "";
  for (let i = 0; i < strings.length; i++) {
    acc += strings[i];
    if (i >= values.length) continue;
    const v = values[i];
    const booleano = acc.match(/\s+\?([\w-]+)=\s*$/);
    if (booleano) {
      acc = acc.slice(0, acc.length - booleano[0].length) + (v === true ? ` ${booleano[1]}` : "");
      continue;
    }
    // `attr=${valor}` sin comillas: el valor se cita y escapa completo (espacios incluidos); null/false → ""
    const atributo = typeof v !== "function" && acc.match(/\s[\w-]+=$/);
    if (atributo && !(v instanceof Node) && !Array.isArray(v) && !esCrudo(v)) {
      acc += `"${v == null || v === false ? "" : esc(v)}"`;
      continue;
    }
    if (v == null || v === false || v === true) continue;
    const evento = typeof v === "function" ? acc.match(/\s+on([a-zA-Z][\w-]*)=\s*$/) : null;
    if (evento) {
      acc = `${acc.slice(0, acc.length - evento[0].length)} data-ev="${handlers.length}"`;
      handlers.push({ evento: evento[1]!.toLowerCase(), fn: v as EventListener });
      continue;
    }
    for (const item of Array.isArray(v) ? v : [v]) {
      if (item == null || item === false || item === true) continue;
      if (item instanceof Node) {
        acc += `<template data-nodo="${nodos.length}"></template>`;
        nodos.push(item);
      } else acc += esCrudo(item) ? item[CRUDO] : esc(item);
    }
  }
  const t = document.createElement("template");
  t.innerHTML = acc;
  for (const m of [...t.content.querySelectorAll<HTMLElement>("template[data-nodo]")]) {
    m.replaceWith(nodos[Number(m.dataset["nodo"])] ?? document.createComment("nodo"));
  }
  for (const n of [...t.content.querySelectorAll<HTMLElement>("[data-ev]")]) {
    const h = handlers[Number(n.dataset["ev"])];
    if (h) n.addEventListener(h.evento, h.fn);
    n.removeAttribute("data-ev");
  }
  return t.content;
};

/* ── Registro y fábrica ─────────────────────────────────────── */

/** Registro idempotente: el string del tag es exactamente el nombre de la hoja. */
export const define = (tag: string, clase: CustomElementConstructor): void => {
  if (!customElements.get(tag)) customElements.define(tag, clase);
};

/** Emite un evento de dominio que cruza el Shadow DOM. Única forma de emitir. */
export const emitir = (host: HTMLElement, nombre: string, detail?: unknown): void => {
  host.dispatchEvent(new CustomEvent(nombre, { detail, bubbles: true, composed: true }));
};

/** Props asignadas ANTES de definir el tag quedan como propiedad propia que sombrea el setter: se rescatan al conectar. */
export function adoptarPropsTardias(host: HTMLElement & { props?: unknown }): void {
  if (!Object.prototype.hasOwnProperty.call(host, "props")) return;
  const tardias = host.props;
  delete (host as { props?: unknown }).props;
  host.props = tardias;
}

/** Host con `props` tipadas (lo que devuelve la fábrica): se lee completo y se escribe parcial (mezcla). */
export type HostProps<P> = HTMLElement & { get props(): P; set props(v: Partial<P> | null | undefined) };

/**
 * Fábrica de componente: `props` mezcla lo nuevo con lo anterior y repinta. `nombre` = tag = nombre de la hoja.
 * `parcial` evita el repintado completo cuando devuelve `true`.
 */
export function crearComponente<P extends object>(
  moduleUrl: string,
  nombre: string,
  inicial: P,
  render: (root: ShadowRoot, props: P, host: HostProps<P>) => void,
  parcial?: (root: ShadowRoot, props: P, previos: P, host: HostProps<P>) => boolean,
): CustomElementConstructor {
  precargarCss(moduleUrl, nombre);
  return class extends HTMLElement {
    #props: P = inicial;
    #root = this.attachShadow({ mode: "open" });

    connectedCallback(): void {
      adoptarPropsTardias(this);
      this.#pintar();
    }

    get props(): P {
      return this.#props;
    }

    set props(v: Partial<P> | null | undefined) {
      const previos = this.#props;
      this.#props = { ...previos, ...(v ?? {}) };
      if (!this.isConnected) return;
      if (parcial?.(this.#root, this.#props, previos, this as unknown as HostProps<P>)) return;
      this.#pintar();
    }

    #pintar(): void {
      this.#root.replaceChildren();
      render(this.#root, this.#props, this as unknown as HostProps<P>);
      adoptCss(this.#root, moduleUrl, nombre);
    }
  };
}

/** Notificación con el toast del shell (`<iswc-app-shell toast>`); si no está montado, consola. */
export function avisar(mensaje: string, color: "brand" | "success" | "warning" | "danger" | "neutral" = "brand"): void {
  const shell = document.querySelector("iswc-app-shell") as (HTMLElement & { toast?(m: string, o?: object): unknown }) | null;
  if (shell?.toast) void shell.toast(mensaje, { color, duration: color === "danger" ? 8000 : 4000 });
  else console.info(`[mr] ${color}: ${mensaje}`);
}

/** Mensaje de un error cualquiera (DER lanza `HttpError`/`ValidationError` con `message`). */
export function mensajeDe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
