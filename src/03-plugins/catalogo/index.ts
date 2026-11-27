/**
 * Plugin de catálogo: el JSON TRANSVERSAL del catálogo de cada APP (`iapp`). Una app es una instancia de negocio
 * (un restaurante, una tienda, un hotel): sus categorías, sus productos, sus servicios y la disponibilidad de estos
 * últimos viven aislados por `iapp`, así que dos apps del mismo sistema nunca se mezclan y el clon de una se purga entero.
 *
 *   catalogo_categorias     (iapp, icategoria, nombre, orden, bactivo, fhcre, fhmod)
 *   catalogo_items          (iapp, iitem, icategoria, tipo, codigo, nombre, descripcion, precio, moneda, imagen, imagen_mini, bactivo, bdestacado, duracion_min, jextras, fhcre, fhmod)
 *   catalogo_disponibilidad (iapp, iitem, dia_semana, desde, hasta, cupos, fhcre)
 *
 * Lectura PÚBLICA (solo GET, sin sesión): el catálogo de la app lo puede ver cualquiera, que es lo que necesita el front
 * de la app. Escritura PROTEGIDA: exige sesión y el permiso `catalogo.editar`.
 *
 * ```ts
 * const cat = createClient(catalogoPlugin, { baseUrl: "/api", headers: () => ({ "X-App": "riogo24" }) });
 * const categorias = await cat.categorias();
 * const { items, total } = await cat.items({ categoria: "bebidas", q: "limonada", pagina: 1 });
 * const servicio = await cat.item("srv-corte");
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/catalogo.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type Categoria, type CategoriaCambio, type CategoriaInput, type Disponibilidad, type DisponibilidadInput, type FiltrosCatalogo, type ImportarCatalogo, type ItemCambio, type ItemCatalogo, type ItemInput, type PaginaItems, type ResultadoImportacion, ZCategoriaCambio, ZCategoriaInput, ZDisponibilidadInput, ZImportarCatalogo, ZItemCambio, ZItemInput } from "@Jeff-Aporta/DER/src/03-plugins/catalogo/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/catalogo/schemas.ts";

/** Quita las claves vacías (una query `?x=undefined` rompería el filtro) y vuelve texto el resto. */
function limpio(q: object | undefined): Record<string, string> | undefined {
  if (!q) return undefined;
  const e = Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return e.length ? Object.fromEntries(e.map(([k, v]) => [k, String(v)])) : undefined;
}

/** JSON transversal del catálogo: las tres entidades (no publicadas por CRUD) y sus rutas (lectura pública, escritura con permiso). */
export const catalogoPlugin: PluginDef = {
  name: "catalogo",
  entities: {
    categorias: {
      name: "catalogo.categoria",
      singular: "catalogo_categoria",
      plural: "catalogo_categorias",
      table: "catalogo_categorias",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          iapp: { type: "string", pk: true, length: 40 },
          icategoria: { type: "string", pk: true, length: 40 },
          nombre: { type: "string", length: 160, nullable: false },
          orden: { type: "int", default: 0 },
          bactivo: { type: "bool", default: true },
          fhcre: { type: "datetime", nullable: false },
          fhmod: { type: "datetime", nullable: true },
        },
      },
      listColumns: ["iapp", "icategoria", "nombre", "orden", "bactivo"],
    },
    items: {
      name: "catalogo.item",
      singular: "catalogo_item",
      plural: "catalogo_items",
      table: "catalogo_items",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          iapp: { type: "string", pk: true, length: 40 },
          iitem: { type: "string", pk: true, length: 40 },
          icategoria: { type: "string", length: 40, nullable: true },
          tipo: { type: "string", enum: ["producto", "servicio"], nullable: false },
          codigo: { type: "string", length: 40, nullable: false },
          nombre: { type: "string", length: 160, nullable: false },
          descripcion: { type: "text", nullable: true },
          precio: { type: "int", nullable: false, default: 0 },
          moneda: { type: "string", length: 3, nullable: false, default: "COP" },
          imagen: { type: "string", length: 500, nullable: true },
          imagen_mini: { type: "string", length: 500, nullable: true },
          bactivo: { type: "bool", default: true },
          bdestacado: { type: "bool", default: false },
          duracion_min: { type: "int", nullable: true },
          jextras: { type: "json", nullable: true },
          fhcre: { type: "datetime", nullable: false },
          fhmod: { type: "datetime", nullable: true },
        },
      },
      listColumns: ["iapp", "iitem", "icategoria", "tipo", "codigo", "nombre", "precio", "bdestacado", "bactivo"],
    },
    disponibilidad: {
      name: "catalogo.disponibilidad",
      singular: "catalogo_disponibilidad",
      plural: "catalogo_disponibilidades",
      table: "catalogo_disponibilidad",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          iapp: { type: "string", pk: true, length: 40 },
          iitem: { type: "string", pk: true, length: 40 },
          dia_semana: { type: "int", pk: true },
          desde: { type: "string", pk: true, length: 5 },
          hasta: { type: "string", length: 5, nullable: false, default: "23:59" },
          cupos: { type: "int", nullable: false, default: 0 },
          fhcre: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["iapp", "iitem", "dia_semana", "desde", "hasta", "cupos"],
    },
  },
  irregularPaths: {
    categorias: {
      method: "GET",
      path: "catalogo/categorias",
      security: "public",
      returns: "json",
      ops: {
        /** `GET catalogo/categorias`: las categorías activas de la app, ordenadas (`orden`, luego nombre). */
        categorias(this: ClientPlugin): Promise<Categoria[]> {
          return this.call<Categoria[]>("categorias");
        },
      },
    },
    items: {
      method: "GET",
      path: "catalogo/items",
      security: "public",
      returns: "json",
      ops: {
        /** `GET catalogo/items?categoria=&q=&pagina=&porPagina=`: la página de items activos de la app. */
        items(this: ClientPlugin, filtros?: FiltrosCatalogo): Promise<PaginaItems> {
          return this.call<PaginaItems>("items", limpio(filtros));
        },
      },
    },
    item: {
      method: "GET",
      path: "catalogo/item/{iitem}",
      security: "public",
      returns: "json",
      ops: {
        /** `GET catalogo/item/{iitem}`: un item activo de la app (404 si no existe o está inactivo). */
        item(this: ClientPlugin, iitem: string): Promise<ItemCatalogo> {
          return this.call<ItemCatalogo>("item", undefined, { iitem });
        },
      },
    },
    disponibilidad: {
      method: "GET",
      path: "catalogo/disponibilidad",
      security: "public",
      returns: "json",
      ops: {
        /** `GET catalogo/disponibilidad?iitem=&fecha=`: las franjas de un servicio (las del día de `fecha`, o todas). */
        disponibilidad(this: ClientPlugin, iitem: string, fecha?: string): Promise<Disponibilidad[]> {
          return this.call<Disponibilidad[]>("disponibilidad", limpio({ iitem, fecha }));
        },
      },
    },
    crearCategoria: {
      method: "POST",
      path: "catalogo/categorias",
      security: { protected: true, permissions: true, action: "catalogo.editar" },
      zod: ZCategoriaInput,
      returns: "json",
      ops: {
        /** `POST catalogo/categorias`: crea una categoría en la app (exige `catalogo.editar`). */
        crearCategoria(this: ClientPlugin, input: CategoriaInput): Promise<Categoria> {
          return this.call<Categoria>("crearCategoria", input);
        },
      },
    },
    editarCategoria: {
      method: "PUT",
      path: "catalogo/categorias/{icategoria}",
      security: { protected: true, permissions: true, action: "catalogo.editar" },
      zod: ZCategoriaCambio,
      returns: "json",
      ops: {
        /** `PUT catalogo/categorias/{icategoria}`: cambia nombre, orden o estado (exige `catalogo.editar`). */
        editarCategoria(this: ClientPlugin, icategoria: string, cambio: CategoriaCambio): Promise<Categoria> {
          return this.call<Categoria>("editarCategoria", cambio, { icategoria });
        },
      },
    },
    borrarCategoria: {
      method: "DELETE",
      path: "catalogo/categorias/{icategoria}",
      security: { protected: true, permissions: true, action: "catalogo.editar" },
      returns: "json",
      ops: {
        /** `DELETE catalogo/categorias/{icategoria}`: baja lógica de la categoría (exige `catalogo.editar`). */
        borrarCategoria(this: ClientPlugin, icategoria: string): Promise<Categoria> {
          return this.call<Categoria>("borrarCategoria", undefined, { icategoria });
        },
      },
    },
    crearItem: {
      method: "POST",
      path: "catalogo/items",
      security: { protected: true, permissions: true, action: "catalogo.editar" },
      zod: ZItemInput,
      returns: "json",
      ops: {
        /** `POST catalogo/items`: crea un producto o un servicio en la app (exige `catalogo.editar`). */
        crearItem(this: ClientPlugin, input: ItemInput): Promise<ItemCatalogo> {
          return this.call<ItemCatalogo>("crearItem", input);
        },
      },
    },
    editarItem: {
      method: "PUT",
      path: "catalogo/items/{iitem}",
      security: { protected: true, permissions: true, action: "catalogo.editar" },
      zod: ZItemCambio,
      returns: "json",
      ops: {
        /** `PUT catalogo/items/{iitem}`: cambia un item de la app (exige `catalogo.editar`). */
        editarItem(this: ClientPlugin, iitem: string, cambio: ItemCambio): Promise<ItemCatalogo> {
          return this.call<ItemCatalogo>("editarItem", cambio, { iitem });
        },
      },
    },
    borrarItem: {
      method: "DELETE",
      path: "catalogo/items/{iitem}",
      security: { protected: true, permissions: true, action: "catalogo.editar" },
      returns: "json",
      ops: {
        /** `DELETE catalogo/items/{iitem}`: baja lógica del item (exige `catalogo.editar`). */
        borrarItem(this: ClientPlugin, iitem: string): Promise<ItemCatalogo> {
          return this.call<ItemCatalogo>("borrarItem", undefined, { iitem });
        },
      },
    },
    guardarDisponibilidad: {
      method: "POST",
      path: "catalogo/disponibilidad",
      security: { protected: true, permissions: true, action: "catalogo.editar" },
      zod: ZDisponibilidadInput,
      returns: "json",
      ops: {
        /** `POST catalogo/disponibilidad`: deja (o cambia) una franja de un servicio (exige `catalogo.editar`). */
        guardarDisponibilidad(this: ClientPlugin, input: DisponibilidadInput): Promise<Disponibilidad> {
          return this.call<Disponibilidad>("guardarDisponibilidad", input);
        },
      },
    },
    borrarDisponibilidad: {
      method: "DELETE",
      path: "catalogo/disponibilidad/{iitem}",
      security: { protected: true, permissions: true, action: "catalogo.editar" },
      returns: "json",
      ops: {
        /** `DELETE catalogo/disponibilidad/{iitem}`: quita todas las franjas de un servicio (exige `catalogo.editar`). */
        borrarDisponibilidad(this: ClientPlugin, iitem: string): Promise<{ borrados: number }> {
          return this.call<{ borrados: number }>("borrarDisponibilidad", undefined, { iitem });
        },
      },
    },
    importarCatalogo: {
      method: "POST",
      path: "catalogo/importar",
      security: { protected: true, permissions: true, action: "catalogo.editar" },
      zod: ZImportarCatalogo,
      returns: "json",
      ops: {
        /** `POST catalogo/importar`: importa el catálogo de la app (idempotente por código). */
        importarCatalogo(this: ClientPlugin, datos: ImportarCatalogo): Promise<ResultadoImportacion> {
          return this.call<ResultadoImportacion>("importarCatalogo", datos);
        },
      },
    },
  },
};
