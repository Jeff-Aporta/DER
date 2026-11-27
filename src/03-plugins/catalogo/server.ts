/**
 * Plugin de catálogo (server): el catálogo de cada APP (`iapp`) con sus rutas públicas de lectura y sus rutas de
 * escritura (con el permiso `catalogo.editar`).
 *
 * - ÁMBITO: toda lectura y toda escritura se filtran por `iapp`. La app de la petición sale de la cabecera `X-App`
 *   (o de la sesión); sin app no hay catálogo que servir. El ámbito es LOCAL de este plugin: el orquestador lo une
 *   luego con el `ambitoApp` del plugin `apps`.
 * - LECTURA PÚBLICA: solo GET y sin sesión (`catalogo/categorias`, `catalogo/items`, `catalogo/item/{iitem}`,
 *   `catalogo/disponibilidad`). Es lo que necesita el front de la app, que no tiene sesión.
 * - ESCRITURA: exige sesión y el permiso `catalogo.editar` (la acción de seguridad de esas rutas). Un item de otra app
 *   es 404 (nunca se distingue).
 * - PRECIO: entero en pesos (COP). `jextras` guarda lo libre del item (adicionales, variantes).
 * - DISPONIBILIDAD: solo de los servicios; franjas por día de la semana (1 = lunes … 7 = domingo) con sus cupos.
 * - IMPORTACIÓN: `importarCatalogo(p, iapp, { categorias, items, disponibilidad })` es IDEMPOTENTE por código (el de la
 *   categoría es su `icategoria`, el del item su `codigo`): lo que existe se actualiza, lo nuevo se crea.
 *
 * ```ts
 * const cat = crearCatalogo({ db, cfg: { appPorDefecto: "riogo24" } });
 * const router = createRouter(ctrls, { basePath: "/api", plugins: [cat] });
 * await router.seed();
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/catalogo.md
 */
import { HttpError, NotFoundError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { ahora, ctrl, fila, filas, guardar, idNuevo, porPk, sinIndefinidos, validado } from "@Jeff-Aporta/DER/src/03-plugins/common/tablas.ts";
import { catalogoPlugin } from "@Jeff-Aporta/DER/src/03-plugins/catalogo/index.ts";
import { type Categoria, type CategoriaCambio, type CategoriaInput, type CatalogoConfig, type ContextoCatalogo, type Disponibilidad, type DisponibilidadInput, type FiltrosCatalogo, type ImportarCatalogo, type ItemCambio, type ItemCatalogo, type ItemInput, MONEDA_POR_DEFECTO, type PaginaItems, type ResultadoImportacion, type VerbosCatalogo, ZCategoriaCambio, ZCategoriaInput, ZCatalogoConfig, ZDisponibilidadInput, ZImportarCatalogo, ZItemCambio, ZItemInput } from "@Jeff-Aporta/DER/src/03-plugins/catalogo/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/catalogo/index.ts";

const cfgDe = (p: ServerPlugin): CatalogoConfig => (p.cfg ?? {}) as CatalogoConfig;

/** Cabecera que lleva el ámbito de la app (la misma que usa el plugin `apps` por defecto). */
const CABECERA_APP = "x-app";

/**
 * La app de la petición: la cabecera `X-App`; si no viene, la que trae la sesión; si tampoco, la de por defecto de la
 * configuración. Sin ninguna, 400: sin app no se sabe qué catálogo se está pidiendo.
 *
 * LOCAL de este plugin a propósito (no se exporta): tiene la misma forma que el `ambitoApp` del plugin `apps`, así que
 * el orquestador lo une luego con él (basta cambiar el cuerpo de esta función).
 */
function ambito(ctx: ContextoCatalogo, cabecera: string, porDefecto?: string | undefined): string {
  const deCabecera = (ctx.request?.headers.get(cabecera) ?? "").trim();
  if (deCabecera) return deCabecera.slice(0, 40);
  const claims: Record<string, unknown> = ctx.session?.claims ?? {};
  const deSesion = String(claims["iapp"] ?? "").trim();
  if (deSesion) return deSesion.slice(0, 40);
  if (porDefecto) return porDefecto;
  throw new HttpError(400, "Falta el ambito de la app: usa la cabecera " + cabecera.toUpperCase());
}

/** La app de la petición, con la configuración del plugin (la de por defecto si no hay cabecera ni sesión). */
function ambitoDe(p: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): string {
  const cfg = cfgDe(p);
  return ambito({ request: i.request, session: ctx.session }, cfg.cabecera ?? CABECERA_APP, cfg.appPorDefecto);
}

/** El día ISO (1 = lunes … 7 = domingo) de una fecha `YYYY-MM-DD` (en UTC: el día no se corre por zona horaria). */
export function diaDe(fecha: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ValidationError("La fecha debe ser YYYY-MM-DD");
  const d = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ValidationError("«" + fecha + "» no es una fecha válida");
  return ((d.getUTCDay() + 6) % 7) + 1;
}

/** Filtros de la lista a partir de la query HTTP. */
function filtrosDeQuery(i: ExtraRouteInput): FiltrosCatalogo {
  const numero = (k: string): number | undefined => {
    const n = Number(i.query.get(k));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  return { categoria: i.query.get("categoria") ?? undefined, q: i.query.get("q") ?? undefined, pagina: numero("pagina"), porPagina: numero("porPagina") };
}

/** Categorías activas de la app, por orden y luego por nombre. */
async function listarCategorias(p: ServerPlugin, iapp: string): Promise<Categoria[]> {
  return await filas<Categoria>(p, "categorias", { where: { iapp, bactivo: true }, orderBy: ["orden", "nombre"], pageSize: 200 });
}

/** El item de la app con ese código (null si no existe). */
async function itemPorCodigo(p: ServerPlugin, iapp: string, codigo: string): Promise<ItemCatalogo | null> {
  const items = await filas<ItemCatalogo>(p, "items", { where: { iapp, codigo }, pageSize: 1 });
  return items[0] ?? null;
}

/** Un item de la app por su id (404 si no existe). */
async function itemDe(p: ServerPlugin, iapp: string, iitem: string): Promise<ItemCatalogo> {
  const item = await porPk<ItemCatalogo>(p, "items", { iapp, iitem });
  if (!item) throw new NotFoundError("Ese item no existe");
  return item;
}

/** Página de items activos de la app (filtros: categoría, búsqueda y paginación). */
async function listarItems(p: ServerPlugin, iapp: string, filtros: FiltrosCatalogo = {}): Promise<PaginaItems> {
  const pagina = Math.max(1, Math.floor(filtros.pagina ?? 1));
  const porPagina = Math.min(100, Math.max(1, Math.floor(filtros.porPagina ?? 20)));
  const where: Record<string, unknown> = { iapp, bactivo: true };
  if (filtros.categoria) where["icategoria"] = filtros.categoria.trim();
  const q = filtros.q?.trim();
  if (q) where["$or"] = [{ nombre: { contains: q } }, { descripcion: { contains: q } }, { codigo: { contains: q } }];
  const c = ctrl(p, "items");
  // el total se cuenta de a páginas (para que un catálogo grande no se corte) y la hoja sale ya paginada
  let total = 0;
  for (let hoja = 1; hoja <= 100; hoja++) {
    const parte = await c.query({ select: ["iitem"], where, page: hoja, pageSize: c.entity.maxPageSize } as never);
    total += parte.length;
    if (parte.length < c.entity.maxPageSize) break;
  }
  const paginaItems = await c.query({ where, orderBy: ["-bdestacado", "nombre"], page: pagina, pageSize: porPagina } as never);
  return { items: paginaItems.map((x: unknown) => fila(x) as ItemCatalogo), total, pagina, porPagina };
}

/** Las franjas de un servicio: las del día pedido (o todas si no se pide día). */
async function disponibilidadDe(p: ServerPlugin, iapp: string, iitem: string, dia?: number | undefined): Promise<Disponibilidad[]> {
  const item = await itemDe(p, iapp, iitem);
  if (item.tipo !== "servicio") throw new ValidationError("Solo un servicio tiene disponibilidad");
  const where: Record<string, unknown> = { iapp, iitem };
  if (dia !== undefined) where["dia_semana"] = dia;
  return await filas<Disponibilidad>(p, "disponibilidad", { where, orderBy: ["dia_semana", "desde"], pageSize: 200 });
}

/** La categoría de la app por su código (null si no se indica; 400 si el código no existe). */
async function categoriaDe(p: ServerPlugin, iapp: string, codigo: string | null | undefined): Promise<string | null> {
  const c = codigo?.trim();
  if (!c) return null;
  const previa = await porPk<Categoria>(p, "categorias", { iapp, icategoria: c });
  if (!previa) throw new ValidationError("La categoría «" + c + "» no existe");
  return previa.icategoria;
}

/** Crea una categoría en la app (409 si el código ya existe). */
async function crearCategoria(p: ServerPlugin, iapp: string, input: CategoriaInput): Promise<Categoria> {
  const d = validado<CategoriaInput>(ZCategoriaInput, input);
  const codigo = d.codigo.trim();
  if (await porPk<Categoria>(p, "categorias", { iapp, icategoria: codigo })) throw new HttpError(409, "Ya existe la categoría «" + codigo + "»");
  const c = ctrl(p, "categorias");
  const creado = await c.post(c.pojo({ iapp, icategoria: codigo, nombre: d.nombre, orden: d.orden ?? 0, bactivo: d.bactivo ?? true, fhcre: ahora(), fhmod: null }));
  return fila(creado) as Categoria;
}

/** Cambia una categoría de la app (404 si no existe). */
async function editarCategoria(p: ServerPlugin, iapp: string, icategoria: string, cambio: CategoriaCambio): Promise<Categoria> {
  const d = validado<CategoriaCambio>(ZCategoriaCambio, cambio);
  if (!(await porPk<Categoria>(p, "categorias", { iapp, icategoria }))) throw new NotFoundError("Esa categoría no existe");
  const cambios = sinIndefinidos({ nombre: d.nombre, orden: d.orden, bactivo: d.bactivo, fhmod: ahora() });
  return await guardar<Categoria>(p, "categorias", { iapp, icategoria }, cambios);
}

/** Baja lógica de una categoría (la fila se conserva). */
async function borrarCategoria(p: ServerPlugin, iapp: string, icategoria: string): Promise<Categoria> {
  if (!(await porPk<Categoria>(p, "categorias", { iapp, icategoria }))) throw new NotFoundError("Esa categoría no existe");
  return await guardar<Categoria>(p, "categorias", { iapp, icategoria }, { bactivo: false, fhmod: ahora() });
}

/** Crea un item (producto o servicio) en la app (409 si el código ya existe). */
async function crearItem(p: ServerPlugin, iapp: string, input: ItemInput): Promise<ItemCatalogo> {
  const d = validado<ItemInput>(ZItemInput, input);
  const codigo = d.codigo.trim();
  if (await itemPorCodigo(p, iapp, codigo)) throw new HttpError(409, "Ya existe el item con el código «" + codigo + "»");
  const icategoria = await categoriaDe(p, iapp, d.categoria);
  const c = ctrl(p, "items");
  const creado = await c.post(c.pojo({ iapp, iitem: idNuevo(), icategoria, tipo: d.tipo, codigo, nombre: d.nombre, descripcion: d.descripcion ?? null, precio: d.precio, moneda: d.moneda ?? MONEDA_POR_DEFECTO, imagen: d.imagen ?? null, imagen_mini: d.imagen_mini ?? null, bactivo: d.bactivo ?? true, bdestacado: d.bdestacado ?? false, duracion_min: d.tipo === "servicio" ? d.duracion_min ?? null : null, jextras: d.extras ?? null, fhcre: ahora(), fhmod: null }));
  return fila(creado) as ItemCatalogo;
}

/** Cambia un item de la app (404 si no existe). El código no cambia: es la llave idempotente de la importación. */
async function editarItem(p: ServerPlugin, iapp: string, iitem: string, cambio: ItemCambio): Promise<ItemCatalogo> {
  const d = validado<ItemCambio>(ZItemCambio, cambio);
  const previa = await porPk<ItemCatalogo>(p, "items", { iapp, iitem });
  if (!previa) throw new NotFoundError("Ese item no existe");
  const cambios = sinIndefinidos({ tipo: d.tipo, nombre: d.nombre, descripcion: d.descripcion, precio: d.precio, moneda: d.moneda, imagen: d.imagen, imagen_mini: d.imagen_mini, bactivo: d.bactivo, bdestacado: d.bdestacado, duracion_min: d.duracion_min, extras: d.extras, fhmod: ahora() });
  if (d.categoria !== undefined) cambios["icategoria"] = await categoriaDe(p, iapp, d.categoria);
  if ((d.tipo ?? previa.tipo) !== "servicio") cambios["duracion_min"] = null;
  return await guardar<ItemCatalogo>(p, "items", { iapp, iitem }, cambios);
}

/** Baja lógica de un item (la fila se conserva). */
async function borrarItem(p: ServerPlugin, iapp: string, iitem: string): Promise<ItemCatalogo> {
  if (!(await porPk<ItemCatalogo>(p, "items", { iapp, iitem }))) throw new NotFoundError("Ese item no existe");
  return await guardar<ItemCatalogo>(p, "items", { iapp, iitem }, { bactivo: false, fhmod: ahora() });
}

/** Deja (o cambia) una franja de disponibilidad de un servicio (la llave es item + día + hora de inicio). */
async function guardarDisponibilidad(p: ServerPlugin, iapp: string, input: DisponibilidadInput): Promise<Disponibilidad> {
  const d = validado<DisponibilidadInput>(ZDisponibilidadInput, input);
  const item = await itemDe(p, iapp, d.iitem);
  if (item.tipo !== "servicio") throw new ValidationError("Solo un servicio tiene disponibilidad");
  const desde = d.desde.trim();
  const hasta = d.hasta?.trim() ?? "23:59";
  if (hasta <= desde) throw new ValidationError("La hora «hasta» debe ser posterior a «desde»");
  const pk = { iapp, iitem: d.iitem, dia_semana: d.dia_semana, desde };
  const previa = await porPk<Disponibilidad>(p, "disponibilidad", pk);
  return await guardar<Disponibilidad>(p, "disponibilidad", pk, { hasta, cupos: d.cupos ?? previa?.cupos ?? 0, fhcre: previa?.fhcre ?? ahora() });
}

/** Quita todas las franjas de un servicio. */
async function borrarDisponibilidad(p: ServerPlugin, iapp: string, iitem: string): Promise<{ borrados: number }> {
  const c = ctrl(p, "disponibilidad");
  const actuales = await filas<Disponibilidad>(p, "disponibilidad", { where: { iapp, iitem }, pageSize: 500 });
  for (const a of actuales) await c.delete(c.pojo({ iapp, iitem: a.iitem, dia_semana: a.dia_semana, desde: a.desde }));
  return { borrados: actuales.length };
}

/**
 * Importa el catálogo de una app: IDEMPOTENTE por código (el de la categoría es su `icategoria`, el del item su `codigo`).
 * Lo que ya existe se actualiza (lo que no viene en la importación se conserva) y lo nuevo se crea.
 */
export async function importarCatalogo(p: ServerPlugin, iapp: string, datos: ImportarCatalogo): Promise<ResultadoImportacion> {
  const d = validado<ImportarCatalogo>(ZImportarCatalogo, datos);
  const res: ResultadoImportacion = { categorias: { creadas: 0, actualizadas: 0 }, items: { creados: 0, actualizados: 0 }, disponibilidad: { creadas: 0, actualizadas: 0 } };
  for (const cat of d.categorias ?? []) {
    const codigo = cat.codigo.trim();
    const previa = await porPk<Categoria>(p, "categorias", { iapp, icategoria: codigo });
    const cambios: Record<string, unknown> = { nombre: cat.nombre };
    if (cat.orden !== undefined) cambios["orden"] = cat.orden;
    if (cat.bactivo !== undefined) cambios["bactivo"] = cat.bactivo;
    if (previa) {
      await guardar<Categoria>(p, "categorias", { iapp, icategoria: codigo }, { ...cambios, fhmod: ahora() });
      res.categorias.actualizadas++;
    } else {
      const c = ctrl(p, "categorias");
      await c.post(c.pojo({ iapp, icategoria: codigo, orden: 0, bactivo: true, ...cambios, fhcre: ahora(), fhmod: null }));
      res.categorias.creadas++;
    }
  }
  for (const item of d.items ?? []) {
    const codigo = item.codigo.trim();
    const previa = await itemPorCodigo(p, iapp, codigo);
    // lo que no viene en la importación se conserva (si no, la app perdería datos al reimportar)
    const icategoria = item.categoria === undefined ? previa?.icategoria ?? null : await categoriaDe(p, iapp, item.categoria);
    const cambios: Record<string, unknown> = { icategoria, tipo: item.tipo, nombre: item.nombre, precio: item.precio };
    if (item.descripcion !== undefined) cambios["descripcion"] = item.descripcion;
    if (item.moneda !== undefined) cambios["moneda"] = item.moneda;
    if (item.imagen !== undefined) cambios["imagen"] = item.imagen;
    if (item.imagen_mini !== undefined) cambios["imagen_mini"] = item.imagen_mini;
    if (item.bactivo !== undefined) cambios["bactivo"] = item.bactivo;
    if (item.bdestacado !== undefined) cambios["bdestacado"] = item.bdestacado;
    if (item.duracion_min !== undefined) cambios["duracion_min"] = item.duracion_min;
    if (item.extras !== undefined) cambios["jextras"] = item.extras;
    if (item.tipo !== "servicio") cambios["duracion_min"] = null;
    if (previa) {
      await guardar<ItemCatalogo>(p, "items", { iapp, iitem: previa.iitem }, { ...cambios, fhmod: ahora() });
      res.items.actualizados++;
    } else {
      const c = ctrl(p, "items");
      await c.post(c.pojo({ iapp, iitem: idNuevo(), codigo, descripcion: null, moneda: MONEDA_POR_DEFECTO, imagen: null, imagen_mini: null, bactivo: true, bdestacado: false, duracion_min: null, jextras: null, ...cambios, fhcre: ahora(), fhmod: null }));
      res.items.creados++;
    }
  }
  for (const dis of d.disponibilidad ?? []) {
    const codigo = dis.codigo.trim();
    const item = await itemPorCodigo(p, iapp, codigo);
    if (!item) throw new ValidationError("El item con el código «" + codigo + "» no existe en la importación");
    if (item.tipo !== "servicio") throw new ValidationError("El item «" + codigo + "» no es un servicio: no tiene disponibilidad");
    const desde = dis.desde.trim();
    const pk = { iapp, iitem: item.iitem, dia_semana: dis.dia_semana, desde };
    const previa = await porPk<Disponibilidad>(p, "disponibilidad", pk);
    const hasta = dis.hasta === undefined ? previa?.hasta ?? "23:59" : dis.hasta.trim();
    if (hasta <= desde) throw new ValidationError("La hora «hasta» debe ser posterior a «desde»");
    if (previa) {
      await guardar<Disponibilidad>(p, "disponibilidad", pk, { hasta, cupos: dis.cupos ?? previa.cupos, fhcre: previa.fhcre });
      res.disponibilidad.actualizadas++;
    } else {
      const c = ctrl(p, "disponibilidad");
      await c.post(c.pojo({ ...pk, hasta, cupos: dis.cupos ?? 0, fhcre: ahora() }));
      res.disponibilidad.creadas++;
    }
  }
  return res;
}

/** JSON del server del catálogo: `catalogoPlugin` + handlers + verbos + seed. */
export const catalogoServer: ServerPluginDef = Obj.insert(catalogoPlugin, {
  cfg: ZCatalogoConfig,
  entities: {
    categorias: { indexes: [{ columns: ["iapp", "orden"], name: "ix_catalogo_categorias_app" }] },
    items: { indexes: [{ columns: ["iapp", "icategoria"], name: "ix_catalogo_items_categoria" }, { columns: ["iapp", "codigo"], name: "ux_catalogo_items_codigo", unique: true }, { columns: ["iapp", "tipo"], name: "ix_catalogo_items_tipo" }] },
    disponibilidad: { indexes: [{ columns: ["iapp", "iitem"], name: "ix_catalogo_disponibilidad_item" }] },
  },
  irregularPaths: {
    categorias: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Categoria[]> {
        return await listarCategorias(this, ambitoDe(this, i, ctx));
      },
    },
    items: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<PaginaItems> {
        return await listarItems(this, ambitoDe(this, i, ctx), filtrosDeQuery(i));
      },
    },
    item: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ItemCatalogo> {
        const item = await itemDe(this, ambitoDe(this, i, ctx), i.params["iitem"] ?? "");
        if (!item.bactivo) throw new NotFoundError("Ese item no existe");
        return item;
      },
    },
    disponibilidad: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Disponibilidad[]> {
        const iapp = ambitoDe(this, i, ctx);
        const iitem = (i.query.get("iitem") ?? "").trim();
        if (!iitem) throw new ValidationError("Falta iitem");
        const fecha = (i.query.get("fecha") ?? "").trim();
        return await disponibilidadDe(this, iapp, iitem, fecha ? diaDe(fecha) : undefined);
      },
    },
    crearCategoria: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Categoria> {
        return await crearCategoria(this, ambitoDe(this, i, ctx), i.body as CategoriaInput);
      },
    },
    editarCategoria: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Categoria> {
        return await editarCategoria(this, ambitoDe(this, i, ctx), i.params["icategoria"] ?? "", i.body as CategoriaCambio);
      },
    },
    borrarCategoria: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Categoria> {
        return await borrarCategoria(this, ambitoDe(this, i, ctx), i.params["icategoria"] ?? "");
      },
    },
    crearItem: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ItemCatalogo> {
        return await crearItem(this, ambitoDe(this, i, ctx), i.body as ItemInput);
      },
    },
    editarItem: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ItemCatalogo> {
        return await editarItem(this, ambitoDe(this, i, ctx), i.params["iitem"] ?? "", i.body as ItemCambio);
      },
    },
    borrarItem: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ItemCatalogo> {
        return await borrarItem(this, ambitoDe(this, i, ctx), i.params["iitem"] ?? "");
      },
    },
    guardarDisponibilidad: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<Disponibilidad> {
        return await guardarDisponibilidad(this, ambitoDe(this, i, ctx), i.body as DisponibilidadInput);
      },
    },
    borrarDisponibilidad: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<{ borrados: number }> {
        return await borrarDisponibilidad(this, ambitoDe(this, i, ctx), i.params["iitem"] ?? "");
      },
    },
    importarCatalogo: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ResultadoImportacion> {
        return await importarCatalogo(this, ambitoDe(this, i, ctx), (i.body ?? {}) as ImportarCatalogo);
      },
    },
  },
  /** En el server, los verbos son metodos directos (sin HTTP): las mismas funciones que usan los handlers. */
  setup(this: ServerPlugin) {
    const v: VerbosCatalogo = {
      categorias: (iapp) => listarCategorias(this, iapp),
      items: (iapp, filtros) => listarItems(this, iapp, filtros),
      item: (iapp, iitem) => itemDe(this, iapp, iitem),
      disponibilidad: (iapp, iitem, dia) => disponibilidadDe(this, iapp, iitem, dia),
      crearCategoria: (iapp, input) => crearCategoria(this, iapp, input),
      editarCategoria: (iapp, icategoria, cambio) => editarCategoria(this, iapp, icategoria, cambio),
      borrarCategoria: (iapp, icategoria) => borrarCategoria(this, iapp, icategoria),
      crearItem: (iapp, input) => crearItem(this, iapp, input),
      editarItem: (iapp, iitem, cambio) => editarItem(this, iapp, iitem, cambio),
      borrarItem: (iapp, iitem) => borrarItem(this, iapp, iitem),
      guardarDisponibilidad: (iapp, input) => guardarDisponibilidad(this, iapp, input),
      borrarDisponibilidad: (iapp, iitem) => borrarDisponibilidad(this, iapp, iitem),
      importarCatalogo: (iapp, datos) => importarCatalogo(this, iapp, datos),
    };
    Object.assign(this, v);
  },
  /** Crea sus tablas (y les suma columnas nuevas): sirve también sin router. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
  },
}) as ServerPluginDef;

/** createServer(catalogoServer, runtime) con los verbos tipados. */
export function crearCatalogo(runtime: ServerPluginRuntime): ServerPlugin & VerbosCatalogo {
  return createServer(catalogoServer, runtime) as ServerPlugin & VerbosCatalogo;
}
