---
name: mr-session
description: Sesión del lab sin contraseña: select de usuarios, rol efectivo y modal con lo que ese rol puede hacer.
---

# `<mr-session>`

Sesión del lab sin contraseña: select de usuarios, rol efectivo y modal con lo que ese rol puede hacer.

## Anatomía

Shadow DOM con los tags del kit (`iswc-*`) y, cuando aplica, componentes `mr-*` hijos. Hoja hermana `dist/mr-session.css`.

## Cuándo usarlo

En el slot actions del shell. Cambiar de usuario cambia la cabecera x-usuario de todas las peticiones.

## Props

| Prop | Tipo | Default | Qué hace |
| --- | --- | --- | --- |
| `usuarios` | `UsuarioLab[]` | `[]` | Lista de GET lab/usuarios. |
| `usuario` | `string | null` | `localStorage` | Usuario activo. |
| `perms` | `Record<string, unknown>` | `{}` | Perfil de GET permisos. |

## Eventos

| Evento | detail | Cuándo |
| --- | --- | --- |
| `mr-usuario` | `{ usuario }` | Al cambiar el select. |

## Slots

Sin slots: todo se pasa por `props` (JSON).

## Ejemplos

```html
<mr-session></mr-session>
```
