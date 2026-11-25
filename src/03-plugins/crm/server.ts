/**
 * Plugin CRM (server): el transversal con las puertas de seguridad y los verbos de servidor.
 *
 * - Puerta 1, sesión: todas las rutas salvo `login` y `respuestaBot` son `protected` (y `true`/permisos del consumidor
 *   aplican encima si definió `permissions`).
 * - Puerta 2, empresa activa: cada handler resuelve `{ usuario, empresa, rol }` con `X-Empresa` contra `crm_miembros`;
 *   sin pertenencia activa es 403. El cliente nunca fija la empresa: solo escoge una de las suyas.
 * - Puerta 3, rol por empresa: lector (leer), agente (contactos, chats de grupo), admin (miembros, baja de contactos),
 *   propietario. Crear empresas por HTTP es solo de `cfg.superadmins`.
 * - Puerta 4, participación: nadie lee ni escribe una conversación de la que no es parte.
 * - Login: `crm/login` verifica la pertenencia y delega la contraseña al servicio `login` (el `auth.login` del plugin
 *   `identity`: auditoría, bloqueos, JWT). La empresa NO viaja en el token: cada petición la declara y se revalida.
 * - `respuestaBot` es pública pero exige `Authorization: Bearer <cfg.canalToken>` (el canal del bot, no la app).
 * - `seed()` crea las tablas en cualquier motor (SQLite, PostgreSQL, PGlite, D1…) y deja creadas las empresas, miembros
 *   y contactos de `cfg.empresas`; repetirlo no duplica nada.
 * - Servicios del consumidor (todos opcionales): `login`, `almacen` (bytes de adjuntos), `canal` (entrega al bot),
 *   `alMensaje` (tiempo real) y `notificar` (campana/push).
 *
 * ```ts
 * const crm = crearCrm({ db, cfg: { empresas: [{ iempresa: "acme", nombre: "Acme", miembros: [{ iusuario: "ana", rol: "propietario" }] }] }, services: { login: (i, req) => auth.login(i, req) } });
 * const router = createRouter(ctrls, { basePath: "/api", plugins: [auth, crm] });
 * await router.seed();
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/crm.md
 */
import { HttpError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { timingSafeEqual } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { abrirConversacion, adjunto, agregarParticipante, enviarChat, hilos, historial, leerChat, participantes, quitarParticipante, responderBot } from "@Jeff-Aporta/DER/src/03-plugins/crm/chat.ts";
import { cambiarMiembro, contactos, crearContacto, crearEmpresa, editarContacto, empresa, empresasDe, exigir, login, miembros, contexto as contextoDe, vincularMiembro } from "@Jeff-Aporta/DER/src/03-plugins/crm/empresas.ts";
import { crmPlugin } from "@Jeff-Aporta/DER/src/03-plugins/crm/index.ts";
import { CABECERA_EMPRESA, type ChatConsulta, type ChatEnviado, type ChatPagina, type Contacto, type ContactoInput, type ContextoCrm, type Conversacion, type CrmConfig, type Empresa, type EmpresaInput, type EnviarChatInput, type HiloChat, type LineaChat, type LoginCrmInput, type LoginCrmResult, type Miembro, type MiembroInput, type Participante, type ParticipanteInput, type PerfilCrm, type RespuestaBotInput, type VerbosCrm, ZCrmConfig } from "@Jeff-Aporta/DER/src/03-plugins/crm/schemas.ts";
import { usuarioDe } from "@Jeff-Aporta/DER/src/03-plugins/crm/util.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/crm/index.ts";

const cfgDe = (plugin: ServerPlugin): CrmConfig => (plugin.cfg ?? {}) as CrmConfig;

/** Contexto de la petición: usuario de la sesión + empresa activa (cabecera `X-Empresa`) validada contra `crm_miembros`. */
async function contextoHttp(plugin: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ContextoCrm> {
  return await contextoDe(plugin, usuarioDe(ctx), i.request.headers.get(CABECERA_EMPRESA));
}

/** El mismo contexto con un rol mínimo exigido. */
async function contextoCon(plugin: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx, minimo: "lector" | "agente" | "admin" | "propietario"): Promise<ContextoCrm> {
  const c = await contextoHttp(plugin, i, ctx);
  exigir(c, minimo);
  return c;
}

/** ¿El token Bearer es el del canal del bot? Comparación en tiempo constante; sin token configurado nadie entra. */
function esCanal(plugin: ServerPlugin, req: Request): boolean {
  const esperado = cfgDe(plugin).canalToken;
  if (!esperado) return false;
  const dado = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = new TextEncoder().encode(dado);
  const b = new TextEncoder().encode(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Deja creadas las empresas, miembros y contactos de `cfg.empresas` (sin duplicar si ya estaban). */
async function sembrar(plugin: ServerPlugin): Promise<void> {
  for (const e of cfgDe(plugin).empresas ?? []) {
    if (!(await empresa(plugin, e.iempresa))) await crearEmpresa(plugin, { iempresa: e.iempresa, ...(e.codigo ? { codigo: e.codigo } : {}), nombre: e.nombre, nit: e.nit ?? null });
    for (const m of e.miembros ?? []) await vincularMiembro(plugin, e.iempresa, m);
    const ya = new Set((await contactos(plugin, e.iempresa, undefined, 200)).map((c) => c.id));
    for (const c of e.contactos ?? []) if (!c.id || !ya.has(c.id)) await crearContacto(plugin, e.iempresa, c);
  }
}

/** JSON del server del CRM: `crmPlugin` + handlers con sus puertas + verbos de servidor + seed. */
export const crmServer: ServerPluginDef = Obj.insert(crmPlugin, {
  cfg: ZCrmConfig,
  entities: {
    miembros: { indexes: [{ columns: ["iusuario", "bactivo"], name: "ix_crm_miembros_usuario" }] },
    contactos: { indexes: [{ columns: ["iempresa", "nombre"], name: "ix_crm_contactos_empresa" }] },
    conversaciones: { indexes: [{ columns: ["iempresa", "clave"], name: "ix_crm_conversaciones_clave" }] },
    participantes: { indexes: [{ columns: ["iparticipante", "iempresa"], name: "ix_crm_participantes_usuario" }] },
    mensajes: { indexes: [{ columns: ["iconversacion", "id"], name: "ix_crm_mensajes_conversacion" }] },
    adjuntos: { indexes: [{ columns: ["imensaje"], name: "ix_crm_adjuntos_mensaje" }] },
  },
  irregularPaths: {
    login: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<LoginCrmResult> {
        return await login(this, i.body as LoginCrmInput, i.request);
      },
    },
    yo: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<PerfilCrm> {
        const iusuario = usuarioDe(ctx);
        const empresas = await empresasDe(this, iusuario);
        const pedida = i.request.headers.get(CABECERA_EMPRESA);
        const activa = (pedida ? empresas.find((e) => e.iempresa === pedida.toLowerCase()) : empresas.length === 1 ? empresas[0] : null) ?? null;
        return { iusuario, activa, empresas };
      },
    },
    empresas: {
      async handler(this: ServerPlugin, _i: ExtraRouteInput, ctx: ServerCtx) {
        return await empresasDe(this, usuarioDe(ctx));
      },
    },
    crearEmpresa: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Empresa> {
        if (!(cfgDe(this).superadmins ?? []).includes(usuarioDe(ctx))) throw new HttpError(403, "Solo un superadmin crea empresas");
        return await crearEmpresa(this, i.body as EmpresaInput);
      },
    },
    miembros: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Miembro[]> {
        return await miembros(this, (await contextoCon(this, i, ctx, "lector")).iempresa);
      },
    },
    vincularMiembro: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Miembro> {
        return await cambiarMiembro(this, await contextoHttp(this, i, ctx), i.body as MiembroInput);
      },
    },
    contactos: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Contacto[]> {
        const c = await contextoCon(this, i, ctx, "lector");
        return await contactos(this, c.iempresa, i.query.get("q") ?? undefined, Number(i.query.get("limite") ?? 50) || 50);
      },
    },
    crearContacto: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Contacto> {
        const c = await contextoCon(this, i, ctx, "agente");
        return await crearContacto(this, c.iempresa, i.body as ContactoInput);
      },
    },
    editarContacto: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Contacto> {
        const c = await contextoCon(this, i, ctx, "agente");
        const cambio = (i.body ?? {}) as Partial<ContactoInput>;
        if (cambio.bactivo === false) exigir(c, "admin");
        return await editarContacto(this, c.iempresa, i.params["id"] ?? "", cambio);
      },
    },
    chat: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ChatPagina> {
        const c = await contextoCon(this, i, ctx, "lector");
        const q: ChatConsulta = { iconversacion: i.query.get("iconversacion") ?? undefined, hilo: i.query.get("hilo") ?? undefined, limite: Number(i.query.get("limite") ?? 30) || 30, antes: i.query.get("antes") ?? undefined, q: i.query.get("q") ?? undefined };
        return await historial(this, c, q);
      },
    },
    enviarChat: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ChatEnviado> {
        return await enviarChat(this, await contextoCon(this, i, ctx, "lector"), i.body as EnviarChatInput);
      },
    },
    hilos: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<HiloChat[]> {
        return await hilos(this, await contextoCon(this, i, ctx, "lector"), i.query.get("q") ?? undefined);
      },
    },
    leerChat: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<{ leidas: number }> {
        return await leerChat(this, await contextoCon(this, i, ctx, "lector"), String((i.body as { iconversacion?: unknown } | null)?.iconversacion ?? ""));
      },
    },
    adjunto: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Response> {
        return await adjunto(this, await contextoCon(this, i, ctx, "lector"), i.params["id"] ?? "");
      },
    },
    conversacion: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Conversacion> {
        return await abrirConversacion(this, await contextoCon(this, i, ctx, "lector"), i.body as EnviarChatInput);
      },
    },
    participantes: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Participante[]> {
        const c = await contextoCon(this, i, ctx, "lector");
        const id = i.query.get("iconversacion");
        if (!id) throw new ValidationError("Falta `iconversacion`");
        return await participantes(this, c, id);
      },
    },
    agregarParticipante: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Participante> {
        return await agregarParticipante(this, await contextoCon(this, i, ctx, "agente"), i.body as ParticipanteInput);
      },
    },
    quitarParticipante: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<{ quitados: number }> {
        return await quitarParticipante(this, await contextoCon(this, i, ctx, "lector"), i.body as ParticipanteInput);
      },
    },
    respuestaBot: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<LineaChat> {
        if (!esCanal(this, i.request)) throw new HttpError(401, "Token del canal inválido");
        return await responderBot(this, i.body as RespuestaBotInput);
      },
    },
  },
  /** En el server, los verbos son métodos directos (sin HTTP): las mismas funciones que usan los handlers. */
  setup(this: ServerPlugin) {
    const v: VerbosCrm = {
      crearEmpresa: (input) => crearEmpresa(this, input),
      empresa: (iempresa) => empresa(this, iempresa),
      empresasDe: (iusuario) => empresasDe(this, iusuario),
      vincularMiembro: (iempresa, input) => vincularMiembro(this, iempresa, input),
      miembros: (iempresa) => miembros(this, iempresa),
      contexto: (iusuario, iempresa) => contextoDe(this, iusuario, iempresa),
      login: (input, req) => login(this, input, req),
      crearContacto: (iempresa, input) => crearContacto(this, iempresa, input),
      contactos: (iempresa, q, limite) => contactos(this, iempresa, q, limite),
      editarContacto: (iempresa, id, input) => editarContacto(this, iempresa, id, input),
      abrirConversacion: (c, input) => abrirConversacion(this, c, input),
      enviarChat: (c, input) => enviarChat(this, c, input),
      responderBot: (input) => responderBot(this, input),
      historial: (c, consulta) => historial(this, c, consulta),
      hilos: (c, q) => hilos(this, c, q),
      leerChat: (c, id) => leerChat(this, c, id),
      agregarParticipante: (c, input) => agregarParticipante(this, c, input),
      quitarParticipante: (c, input) => quitarParticipante(this, c, input),
      participantes: (c, id) => participantes(this, c, id),
      adjunto: (c, id) => adjunto(this, c, id),
    };
    Object.assign(this, v);
  },
  /** Crea sus tablas (y les suma columnas nuevas) en cualquier motor y deja creadas las empresas, miembros y contactos de `cfg`. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
    await sembrar(this);
  },
}) as ServerPluginDef;

/** `createServer(crmServer, runtime)` con los verbos tipados (`services`: `login`, `almacen`, `canal`, `alMensaje`, `notificar`). */
export function crearCrm(runtime: ServerPluginRuntime): ServerPlugin & VerbosCrm {
  return createServer(crmServer, runtime) as ServerPlugin & VerbosCrm;
}
