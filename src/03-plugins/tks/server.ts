/**
 * Plugin de tiquetes (server): el transversal con las particularidades del servidor.
 *
 * - El alta pone los valores por defecto que el front no debe inventar: `fhcre` (ahora), `iusuario` (la sesión),
 *   `estado` (la primera columna del tablero) y `bfinalizado` (la regla de cierre).
 * - La regla de cierre: el estado que el consumidor declara como "finalizado" marca `bfinalizado` solo; si no hay
 *   ningún estado de cierre, el usuario puede marcarlo a mano.
 * - La baja es lógica: `DELETE` archiva (`bactivo` false) y nunca borra la fila.
 * - `misTks`: lo que la sesión puede ver (creador o asignado por usuario, rol o grupo; `*` en grupos = todos),
 *   con la paginación de DER (page, pageSize).
 * - Las columnas de métrica (`qtotalmensajes`, `qcalificacion`) se encienden en `seed` si el consumidor instaló los
 *   plugins de mensajes y de calificaciones: un plugin no depende de otro.
 *
 * ```ts
 * const tks = createServer(tksServer, { db, cfg: { estadosFinalizados: ["finalizado"] } });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/tks.md
 */
import { Obj } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import { findController } from "@Jeff-Aporta/DER/src/02-controllers/server/database.ts";
import type { ComputedSql, ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { PerfilAsignado } from "@Jeff-Aporta/DER/src/03-plugins/common/schemas.ts";
import { coincideAsignado } from "@Jeff-Aporta/DER/src/03-plugins/common/social.ts";
import { tksPlugin } from "@Jeff-Aporta/DER/src/03-plugins/tks/index.ts";
import { type Tk, type TkInput, type TksConfig, ZTksConfig, ZTkInput } from "@Jeff-Aporta/DER/src/03-plugins/tks/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/tks/index.ts";

/** Espacio donde viven los mensajes de un tk (el que el plugin de mensajes usa por convención). */
export const ESPACIO_TKS = "tks";

/** Configuración por defecto si el consumidor no declaró otra. */
const CFG_DEFECTO: TksConfig = { estadosFinalizados: ["finalizado"], permitirFinalizadoManual: true };

/** Plugin dueño de cada controller, para los hooks (de ahí sale la configuración). */
const plugins = new WeakMap<object, ServerPlugin>();

/** Métrica: cuántos mensajes tiene el tk (cuenta los del espacio `tks` con su id como referencia). */
const SQL_MENSAJES = {
  sqlite: "(select count(*) from mensajes_mensajes m where m.tdespacio = 'tks' and m.iref = cast({itk} as text))",
  pg: "(select count(*) from mensajes_mensajes m where m.tdespacio = 'tks' and m.iref = cast({itk} as text))",
  mysql: "(select count(*) from mensajes_mensajes m where m.tdespacio = 'tks' and m.iref = cast({itk} as char))",
  mssql: "(select count(*) from mensajes_mensajes m where m.tdespacio = 'tks' and m.iref = cast({itk} as varchar(60)))",
};

/** Métrica: la calificación promedio del tk (nulo si nadie lo ha calificado). */
const SQL_CALIFICACION = {
  sqlite: "(select avg(c.valor) from calificaciones_calificaciones c where c.tdespacio = 'tks' and c.iref = cast({itk} as text))",
  pg: "(select avg(c.valor) from calificaciones_calificaciones c where c.tdespacio = 'tks' and c.iref = cast({itk} as text))",
  mysql: "(select avg(c.valor) from calificaciones_calificaciones c where c.tdespacio = 'tks' and c.iref = cast({itk} as char))",
  mssql: "(select avg(c.valor) from calificaciones_calificaciones c where c.tdespacio = 'tks' and c.iref = cast({itk} as varchar(60)))",
};

/** Perfil de la sesión (usuario, roles y grupos) para evaluar las asignaciones. */
function perfilDe(ctx: ServerCtx): PerfilAsignado {
  const claims = (ctx.session?.claims ?? {}) as { roles?: unknown; grupos?: unknown };
  const roles = Array.isArray(claims.roles) ? claims.roles.map(String) : ctx.session?.role ? [String(ctx.session.role)] : [];
  const grupos = Array.isArray(claims.grupos) ? claims.grupos.map(String) : [];
  return { usuario: String(ctx.session?.id ?? ""), roles, grupos };
}

/** ¿La sesión ve este tk? El creador siempre; los demás, si están asignados por usuario, rol o grupo (`*` = todos). */
function visible(tk: Tk, perfil: PerfilAsignado): boolean {
  if (tk.iusuario && tk.iusuario === perfil.usuario) return true;
  return coincideAsignado(tk.jasignados, perfil);
}

/** La regla de cierre: el estado de cierre marca `bfinalizado`; sin estado de cierre, manda lo que ponga el usuario. */
function reglaFinalizado(cfg: TksConfig, tk: Tk): void {
  const estados = cfg.estadosFinalizados ?? [];
  if (estados.length) tk.bfinalizado = estados.includes(String(tk.estado));
  else if (!cfg.permitirFinalizadoManual) tk.bfinalizado = false;
}

/** Las llaves primarias de un tk, como objeto plano. */
function clavesDe(ctrl: ServerController<any>, tk: Tk): Record<string, unknown> {
  const self = tk as unknown as Record<string, unknown>;
  return Object.fromEntries(ctrl.entity.meta.pks.map((k) => [k, self[k]]));
}

/** JSON del server de tiquetes: `tksPlugin` + defaults, regla de cierre, baja lógica y los paths del tablero. */
export const tksServer: ServerPluginDef = Obj.insert(tksPlugin, {
  cfg: ZTksConfig,
  entities: {
    tks: {
      hooks: {
        /** Alta: fecha, autor de la sesión, columna inicial y regla de cierre. */
        prePost(this: ServerController<any>, tk: Tk, ctx: ServerCtx) {
          const cfg = (plugins.get(this)?.cfg as TksConfig | undefined) ?? CFG_DEFECTO;
          if (!tk.fhcre) tk.fhcre = new Date();
          if (!tk.iusuario && ctx.session?.id) tk.iusuario = String(ctx.session.id);
          if (!tk.estado) tk.estado = "por_hacer";
          if (tk.bactivo === null || tk.bactivo === undefined) tk.bactivo = true;
          reglaFinalizado(cfg, tk);
          return null;
        },
        /** Cambio: la regla de cierre mira el estado vigente (el de la fila si el cambio no lo trae). */
        async prePut(this: ServerController<any>, tk: Tk, ctx: ServerCtx) {
          const cfg = (plugins.get(this)?.cfg as TksConfig | undefined) ?? CFG_DEFECTO;
          if (!(cfg.estadosFinalizados ?? []).length) {
            if (!cfg.permitirFinalizadoManual) tk.bfinalizado = false;
            return null;
          }
          if (tk.estado === undefined || tk.estado === null) {
            const actual = await this.get(this.pojo(clavesDe(this, tk)), { ...ctx, include: {} }) as Tk | null;
            if (!actual) return null;
            tk.estado = actual.estado;
          }
          reglaFinalizado(cfg, tk);
          return null;
        },
      },
      actions: {
        /** La baja es lógica: el tk se archiva (`bactivo` false) y la fila se conserva. */
        async delete(this: ServerController<any>, tk: Tk, ctx: ServerCtx) {
          const claves = clavesDe(this, tk);
          const actual = await this.get(this.pojo(claves), { ...ctx, include: {} }) as Tk | null;
          if (!actual) return null;
          return await this.put(this.pojo({ ...claves, bactivo: false }), ctx) as Tk | null;
        },
        /** Igual en el borrado en plural: se archivan, no se borran. */
        async deleteList(this: ServerController<any>, tks: Tk[], ctx: ServerCtx) {
          const out: Tk[] = [];
          for (const tk of tks) {
            const claves = clavesDe(this, tk);
            const actual = await this.get(this.pojo(claves), { ...ctx, include: {} }) as Tk | null;
            if (!actual) continue;
            const archivado = await this.put(this.pojo({ ...claves, bactivo: false }), ctx) as Tk | null;
            if (archivado) out.push(archivado);
          }
          return out;
        },
      },
      indexes: [{ columns: ["estado", "fhcre"], name: "ix_tks_estado" }],
      paths: {
        crearTk: {
          /** Crea un tk con los defaults del servidor (los que el front no debe inventar). */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Tk> {
            const input = ZTkInput.parse(i.body ?? {}) as TkInput;
            const ctrl = this.controllers["tks"]!;
            return await ctrl.post(ctrl.pojo({ ...input }), ctx) as Tk;
          },
        },
        misTks: {
          /** Lo que la sesión ve, con la paginación de DER: page, pageSize, estado y q (búsqueda). */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Tk[]> {
            const ctrl = this.controllers["tks"]!;
            const perfil = perfilDe(ctx);
            const pagina = Math.max(1, Number(i.query.get("page") ?? 1) || 1);
            const tamano = Math.min(200, Math.max(1, Number(i.query.get("pageSize") ?? 50) || 50));
            const estado = i.query.get("estado") ?? null;
            const busqueda = (i.query.get("q") ?? "").trim().toLowerCase();
            const filas = await ctrl.query({ where: { bactivo: true }, orderBy: "-itk", pageSize: ctrl.entity.maxPageSize }, { ...ctx, include: {} }) as Tk[];
            const propias = filas.filter((t) => visible(t, perfil));
            const filtradas = propias.filter((t) => (estado ? String(t.estado) === estado : true)).filter((t) => (busqueda ? String(t.proposito ?? "").toLowerCase().includes(busqueda) || String(t.requerimiento ?? "").toLowerCase().includes(busqueda) : true));
            return filtradas.slice((pagina - 1) * tamano, pagina * tamano);
          },
        },
      },
    },
  },
  seed(this: ServerPlugin) {
    const ctrl = this.controllers["tks"]!;
    const computed: Record<string, ComputedSql> = { ...(ctrl.config.computed ?? {}) };
    const mensajes = findController("mensajes");
    if (mensajes && mensajes.db === ctrl.db) computed["qtotalmensajes"] = SQL_MENSAJES;
    const calificaciones = findController("calificaciones");
    if (calificaciones && calificaciones.db === ctrl.db) computed["qcalificacion"] = SQL_CALIFICACION;
    ctrl.config.computed = computed;
  },
  setup(this: ServerPlugin) {
    for (const c of this.list) plugins.set(c, this);
  },
}) as ServerPluginDef;
