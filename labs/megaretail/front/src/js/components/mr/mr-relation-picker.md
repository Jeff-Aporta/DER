---
name: mr-relation-picker
description: Data view de una relación: modal con el grid de la otra entidad; one = exactamente una fila, many = varias.
---

# `<mr-relation-picker>`

Data view de una relación: modal con el grid de la otra entidad; one = exactamente una fila, many = varias.

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-relation-picker.css`.

## Cuándo usarlo

Lo abre mr-relation-field; sirve para cualquier entidad.

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `entidad` | `string` | `""` | Plural de la entidad a elegir. |
| `kind` | `one | many` | `one` | Selección única o múltiple. |
| `abierto` | `boolean` | `false` | Muestra el modal. |
| `titulo` | `string` | `Elegir` | Título del modal. |

## Eventos

| Evento | detail | Cuándo |
| --- | --- | --- |
| `mr-pick` | `{ filas }` | Al confirmar. |
| `mr-cancel` | `—` | Al cerrar. |

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-relation-picker></mr-relation-picker>
```
