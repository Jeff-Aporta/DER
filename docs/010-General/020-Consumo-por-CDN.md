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

Las carpetas tienen espacios, que en la URL van como `%20`:

| Quiero | Importar | Instalar |
|---|---|---|
| Definir entidades/POJOs (front o back) | `mod.ts` | `zod` |
| Client fetch | `src/02%20controllers/client/mod.ts` | `zod` |
| Server SQLite | `src/02%20controllers/server/sqlite/mod.ts` | `zod`, `kysely` |
| Server PostgreSQL | `src/02%20controllers/server/pg/mod.ts` | `zod`, `kysely`, tu pool (`pg`, Neon…) |
| Server PGlite | `src/02%20controllers/server/pglite/mod.ts` | `zod`, `kysely`, `@electric-sql/pglite` |
| Host Azure Functions | `src/02%20controllers/server/hosts/azure/mod.ts` (+ un motor) | lo del motor + `@azure/functions` en la app |
| Host Cloudflare Workers | `src/02%20controllers/server/hosts/cloudflare/mod.ts` (+ un motor) | lo del motor |
| Solo `Obj`, Zod y tipos | `src/00%20common/mod.ts` | `zod` |

## Deno

El consumidor mapea **tres cosas** en su `deno.json`: las dependencias que use y el **alias de la librería**, `@Jeff-Aporta/DER/`. Los archivos de la librería se importan entre sí por ese alias, así que mapearlo es obligatorio, igual que `zod`.

```json
{
  "imports": {
    "zod": "npm:zod@^4.6",
    "kysely": "npm:kysely@^0.28",
    "@Jeff-Aporta/DER/": "https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@<sha>/"
  }
}
```

```ts
import { ClientController } from "@Jeff-Aporta/DER/src/02 controllers/client/mod.ts";
import { createRouter, ServerController, sqliteDatabase } from "@Jeff-Aporta/DER/src/02 controllers/server/sqlite/mod.ts";
import { IdentityClient } from "@Jeff-Aporta/DER/src/03 plugins/client.ts";
```

- Deno aplica el import map también a los módulos remotos: dentro de la librería, `"zod"` y `"@Jeff-Aporta/DER/…"` resuelven a lo que el consumidor mapeó. Hay una sola instancia de `z` en toda la app y una sola versión de la librería.
- Una app de solo cliente no mapea `kysely`: las entradas de cliente no lo alcanzan (lo vigila `tests/arch.test.ts`).
- Dentro de este repo el alias apunta a `./` (`deno.json`) y `tsconfig.json` tiene el `paths` equivalente para el editor.

## Navegador

Los navegadores no ejecutan `.ts`. Hay dos opciones:

- Empaquetar con tu bundler (Vite, esbuild, `deno bundle`) importando `client/mod.ts`.
- Generar un bundle ESM del client con `zod` externo y mapear `zod` con `<script type="importmap">`.

## Node (≥ 22.6, `--experimental-strip-types`, o tsx)

Instala `zod` (y `kysely` en el server) con npm, y vendoriza o descarga los archivos `.ts` del commit fijado. Los imports relativos llevan `.ts`, así que en tsc hace falta `allowImportingTsExtensions` / `rewriteRelativeImportExtensions`. `node:sqlite` viene incluido en Node 22+.

## Desarrollo local (este repo)

```bash
npm install          # node_modules: zod, kysely, pglite, typescript, /node, /deno, /assert
deno task check      # tsc estricto (lo mismo que ve el editor) + deno check
deno task test
```

`package.json` declara `zod` como peer obligatoria y `kysely` y `-sql/pglite` como peers **opcionales**: un consumidor npm instala solo las de su dimensión.

## Reglas del contrato CDN (las vigila `tests/arch.test.ts`)

- Los **imports internos** van siempre por el alias `@Jeff-Aporta/DER/`; los **externos** (entre archivos del repo) llevan extensión `.ts`.
- Cada carpeta importa solo las dependencias permitidas para su dimensión.
- Cada `mod.ts` referencia `docs/README.md` en su cabecera.
