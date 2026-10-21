# Skill: consumir DER por CDN con Deno

[← temario](README.md)

## Import map del consumidor

```json
{
  "imports": {
    "zod": "npm:zod@^4.6",
    "kysely": "npm:kysely@^0.28",
    "@Jeff-Aporta/DER/": "https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@<sha>/",
    "@Jeff-Aporta/wc-base/": "https://raw.githubusercontent.com/Jeff-Aporta/is-webcomponents/<sha-iswc>/src/vendor-distributions/shared/",
    "@Jeff-Aporta/wc-diagrams/": "https://raw.githubusercontent.com/Jeff-Aporta/is-webcomponents/<sha-iswc>/src/components/diagrams/schemas/"
  }
}
```

- `<sha>` = commit de DER (nunca `@main` en producción). `<sha-iswc>` = el que trae el `deno.json` de DER (`de72fa69…`); el `main` del kit no es importable por Deno.
- Una app solo cliente no mapea `kysely`. Una app server agrega su pool/driver (`pg`, `mysql2`, `tedious`+`tarn`, `better-sqlite3`, `sqlite3`) o nada si usa `node:sqlite`/PGlite.
- Solo Deno: DER no tiene `package.json` ni `node_modules`; `deno check` y `deno test` bastan.

## Qué entrada importar

| Quiero | Entrada |
|---|---|
| definir entidades/POJOs (front o back) | `@Jeff-Aporta/DER/index.ts` |
| client fetch + `createClient` | `@Jeff-Aporta/DER/src/02-controllers/client/index.ts` |
| server + un motor | `@Jeff-Aporta/DER/src/02-controllers/server/{sqlite,pg,pglite,mysql,mssql}.ts` (cada uno reexporta todo el server) |
| host Azure / Cloudflare | `@Jeff-Aporta/DER/src/02-controllers/server/hosts/{azure,cloudflare}.ts` |
| plugins (server) | `@Jeff-Aporta/DER/src/03-plugins/index.ts` |
| plugins (client) | `@Jeff-Aporta/DER/src/03-plugins/client.ts` |

## Ejemplo mínimo completo (Deno)

```ts
import { defineEntity, defineSchema } from "@Jeff-Aporta/DER/index.ts";
import { createRouter, createServer, ServerController, sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { identityServer, permissionsServer } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";

const Producto = defineEntity({ schema: defineSchema({ columns: { id: { type: "int", pk: true, autoincrement: true }, nombre: { type: "string", nullable: false } } }), singular: "producto", plural: "productos", security: { public: ["list", "get"] } });
const db = sqliteDatabase("app.db");
const productos = new ServerController(Producto, { db });
const auth = createServer(identityServer, { db, cfg: { secret: "env:JWT_SECRET", admin: { usuario: "admin", password: "env:ADMIN_PASSWORD" } } });
const permisos = createServer(permissionsServer, { db, cfg: { admins: ["admin"] } });
const router = createRouter([productos], { basePath: "/api", cors: true, plugins: [auth, permisos] });
await router.seed();
Deno.serve(router.fetch);
```

## Verificar que el consumo funciona

```bash
deno check main.ts     # resuelve todo por URL
deno run -A main.ts
```

Si falla con `Module not found …/schemas.js`, el pin de iswc apunta a un commit con imports `.js`: usa el SHA que trae DER.
