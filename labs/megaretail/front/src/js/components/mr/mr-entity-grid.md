---
name: mr-entity-grid
description: Listado de una entidad con iswc-ag-grid: columnas del schema + JSON, datos por query (?q= base64url) paginados en el server.
---

# `<mr-entity-grid>`

Listado de una entidad con iswc-ag-grid: columnas del schema + JSON, datos por query (?q= base64url) paginados en el server.

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-entity-grid.css`.

## Cuándo usarlo

Como catálogo o dentro del selector de relaciones (selección single/multiple).

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `entidad` | `string` | `""` | Plural de la entidad. |
| `seleccion` | `none | single | multiple` | `single` | Modo de selección. |
| `pageSize` | `number` | `25` | Filas por página. |
| `page` | `number` | `1` | Página (1-based). |
| `alto` | `string` | `60vh` | Alto del grid. |

## Eventos

| Evento | detail | Cuándo |
| --- | --- | --- |
| `mr-select` | `{ filas }` | Cambio de selección. |
| `mr-page` | `{ page, pageSize }` | Cambio de página. |

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-entity-grid></mr-entity-grid>
```
