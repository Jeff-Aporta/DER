# Skill: estilo y reglas para modificar DER

[← temario](README.md) · lo vigila `tests/arch/arch.test.ts`; el WHAT vive en `specs/` (mantenlo con `specs/W2H.md`)

## Antes de tocar código

1. Ubica el WHAT en `specs/FOUNDATION.md` (mapa) y la hoja de `docs/` del tema.
2. Cambia código + tests + docs + specs en el mismo commit.
3. `deno task check`, `deno lint`, `deno task test` en verde. Un test rojo se arregla, nunca se salta.

## Reglas de forma (todas con guardián)

- Tipos solo en `schemas.ts`, con `type` (nunca `interface`) y **cada tipo en una línea**. Constantes Zod `Z…` también solo ahí.
- **Un import por línea** (nada de `import {` multilínea); internos por `@Jeff-Aporta/DER/…` con `.ts`; iswc por `@Jeff-Aporta/wc-*` fijado a SHA; nunca URLs directas.
- Barrels `index.ts`; carpetas kebab-case; ninguna carpeta de `src/`, `tests/` o `specs/` con menos de dos elementos.
- Miembros privados con `#`; `protected` solo para el contrato abstracto base→hijos.
- **JSDoc en todo lo exportado y en todo método público** (una línea basta, con el "para qué" y el caso borde).
- Cada archivo de `src/` enlaza por CDN la skill general y su skill particular.
- Una sentencia por línea; sin funciones de una línea que solo deleguen; aplanar antes que ramificar.
- Plugins como JSON (`PluginDef` en `index.ts`, `Obj.insert` en `server.ts`); `irregularPaths` para lo que no es de una entidad, `paths` dentro de la entidad; `exposed` y `administrable` explícitos.
- POJOs indirectos (`controller.pojo`, `registry.pojo`); nunca exportar clases desde un plugin.
- Capas hacia abajo (`00-common ← 01-objects ← 02-controllers ← 03-plugins`), client ⟂ server, dependencias por archivo.

## Dónde va cada cosa

| Cambio | Archivos |
|---|---|
| tipo nuevo transversal | `src/00-common/schemas.ts` |
| tipo que depende de Kysely | `src/02-controllers/server/schemas.ts` |
| motor nuevo | constante en `server/engines.ts` + fábrica `server/<motor>.ts` + `ALLOWED` del guardián + `tests/server/engines.test.ts` |
| plugin nuevo | `src/03-plugins/<plugin>/{schemas,index,server}.ts` + exportes en `03-plugins/index.ts` y `client.ts` + skill `skills/<plugin>.md` |
| regla de negocio | spec `[W-*]` nuevo + test que la describe |

## Nomenclatura

`UsuarioSchema` / `Usuario` / `UsuarioEntity` / `usuarios` (controller). Tablas con prefijo de dominio (`identity_*`, `permisos_*`). Nombres de entidad `dominio.entidad`. Mensajes de error en español.
