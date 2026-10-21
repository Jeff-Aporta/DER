/**
 * <mr-flow> — pantalla de un flujo de negocio definido en `ui/flujos.json`: el formulario se genera del `schema` del
 * flujo (JSON tipo DER: relaciones → selectores modales, listas → carrito) y al enviar llama el `path` del plugin DER
 * (`createClient(...).call`, que valida con el Zod del path antes del fetch). Muestra el resultado y respeta `permiso`.
 */
import { avisar, crearComponente, define, html, mensajeDe } from "../../base/componente.ts";
import type { FlowProps } from "../../consts/schemas/componentes.schemas.ts";
import type { Schema } from "@Jeff-Aporta/DER/index.ts";
import { dominio } from "../../core/der.ts";
import { estado, puede } from "../../core/estado.ts";
import { aplicarUi, modeloDeSchema } from "../../core/form-model.ts";
import { flujosUi } from "../../core/ui-config.ts";
import "./mr-form.ts";

const moneda = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 });

/** Valor legible de una celda del resultado. */
function legible(k: string, v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return /total|precio|costo|monto/.test(k) ? moneda.format(v) : String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const nombre = o["nombre"] ?? o["razon_social"] ?? o["consecutivo"] ?? o["sku"];
    return nombre != null ? String(nombre) : JSON.stringify(v);
  }
  return String(v);
}

/** Resultado como lista clave → valor (objeto) o tabla (lista de objetos). */
function resultado(datos: unknown): DocumentFragment {
  if (Array.isArray(datos)) {
    if (!datos.length) return html`<p class="vacio">Sin filas.</p>`;
    const claves = Object.keys(datos[0] as Record<string, unknown>).filter((k) => typeof (datos[0] as Record<string, unknown>)[k] !== "object");
    return html`<table class="tabla"><thead><tr>${claves.map((k) => html`<th>${k}</th>`)}</tr></thead><tbody>${datos.map((fila) => html`<tr>${claves.map((k) => html`<td>${legible(k, (fila as Record<string, unknown>)[k])}</td>`)}</tr>`)}</tbody></table>`;
  }
  if (datos && typeof datos === "object") {
    const entradas = Object.entries(datos as Record<string, unknown>);
    return html`<dl class="kv">${entradas.map(([k, v]) => html`<div class="par"><dt>${k}</dt><dd>${Array.isArray(v) && v.length && typeof v[0] === "object" ? resultado(v) : legible(k, v)}</dd></div>`)}</dl>`;
  }
  return html`<p>${String(datos)}</p>`;
}

const MrFlow = crearComponente<FlowProps>(
  import.meta.url,
  "mr-flow",
  { id: "", flujo: null, resultado: null, error: null, permitido: true, version: 0 },
  (root, props, host) => {
    if (!props.flujo) {
      root.append(html`<iswc-spinner></iswc-spinner>`);
      void flujosUi().then((flujos) => {
        const flujo = flujos[props.id];
        if (!flujo) throw new Error(`El flujo "${props.id}" no está en ui/flujos.json`);
        if (host.isConnected) host.props = { flujo, permitido: puede(flujo.permiso, "POST") };
      }).catch((err: unknown) => root.replaceChildren(html`<iswc-callout color="danger">${mensajeDe(err)}</iswc-callout>`));
      return;
    }
    const flujo = props.flujo;
    const modelo = aplicarUi(modeloDeSchema(flujo.schema as Schema, "crear"), flujo);
    const enviar = async (ev: Event) => {
      const cuerpo = (ev as CustomEvent<{ cuerpo: Record<string, unknown> }>).detail.cuerpo;
      const form = ev.target as HTMLElement & { props: unknown };
      if (flujo.confirmar && !confirm(flujo.confirmar)) return;
      form.props = { enviando: true, error: null };
      try {
        const pks: Record<string, string> = {};
        for (const [pk, campo] of Object.entries(flujo.pks ?? {})) {
          pks[pk] = String(cuerpo[campo] ?? "");
          delete cuerpo[campo];
        }
        const datos = await dominio().call(flujo.path, cuerpo, pks);
        const json = datos && typeof datos === "object" && "toJSON" in datos ? (datos as { toJSON(): unknown }).toJSON() : Array.isArray(datos) ? datos.map((d) => (d && typeof d === "object" && "toJSON" in d ? (d as { toJSON(): unknown }).toJSON() : d)) : datos;
        avisar(`${flujo.titulo}: listo`, "success");
        host.props = { resultado: json, error: null, version: props.version + 1 };
      } catch (err) {
        form.props = { enviando: false, error: mensajeDe(err) };
        avisar(mensajeDe(err), "danger");
      }
    };
    root.append(html`
      <section class="flujo" part="flujo">
        <header class="cabecera" part="cabecera">
          ${flujo.icon ? html`<iswc-icon icon=${flujo.icon}></iswc-icon>` : ""}
          <div>
            <h2>${flujo.titulo}</h2>
            ${flujo.descripcion ? html`<p class="descripcion">${flujo.descripcion}</p>` : ""}
          </div>
          ${flujo.permiso ? html`<iswc-badge color=${props.permitido ? "success" : "danger"} variant="soft"><iswc-icon slot="start" icon=${props.permitido ? "mdi:lock-open-variant-outline" : "mdi:lock"}></iswc-icon>${flujo.permiso}</iswc-badge>` : ""}
        </header>
        ${props.permitido ? "" : html`<iswc-callout color="warning" icon="mdi:lock">${estado.usuario ? `El rol ${estado.perfil?.irol ?? ""} no tiene el permiso «${flujo.permiso}». El API responderá 403.` : "Sin usuario activo: elige uno en la barra superior."}</iswc-callout>`}
        <div class="cuerpo" part="cuerpo">
          <iswc-card class="formulario">
            <mr-form onmr-submit=${enviar}></mr-form>
          </iswc-card>
          ${props.resultado !== null ? html`
            <iswc-card class="resultado" part="resultado">
              <strong slot="header">${flujo.resultado?.titulo ?? "Resultado"}</strong>
              ${resultado(props.resultado)}
            </iswc-card>` : ""}
        </div>
      </section>
    `);
    const form = root.querySelector<HTMLElement & { props: unknown }>("mr-form")!;
    form.props = { modelo, modo: "crear", valor: {}, validar: null, textoEnviar: flujo.titulo, textoCancelar: null };
  },
);

define("mr-flow", MrFlow);
