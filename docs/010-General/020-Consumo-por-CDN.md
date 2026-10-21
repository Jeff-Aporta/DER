---
Titulo: Consumo por CDN
Estado: vigente
Autor:
tags: [general, cdn, dependencias]
---
# Consumir por CDN

[← índice](../README.md)

El paquete es TypeScript sin build. Cada archivo importa sus dependencias con especificadores desnudos (`"zod"`, `"kysely"`, `"@electric-sql/pglite"`), que **resuelve el import map del consumidor**. Así cada app instala solo lo que usa.

## URLs

Base (fija un commit o tag en producción; `@main` solo para desarrollo):

```
https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@<ref>/
https://raw.githubusercontent.com/Jeff-Aporta/DER/<ref>/
```

Las carpetas van en kebab-case (sin espacios): la URL es legible tal cual.

| Quiero | Importar | Instalar |
|---|---|---|
| Definir entidades/POJOs (front o back) | `index.ts` | `zod` |
| Client fetch + `createClient` | `src/02-controllers/client/index.ts` | `zod` |
| Server SQLite (`node:sqlite`, better-sqlite3 o sqlite3) | `src/02-controllers/server/sqlite.ts` | `zod`, `kysely` (+ tu driver si no es `node:sqlite`) |
| Server PostgreSQL | `src/02-controllers/server/pg.ts` | `zod`, `kysely`, tu pool (`pg`, Neon…) |
| Server PGlite | `src/02-controllers/server/pglite.ts` | `zod`, `kysely`, `@electric-sql/pglite` |
| Server MySQL / MariaDB | `src/02-controllers/server/mysql.ts` | `zod`, `kysely`, `mysql2` |
| Server Microsoft SQL Server | `src/02-controllers/server/mssql.ts` | `zod`, `kysely`, `tedious`, `tarn` |
| Host Azure Functions | `src/02-controllers/server/hosts/azure.ts` (+ un motor) | lo del motor + `@azure/functions` en la app |
| Host Cloudflare Workers | `src/02-controllers/server/hosts/cloudflare.ts` (+ un motor) | lo del motor |
| Plugins de seguridad (server) | `src/03-plugins/index.ts` | `zod`, `kysely` |
| Plugins de seguridad (client) | `src/03-plugins/client.ts` | `zod` |
| Solo `Obj`, Zod y tipos | `src/00-common/index.ts` | `zod` |

## Deno

El consumidor mapea en su `deno.json` las dependencias que use, el **alias de la librería** `@Jeff-Aporta/DER/` y los **alias de iswc** (`@Jeff-Aporta/wc-base/` y `@Jeff-Aporta/wc-diagrams/`, copiados de este repo). Los archivos de la librería se importan entre sí por esos alias, así que mapearlos es obligatorio, igual que `zod`.

```json
{
  "imports": {
    "zod": "npm:zod@^4.6",
    "kysely": "npm:kysely@^0.28",
    "@Jeff-Aporta/DER/": "https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@<sha>/",
    "@Jeff-Aporta/wc-base/": "https://raw.githubusercontent.com/Jeff-Aporta/is-webcomponents/<sha>/src/vendor-distributions/shared/",
    "@Jeff-Aporta/wc-diagrams/": "https://raw.githubusercontent.com/Jeff-Aporta/is-webcomponents/<sha>/src/components/diagrams/schemas/"
  }
}
```

```ts
import { ClientController, createClient } from "@Jeff-Aporta/DER/src/02-controllers/client/index.ts";
import { createRouter, createServer, ServerController, sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { identity, permissions } from "@Jeff-Aporta/DER/src/03-plugins/client.ts";
```

- Deno aplica el import map también a los módulos remotos: dentro de la librería, `"zod"`, `"@Jeff-Aporta/DER/…"` y `"@Jeff-Aporta/wc-…"` resuelven a lo que el consumidor mapeó. Hay una sola instancia de `z` en toda la app y una sola versión de la librería.
- Una app de solo cliente no mapea `kysely`: las entradas de cliente no lo alcanzan (lo vigila `tests/arch/arch.test.ts`).
- Dentro de este repo el alias apunta a `./` (`deno.json`); el editor usa el LSP de Deno con ese mismo mapa (no hay `tsconfig`).
- **Pin de iswc:** los alias `wc-*` fijan un SHA de 40. El `main` del kit pasó a usar imports internos `../schemas.js` (convención Node strip-only) que Deno no resuelve en remoto, así que el SHA fijado es el último que sirve `.ts` (`de72fa69…`); subirlo exige que el kit publique una copia resoluble por Deno.

## Navegador

Los navegadores no ejecutan `.ts`. Hay dos opciones:

- Empaquetar con tu bundler (Vite, esbuild, `deno bundle`) importando `client/index.ts`.
- Generar un bundle ESM del client con `zod` externo y mapear `zod` con `<script type="importmap">`.

## Node (≥ 22.6, `--experimental-strip-types`, o tsx)

Instala `zod` (y `kysely` en el server) con npm, y vendoriza o descarga los archivos `.ts` del commit fijado. Los imports llevan `.ts`, así que en tsc hace falta `allowImportingTsExtensions` / `rewriteRelativeImportExtensions`. `node:sqlite` viene incluido en Node 22+.

## Desarrollo local (este repo)

```bash
npm install          # node_modules: zod, kysely, pglite, @std/assert
deno task check      # deno check de todas las entradas, examples y tests
deno task test
```

`package.json` declara `zod` como peer obligatoria y `kysely` y `@electric-sql/pglite` como peers **opcionales**: un consumidor npm instala solo las de su dimensión.

## Reglas del contrato CDN (las vigila `tests/arch/arch.test.ts`)

- Los **imports internos** van siempre por el alias `@Jeff-Aporta/DER/`, con extensión `.ts` y uno por línea.
- Lo de iswc va por `@Jeff-Aporta/wc-*` (nunca una URL directa) y los alias fijan un SHA.
- Cada archivo importa solo las dependencias permitidas para su dimensión.
- Cada `index.ts` referencia `docs/README.md` en su cabecera.
