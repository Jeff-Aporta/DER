/**
 * <mr-app> — shell de la app (`<iswc-app-shell>` + `<iswc-app-nav>`): navegación de `ui/app.json` (secciones → entidades,
 * flujos o reportes), el selector de usuario (`<mr-session>`) y la vista activa (`<mr-entity-view>`, `<mr-flow>` o
 * `<mr-report>`). Toda la app sale de JSON: no hay código por entidad.
 */
import { crearComponente, define, html, mensajeDe } from "../../base/componente.ts";
import type { AppProps, NavEl, NavRow, Vista } from "../../consts/schemas/componentes.schemas.ts";
import type { AppUi } from "../../consts/schemas/ui.schemas.ts";
import { conectar } from "../../core/der.ts";
import { alCambiar, estado, setVista } from "../../core/estado.ts";
import { appUi, flujosUi, reportesUi } from "../../core/ui-config.ts";
import { refrescarSesion } from "./mr-session.ts";
import "./mr-session.ts";
import "./mr-entity-view.ts";
import "./mr-flow.ts";
import "./mr-report.ts";

let ui: AppUi | null = null;
let flujos: Record<string, { titulo: string; icon?: string | undefined }> = {};
let reportes: Record<string, { titulo: string; icon?: string | undefined }> = {};

/** Filas de `<iswc-app-nav>`: la primaria con las secciones y una secundaria por sección. */
function filasNav(app: AppUi, vista: Vista): NavRow[] {
  const primaria: NavRow = { id: "seccion", value: vista.seccion, tabs: app.nav.map((s) => ({ id: s.id, label: s.label, icon: s.icon })) };
  const secundarias: NavRow[] = app.nav.map((s) => ({
    id: `tabs-${s.id}`,
    parent: s.id,
    value: vista.seccion === s.id ? vista.tab : (s.entidades?.[0] ?? s.flujos?.[0] ?? s.reportes?.[0] ?? ""),
    tabs: [
      ...(s.entidades ?? []).map((e) => ({ id: e, label: app.entidades[e]?.titulo ?? e, icon: app.entidades[e]?.icon })),
      ...(s.flujos ?? []).map((f) => ({ id: f, label: flujos[f]?.titulo ?? f, icon: flujos[f]?.icon })),
      ...(s.reportes ?? []).map((r) => ({ id: r, label: reportes[r]?.titulo ?? r, icon: reportes[r]?.icon })),
    ],
  }));
  return [primaria, ...secundarias];
}

/** Vista inicial: la primera pestaña de la primera sección (o la guardada en el hash `#seccion/tab`). */
function vistaInicial(app: AppUi): Vista {
  const hash = location.hash.replace(/^#/, "");
  const [seccion, tab] = hash.split("/");
  const s = app.nav.find((x) => x.id === seccion) ?? app.nav[0]!;
  const tabs = [...(s.entidades ?? []), ...(s.flujos ?? []), ...(s.reportes ?? [])];
  return { seccion: s.id, tab: tab && tabs.includes(tab) ? tab : tabs[0] ?? "" };
}

/** Componente de la vista activa según el tipo de pestaña. */
function vistaActiva(app: AppUi, vista: Vista, version: number): DocumentFragment {
  const s = app.nav.find((x) => x.id === vista.seccion);
  if (!s) return html`<iswc-callout color="danger">Sección desconocida.</iswc-callout>`;
  if (s.entidades?.includes(vista.tab)) {
    const el = document.createElement("mr-entity-view") as HTMLElement & { props: unknown };
    el.props = { entidad: vista.tab, version, seleccion: null, modo: "lista" };
    return html`${el}`;
  }
  if (s.flujos?.includes(vista.tab)) {
    const el = document.createElement("mr-flow") as HTMLElement & { props: unknown };
    el.props = { id: vista.tab, flujo: null, resultado: null, version };
    return html`${el}`;
  }
  if (s.reportes?.includes(vista.tab)) {
    const el = document.createElement("mr-report") as HTMLElement & { props: unknown };
    el.props = { id: vista.tab, reporte: null, datos: null, filas: [] };
    return html`${el}`;
  }
  return html`<iswc-callout color="neutral">Elige una pestaña.</iswc-callout>`;
}

const MrApp = crearComponente<AppProps>(import.meta.url, "mr-app", { vista: null, listo: false, error: null }, (root, props, host) => {
  if (props.error) {
    root.append(html`<iswc-callout color="danger" icon="mdi:alert">${props.error}</iswc-callout>`);
    return;
  }
  if (!props.listo || !ui) {
    root.append(html`<div class="cargando"><iswc-spinner></iswc-spinner><span>Cargando MegaRetail…</span></div>`);
    void (async () => {
      try {
        ui = await appUi();
        conectar(ui.api);
        flujos = await flujosUi();
        reportes = await reportesUi();
        if (!estado.usuario) {
          const { setUsuario } = await import("../../core/estado.ts");
          setUsuario(ui.usuarioInicial);
        }
        const vista = vistaInicial(ui);
        setVista(vista);
        host.props = { listo: true, vista };
        document.documentElement.setAttribute("data-app-ready", "");
      } catch (err) {
        host.props = { error: mensajeDe(err) };
      }
    })();
    return;
  }
  const app = ui;
  const vista = props.vista ?? vistaInicial(app);
  let version = 0;
  const alNavegar = (e: Event) => {
    const { row, id } = (e as CustomEvent<{ row: string; id: string }>).detail;
    const nav = e.currentTarget as NavEl;
    const actual = estado.vista ?? vista;
    const nueva: Vista = row === "seccion" ? vistaInicialDe(app, id) : { seccion: actual.seccion, tab: id };
    setVista(nueva);
    location.hash = `${nueva.seccion}/${nueva.tab}`;
    nav.rows = filasNav(app, nueva);
    root.querySelector(".vista")?.replaceChildren(vistaActiva(app, nueva, ++version));
    host.props.vista = nueva;
  };
  root.append(html`
    <iswc-app-shell brand=${app.titulo} logo=${app.logo ?? "mdi:domain"} toast="top-end" home-label="MegaRetail">
      <iswc-app-nav slot="nav" oniswc-nav-select=${alNavegar}></iswc-app-nav>
      <mr-session slot="actions"></mr-session>
      <iswc-theme-toggle slot="actions" scope="root"></iswc-theme-toggle>
      <main class="vista" part="vista">${vistaActiva(app, vista, version)}</main>
      <footer slot="footer" class="pie"><span>${app.subtitulo ?? ""}</span><span>DER por CDN · kit iswc · todo desde JSON</span></footer>
    </iswc-app-shell>
  `);
  const nav = root.querySelector<NavEl>("iswc-app-nav")!;
  nav.rows = filasNav(app, vista);
  const sesion = root.querySelector<HTMLElement & { props: Partial<Record<string, unknown>> }>("mr-session")!;
  void refrescarSesion(sesion);
  // al cambiar el perfil (usuario) la vista se repinta: botones, permisos y datos se reevalúan
  alCambiar("perfil", () => {
    const actual = estado.vista ?? vista;
    root.querySelector(".vista")?.replaceChildren(vistaActiva(app, actual, ++version));
  });
});

/** Primera pestaña de una sección. */
function vistaInicialDe(app: AppUi, seccion: string): Vista {
  const s = app.nav.find((x) => x.id === seccion) ?? app.nav[0]!;
  return { seccion: s.id, tab: s.entidades?.[0] ?? s.flujos?.[0] ?? s.reportes?.[0] ?? "" };
}

define("mr-app", MrApp);
