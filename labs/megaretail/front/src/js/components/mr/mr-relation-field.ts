/**
 * <mr-relation-field> — campo de formulario para una relación: muestra la(s) fila(s) elegida(s) como etiquetas y abre el
 * `<mr-relation-picker>` (modal con el grid de la otra entidad). `one` guarda la pk remota; `many` guarda la lista de pks.
 * Emite `mr-cambio` `{ nombre, valor, filas }`.
 */
import { crearComponente, define, emitir, html } from "../../base/componente.ts";
import type { RelationFieldProps } from "../../consts/schemas/componentes.schemas.ts";
import { controller } from "../../core/der.ts";
import { resolverPorNombre } from "../../core/entidades.ts";
import "./mr-relation-picker.ts";

/** Etiqueta de la fila relacionada a partir de su pk (consulta `get`). */
async function etiquetasDe(target: string, remoto: string, valores: unknown[]): Promise<string[]> {
  const e = await resolverPorNombre(target);
  if (!e) return valores.map(String);
  const out: string[] = [];
  for (const v of valores) {
    try {
      const fila = await controller(e.plural).get({ [remoto]: v }, { include: {} });
      out.push(fila ? e.etiqueta(fila.toJSON()) : String(v));
    } catch {
      out.push(String(v));
    }
  }
  return out;
}

const MrRelationField = crearComponente<RelationFieldProps>(
  import.meta.url,
  "mr-relation-field",
  { campo: null, valor: null, etiquetas: [], disabled: false, error: null },
  (root, props, host) => {
    const campo = props.campo;
    if (!campo?.relacion) return;
    const rel = campo.relacion;
    const muchos = rel.kind === "many";
    const valores = muchos ? (Array.isArray(props.valor) ? props.valor : []) : props.valor == null || props.valor === "" ? [] : [props.valor];
    const abrir = async () => {
      const e = await resolverPorNombre(rel.entidad);
      const picker = root.querySelector<HTMLElement & { props: unknown }>("mr-relation-picker")!;
      picker.props = { entidad: e?.plural ?? "", kind: rel.kind, abierto: true, titulo: `${campo.label}: ${e?.titulo ?? rel.entidad}` };
    };
    const alElegir = (e: Event) => {
      const filas = (e as CustomEvent<{ filas: Record<string, unknown>[] }>).detail.filas;
      const pks = filas.map((f) => f[rel.remoto]);
      const valor = muchos ? pks : pks[0] ?? null;
      void resolverPorNombre(rel.entidad).then((r) => {
        host.props = { valor, etiquetas: filas.map((f) => (r ? r.etiqueta(f) : String(f[rel.remoto]))), error: null };
        emitir(host, "mr-cambio", { nombre: campo.nombre, valor, filas });
      });
    };
    const limpiar = () => {
      host.props = { valor: muchos ? [] : null, etiquetas: [], error: null };
      emitir(host, "mr-cambio", { nombre: campo.nombre, valor: muchos ? [] : null, filas: [] });
    };
    const etiquetas = props.etiquetas.length === valores.length ? props.etiquetas : valores.map(String);
    root.append(html`
      <div class="campo" part="campo" ?data-error=${!!props.error}>
        <span class="label" part="label">${campo.label}${campo.requerido ? html`<span class="req" aria-hidden="true">*</span>` : ""}</span>
        <div class="valor" part="valor">
          ${etiquetas.length ? etiquetas.map((t) => html`<iswc-tag color="brand" variant="soft">${t}</iswc-tag>`) : html`<span class="vacio">${muchos ? "Sin elementos relacionados" : "Sin seleccionar"}</span>`}
          <span class="acciones">
            <iswc-button size="small" variant="outlined" color="brand" ?disabled=${props.disabled} onclick=${abrir}>
              <iswc-icon slot="start" icon=${muchos ? "mdi:format-list-checks" : "mdi:magnify"}></iswc-icon>${muchos ? "Elegir varios…" : "Elegir…"}
            </iswc-button>
            ${etiquetas.length ? html`<iswc-button size="small" variant="text" color="neutral" ?disabled=${props.disabled} onclick=${limpiar} title="Quitar"><iswc-icon icon="mdi:close"></iswc-icon></iswc-button>` : ""}
          </span>
        </div>
        ${props.error ? html`<span class="error" part="error">${props.error}</span>` : campo.hint ? html`<span class="hint" part="hint">${campo.hint}</span>` : ""}
      </div>
      <mr-relation-picker onmr-pick=${alElegir}></mr-relation-picker>
    `);
    // etiquetas de un valor inicial (edición): se resuelven en diferido
    if (valores.length && props.etiquetas.length !== valores.length) {
      void etiquetasDe(rel.entidad, rel.remoto, valores).then((et) => {
        if (host.isConnected) host.props = { etiquetas: et };
      });
    }
  },
);

define("mr-relation-field", MrRelationField);
