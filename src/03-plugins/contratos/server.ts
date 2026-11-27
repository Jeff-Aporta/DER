/**
 * Plugin de CONTRATOS (server): la ruta pública `GET contratos` que sirve el contrato homogéneo del API.
 *
 * - QUÉ SIRVE: las entidades MONTADAS en el servidor (las de los plugins y las del consumidor) con su JSON Schema, sus
 *   pks, su `iapp` y sus rutas (las que su controller publica de verdad), y las rutas irregulares.
 * - QUÉ NO SIRVE: nada de lo que el servidor no publica. Una entidad con `exposed: false` no sale; una columna `hidden`
 *   no sale del esquema; una ruta que no está registrada no sale.
 * - LA VERSIÓN: el sha256 del contenido (entidades + rutas). Cambia si cambia un esquema; no cambia por la fecha (por eso
 *   `generado` va aparte). El front cachea por versión: si la versión no cambia, no hay nada nuevo que aprender.
 * - EL FILTRO: `?plugins=catalogo,pagos` acota el contrato a esos plugins (las entidades y las rutas de los demás no salen).
 *
 * ```ts
 * const contratos = createServer(contratosServer, { db });
 * const router = createRouter(ctrls, { basePath: "/api", plugins: [catalogo, pagos, contratos] });
 * ```
 *
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/contratos.md
 */
import { z } from "zod";
import { HttpError, Obj } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { IrregularPath } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { columnZod } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import { routePath } from "@Jeff-Aporta/DER/src/02-controllers/plugin.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { Router } from "@Jeff-Aporta/DER/src/02-controllers/server/router.ts";
import { controllerRouteSpecs, controllerSecurity } from "@Jeff-Aporta/DER/src/02-controllers/server/routes.ts";
import type { ActionRouteSpec, ExtraRouteInput, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { contratosPlugin } from "@Jeff-Aporta/DER/src/03-plugins/contratos/index.ts";
import type { ContratoEntidad, ContratoRutaExtra, Contratos, JsonSchema } from "@Jeff-Aporta/DER/src/03-plugins/contratos/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/contratos/index.ts";

/** El JSON Schema de un Zod (o `{}` si el tipo no se puede representar en JSON Schema). */
function jsonDeZod(molde: z.ZodType): JsonSchema {
  try {
    return z.toJSONSchema(molde, { unrepresentable: "any" }) as unknown as JsonSchema;
  } catch {
    return {};
  }
}

/** El JSON Schema de la entidad: sus columnas (sin las ocultas) tal como las devuelve el servidor. */
function esquemaDe(ctrl: ServerController<any>): JsonSchema {
  const props: Record<string, z.ZodType> = {};
  for (const [nombre, col] of Object.entries(ctrl.entity.meta.columns)) {
    if (ctrl.isHidden(nombre)) continue;
    props[nombre] = columnZod(nombre, col).nullable().optional();
  }
  try {
    return z.toJSONSchema(z.object(props), { unrepresentable: "any" }) as unknown as JsonSchema;
  } catch {
    const properties: Record<string, JsonSchema> = {};
    for (const [nombre, molde] of Object.entries(props)) properties[nombre] = jsonDeZod(molde);
    return { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties, required: [] };
  }
}

/** La entidad del contrato: sus rutas (las que publica su controller), su esquema y si son públicas. */
function entidadDe(ctrl: ServerController<any>, specs: ActionRouteSpec[]): ContratoEntidad {
  const entity = ctrl.entity;
  const ruta = (name: string): string => {
    const spec = specs.find((s) => s.name === name && !s.sse) ?? specs.find((s) => s.name === name);
    return spec?.path ?? "";
  };
  return {
    nombre: entity.name,
    singular: entity.singularPath.join("/"),
    plural: entity.pluralPath.join("/"),
    pk: [...entity.meta.pks],
    iapp: entity.meta.isColumn("iapp"),
    publica: { list: !controllerSecurity(ctrl, "list").protected, get: !controllerSecurity(ctrl, "get").protected },
    esquema: esquemaDe(ctrl),
    rutas: { list: ruta("list"), get: ruta("get"), post: ruta("post"), put: ruta("put"), delete: ruta("delete") },
  };
}

/** De qué plugin es cada controller (los del consumidor no tienen plugin). */
function dueniosDe(router: Router): Map<ServerController<any>, string> {
  const out = new Map<ServerController<any>, string>();
  for (const plugin of router.plugins) for (const ctrl of plugin.list) out.set(ctrl, plugin.name);
  return out;
}

/** La salida de una ruta irregular (la del POJO o la del POJO en lista; si no se sabe, no se inventa). */
function salidaDe(def: { path: IrregularPath; ctrl: ServerController<any> | null } | undefined): JsonSchema | undefined {
  if (!def?.ctrl) return undefined;
  if (def.path.returns === "pojo") return esquemaDe(def.ctrl);
  if (def.path.returns === "list") return { type: "array", items: esquemaDe(def.ctrl) };
  return undefined;
}

/** Las rutas irregulares que el servidor publica (las de los plugins), con su entrada y su salida. */
function extrasDe(router: Router, permitidos: Set<string> | null): ContratoRutaExtra[] {
  const defs = new Map<string, { plugin: string; path: IrregularPath; ctrl: ServerController<any> | null }>();
  for (const plugin of router.plugins) {
    for (const def of Object.values(plugin.def.irregularPaths ?? {})) {
      defs.set(`${def.method} ${routePath(def)}`, { plugin: plugin.name, path: def, ctrl: null });
    }
    for (const ctrl of plugin.list) {
      for (const def of Object.values(ctrl.entity.def.paths ?? {})) {
        defs.set(`${def.method} ${routePath(def, ctrl.entity)}`, { plugin: plugin.name, path: def, ctrl });
      }
    }
  }
  const out: ContratoRutaExtra[] = [];
  for (const ruta of router.routes) {
    if (ruta.kind !== "extra" || ruta.sse) continue;
    const def = defs.get(`${ruta.method} ${ruta.path}`);
    if (permitidos && (!def || !permitidos.has(def.plugin))) continue;
    const extra: ContratoRutaExtra = { metodo: ruta.method, path: ruta.path, publica: !ruta.security.protected };
    if (def?.path.zod) extra.entrada = jsonDeZod(def.path.zod);
    const salida = salidaDe(def);
    if (salida) extra.salida = salida;
    out.push(extra);
  }
  return out;
}

/** El hash sha256 del contenido del contrato (estable: sólo depende de las entidades y de las rutas). */
export async function hashDe(contenido: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(contenido));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * El contrato del servidor: las entidades montadas (con su esquema y sus rutas) y las rutas irregulares.
 * `filtro` (el `?plugins=`) acota el contrato a los plugins indicados.
 */
export async function contratoDelRouter(router: Router, filtro?: string | null): Promise<Contratos> {
  const permitidos = filtro ? new Set(filtro.split(",").map((p) => p.trim()).filter(Boolean)) : null;
  const duenios = dueniosDe(router);
  const entidades: ContratoEntidad[] = [];
  const vistas = new Set<string>();
  for (const ctrl of router.controllers) {
    const plugin = duenios.get(ctrl);
    if (permitidos && (!plugin || !permitidos.has(plugin))) continue;
    const specs = controllerRouteSpecs(ctrl);
    if (!specs.length) continue;
    if (vistas.has(ctrl.entity.name)) continue;
    vistas.add(ctrl.entity.name);
    entidades.push(entidadDe(ctrl, specs));
  }
  entidades.sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
  const rutasExtra = extrasDe(router, permitidos);
  const contenido = { entidades, rutasExtra };
  const version = await hashDe(contenido);
  return { version, generado: new Date().toISOString(), ...contenido };
}

/** JSON del server de contratos: la ruta pública `GET contratos` que sirve el contrato del API. */
export const contratosServer: ServerPluginDef = Obj.insert(contratosPlugin, {
  irregularPaths: {
    contratos: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<Contratos> {
        const router = this.router;
        if (!router) throw new HttpError(500, "El plugin de contratos necesita un router");
        return await contratoDelRouter(router, i.query.get("plugins"));
      },
    },
  },
}) as ServerPluginDef;
