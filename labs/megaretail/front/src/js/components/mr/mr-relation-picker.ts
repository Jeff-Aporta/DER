/**
 * <mr-relation-picker> — "data view" de una relación: modal (`<iswc-dialog>`) con el `<mr-entity-grid>` de la otra entidad.
 * `kind: "one"` → exactamente una fila (1:1 / N:1); `kind: "many"` → selección múltiple (1:N / N:M).
 * Emite `mr-pick` `{ filas }` al confirmar y `mr-cancel` al cerrar.
 */
import { crearComponente, define, emitir, html } from "../../base/componente.ts";
import type { DialogEl, RelationPickerProps } from "../../consts/schemas/componentes.schemas.ts";
import "./mr-entity-grid.ts";

const MrRelationPicker = crearComponente<RelationPickerProps>(
  import.meta.url,
  "mr-relation-picker",
  { entidad: "", kind: "one", abierto: false, valor: [], titulo: "Elegir" },
  (root, props, host) => {
    let elegidas: Record<string, unknown>[] = [];
    const alSeleccionar = (e: Event) => {
      elegidas = (e as CustomEvent<{ filas: Record<string, unknown>[] }>).detail.filas;
      root.querySelector<HTMLElement>(".confirmar")?.toggleAttribute("disabled", elegidas.length === 0);
      root.querySelector(".cuenta")!.textContent = elegidas.length ? `${elegidas.length} seleccionada${elegidas.length === 1 ? "" : "s"}` : "";
    };
    const confirmar = () => {
      emitir(host, "mr-pick", { filas: props.kind === "one" ? elegidas.slice(0, 1) : elegidas });
      host.props = { abierto: false };
    };
    const cerrar = () => {
      host.props = { abierto: false };
      emitir(host, "mr-cancel");
    };
    const alOcultar = () => {
      if (host.props.abierto) cerrar();
    };
    root.append(html`
      <iswc-dialog label=${props.titulo} backdrop-variant="basic" ?open=${props.abierto} oniswc-after-hide=${alOcultar}>
        <p class="ayuda" part="ayuda">${props.kind === "one" ? "Elige exactamente una fila." : "Marca todas las filas que quieras relacionar."}</p>
        <mr-entity-grid onmr-select=${alSeleccionar}></mr-entity-grid>
        <div slot="footer" class="pie">
          <span class="cuenta"></span>
          <iswc-button variant="text" color="neutral" onclick=${cerrar}>Cancelar</iswc-button>
          <iswc-button class="confirmar" color="brand" disabled onclick=${confirmar}>${props.kind === "one" ? "Seleccionar" : "Relacionar"}</iswc-button>
        </div>
      </iswc-dialog>
    `);
    const grid = root.querySelector<HTMLElement & { props: unknown }>("mr-entity-grid")!;
    grid.props = { entidad: props.entidad, seleccion: props.kind === "one" ? "single" : "multiple", pageSize: 10, alto: "50vh" };
  },
  (root, props, previos) => {
    if (props.entidad !== previos.entidad || props.kind !== previos.kind) return false;
    const dlg = root.querySelector<DialogEl>("iswc-dialog");
    if (dlg && props.abierto !== previos.abierto) dlg.open = props.abierto;
    if (dlg) dlg.setAttribute("label", props.titulo);
    return true;
  },
);

define("mr-relation-picker", MrRelationPicker);
