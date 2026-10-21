/**
 * <mr-pager> — paginador de consultas DER (`page`/`pageSize`): anterior/siguiente, número de página y tamaño.
 * DER no devuelve el total de filas, así que "siguiente" se deshabilita cuando la página trae menos filas que `pageSize`.
 * Emite `mr-page` `{ page, pageSize }`.
 */
import { crearComponente, define, emitir, html } from "../../base/componente.ts";
import type { PagerProps, SelectEl } from "../../consts/schemas/componentes.schemas.ts";

const MrPager = crearComponente<PagerProps>(import.meta.url, "mr-pager", { page: 1, pageSize: 25, cantidad: 0, opciones: [10, 25, 50, 100] }, (root, props, host) => {
  const ir = (page: number) => emitir(host, "mr-page", { page: Math.max(1, page), pageSize: props.pageSize });
  const tamano = (e: Event) => emitir(host, "mr-page", { page: 1, pageSize: Number((e.target as SelectEl).value) || props.pageSize });
  const ultima = props.cantidad < props.pageSize;
  root.append(html`
    <nav class="pager" part="pager" aria-label="Paginación">
      <iswc-button variant="outlined" color="neutral" size="small" ?disabled=${props.page <= 1} onclick=${() => ir(props.page - 1)}>
        <iswc-icon slot="start" icon="mdi:chevron-left"></iswc-icon>Anterior
      </iswc-button>
      <span class="info" part="info">Página <strong>${props.page}</strong> · ${props.cantidad} fila${props.cantidad === 1 ? "" : "s"}${ultima ? " · fin" : ""}</span>
      <iswc-button variant="outlined" color="neutral" size="small" ?disabled=${ultima} onclick=${() => ir(props.page + 1)}>
        Siguiente<iswc-icon slot="end" icon="mdi:chevron-right"></iswc-icon>
      </iswc-button>
      <iswc-select class="tamano" label="Por página" label-placement="start" value=${String(props.pageSize)} oniswc-change=${tamano}>
        ${props.opciones.map((n) => html`<iswc-option value=${String(n)}>${n}</iswc-option>`)}
      </iswc-select>
    </nav>
  `);
});

define("mr-pager", MrPager);
