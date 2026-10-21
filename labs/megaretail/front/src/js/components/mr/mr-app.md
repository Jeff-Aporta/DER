---
name: mr-app
description: Shell de MegaRetail: barra (iswc-app-shell), navegación de ui/app.json, selector de usuario y la vista activa.
---

# `<mr-app>`

Shell de MegaRetail: barra (iswc-app-shell), navegación de ui/app.json, selector de usuario y la vista activa.

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-app.css`.

## Cuándo usarlo

Una sola vez, en index.html. Toda la app sale de JSON (app.json, entidades/*.json, flujos.json, reportes.json).

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `vista` | `Vista | null` | `null` | Sección y pestaña activas (también en el hash #seccion/tab). |
| `listo` | `boolean` | `false` | true cuando los JSON de UI están cargados. |

## Eventos

No emite eventos propios.

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-app></mr-app>
```
