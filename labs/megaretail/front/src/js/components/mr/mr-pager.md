---
name: mr-pager
description: Paginador de consultas DER: anterior/siguiente, página y tamaño. Sin total (DER no lo devuelve).
---

# `<mr-pager>`

Paginador de consultas DER: anterior/siguiente, página y tamaño. Sin total (DER no lo devuelve).

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-pager.css`.

## Cuándo usarlo

Debajo de un mr-entity-grid.

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `page` | `number` | `1` | Página actual. |
| `pageSize` | `number` | `25` | Tamaño. |
| `cantidad` | `number` | `0` | Filas recibidas en la página (si < pageSize, es la última). |

## Eventos

| Evento | detail | Cuándo |
| --- | --- | --- |
| `mr-page` | `{ page, pageSize }` | Al navegar o cambiar el tamaño. |

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-pager></mr-pager>
```
