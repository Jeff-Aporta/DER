/**
 * <mr-session> — "inicio de sesión" del lab: un `<iswc-select>` con los usuarios (sin contraseña), el rol efectivo que
 * representa (perfil de `GET permisos`) y un modal con lo que ese rol puede o no hacer (acción → valor). Cambiar de usuario
 * cambia la cabecera `x-usuario` de todas las peticiones y repinta la vista: así se compara el sistema de permisos en vivo.
 * Emite `mr-usuario` `{ usuario }`.
 */
import { avisar, crearComponente, define, emitir, html, mensajeDe } from "../../base/componente.ts";
import type { DialogEl, SelectEl, SessionProps } from "../../consts/schemas/componentes.schemas.ts";
import { perfil, usuariosLab } from "../../core/der.ts";
import { estado, setPerfil, setUsuario } from "../../core/estado.ts";

/** Lee usuarios y perfil y actualiza las props. */
export async function refrescarSesion(host: HTMLElement & { props: Partial<SessionProps> }): Promise<void> {
  host.props = { cargando: true };
  try {
    const usuarios = await usuariosLab();
    const p = await perfil();
    setPerfil(p);
    host.props = { usuarios, usuario: p.usuario, irol: p.usuario ? p.irol : null, roles: p.roles, perms: p.perms, cargando: false };
  } catch (err) {
    setPerfil(null);
    host.props = { cargando: false, usuario: null, irol: null, roles: [], perms: {} };
    avisar(mensajeDe(err), "danger");
  }
}

/** Texto de un valor de permiso (`true`, `false`, `{ GET: true, POST: false }`). */
function textoValor(v: unknown): { texto: string; color: "success" | "danger" | "neutral" | "warning" } {
  if (v === true) return { texto: "permitido", color: "success" };
  if (v === false) return { texto: "denegado", color: "danger" };
  if (v && typeof v === "object") {
    const partes = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${x === true ? "sí" : x === false ? "no" : String(x)}`);
    const todos = Object.values(v as Record<string, unknown>).every((x) => x === true);
    const ninguno = Object.values(v as Record<string, unknown>).every((x) => x === false);
    return { texto: partes.join(" · "), color: todos ? "success" : ninguno ? "danger" : "warning" };
  }
  return { texto: String(v), color: "neutral" };
}

const MrSession = crearComponente<SessionProps>(
  import.meta.url,
  "mr-session",
  { usuarios: [], usuario: estado.usuario, irol: null, roles: [], perms: {}, cargando: true },
  (root, props, host) => {
    const cambiar = (e: Event) => {
      const v = (e.target as SelectEl).value;
      setUsuario(v || null);
      emitir(host, "mr-usuario", { usuario: v || null });
      void refrescarSesion(host);
    };
    const abrir = () => {
      const dlg = root.querySelector<DialogEl>("iswc-dialog");
      if (dlg) dlg.open = true;
    };
    const u = props.usuarios.find((x) => x.iusuario === props.usuario);
    const perms = Object.entries(props.perms).sort(([a], [b]) => a.localeCompare(b));
    root.append(html`
      <div class="sesion" part="sesion">
        <iswc-icon class="icono" icon="mdi:account-circle"></iswc-icon>
        <iswc-select class="usuario" label="Usuario" label-placement="start" placeholder="Anónimo" clearable value=${props.usuario ?? ""} ?disabled=${props.cargando} oniswc-change=${cambiar}>
          ${props.usuarios.map((x) => html`<iswc-option value=${x.iusuario} ?disabled=${!x.bactivo}>${x.nombre ?? x.iusuario}${x.roles.length ? ` · ${x.roles.join(", ")}` : " · rol base"}${x.bactivo ? "" : " (inactivo)"}</iswc-option>`)}
        </iswc-select>
        ${props.usuario ? html`<iswc-badge class="rol" color=${props.irol === "ADMIN" ? "danger" : props.irol === "USR" ? "neutral" : "brand"} variant="filled" pill title="Rol efectivo"><iswc-icon slot="start" icon="mdi:shield-account-outline"></iswc-icon>${props.irol ?? "…"}</iswc-badge>` : html`<iswc-badge class="rol" color="neutral" variant="soft" pill>anónimo</iswc-badge>`}
        <iswc-button variant="text" color="neutral" size="small" title="Qué puede hacer este usuario" onclick=${abrir}><iswc-icon icon="mdi:key-chain-variant"></iswc-icon></iswc-button>
      </div>
      <iswc-dialog label=${`Permisos de ${u?.nombre ?? props.usuario ?? "anónimo"}`} backdrop-variant="basic">
        <div class="resumen">
          <p><strong>Usuario:</strong> ${props.usuario ?? "ninguno (anónimo: toda ruta protegida responde 401)"}</p>
          <p><strong>Rol efectivo:</strong> ${props.irol ?? "—"} ${props.roles.length > 1 ? html`<span class="otros">(también: ${props.roles.slice(1).join(", ")})</span>` : ""}</p>
          <p class="nota">El rol base <code>USR</code> define los valores por defecto (sólo lectura); cada rol escribe sólo sus diferencias; <code>ADMIN</code> tiene <code>*</code>.</p>
        </div>
        ${perms.length ? html`
          <table class="permisos">
            <thead><tr><th>Acción</th><th>Valor efectivo</th></tr></thead>
            <tbody>${perms.map(([accion, v]) => {
              const t = textoValor(v);
              return html`<tr><td><code>${accion}</code></td><td><iswc-tag color=${t.color} variant="soft">${t.texto}</iswc-tag></td></tr>`;
            })}</tbody>
          </table>` : html`<iswc-callout color="neutral">Sin sesión no hay acciones evaluadas.</iswc-callout>`}
        <div slot="footer"><iswc-button data-dialog="close" variant="text" color="neutral">Cerrar</iswc-button></div>
      </iswc-dialog>
    `);
  },
);

define("mr-session", MrSession);
