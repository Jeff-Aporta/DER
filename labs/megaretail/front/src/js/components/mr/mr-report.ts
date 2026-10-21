/**
 * <mr-report> — reporte definido en `ui/reportes.json`: parámetros (formulario generado, GET con query string),
 * indicadores (`<mr-stats>`) y la tabla (`<iswc-ag-grid>`) con columnas JSON, filtro y agrupación opcionales.
 */
import { avisar, crearComponente, define, html, mensajeDe } from "../../base/componente.ts";
import type { GridEl, ReportProps } from "../../consts/schemas/componentes.schemas.ts";
import type { Schema } from "@megaretail/vendor";
import { dominio } from "../../core/der.ts";
import { estado, puede } from "../../core/estado.ts";
import { aplicarUi, modeloDeSchema } from "../../core/form-model.ts";
import { aplanar, valorRuta } from "../../core/grid-model.ts";
import { reportesUi } from "../../core/ui-config.ts";
import "./mr-form.ts";
import "./mr-stats.ts";

/** Filas del resultado: `filas` (ruta) o el arreglo raíz; aplanadas y filtradas según el JSON. */
function filasDe(reporte: ReportProps["reporte"], datos: unknown): Record<string, unknown>[] {
  if (!reporte) return [];
  const base = reporte.filas ? valorRuta(datos, reporte.filas) : datos;
  const lista = Array.isArray(base) ? base as Record<string, unknown>[] : [];
  const filtro = reporte.filtro ?? {};
  return lista.filter((f) => Object.entries(filtro).every(([k, v]) => f[k] === v)).map((f, i) => ({ __id: String(i), ...aplanar(f, reporte.columnas) }));
}

async function consultar(props: ReportProps, host: HTMLElement & { props: Partial<ReportProps> }, params: Record<string, unknown>): Promise<void> {
  if (!props.reporte) return;
  host.props = { cargando: true, error: null };
  try {
    const limpio = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]));
    const datos = await dominio().call(props.reporte.path, Object.keys(limpio).length ? limpio : undefined);
    host.props = { datos, filas: filasDe(props.reporte, datos), cargando: false };
  } catch (err) {
    host.props = { cargando: false, error: mensajeDe(err), filas: [], datos: null };
    avisar(mensajeDe(err), "danger");
  }
}

const MrReport = crearComponente<ReportProps>(
  import.meta.url,
  "mr-report",
  { id: "", reporte: null, datos: null, filas: [], error: null, cargando: false, permitido: true },
  (root, props, host) => {
    if (!props.reporte) {
      root.append(html`<iswc-spinner></iswc-spinner>`);
      void reportesUi().then((reportes) => {
        const reporte = reportes[props.id];
        if (!reporte) throw new Error(`El reporte "${props.id}" no está en ui/reportes.json`);
        if (!host.isConnected) return;
        host.props = { reporte, permitido: puede(reporte.permiso, "GET") };
        void consultar({ ...props, reporte }, host, {});
      }).catch((err: unknown) => root.replaceChildren(html`<iswc-callout color="danger">${mensajeDe(err)}</iswc-callout>`));
      return;
    }
    const r = props.reporte;
    const modelo = r.params ? aplicarUi(modeloDeSchema({ columns: r.params.columns } as Schema, "crear"), { campos: r.campos }) : null;
    root.append(html`
      <section class="reporte" part="reporte">
        <header class="cabecera" part="cabecera">
          ${r.icon ? html`<iswc-icon icon=${r.icon}></iswc-icon>` : ""}
          <div>
            <h2>${r.titulo}</h2>
            ${r.descripcion ? html`<p class="descripcion">${r.descripcion}</p>` : ""}
          </div>
          ${r.permiso ? html`<iswc-badge color=${props.permitido ? "success" : "danger"} variant="soft">${r.permiso}</iswc-badge>` : ""}
        </header>
        ${props.permitido ? "" : html`<iswc-callout color="warning" icon="mdi:lock">${estado.usuario ? `El rol ${estado.perfil?.irol ?? ""} no tiene el permiso «${r.permiso}».` : "Sin usuario activo: elige uno en la barra superior."}</iswc-callout>`}
        ${modelo ? html`<iswc-card class="parametros"><mr-form onmr-submit=${(e: Event) => consultar(props, host, (e as CustomEvent<{ cuerpo: Record<string, unknown> }>).detail.cuerpo)}></mr-form></iswc-card>` : ""}
        ${props.error ? html`<iswc-callout color="danger" icon="mdi:alert-circle">${props.error}</iswc-callout>` : ""}
        <mr-stats></mr-stats>
        <div class="tabla" part="tabla">
          ${props.cargando ? html`<iswc-spinner class="cargando"></iswc-spinner>` : ""}
          <iswc-ag-grid density="compact" get-row-id="__id" group-by=${r.groupBy ?? ""}></iswc-ag-grid>
          ${!props.cargando && !props.filas.length ? html`<iswc-callout color="neutral" icon="mdi:database-remove-outline">Sin datos para estos parámetros.</iswc-callout>` : ""}
        </div>
      </section>
    `);
    const form = root.querySelector<HTMLElement & { props: unknown }>("mr-form");
    if (form && modelo) form.props = { modelo, modo: "crear", valor: {}, textoEnviar: "Consultar", textoCancelar: null };
    const stats = root.querySelector<HTMLElement & { props: unknown }>("mr-stats")!;
    stats.props = { stats: r.stats ?? [], datos: props.datos };
    const grid = root.querySelector<GridEl>("iswc-ag-grid")!;
    grid.api.setColumns(r.columnas.map((c) => ({ ...c, header: c.header ?? c.field, sortable: c.sortable ?? true, filter: c.filter ?? true })));
    grid.api.setRows(props.filas);
  },
);

define("mr-report", MrReport);
