/**
 * Plugin de apps (server): la instancia de negocio (el `iapp`) con su marca, su modo y su purga.
 *
 * - Aislamiento: el ambito de la peticion (cabecera `X-App` o claim `iapp` de la sesion) decide que apps se ven. Con
 *   ambito, la lista devuelve SOLO esa app (nunca las de otro `iapp`); sin ambito, las de la empresa de la sesion
 *   (claim `iempresa` o cabecera `X-Empresa`); sin empresa tampoco, todas (el instalador).
 * - Publica: `GET apps/{iapp}/publica` no exige sesion y entrega SOLO lo que el front puede pintar (nombre, modo, marca,
 *   servidor y contacto de WhatsApp): ni la empresa, ni si es demo, ni cuando se creo.
 * - Permiso: la lista, el alta y el cambio exigen la accion `apps.administrar` (la puerta la trae el plugin `permissions`).
 * - Purga: `purgarApp` borra todas las filas con ese `iapp` en las tablas indicadas (en cascada, en la misma base). Solo
 *   se purga una app demo (`bdemo`); para las demas hace falta `forzar`.
 *
 * ```ts
 * const apps = crearApps({ db, cfg: { cabecera: "x-app" } });
 * await apps.purgarApp("riogo24", ["apps_apps", "catalogo_productos", "pagos_intentos"]);
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/apps.md
 */
import { HttpError, NotFoundError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { ahora, ctrl, fila, filas, guardar, porPk, sinIndefinidos, validado } from "@Jeff-Aporta/DER/src/03-plugins/common/tablas.ts";
import { ambitoDe, appsPlugin } from "@Jeff-Aporta/DER/src/03-plugins/apps/index.ts";
import { type App, type AppCambio, type AppInput, type AppPublica, type AppsConfig, type ContextoApp, type ListaAppsFiltros, type ModoApp, type PurgaOpciones, type PurgaResultado, type VerbosApps, ZAppCambio, ZAppInput, ZAppsConfig } from "@Jeff-Aporta/DER/src/03-plugins/apps/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/apps/index.ts";

/** Configuracion del plugin (con los defaults puestos). */
const cfgDe = (p: ServerPlugin): AppsConfig => (p.cfg ?? {}) as AppsConfig;

/** El `iapp` normalizado: minusculas, sin espacios y solo `[a-z0-9._-]` ("Rio Go 24" y "rio go 24" son la misma app). */
function normalizaIapp(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").slice(0, 40);
}

/** La app por su clave (404 si no existe). */
export async function exigirApp(p: ServerPlugin, iapp: string): Promise<App> {
  const app = await porPk<App>(p, "apps", { iapp });
  if (!app) throw new NotFoundError("Esa app no existe");
  return app;
}

/** La vista publica de la app: lo unico que el front puede ver (nada de datos internos). */
export function publicaDe(app: App): AppPublica {
  return { nombre: app.nombre, modo: app.modo, marca: app.marca ?? null, servidor: app.servidor ?? null, contacto_wa: app.contacto_wa ?? null };
}

/** El controller que administra esa tabla (por nombre de tabla o por plural); 400 si no lo hay o si no tiene la columna `iapp`. */
function controllerDe(p: ServerPlugin, tabla: string): ServerController<any> {
  const c = p.db.controllers.find((x) => x.table === tabla || x.entity.pluralPath.join("/") === tabla);
  if (!c) throw new ValidationError("La tabla «" + tabla + "» no la administra ningun controller de esta base");
  if (!c.entity.meta.isColumn("iapp")) throw new ValidationError("La tabla «" + tabla + "» no tiene la columna iapp");
  return c;
}

/** La empresa de la sesion (claim `iempresa`) o de la cabecera `X-Empresa` (el consumidor decide como validarla). */
function empresaDe(ctx: ServerCtx, request: Request): string {
  const claims = (ctx.session?.claims ?? {}) as { iempresa?: unknown };
  const valor = String(claims.iempresa ?? request.headers.get("x-empresa") ?? "").trim();
  return valor.slice(0, 40);
}

/** Un `iapp` libre a partir del nombre ("Rio Go 24" -> "rio-go-24"; si existe, "-2", "-3"...). */
async function iappLibre(p: ServerPlugin, nombre: string): Promise<string> {
  const base = normalizaIapp(nombre) || "app";
  let iapp = base;
  let n = 2;
  while (await porPk<App>(p, "apps", { iapp })) {
    iapp = `${base}-${n}`;
    n++;
  }
  return iapp;
}

/** Las apps que ve el llamador: la del ambito si la peticion trae uno; si no, las de su empresa; si no, todas. */
async function listarApps(p: ServerPlugin, ctx: ServerCtx, request: Request, filtros: ListaAppsFiltros): Promise<App[]> {
  const where: Record<string, unknown> = {};
  const ambito = ambitoDe({ request, session: ctx.session } satisfies ContextoApp, cfgDe(p).cabecera);
  if (ambito) where["iapp"] = ambito;
  else {
    const iempresa = empresaDe(ctx, request);
    if (iempresa) where["iempresa"] = iempresa;
  }
  if (filtros.modo) where["modo"] = filtros.modo;
  if (filtros.iempresa) where["iempresa"] = filtros.iempresa;
  const q = filtros.q?.trim();
  if (q) where["$or"] = [{ iapp: { contains: q } }, { nombre: { contains: q } }];
  return await filas<App>(p, "apps", { where, orderBy: "iapp", pageSize: 500 });
}

/** Crea la app (el `iapp` lo deduce del nombre si no viene) y la devuelve. */
async function crearApp(p: ServerPlugin, input: AppInput): Promise<App> {
  const d = validado<AppInput>(ZAppInput, input);
  const iapp = d.iapp ? normalizaIapp(d.iapp) : await iappLibre(p, d.nombre);
  if (!iapp) throw new ValidationError("El iapp no puede quedar vacio");
  if (await porPk<App>(p, "apps", { iapp })) throw new HttpError(409, "Ya existe una app con ese iapp");
  const c = ctrl(p, "apps");
  const creado = await c.post(c.pojo({ iapp, nombre: d.nombre, modo: d.modo, iempresa: d.iempresa ?? null, bdemo: d.bdemo ?? false, servidor: d.servidor ?? null, marca: d.marca ?? null, soporte_wa: d.soporte_wa ?? false, contacto_wa: d.contacto_wa ?? null, fhcre: ahora() }));
  return fila(creado) as App;
}

/** Cambia lo editable de la app (el `iapp` NO cambia). */
async function cambiarApp(p: ServerPlugin, iapp: string, cambio: AppCambio): Promise<App> {
  const d = validado<AppCambio>(ZAppCambio, cambio);
  const app = await exigirApp(p, iapp);
  const cambios = sinIndefinidos({ nombre: d.nombre, modo: d.modo, iempresa: d.iempresa, bdemo: d.bdemo, servidor: d.servidor, marca: d.marca, soporte_wa: d.soporte_wa, contacto_wa: d.contacto_wa });
  return await guardar<App>(p, "apps", { iapp: app.iapp }, cambios);
}

/** Purga los datos de una app: borra todas las filas con ese `iapp` en las tablas indicadas (en cascada). */
export async function purgarApp(p: ServerPlugin, iapp: string, tablas: string[], opciones: PurgaOpciones = {}): Promise<PurgaResultado> {
  const app = await exigirApp(p, iapp);
  if (!app.bdemo && !opciones.forzar) throw new HttpError(403, "La app «" + iapp + "» no es demo: la purga exige forzar");
  const detalle: { tabla: string; borrados: number }[] = [];
  let total = 0;
  for (const tabla of tablas) {
    const c = controllerDe(p, tabla);
    const suyas = await c.query({ where: { iapp }, pageSize: 1000 } as never);
    const borradas = await c.deleteList(suyas as never);
    detalle.push({ tabla, borrados: borradas.length });
    total += borradas.length;
  }
  return { iapp, tablas: detalle, total };
}

/** Filtros de la lista a partir de la query HTTP. */
function filtrosDeQuery(i: ExtraRouteInput): ListaAppsFiltros {
  const texto = (k: string): string | undefined => i.query.get(k) ?? undefined;
  return { modo: texto("modo") as ModoApp | undefined, iempresa: texto("iempresa"), q: texto("q") };
}

/** JSON del server de apps: appsPlugin + handlers + verbos + seed. */
export const appsServer: ServerPluginDef = Obj.insert(appsPlugin, {
  cfg: ZAppsConfig,
  irregularPaths: {
    publica: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<AppPublica> {
        return publicaDe(await exigirApp(this, (i.params["iapp"] ?? "").trim()));
      },
    },
    listarApps: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<App[]> {
        return await listarApps(this, ctx, i.request, filtrosDeQuery(i));
      },
    },
    crearApp: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<App> {
        return await crearApp(this, i.body as AppInput);
      },
    },
    cambiarApp: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<App> {
        return await cambiarApp(this, (i.params["iapp"] ?? "").trim(), i.body as AppCambio);
      },
    },
    cambiarAppCuerpo: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<App> {
        const cuerpo = (i.body ?? {}) as AppCambio & { iapp?: string | undefined };
        const iapp = String(cuerpo.iapp ?? "").trim();
        if (!iapp) throw new ValidationError("Falta el iapp de la app");
        const cambio: AppCambio = { nombre: cuerpo.nombre, modo: cuerpo.modo, iempresa: cuerpo.iempresa, bdemo: cuerpo.bdemo, servidor: cuerpo.servidor, marca: cuerpo.marca, soporte_wa: cuerpo.soporte_wa, contacto_wa: cuerpo.contacto_wa };
        return await cambiarApp(this, iapp, cambio);
      },
    },
  },
  /** En el server, los verbos son metodos directos (sin HTTP): las mismas funciones que usan los handlers. */
  setup(this: ServerPlugin) {
    const v: VerbosApps = {
      exigirApp: (iapp) => exigirApp(this, iapp),
      purgarApp: (iapp, tablas, opciones) => purgarApp(this, iapp, tablas, opciones),
    };
    Object.assign(this, v);
  },
  /** Crea sus tablas (y les suma columnas nuevas). */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
  },
}) as ServerPluginDef;

/** createServer(appsServer, runtime) con los verbos tipados. */
export function crearApps(runtime: ServerPluginRuntime): ServerPlugin & VerbosApps {
  return createServer(appsServer, runtime) as ServerPlugin & VerbosApps;
}
