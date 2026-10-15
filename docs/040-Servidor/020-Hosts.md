---
Titulo: Hosts: Azure, Workers, Deno
Estado: vigente
Autor:
tags: [servidor, hosts]
---
# Hosts: Azure Functions, Cloudflare Workers, Deno/Bun/Node

[← índice](../README.md) · tabla: `src/02 controllers/server/router.ts` + `routes.ts` · hosts: `src/02 controllers/server/hosts/<host>/mod.ts` · tipos en `src/02 controllers/server/schemas.ts`

Mismo modelo que `registrarEntidad` de ISS: **cada acción definida en el controller es una ruta propia**, con parámetros `{pk}`, id estable `METHOD:/ruta` (para seguridad por ruta), sin duplicados ni ambigüedades. El `Router` construye esa **tabla de rutas** una vez y cada host la registra a su manera:

| Host | Entrada | Cómo registra |
|---|---|---|
| Deno / Bun / Node / Hono… | `server/mod.ts` | `Deno.serve(router.fetch)`: matcher genérico sobre la tabla (los literales ganan a los parámetros) |
| Azure Functions v4 | `server/hosts/azure/mod.ts` | `registerAzure(app, router)`: una `app.http` por ruta (+ `OPTIONS` si hay CORS) |
| Cloudflare Workers | `server/hosts/cloudflare/mod.ts` | `export default defineWorker((env) => router)` |

Los hosts no tienen dependencias: el `app` de `@azure/functions` lo pasa el consumidor (tipos estructurales `AzureApp`, `AzureHttpRequest`, `AzureHttpResponseInit`), y Workers no necesita nada.

## Qué se registra por controller

| id | acción |
|---|---|
| `GET:/plural` · `POST/PUT/DELETE:/plural` | list · postList · putList · deleteList |
| `POST:/plural/query` · `GET:/plural/query` | query |
| `POST:/singular` · `GET/PUT/DELETE:/singular/{pk...}` | post · get · put · delete |
| `METHOD:/singular/{pk...}/<ep>` · `METHOD:/plural/<ep>` | endpoints especiales (scope one / many) |
| `GET/PUT:/singular/{pk...}/cfg` | getCfg / putCfg (si la entidad tiene `cfg`) |
| `GET:/plural/doc` | doc (`?v=1` → vista) |
| `<lo anterior>/sse` | sólo si el server define el handler SSE de esa acción/endpoint |

Además: `GET:/doc` (doc general del API).

- **`expose`** (en el ServerController, como `aplicar` de ISS) limita lo registrado: `expose: ["get", "list", "doc"]`. Default: todo.
- **Duplicados o ambigüedades** (`producto/{a}` y `producto/{b}` con el mismo método) lanzan un error al construir el router.

## Rutas irregulares (`noRegulares` / `extras` de ISS)

Cualquier método y ruta con parámetros `{nombre}`, relativa al basePath, registrada igual en todos los hosts:

```ts
// del controller: this = el controller
new ServerController(ProductoEntity, { db, table: "productos", routes: [
  { method: "GET", path: "reportes/productos/{tipo}",
    handler({ params, query, body, request }, ctx) { return this.query({ where: { tipo: params["tipo"] } }); } },
  { method: "POST", path: "procesos/importar",                      // → POST procesos/importar/sse
    async sse({ body }, send, ctx) { send("importando"); await this.postList(body as never[]); send("fin"); } },
]});
// del router: this = el router
createRouter(ctrls, { routes: [{ method: "GET", path: "salud", handler: () => ({ ok: true }) }] });
```

Respuesta: un `Response` pasa tal cual; `undefined` → 204; cualquier otro valor → JSON 200.

## Comunes a todos los hosts

- **`context(req)`**: contexto por request. `ctx.state.route` trae la `RouteInfo` y `ctx.state.basePath` el basePath.
- **`guard(route, req, ctx)`**: autorización por `route.id`. Retornar un `Response` corta y lanzar `HttpError` responde con ese status.
- **`cors: true | { origin, methods, headers, maxAge }`**: responde los preflight `OPTIONS` y agrega las cabeceras a toda respuesta (también a los errores).
- Los errores se unifican: `ValidationError` → 400, `NotFoundError` → 404 y lo demás → 500.

## Azure Functions

```ts
import { app } from "@azure/functions";
import { createRouter, pgDatabase } from ".../src/02%20controllers/server/pg/mod.ts";
import { registerAzure } from ".../src/02%20controllers/server/hosts/azure/mod.ts";

app.setup({ enableHttpStream: true });                    // SSE en vivo (stream: true, el default)
const router = createRouter(ctrls, { basePath: "/api", cors: true }); // basePath = routePrefix de host.json
registerAzure(app, router, { authLevel: "anonymous" });
```

- Nombres de función válidos y únicos (`GET_producto_iproducto`). La ruta se registra sin el routePrefix: Azure lo agrega.
- Prefijos reservados por el host (`runtime/`, `admin/`): registrarlos lanza un error.
- `stream: false` lee el body completo antes de responder (sin `enableHttpStream`).

## Cloudflare Workers

```ts
import { createRouter, pgDatabase } from ".../src/02%20controllers/server/pg/mod.ts";
import { defineWorker } from ".../src/02%20controllers/server/hosts/cloudflare/mod.ts";

export default defineWorker((env: Env) =>
  createRouter(buildControllers(pgDatabase(poolDesde(env))), { basePath: "/api", cors: true })
);
```

- `setup(env)` corre una vez por isolate y su Router se reusa. Si falla, se reintenta en el siguiente request.
- El core no importa `node:` en el arranque. Solo las fuentes de doc locales usan `node:fs` (con `nodejs_compat`); las fuentes http funcionan siempre.
- Base de datos: PostgreSQL por un pool compatible con `pg` (Hyperdrive, Neon). `server/sqlite` usa `node:sqlite`, que no existe en Workers; D1 necesitaría su propio dialecto de Kysely.
