---
name: mr-form
description: Formulario generado desde un FormModel (schema DER + JSON de UI): cada campo elige su control del kit.
---

# `<mr-form>`

Formulario generado desde un FormModel (schema DER + JSON de UI): cada campo elige su control del kit.

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-form.css`.

## Cuándo usarlo

Entidades (crear/editar) y flujos. Valida con el Zod de DER antes de emitir.

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `modelo` | `FormModel | null` | `null` | Campos y orden (modeloDeSchema + aplicarUi). |
| `valor` | `Record<string, unknown>` | `{}` | Valores iniciales. |
| `modo` | `crear | editar` | `crear` | Pks/secuencias ocultas o sólo lectura. |
| `validar` | `(cuerpo) => string | null` | `null` | Validación antes de enviar. |
| `compacto` | `boolean` | `false` | Fila de una lista: sin botones, emite mr-cambio. |

## Eventos

| Evento | detail | Cuándo |
| --- | --- | --- |
| `mr-submit` | `{ cuerpo }` | Cuerpo listo para la API. |
| `mr-cancel` | `—` | Botón cancelar. |
| `mr-cambio` | `{ valores }` | Sólo en compacto. |

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-form></mr-form>
```
