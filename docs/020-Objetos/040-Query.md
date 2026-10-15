---
Titulo: Query: filtros, orden, paginación
Estado: vigente
Autor:
tags: [objetos, query]
---
# `query()`

[← índice](../README.md) · tipos `QuerySpec`, `Where`, `FieldOps`, `Include` y Zod `ZQuerySpec` en `src/00 common/schemas.ts`

```ts
await productos.query({
  select: ["iproducto", "nombre", "precio"],      // columnas (incluidas las calculadas); default: todas
  where: {
    precio: { gte: 10, lt: 100 },
    nombre: { contains: "cafe" },                 // ILIKE '%cafe%' con % y _ escapados
    icategoria: null,                             // IS NULL
    tipo: ["fisico", "digital"],                  // IN
    categoria: { bactivo: true },                 // filtro por relación → EXISTS (subconsulta correlacionada)
    total: { gt: 40 },                            // columna calculada
    $or: [{ stock: 0 }, { tipo: "digital" }],
    $not: { nombre: "Ebook" },
  },
  orderBy: ["-precio", "nombre"],                 // "-" = desc; también { field, dir }
  page: 1, pageSize: 20,                          // 1-based; default pageSize de la entidad, tope maxPageSize
  include: { categoria: true, lineas: { producto: true } },
});
```

- **Siempre retorna un arreglo** de POJOs.
- Sin `orderBy` se ordena por las pk, así la paginación es estable.
- Operadores: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `between`, `like`, `ilike`, `contains`, `startsWith`, `endsWith` (sin distinguir mayúsculas y con comodines escapados) e `isNull`. Los valores se castean con el tipo de la columna.
- `in: []` → ningún resultado. `nin: []` → no filtra.

## Include (JData de relaciones)

Es una consulta al estilo `Obj`: `true` incluye el detalle, un objeto incluye además sus detalles anidados, y `"*": true` incluye todas las relaciones de ese nivel. El SQL lo arma el controller con una sola consulta, usando subconsultas JSON correlacionadas por motor:

- 1:1 (`kind: "one"`) → objeto o `null`.
- 1:N (`kind: "many"`) → arreglo (vacío si no hay).

`get()` acepta `ctx.include` (y por HTTP `?include=<json>`). Si no se pasa, usa `getInclude` de la entidad.

## `list()` frente a `query()`

`list()` trae toda la colección, aplanada, con `listColumns` y sin relaciones ni filtros (para combos y catálogos). `query()` es la herramienta completa.
