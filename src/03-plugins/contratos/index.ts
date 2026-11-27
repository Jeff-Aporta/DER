/**
 * Plugin de CONTRATOS (transversal + cliente): el contrato homogéneo que el servidor publica y que cualquier front
 * descarga para saber de verdad qué hay, cómo se llama y qué forma tiene.
 *
 * - El SERVIDOR sirve `GET contratos`: las entidades montadas (con su JSON Schema y sus rutas), las rutas irregulares y
 *   una `version` (hash sha256 del contenido: cambia si cambia un esquema). Nada de lo que el servidor no publica.
 * - El CLIENTE (`clienteContratos`) descarga ese contrato, arma los validadores (`z.fromJSONSchema`) y expone un CRUD
 *   genérico: `listar`, `ver`, `crear`, `editar`, `borrar` y `llamar` (una ruta irregular). Todas las peticiones llevan
 *   la cabecera `x-app` y todas las respuestas se validan contra el esquema del contrato.
 *
 * ```ts
 * const api = clienteContratos({ servidor: "https://api.ejemplo.com/api", iapp: "riogo24" });
 * const items = await api.listar("catalogo.item", { q: "limonada", pagina: 1, tamano: 20 });
 * const uno = await api.ver("catalogo.item", "lim-001");
 * ```
 *
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/contratos.md
 */
import { z } from "zod";
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { encodeQuery } from "@Jeff-Aporta/DER/src/01-objects/query.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import { type AlmacenContratos, type ClienteContratos, type ContratoEntidad, type Contratos, type JsonSchema, type JsonSchemaZod, type OpcionesClienteContratos, type OpcionesLlamar, type OpcionesLista, ZContratos } from "@Jeff-Aporta/DER/src/03-plugins/contratos/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/contratos/schemas.ts";

/** JSON transversal de contratos: la ruta pública que sirve el contrato (`GET contratos`). */
export const contratosPlugin: PluginDef = {
  name: "contratos",
  irregularPaths: {
    contratos: {
      method: "GET",
      path: "contratos",
      security: "public",
      returns: "json",
      ops: {
        /** `GET contratos`: el contrato del servidor (entidades, esquemas, rutas y versión). */
        contratos(this: ClientPlugin): Promise<Contratos> {
          return this.call<Contratos>("contratos");
        },
      },
    },
  },
};

/** La clave del caché local: el contrato de cada servidor (con su versión). */
function claveDe(servidor: string): string {
  return `der.contratos:${servidor}`;
}

/** El `localStorage` del navegador, si este entorno lo tiene (en el servidor no). */
function almacenLocal(): AlmacenContratos | null {
  try {
    const local = (globalThis as { localStorage?: AlmacenContratos }).localStorage;
    return local ?? null;
  } catch {
    return null;
  }
}

/** El texto de un JSON Schema de una columna es de texto (string) si lo dice en `type` o en algún `anyOf`. */
function esTexto(esquema: JsonSchema): boolean {
  if (esquema.type === "string") return true;
  const anyOf = Array.isArray(esquema["anyOf"]) ? (esquema["anyOf"] as JsonSchema[]) : [];
  return anyOf.some((x) => x.type === "string");
}

/** Las columnas de texto de la entidad (las que el `q` de la lista busca). */
function columnasDeTexto(esquema: JsonSchema): string[] {
  return Object.entries(esquema.properties ?? {}).filter(([, p]) => esTexto(p)).map(([k]) => k);
}

/**
 * Cliente de contratos: descarga `GET contratos` (con la cabecera `x-app`), arma los validadores desde el JSON Schema y
 * expone el CRUD genérico de cualquier entidad. Cachea por versión en memoria y en el `localStorage` (si existe).
 */
export function clienteContratos(opts: OpcionesClienteContratos): ClienteContratos {
  const servidor = opts.servidor.replace(/\/+$/, "");
  const pedir = opts.fetch ?? ((url: string, init?: RequestInit) => globalThis.fetch(url, init));
  const almacen = opts.almacen ?? almacenLocal();
  let cache: Contratos | null = null;
  const validadores = new Map<string, z.ZodType | null>();

  /** Una petición al API: siempre con la cabecera `x-app` (si hay app) y con el cuerpo en JSON. */
  async function pedirJson(metodo: string, path: string, cuerpo?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (opts.iapp) headers["x-app"] = opts.iapp;
    if (cuerpo !== undefined) headers["content-type"] = "application/json";
    const res = await pedir(`${servidor}/${path}`, {
      method: metodo,
      headers,
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    });
    const texto = await res.text();
    let datos: unknown = undefined;
    if (texto) {
      try {
        datos = JSON.parse(texto);
      } catch {
        datos = texto;
      }
    }
    if (!res.ok) {
      const error = datos && typeof datos === "object" ? (datos as { error?: unknown }).error : undefined;
      const detalle = typeof error === "string" ? error : texto || "sin cuerpo";
      throw new Error(`[${metodo} ${path}] ${res.status}: ${detalle}`);
    }
    return datos;
  }

  /** El validador de un JSON Schema (memoizado; `null` si el esquema no se puede traducir). */
  function validadorDe(clave: string, esquema: JsonSchema): z.ZodType | null {
    if (validadores.has(clave)) return validadores.get(clave) ?? null;
    let validador: z.ZodType | null = null;
    try {
      validador = z.fromJSONSchema(esquema as unknown as JsonSchemaZod);
    } catch {
      validador = null;
    }
    validadores.set(clave, validador);
    return validador;
  }

  /** Valida lo que llegó contra el esquema del contrato (si hay validador). */
  function validar(clave: string, esquema: JsonSchema, datos: unknown, que: string): void {
    const validador = validadorDe(clave, esquema);
    if (!validador) return;
    const parsed = validador.safeParse(datos);
    if (!parsed.success) throw new Error(`La respuesta de ${que} no cumple el contrato: ${zodMessage(parsed.error)}`);
  }

  /** Guarda el contrato en el almacén local (si lo hay): es una ayuda, nunca un requisito. */
  function guardarCache(contrato: Contratos): void {
    if (!almacen) return;
    try {
      almacen.setItem(claveDe(servidor), JSON.stringify(contrato));
    } catch (err) {
      console.warn("[contratos] no se pudo cachear el contrato:", err);
    }
  }

  /** El contrato cacheado en el navegador (si lo hay y si aún cumple el formato). */
  function leerCache(): Contratos | null {
    if (!almacen) return null;
    let texto: string | null = null;
    try {
      texto = almacen.getItem(claveDe(servidor));
    } catch (err) {
      console.warn("[contratos] no se pudo leer el contrato cacheado:", err);
      return null;
    }
    if (!texto) return null;
    try {
      const parsed = ZContratos.safeParse(JSON.parse(texto));
      return parsed.success ? (parsed.data as Contratos) : null;
    } catch {
      return null;
    }
  }

  /** Descarga el contrato del servidor (y lo cachea). */
  async function descargar(): Promise<Contratos> {
    const plugins = opts.plugins?.length ? `?plugins=${opts.plugins.map((p) => encodeURIComponent(p)).join(",")}` : "";
    const datos = await pedirJson("GET", `contratos${plugins}`);
    const parsed = ZContratos.safeParse(datos);
    if (!parsed.success) throw new Error(`El contrato del servidor no cumple el formato: ${zodMessage(parsed.error)}`);
    const contrato = parsed.data as Contratos;
    cache = contrato;
    guardarCache(contrato);
    return contrato;
  }

  /** El contrato: el de memoria, el del navegador o (si no hay otro) el del servidor. */
  async function contratos(): Promise<Contratos> {
    if (cache) return cache;
    try {
      return await descargar();
    } catch (err) {
      const guardado = leerCache();
      if (!guardado) throw err;
      cache = guardado;
      return guardado;
    }
  }

  /** La entidad del contrato (por nombre, singular o plural). */
  function entidadDe(contrato: Contratos, nombre: string): ContratoEntidad {
    const entity = contrato.entidades.find((x) => x.nombre === nombre || x.singular === nombre || x.plural === nombre);
    if (!entity) {
      const hay = contrato.entidades.map((x) => x.nombre).join(", ") || "ninguna";
      throw new Error(`El contrato no tiene la entidad "${nombre}" (las que hay: ${hay})`);
    }
    return entity;
  }

  /** La consulta (la de DER) que sale de las opciones de la lista. */
  function consultaDe(entity: ContratoEntidad, opciones?: OpcionesLista): Record<string, unknown> | undefined {
    if (!opciones) return undefined;
    const spec: Record<string, unknown> = {};
    const where: Record<string, unknown> = {};
    const texto = opciones.q?.trim();
    if (texto) {
      const columnas = columnasDeTexto(entity.esquema);
      if (columnas.length) where["$or"] = columnas.map((c) => ({ [c]: { contains: texto } }));
    }
    if (opciones.filtros) for (const [k, v] of Object.entries(opciones.filtros)) where[k] = v;
    if (Object.keys(where).length) spec["where"] = where;
    if (opciones.orden) spec["orderBy"] = opciones.orden;
    if (opciones.pagina !== undefined) spec["page"] = opciones.pagina;
    if (opciones.tamano !== undefined) spec["pageSize"] = opciones.tamano;
    if (opciones.incluir) spec["include"] = opciones.incluir;
    if (opciones.campos) spec["select"] = opciones.campos;
    return Object.keys(spec).length ? spec : undefined;
  }

  /** La ruta con las pks puestos (en el orden de las pks de la entidad). */
  function rutaConPk(ruta: string, pks: string[], id: string | string[], metodo: string): string {
    if (!ruta) throw new Error(`El servidor no publica ${metodo} para esta entidad`);
    const partes = Array.isArray(id) ? id.map((x) => String(x)) : (pks.length > 1 ? String(id).split("/") : [String(id)]);
    let i = 0;
    return ruta.replace(/\{[^}]+\}/g, () => encodeURIComponent(partes[i++] ?? ""));
  }

  /** La ruta con sus parámetros de path puestos (`{iitem}` → el valor). */
  function rutaConParams(ruta: string, params: Record<string, string>): string {
    return ruta.replace(/\{(\w+)\}/g, (_m, k: string) => encodeURIComponent(params[k] ?? ""));
  }

  /** La lista de una entidad (con filtros, página y orden si los hay). */
  async function listar(nombre: string, opciones?: OpcionesLista): Promise<unknown[]> {
    const contrato = await contratos();
    const entity = entidadDe(contrato, nombre);
    if (!entity.rutas.list) throw new Error(`El servidor no publica la lista de "${entity.nombre}"`);
    const spec = consultaDe(entity, opciones);
    const query = spec ? `?q=${encodeQuery(spec)}` : "";
    const datos = await pedirJson("GET", `${entity.rutas.list}${query}`);
    const lista = Array.isArray(datos) ? datos : null;
    if (!lista) throw new Error(`La lista de "${entity.nombre}" no devolvió un arreglo`);
    for (const item of lista) validar(entity.nombre, entity.esquema, item, `GET ${entity.rutas.list}`);
    return lista;
  }

  /** El detalle de una entidad (por sus pks). */
  async function ver(nombre: string, id: string | string[]): Promise<unknown> {
    const contrato = await contratos();
    const entity = entidadDe(contrato, nombre);
    const ruta = rutaConPk(entity.rutas.get, entity.pk, id, "GET");
    const datos = await pedirJson("GET", ruta);
    validar(entity.nombre, entity.esquema, datos, `GET ${ruta}`);
    return datos;
  }

  /** Crea una fila (la ruta de alta de la entidad). */
  async function crear(nombre: string, cuerpo: unknown): Promise<unknown> {
    const contrato = await contratos();
    const entity = entidadDe(contrato, nombre);
    if (!entity.rutas.post) throw new Error(`El servidor no publica el alta de "${entity.nombre}"`);
    const datos = await pedirJson("POST", entity.rutas.post, cuerpo);
    validar(entity.nombre, entity.esquema, datos, `POST ${entity.rutas.post}`);
    return datos;
  }

  /** Cambia una fila (la ruta de cambio de la entidad). */
  async function editar(nombre: string, id: string | string[], cuerpo: unknown): Promise<unknown> {
    const contrato = await contratos();
    const entity = entidadDe(contrato, nombre);
    const ruta = rutaConPk(entity.rutas.put, entity.pk, id, "PUT");
    const datos = await pedirJson("PUT", ruta, cuerpo);
    validar(entity.nombre, entity.esquema, datos, `PUT ${ruta}`);
    return datos;
  }

  /** Borra una fila (la ruta de baja de la entidad). */
  async function borrar(nombre: string, id: string | string[]): Promise<unknown> {
    const contrato = await contratos();
    const entity = entidadDe(contrato, nombre);
    const ruta = rutaConPk(entity.rutas.delete, entity.pk, id, "DELETE");
    const datos = await pedirJson("DELETE", ruta);
    validar(entity.nombre, entity.esquema, datos, `DELETE ${ruta}`);
    return datos;
  }

  /** Llama a una ruta irregular del contrato (con su método y sus parámetros). */
  async function llamar(ruta: string, cuerpo?: unknown, opciones?: OpcionesLlamar): Promise<unknown> {
    const contrato = await contratos();
    const extra = contrato.rutasExtra.find((r) => r.path === ruta);
    const metodo = opciones?.metodo ?? extra?.metodo ?? "POST";
    const path = rutaConParams(ruta, opciones?.params ?? {});
    const datos = await pedirJson(metodo, path, cuerpo);
    if (extra?.salida) validar(`${ruta}:salida`, extra.salida, datos, `${metodo} ${ruta}`);
    return datos;
  }

  return {
    contratos,
    recargar: descargar,
    entidad: async (nombre: string): Promise<ContratoEntidad> => entidadDe(await contratos(), nombre),
    listar,
    ver,
    crear,
    editar,
    borrar,
    llamar,
  };
}
