/**
 * <mr-form> — formulario GENERADO desde un `FormModel` (schema DER + JSON de UI): cada campo elige su control del kit
 * (`iswc-input`, `iswc-select`/`iswc-radio-group` para enums, `iswc-date-field`/`iswc-date-time-field` con ISO 8601,
 * `iswc-switch`, `iswc-textarea`, `<mr-relation-field>` para relaciones y `<mr-form-lista>` para listas).
 * Al enviar arma el cuerpo (`cuerpoDe`), lo valida con `validar` (el Zod de DER) y emite `mr-submit` `{ cuerpo }`.
 * En modo `compacto` no tiene botones: emite `mr-cambio` `{ valores }` con cada cambio (filas de una lista).
 */
import { crearComponente, define, emitir, html, mensajeDe } from "../../base/componente.ts";
import type { CheckedEl, FormProps, ValorEl } from "../../consts/schemas/componentes.schemas.ts";
import type { CampoUi } from "../../consts/schemas/ui.schemas.ts";
import { aControl, campoDelError, camposVisibles, cuerpoDe } from "../../core/form-model.ts";
import "./mr-relation-field.ts";
import "./mr-form-lista.ts";

/** Control del kit para un campo. */
function control(campo: CampoUi, valor: unknown, alCambiar: (nombre: string, v: unknown) => void, error: string | undefined, modo: "crear" | "editar"): DocumentFragment {
  const v = aControl(campo, valor);
  const disabled = campo.soloLectura;
  const comun = { label: campo.label, name: campo.nombre };
  const cambio = (e: Event) => alCambiar(campo.nombre, (e.target as ValorEl).value);
  const err = error ?? "";
  switch (campo.control) {
    case "select":
      return html`<iswc-select label=${comun.label} name=${comun.name} value=${String(v ?? "")} ?required=${campo.requerido} ?disabled=${disabled} ?clearable=${!campo.requerido} ?error=${!!err} error-text=${err} hint=${campo.hint ?? ""} oniswc-change=${cambio}>
        ${(campo.opciones ?? []).map((o) => html`<iswc-option value=${o.value}>${o.label}</iswc-option>`)}
      </iswc-select>`;
    case "radio":
      return html`<iswc-radio-group label=${comun.label} name=${comun.name} value=${String(v ?? "")} row ?required=${campo.requerido} ?disabled=${disabled} ?error=${!!err} error-text=${err} hint=${campo.hint ?? ""} oniswc-change=${cambio}>
        ${(campo.opciones ?? []).map((o) => html`<iswc-radio value=${o.value}>${o.label}</iswc-radio>`)}
      </iswc-radio-group>`;
    case "fecha":
      return html`<iswc-date-field label=${comun.label} name=${comun.name} value=${String(v ?? "")} ?required=${campo.requerido} ?disabled=${disabled} ?clearable=${!campo.requerido} ?invalid=${!!err} hint=${err || campo.hint || ""} oniswc-change=${cambio}></iswc-date-field>`;
    case "fechahora":
      return html`<iswc-date-time-field label=${comun.label} name=${comun.name} value=${String(v ?? "")} hour24 ?required=${campo.requerido} ?disabled=${disabled} ?clearable=${!campo.requerido} ?invalid=${!!err} hint=${err || campo.hint || "Hora local; se guarda en UTC (ISO 8601)"} oniswc-change=${cambio}></iswc-date-time-field>`;
    case "hora":
      return html`<iswc-input type="time" step="1" label=${comun.label} name=${comun.name} value=${String(v ?? "")} ?required=${campo.requerido} ?disabled=${disabled} ?error=${!!err} error-text=${err} oniswc-change=${cambio}></iswc-input>`;
    case "bool":
      return html`<iswc-switch name=${comun.name} ?checked=${!!v} ?disabled=${disabled} hint=${campo.hint ?? ""} oniswc-change=${(e: Event) => alCambiar(campo.nombre, (e.target as CheckedEl).checked)}>${comun.label}</iswc-switch>`;
    case "textarea":
    case "json":
      return html`<iswc-textarea label=${comun.label} name=${comun.name} value=${String(v ?? "")} rows=${campo.control === "json" ? "5" : "3"} ?required=${campo.requerido} ?disabled=${disabled} ?error=${!!err} error-text=${err} hint=${campo.hint ?? (campo.control === "json" ? "JSON" : "")} placeholder=${campo.placeholder ?? ""} oniswc-change=${cambio}></iswc-textarea>`;
    case "relacion":
      return html`<mr-relation-field onmr-cambio=${(e: Event) => {
        e.stopPropagation();
        alCambiar(campo.nombre, (e as CustomEvent<{ valor: unknown }>).detail.valor);
      }}></mr-relation-field>`;
    case "lista":
      return html`<mr-form-lista onmr-cambio=${(e: Event) => {
        e.stopPropagation();
        alCambiar(campo.nombre, (e as CustomEvent<{ filas: unknown[] }>).detail.filas);
      }}></mr-form-lista>`;
    case "entero":
    case "numero":
      return html`<iswc-input type="number" step=${campo.control === "entero" ? "1" : String(campo.paso ?? "any")} min=${campo.min !== undefined ? String(campo.min) : ""} max=${campo.max !== undefined ? String(campo.max) : ""} label=${comun.label} name=${comun.name} value=${String(v ?? "")} ?required=${campo.requerido} ?disabled=${disabled} ?error=${!!err} error-text=${err} hint=${campo.hint ?? ""} placeholder=${campo.placeholder ?? ""} oniswc-change=${cambio}></iswc-input>`;
    default:
      return html`<iswc-input type="text" label=${comun.label} name=${comun.name} value=${String(v ?? "")} maxlength=${campo.max !== undefined ? String(campo.max) : ""} ?required=${campo.requerido} ?disabled=${disabled && modo === "editar"} ?readonly=${disabled} ?error=${!!err} error-text=${err} hint=${campo.hint ?? ""} placeholder=${campo.placeholder ?? ""} ?clearable=${!campo.requerido && !disabled} oniswc-change=${cambio}></iswc-input>`;
  }
}

const MrForm = crearComponente<FormProps>(
  import.meta.url,
  "mr-form",
  { modelo: null, valor: {}, modo: "crear", validar: null, enviando: false, error: null, errores: {}, textoEnviar: "Guardar", textoCancelar: "Cancelar", compacto: false },
  (root, props, host) => {
    const modelo = props.modelo;
    if (!modelo) return;
    const valores: Record<string, unknown> = { ...props.valor };
    const alCambiar = (nombre: string, v: unknown) => {
      valores[nombre] = v;
      if (!props.compacto) return;
      // compacto (fila de una lista): se emiten los valores ya convertidos para la API (números, fechas ISO)
      try {
        emitir(host, "mr-cambio", { valores: cuerpoDe(modelo, valores, props.modo) });
      } catch {
        emitir(host, "mr-cambio", { valores: { ...valores } });
      }
    };
    const enviar = (e: Event) => {
      e.preventDefault();
      try {
        const cuerpo = cuerpoDe(modelo, valores, props.modo);
        const mensaje = props.validar ? props.validar(cuerpo) : null;
        if (mensaje) {
          const campo = campoDelError(modelo, mensaje);
          host.props = { valor: { ...valores }, error: campo ? null : mensaje, errores: campo ? { [campo]: mensaje } : {} };
          return;
        }
        host.props = { valor: { ...valores }, error: null, errores: {} };
        emitir(host, "mr-submit", { cuerpo });
      } catch (err) {
        host.props = { valor: { ...valores }, error: mensajeDe(err), errores: {} };
      }
    };
    const cancelar = () => emitir(host, "mr-cancel");
    const visibles = camposVisibles(modelo);
    const form = html`
      <form class="form" part="form" ?data-compacto=${props.compacto} novalidate onsubmit=${enviar}>
        ${props.error ? html`<iswc-callout color="danger" icon="mdi:alert-circle">${props.error}</iswc-callout>` : ""}
        <div class="campos" part="campos">
          ${visibles.map((campo) => html`<div class="campo" data-nombre=${campo.nombre} ?data-completo=${campo.ancho === "completo" || campo.control === "lista" || campo.control === "textarea" || campo.control === "json"}>${control(campo, valores[campo.nombre] ?? campo.valor, alCambiar, props.errores[campo.nombre], props.modo)}</div>`)}
        </div>
        ${props.compacto ? "" : html`
          <div class="acciones" part="acciones">
            ${props.textoCancelar ? html`<iswc-button type="button" variant="text" color="neutral" onclick=${cancelar}>${props.textoCancelar}</iswc-button>` : ""}
            <iswc-button type="button" color="brand" ?loading=${props.enviando} ?disabled=${props.enviando} onclick=${enviar}><iswc-icon slot="start" icon="mdi:content-save-outline"></iswc-icon>${props.textoEnviar}</iswc-button>
          </div>`}
      </form>
    `;
    root.append(form);
    // los campos compuestos reciben sus props después de montarse (no se pueden pasar por atributo)
    for (const campo of visibles) {
      const caja = root.querySelector(`.campo[data-nombre="${campo.nombre}"]`);
      const rel = caja?.querySelector<HTMLElement & { props: unknown }>("mr-relation-field");
      if (rel) rel.props = { campo, valor: valores[campo.nombre] ?? campo.valor ?? null, disabled: campo.soloLectura, error: props.errores[campo.nombre] ?? null };
      const lista = caja?.querySelector<HTMLElement & { props: unknown }>("mr-form-lista");
      if (lista) lista.props = { campo, filas: Array.isArray(valores[campo.nombre]) ? valores[campo.nombre] : [] };
    }
  },
);

define("mr-form", MrForm);
