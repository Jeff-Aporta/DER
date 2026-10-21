---
name: mr-relation-field
description: Campo de relación: etiqueta de la fila elegida (o varias) y botón que abre el selector modal.
---

# `<mr-relation-field>`

Campo de relación: etiqueta de la fila elegida (o varias) y botón que abre el selector modal.

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-relation-field.css`.

## Cuándo usarlo

Relaciones one (una fila) y many (varias) de un formulario generado.

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `campo` | `CampoUi | null` | `null` | Campo con relacion { entidad, kind, local, remoto }. |
| `valor` | `unknown` | `null` | Pk remota o lista de pks. |
| `disabled` | `boolean` | `false` | Sólo lectura. |

## Eventos

| Evento | detail | Cuándo |
| --- | --- | --- |
| `mr-cambio` | `{ nombre, valor, filas }` | Al elegir o limpiar. |

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-relation-field></mr-relation-field>
```
