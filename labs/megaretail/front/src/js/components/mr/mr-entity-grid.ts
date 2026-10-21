/**
 * <mr-entity-grid> — listado de CUALQUIER entidad DER con el `<iswc-ag-grid>` del kit: columnas derivadas del schema +
 * JSON de UI, datos por `query` (`GET plural?q=<base64url>`) con paginación en el server y las relaciones `one`
 * incluidas para mostrar su etiqueta. Selección `none | single | multiple`; emite `mr-select` `{ filas }` y `mr-page`.
 */
import { avisar, crearComponente, define, emitir, html, mensajeDe } from "../../base/componente.ts";
import type { EntityGridProps, GridEl } from "../../consts/schemas/componentes.schemas.ts";
import { controller } from "../../core/der.ts";
import { destinos, resolverEntidad } from "../../core/entidades.ts";
import { columnasDe, filaGrid, includeDe, ROW_ID } from "../../core/grid-model.ts";
import "./mr-pager.ts";

/** Consulta la página y pinta; `version` fuerza la recarga. */
async function cargar(root: ShadowRoot, props: EntityGridProps, host: HTMLElement): Promise<void> {
  const grid = root.querySelector<GridEl>("iswc-ag-grid");
  const pager = root.querySelector<HTMLElement & { props: unknown }>("mr-pager");
  if (!grid) return;
  host.toggleAttribute("cargando", true);
  try {
    const e = await resolverEntidad(props.entidad);
    const rel = await destinos(e.entity);
    const columnas = columnasDe(e.entity.pojo.schema, e.ui, (target) => (rel.get(target) ? target : null));
    const spec: Record<string, unknown> = { page: props.page, pageSize: props.pageSize, include: includeDe(e.entity.pojo.schema, e.ui) };
    if (props.where) spec["where"] = props.where;
    if (e.ui.orderBy) spec["orderBy"] = e.ui.orderBy;
    const filas = await controller(props.entidad).query(spec);
    const rows = filas.map((p) => filaGrid(e.entity, p.toJSON(), (target, fila) => rel.get(target)?.etiqueta(fila) ?? ""));
    grid.api.setColumns(columnas);
    grid.api.setRows(rows);
    grid.api.clearSelection();
    if (pager) pager.props = { page: props.page, pageSize: props.pageSize, cantidad: rows.length };
    root.querySelector(".vacio")?.toggleAttribute("hidden", rows.length > 0);
  } catch (err) {
    avisar(mensajeDe(err), "danger");
    grid.api.setRows([]);
    root.querySelector(".vacio")?.toggleAttribute("hidden", false);
  } finally {
    host.toggleAttribute("cargando", false);
  }
}

const MrEntityGrid = crearComponente<EntityGridProps>(
  import.meta.url,
  "mr-entity-grid",
  { entidad: "", seleccion: "single", pageSize: 25, page: 1, where: undefined, version: 0, alto: "60vh", seleccionados: [] },
  (root, props, host) => {
    const alSeleccionar = (e: Event) => {
      const grid = e.currentTarget as GridEl;
      emitir(host, "mr-select", { filas: grid.api.getSelectedRows() });
    };
    const alPaginar = (e: Event) => {
      const { page, pageSize } = (e as CustomEvent<{ page: number; pageSize: number }>).detail;
      host.props = { page, pageSize };
      emitir(host, "mr-page", { page, pageSize });
    };
    const multiple = props.seleccion === "multiple";
    root.append(html`
      <div class="grid" part="grid" style=${`--mr-grid-alto: ${props.alto}`}>
        <iswc-ag-grid density="compact" get-row-id=${ROW_ID} row-selection=${props.seleccion === "none" ? "none" : props.seleccion} ?selectable=${multiple} oniswc-row-select=${alSeleccionar}></iswc-ag-grid>
        <iswc-callout class="vacio" color="neutral" icon="mdi:database-remove-outline" hidden>No hay filas en esta página.</iswc-callout>
      </div>
      <mr-pager onmr-page=${alPaginar}></mr-pager>
    `);
    if (props.entidad) void cargar(root, props, host);
  },
  (root, props, previos, host) => {
    // cambios de página/versión/entidad recargan los datos sin reconstruir el grid
    const mismo = props.entidad === previos.entidad && props.seleccion === previos.seleccion && props.alto === previos.alto;
    if (!mismo) return false;
    void cargar(root, props, host);
    return true;
  },
);

define("mr-entity-grid", MrEntityGrid);
