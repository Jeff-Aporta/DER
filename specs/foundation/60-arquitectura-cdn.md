# 60 — Arquitectura, consumo por CDN, estilo, guardianes y tests

Área `ARQ`. Lo que hace a DER hermético, consumible por URL y mantenible por agentes.

## 1. WHAT

- **[W-ARQ-01]** Capas y dependencias: `src/00-common` (solo `zod` + `Obj` del kit), `src/01-objects` (solo `zod`), `src/02-controllers` y `client/` (solo `zod`), `server/` (`zod` + `kysely`; `pglite.ts` además `@electric-sql/pglite`; `sqlite.ts` además `node:sqlite`; `doc.ts` módulos `node:` incluidos), `src/03-plugins` (`zod` + `kysely` en server; solo `zod` en las entradas de cliente). Una entrada de cliente nunca alcanza, ni por `import type`, un archivo del server, `crypto`, `rules` o un `server.ts` de plugin.
- **[W-ARQ-02]** Consumo por CDN: el consumidor mapea en su import map `zod` (y `kysely` si es server), el alias `@Jeff-Aporta/DER/` a la URL del repo fijada a un SHA, y los alias `@Jeff-Aporta/wc-base/` y `@Jeff-Aporta/wc-diagrams/` a is-webcomponents fijados a un SHA. Las entradas: `index.ts` (núcleo), `src/02-controllers/client/index.ts`, `src/02-controllers/server/{sqlite,pg,pglite,mysql,mssql}.ts`, `src/02-controllers/server/hosts/{azure,cloudflare}.ts`, `src/03-plugins/index.ts`, `src/03-plugins/client.ts`.
- **[W-ARQ-03]** Toda entrada `index.ts` (y la raíz) referencia en su cabecera el punto de entrada de documentación para agentes. La documentación vive en `docs/` como hojas `.md` con frontmatter `Titulo`, todas listadas en `docs/index.html` (visor del kit).
- **[W-ARQ-04]** Hermeticidad: nada versionado referencia rutas absolutas de la máquina ni rutas relativas que salgan del proyecto, ni dependencias `file:`/`link:`, ni symlinks.
- **[W-ARQ-05]** Estilo verificado: imports internos por alias con `.ts` y uno por línea; sin URLs directas a iswc; tipos (`type`, nunca `interface`) y constantes Zod solo en `schemas.ts`, cada tipo en una línea; sin `private`/`protected` con nombre (salvo `protected abstract` y las implementaciones del contrato base); ninguna carpeta de `src/`, `tests/` ni `specs/` con menos de dos elementos; cada plugin con `schemas.ts`, `index.ts` (JSON `PluginDef`, sin clases) y `server.ts` (`Obj.insert` del transversal); `common/` con `crypto` y `device`.
- **[W-ARQ-06]** Specs: cada spec del mapa de `FOUNDATION.md` existe, tiene al menos un `[W-*]` y ningún ID se repite entre specs.
- **[W-ARQ-07]** Tests organizados por tema en `tests/<tema>/` (`arch`, `objects`, `server`, `http`, `plugins`), helpers compartidos en `tests/_util.ts`; `deno task check` verifica entradas, ejemplos y tests; `deno task test` corre todo; ambos en verde antes de cerrar un cambio.

## 2. HOW débil

- **[HW-ARQ-01]** El pin de is-webcomponents es el último SHA que sirve sus fuentes con imports `.ts` resolubles por Deno en remoto; subirlo exige verificar que el kit siga siendo importable por URL.

## 3. HOW fuerte

- **[HS-ARQ-01]** `deno.json`: `exports` por entrada, `imports` con los alias, tareas `test`, `check`, `example`; `compilerOptions` estrictas (`strict`, `noImplicitAny`, `noImplicitOverride`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`, `exactOptionalPropertyTypes`). Solo Deno: no hay `package.json`, `node_modules` ni `tsconfig`; las dependencias npm las resuelve Deno desde `deno.json`. El editor usa el LSP de Deno (`.vscode/settings.json` con `deno.enable`).
- **[HS-ARQ-02]** Guardianes: `tests/arch/arch.test.ts` (todo lo de `W-ARQ-01`, `03`, `05`, `06`) y `tests/arch/hermeticidad.test.mjs` (`W-ARQ-04`).

## 6. Pruebas

- Cada regla de `W-ARQ-01`, `03`, `04`, `05` y `06` es un test del guardián que lista los archivos infractores.

## 7. Notas

- No hay `tsconfig`: el editor usa el LSP de Deno con `deno.json`.
- Los nombres de archivo de los tests no necesitan sufijo `_test`; `deno test` toma `*.test.ts` y `*.test.mjs`.
