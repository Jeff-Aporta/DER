---
name: mr-flow
description: Pantalla de un flujo de negocio de ui/flujos.json: formulario generado del schema del flujo y llamada al path del plugin DER.
---

# `<mr-flow>`

Pantalla de un flujo de negocio de ui/flujos.json: formulario generado del schema del flujo y llamada al path del plugin DER.

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-flow.css`.

## Cuándo usarlo

Compra, venta con carrito, transferencia, anulación, ajuste de precios, limpieza.

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `id` | `string` | `""` | Clave en flujos.json. |
| `flujo` | `FlujoUi | null` | `null` | Se carga del JSON. |
| `permitido` | `boolean` | `true` | Según el perfil del usuario. |

## Eventos

No emite eventos propios.

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-flow></mr-flow>
<script type="module">document.querySelector('mr-flow').props = { id: 'venta' };</script>
```
