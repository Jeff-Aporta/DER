---
name: mr-report
description: Reporte de ui/reportes.json: parámetros (formulario), indicadores (mr-stats) y tabla (iswc-ag-grid) con columnas JSON.
---

# `<mr-report>`

Reporte de ui/reportes.json: parámetros (formulario), indicadores (mr-stats) y tabla (iswc-ag-grid) con columnas JSON.

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-report.css`.

## Cuándo usarlo

Ranking, alertas, clientes fieles, cubo.

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `id` | `string` | `""` | Clave en reportes.json. |
| `filas` | `Record<string, unknown>[]` | `[]` | Filas de la tabla (derivadas del resultado). |
| `datos` | `unknown` | `null` | Resultado crudo del path. |

## Eventos

No emite eventos propios.

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-report></mr-report>
<script type="module">document.querySelector('mr-report').props = { id: 'cubo' };</script>
```
