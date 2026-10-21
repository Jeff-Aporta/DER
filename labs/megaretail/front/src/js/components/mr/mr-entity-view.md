---
name: mr-entity-view
description: Catálogo de una entidad: cabecera con acciones, grilla y editor modal con el formulario generado.
---

# `<mr-entity-view>`

Catálogo de una entidad: cabecera con acciones, grilla y editor modal con el formulario generado.

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-entity-view.css`.

## Cuándo usarlo

Para cualquier entidad registrada en DER (dominio, usuarios, permisos). Respeta administrable y el permiso del JSON.

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `entidad` | `string` | `""` | Plural de la entidad (productos, permisos/roles). |
| `modo` | `lista | crear | editar` | `lista` | Qué muestra el modal. |
| `version` | `number` | `0` | Súbelo para recargar la grilla. |

## Eventos

No emite eventos propios.

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-entity-view></mr-entity-view>
<script type="module">document.querySelector('mr-entity-view').props = { entidad: 'productos' };</script>
```
