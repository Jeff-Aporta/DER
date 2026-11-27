/**
 * Plugin de apps: el JSON TRANSVERSAL de la INSTANCIA DE NEGOCIO (el `iapp`). Una app es un clon aislable y removible:
 * su `iapp` viaja en la cabecera `X-App` (o en la sesion) y TODA entidad de su ambito lo filtra. La app guarda su marca
 * (lo que pinta el front), su modo (que decide plantilla, textos y flujo) y si es demo (para poder purgar sus datos).
 *
 *   apps_apps  (iapp, nombre, modo, iempresa, bdemo, servidor, marca, soporte_wa, contacto_wa, fhcre)
 *
 * Rutas: la publica (sin sesion y sin datos internos), la lista y el alta/cambio (permiso `apps.administrar`).
 * El ambito (`ambitoApp`) lo resuelven el resto de plugins: catalogo, pedidos, pagos y reservas lo filtran siempre.
 *
 * ```ts
 * const apps = createClient(appsPlugin, { baseUrl: "/api", headers: { "x-app": "riogo24" } });
 * const publica = await apps.publica("riogo24");            // { nombre, modo, marca, servidor, contacto_wa }
 * await apps.cambiarApp("riogo24", { modo: "restaurante" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/apps.md
 */
import { z } from "zod";
import { HttpError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type App, type AppCambio, type AppInput, type AppPublica, type ContextoApp, type ListaAppsFiltros, MODOS_APP, ZAppCambio, ZAppInput } from "@Jeff-Aporta/DER/src/03-plugins/apps/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/apps/schemas.ts";

/** La cabecera que lleva el ambito de la app (por defecto `x-app`). */
export const CABECERA_APP = "x-app";

/** Quita las claves vacias (una query `?x=undefined` romperia el filtro) y vuelve texto el resto. */
function limpio(q: object | undefined): Record<string, string> | undefined {
  if (!q) return undefined;
  const e = Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return e.length ? Object.fromEntries(e.map(([k, v]) => [k, String(v)])) : undefined;
}

/** El ambito de la app de una peticion (la cabecera `X-App` o, si no, el claim `iapp` de la sesion); `null` si no trae ninguno. */
export function ambitoDe(ctx: ContextoApp, cabecera = CABECERA_APP): string | null {
  const deCabecera = ctx.request?.headers.get(cabecera)?.trim() ?? "";
  if (deCabecera) return deCabecera.slice(0, 40);
  const claims = (ctx.session?.claims ?? {}) as { iapp?: unknown };
  const deSesion = String(claims.iapp ?? "").trim();
  return deSesion ? deSesion.slice(0, 40) : null;
}

/** El ambito de la app de una peticion (cabecera `X-App` o sesion): 400 si la peticion no trae ninguno. */
export function ambitoApp(ctx: ContextoApp, cabecera = CABECERA_APP): string {
  const iapp = ambitoDe(ctx, cabecera);
  if (!iapp) throw new HttpError(400, "Falta el ambito de la app: usa la cabecera " + cabecera.toUpperCase());
  return iapp;
}

/** JSON transversal de apps: la entidad de las instancias de negocio y sus rutas (publica, lista, alta y cambio). */
export const appsPlugin: PluginDef = {
  name: "apps",
  entities: {
    apps: {
      name: "apps.app",
      singular: "apps_app",
      plural: "apps_apps",
      table: "apps_apps",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          iapp: { type: "string", pk: true, length: 40 },
          nombre: { type: "string", length: 160, nullable: false },
          modo: { type: "string", enum: MODOS_APP, nullable: false, default: "restaurante" },
          iempresa: { type: "string", length: 40, nullable: true },
          bdemo: { type: "bool", default: false },
          servidor: { type: "string", length: 300, nullable: true },
          marca: { type: "json", nullable: true },
          soporte_wa: { type: "bool", default: false },
          contacto_wa: { type: "string", length: 60, nullable: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["iapp", "nombre", "modo", "iempresa", "bdemo", "fhcre"],
    },
  },
  irregularPaths: {
    publica: {
      method: "GET",
      path: "apps/{iapp}/publica",
      security: "public",
      returns: "json",
      ops: {
        /** `GET apps/{iapp}/publica`: la app tal como la ve el front (sin datos internos). */
        publica(this: ClientPlugin, iapp: string): Promise<AppPublica> {
          return this.call<AppPublica>("publica", undefined, { iapp });
        },
      },
    },
    listarApps: {
      method: "GET",
      path: "apps",
      security: { protected: true, permissions: true, action: "apps.administrar" },
      returns: "json",
      ops: {
        /** `GET apps?modo=&iempresa=&q=`: las apps del ambito (la del `X-App`, si lo hay; si no, las de la empresa). */
        listarApps(this: ClientPlugin, filtros?: ListaAppsFiltros): Promise<App[]> {
          return this.call<App[]>("listarApps", limpio(filtros));
        },
      },
    },
    crearApp: {
      method: "POST",
      path: "apps",
      security: { protected: true, permissions: true, action: "apps.administrar" },
      zod: ZAppInput,
      returns: "json",
      ops: {
        /** `POST apps`: crea la app (el `iapp` lo deduce el servidor del nombre si no viene). */
        crearApp(this: ClientPlugin, input: AppInput): Promise<App> {
          return this.call<App>("crearApp", input);
        },
      },
    },
    cambiarApp: {
      method: "PUT",
      path: "apps/{iapp}",
      security: { protected: true, permissions: true, action: "apps.administrar" },
      zod: ZAppCambio,
      returns: "json",
      ops: {
        /** `PUT apps/{iapp}`: cambia lo editable de la app (el `iapp` NO cambia). */
        cambiarApp(this: ClientPlugin, iapp: string, cambio: AppCambio): Promise<App> {
          return this.call<App>("cambiarApp", cambio, { iapp });
        },
      },
    },
    cambiarAppCuerpo: {
      method: "PUT",
      path: "apps",
      security: { protected: true, permissions: true, action: "apps.administrar" },
      zod: ZAppCambio.extend({ iapp: z.string().trim().min(1).max(40) }),
      returns: "json",
      ops: {
        /** `PUT apps` (la `iapp` va en el cuerpo): cambia lo editable de la app. */
        cambiarAppCuerpo(this: ClientPlugin, iapp: string, cambio: AppCambio): Promise<App> {
          return this.call<App>("cambiarAppCuerpo", { ...cambio, iapp });
        },
      },
    },
  },
};
