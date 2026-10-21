/**
 * <mr-entity-view> — catálogo de una entidad: título, barra de acciones (nuevo, editar, eliminar, recargar), el
 * `<mr-entity-grid>` y el `<mr-form>` generado en un `<iswc-dialog>`. Las escrituras respetan `administrable` de la
 * entidad y el permiso del JSON de UI (`permiso`), evaluado con el perfil del usuario activo.
 */
import { avisar, crearComponente, define, html, mensajeDe } from "../../base/componente.ts";
import type { DialogEl, EntityViewProps } from "../../consts/schemas/componentes.schemas.ts";
import { controller } from "../../core/der.ts";
import { type EntidadResuelta, resolverEntidad } from "../../core/entidades.ts";
import { estado, puede } from "../../core/estado.ts";
import { aplicarUi, modeloDeSchema, validarConZod } from "../../core/form-model.ts";
import "./mr-entity-grid.ts";
import "./mr-form.ts";

/** Pinta la vista ya con la entidad resuelta. */
function pintar(root: ShadowRoot, props: EntityViewProps, host: HTMLElement & { props: Partial<EntityViewProps> }, e: EntidadResuelta): void {
  const administrable = e.entity.def.administrable !== false;
  const permiso = e.ui.permiso;
  const escribe = administrable && puede(permiso, "POST");
  const seleccion = props.seleccion;
  const abrir = (modo: "crear" | "editar") => {
    host.props = { modo };
  };
  const cerrar = () => {
    host.props = { modo: "lista" };
  };
  const recargar = () => {
    host.props = { version: props.version + 1, seleccion: null, modo: "lista" };
  };
  const eliminar = async () => {
    if (!seleccion) return;
    const pk = Object.fromEntries(e.entity.meta.pks.map((k) => [k, seleccion[k]]));
    if (!confirm(`¿Eliminar ${e.etiqueta(seleccion)}?`)) return;
    try {
      await controller(e.plural).delete(pk);
      avisar("Registro eliminado", "success");
      recargar();
    } catch (err) {
      avisar(mensajeDe(err), "danger");
    }
  };
  const guardar = async (ev: Event) => {
    const cuerpo = (ev as CustomEvent<{ cuerpo: Record<string, unknown> }>).detail.cuerpo;
    const form = ev.target as HTMLElement & { props: unknown };
    form.props = { enviando: true, error: null };
    try {
      const ctrl = controller(e.plural);
      if (props.modo === "editar" && seleccion) {
        const pk = Object.fromEntries(e.entity.meta.pks.map((k) => [k, seleccion[k]]));
        await ctrl.put({ ...pk, ...cuerpo });
      } else await ctrl.post(cuerpo);
      avisar(props.modo === "editar" ? "Cambios guardados" : "Registro creado", "success");
      recargar();
    } catch (err) {
      form.props = { enviando: false, error: mensajeDe(err) };
    }
  };
  const alSeleccionar = (ev: Event) => {
    const filas = (ev as CustomEvent<{ filas: Record<string, unknown>[] }>).detail.filas;
    host.props = { seleccion: filas[0] ?? null };
  };
  const modoForm = props.modo === "editar" ? "editar" : "crear";
  const modelo = aplicarUi(modeloDeSchema(e.entity.pojo.schema, modoForm), e.ui);
  const abierto = props.modo !== "lista";
  const zod = e.entity.zod;
  root.append(html`
    <section class="vista" part="vista">
      <header class="cabecera" part="cabecera">
        <div class="titulo">
          ${e.ui.icon ? html`<iswc-icon icon=${e.ui.icon}></iswc-icon>` : ""}
          <h2>${e.titulo}</h2>
          <iswc-badge color="neutral" variant="soft">${e.plural}</iswc-badge>
          ${administrable ? "" : html`<iswc-badge color="warning" variant="soft">sólo lectura</iswc-badge>`}
        </div>
        <div class="acciones" part="acciones">
          <iswc-button variant="text" color="neutral" onclick=${recargar} title="Recargar"><iswc-icon icon="mdi:refresh"></iswc-icon></iswc-button>
          ${administrable ? html`
            <iswc-button variant="outlined" color="brand" ?disabled=${!escribe || !seleccion} onclick=${() => abrir("editar")}><iswc-icon slot="start" icon="mdi:pencil"></iswc-icon>Editar</iswc-button>
            <iswc-button variant="outlined" color="danger" ?disabled=${!escribe || !seleccion} onclick=${eliminar}><iswc-icon slot="start" icon="mdi:delete"></iswc-icon>Eliminar</iswc-button>
            <iswc-button color="brand" ?disabled=${!escribe} onclick=${() => abrir("crear")}><iswc-icon slot="start" icon="mdi:plus"></iswc-icon>Nuevo</iswc-button>` : ""}
        </div>
      </header>
      ${administrable && !escribe ? html`<iswc-callout color="warning" icon="mdi:lock">${estado.usuario ? `El rol ${estado.perfil?.irol ?? ""} no tiene el permiso «${permiso ?? "escritura"}»: sólo lectura.` : "Sin usuario activo: elige uno en la barra superior."}</iswc-callout>` : ""}
      <mr-entity-grid onmr-select=${alSeleccionar}></mr-entity-grid>
      <iswc-dialog class="editor" label=${`${props.modo === "editar" ? "Editar" : "Nuevo"} · ${e.titulo}`} backdrop-variant="basic" ?open=${abierto} oniswc-after-hide=${() => {
        if (host.props.modo !== "lista") cerrar();
      }}>
        ${abierto ? html`<mr-form onmr-submit=${guardar} onmr-cancel=${cerrar}></mr-form>` : ""}
      </iswc-dialog>
    </section>
  `);
  const grid = root.querySelector<HTMLElement & { props: unknown }>("mr-entity-grid")!;
  grid.props = { entidad: e.plural, seleccion: "single", pageSize: e.ui.pageSize ?? 25, version: props.version };
  const form = root.querySelector<HTMLElement & { props: unknown }>("mr-form");
  if (form) form.props = { modelo, modo: modoForm, valor: props.modo === "editar" && seleccion ? { ...seleccion } : {}, validar: (cuerpo: Record<string, unknown>) => validarConZod(zod, cuerpo, modoForm), textoEnviar: props.modo === "editar" ? "Guardar cambios" : "Crear" };
}

const MrEntityView = crearComponente<EntityViewProps>(
  import.meta.url,
  "mr-entity-view",
  { entidad: "", seleccion: null, modo: "lista", version: 0 },
  (root, props, host) => {
    if (!props.entidad) return;
    root.append(html`<iswc-spinner class="cargando"></iswc-spinner>`);
    void resolverEntidad(props.entidad).then((e) => {
      if (!host.isConnected || host.props.entidad !== props.entidad) return;
      root.replaceChildren();
      pintar(root, props, host, e);
    }).catch((err: unknown) => {
      root.replaceChildren(html`<iswc-callout color="danger" icon="mdi:alert">${mensajeDe(err)}</iswc-callout>`);
    });
  },
  (root, props, previos, host) => {
    // sólo la selección cambia: habilitar/deshabilitar botones sin repintar el grid
    if (props.entidad === previos.entidad && props.modo === previos.modo && props.version === previos.version) {
      const hay = !!props.seleccion;
      const e = root.querySelector<HTMLElement>(".vista");
      if (!e) return false;
      for (const b of root.querySelectorAll<HTMLElement>(".acciones iswc-button[color='brand'][variant='outlined'], .acciones iswc-button[color='danger']")) {
        const permitido = !b.hasAttribute("data-bloqueado");
        b.toggleAttribute("disabled", !hay || !permitido);
      }
      if (!hay) return true;
      void host;
      return true;
    }
    if (props.modo !== previos.modo || props.version !== previos.version) {
      const dlg = root.querySelector<DialogEl>("iswc-dialog.editor");
      if (dlg && props.modo === "lista" && previos.modo !== "lista" && props.version === previos.version) {
        dlg.open = false;
        return true;
      }
    }
    return false;
  },
);

define("mr-entity-view", MrEntityView);
