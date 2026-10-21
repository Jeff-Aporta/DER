/**
 * <mr-form-lista> — campo de lista (carrito, ítems): cada fila es un `<mr-form compacto>` generado del `schema` del
 * campo (JSON tipo DER), con botones agregar/quitar. Emite `mr-cambio` `{ filas }`.
 */
import { crearComponente, define, emitir, html } from "../../base/componente.ts";
import type { FormListaProps } from "../../consts/schemas/componentes.schemas.ts";
import type { Schema } from "@megaretail/vendor";
import { aplicarUi, modeloDeSchema } from "../../core/form-model.ts";

const MrFormLista = crearComponente<FormListaProps>(import.meta.url, "mr-form-lista", { campo: null, filas: [] }, (root, props, host) => {
  const campo = props.campo;
  if (!campo?.schema) return;
  const modelo = aplicarUi(modeloDeSchema(campo.schema as Schema, "crear"), {});
  const filas = props.filas.map((f) => ({ ...f }));
  const avisar = () => emitir(host, "mr-cambio", { filas: filas.map((f) => ({ ...f })) });
  const agregar = () => {
    host.props = { filas: [...filas, {}] };
    emitir(host, "mr-cambio", { filas: [...filas, {}] });
  };
  const quitar = (i: number) => {
    const restantes = filas.filter((_, j) => j !== i);
    host.props = { filas: restantes };
    emitir(host, "mr-cambio", { filas: restantes });
  };
  root.append(html`
    <fieldset class="lista" part="lista">
      <legend class="label" part="label">${campo.label}${campo.hint ? html`<span class="hint">${campo.hint}</span>` : ""}</legend>
      ${filas.length ? "" : html`<p class="vacio">Sin ítems. Agrega el primero.</p>`}
      <ol class="filas" part="filas">
        ${filas.map((fila, i) => html`
          <li class="fila" part="fila">
            <span class="n">${i + 1}</span>
            <mr-form data-i=${String(i)} onmr-cambio=${(e: Event) => {
              // los cambios de los campos de la fila ya los resumió su mr-form (compacto): sólo esos cuentan
              e.stopPropagation();
              const valores = (e as CustomEvent<{ valores?: Record<string, unknown> }>).detail.valores;
              if (!valores) return;
              filas[i] = { ...fila, ...valores };
              avisar();
            }}></mr-form>
            <iswc-button variant="text" color="danger" size="small" title="Quitar" onclick=${() => quitar(i)}><iswc-icon icon="mdi:delete-outline"></iswc-icon></iswc-button>
          </li>`)}
      </ol>
      <iswc-button variant="outlined" color="brand" size="small" onclick=${agregar}><iswc-icon slot="start" icon="mdi:plus"></iswc-icon>Agregar ítem</iswc-button>
    </fieldset>
  `);
  for (const f of root.querySelectorAll<HTMLElement & { props: unknown }>("mr-form")) {
    const i = Number(f.dataset["i"]);
    f.props = { modelo, valor: filas[i] ?? {}, modo: "crear", compacto: true };
  }
});

define("mr-form-lista", MrFormLista);
