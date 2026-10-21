---
name: mr-stats
description: Fila de iswc-stat definidos en JSON: valor por consulta Obj.getValue sobre el resultado y formato.
---

# `<mr-stats>`

Fila de iswc-stat definidos en JSON: valor por consulta Obj.getValue sobre el resultado y formato.

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-stats.css`.

## Cuándo usarlo

Indicadores de un reporte o de un flujo.

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `stats` | `StatUi[]` | `[]` | Definiciones { label, consulta, formato }. |
| `datos` | `unknown` | `null` | Resultado del que se leen. |

## Eventos

No emite eventos propios.

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-stats></mr-stats>
```
