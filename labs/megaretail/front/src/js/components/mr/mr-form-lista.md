---
name: mr-form-lista
description: Campo de lista (carrito): filas con un mr-form compacto generado del schema del campo, agregar y quitar.
---

# `<mr-form-lista>`

Campo de lista (carrito): filas con un mr-form compacto generado del schema del campo, agregar y quitar.

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-form-lista.css`.

## Cuándo usarlo

Campos con control "lista" en flujos (items de una venta).

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `campo` | `CampoUi | null` | `null` | Campo con su schema. |
| `filas` | `Record<string, unknown>[]` | `[]` | Filas actuales. |

## Eventos

| Evento | detail | Cuándo |
| --- | --- | --- |
| `mr-cambio` | `{ filas }` | Cada cambio. |

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-form-lista></mr-form-lista>
```
