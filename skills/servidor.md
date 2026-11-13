# Skill: servidor (motores, seed, propagación, router, hosts)

[← temario](README.md) · referencia: `docs/040-Servidor/` y `docs/030-Controllers/020-…`

## Motores

```ts
sqliteDatabase("app.db")                                   // node:sqlite (nada que instalar)
sqliteDatabase(new BetterSqlite3("app.db"))                // driver síncrono
sqliteDatabase(new sqlite3.Database("app.db"))             // driver asíncrono (sqlite3)
pgDatabase(new pg.Pool({ connectionString }))              // PostgreSQL (o Neon…)
pgliteDatabase()                                           // PostgreSQL embebido (tests)
mysqlDatabase(mysql2.createPool({ uri }))                  // MySQL / MariaDB
mssqlDatabase({ tarn: { ...Tarn, options }, tedious: { ...Tedious, connectionFactory } })   // SQL Server
```

Todos con `{ identifierCase?: "preserve" | "lower" | "upper", cfg? }`. El resultado observable es el mismo en todos; lo que cambia (tipos, JSON, LIKE, paginación, `returning`/`output`/relectura) vive en `engines.ts`.

## Cloudflare D1

El binding del Worker es la opción normal dentro de Cloudflare:

```ts
import { d1Database } from "@Jeff-Aporta/DER/src/02-controllers/server/d1.ts";
const db = d1Database(env.DB);
```

El binding expone `prepare(sql).bind(...params)`; `all()` y `run()` devuelven `{ results, meta }` y `first()` devuelve la primera fila. DER usa `all()` para que una escritura también aporte `meta.changes` y `meta.last_row_id`. D1 no tiene transacciones interactivas: `BEGIN/COMMIT/ROLLBACK` se tratan como no-op y una lista de escrituras no es atómica.

Para una base remota por HTTP (fuera del Worker, o para pruebas), el mismo contrato se emula sobre la API REST:

```ts
import { d1HttpDatabase, d1HttpEndpoint } from "@Jeff-Aporta/DER/src/02-controllers/server/d1.ts";
const endpoint = d1HttpEndpoint(env.CF_ACCOUNT_ID, env.CF_DATABASE_ID);
const db = d1HttpDatabase({ endpoint, token: env.CF_API_TOKEN });
// o: d1HttpDatabaseFromEnv({ D1_HTTP_ENDPOINT: endpoint, D1_HTTP_TOKEN: token })
```

La API real es `POST /accounts/{account}/d1/database/{database}/query` con `Authorization: Bearer` y cuerpo `{ sql, params }`; el adaptador lo presenta como `prepare/bind/all/run/first`. El token nunca se imprime ni se incluye en los errores. El binding evita saltos de red y es la opción recomendada dentro de un Worker.

## Seed y migraciones

- `db.seed()` / `router.seed()`: `CREATE TABLE IF NOT EXISTS` + secuencias + índices + tabla de cfg, en cascada por la propagación (cada controller en su base).
- `ctrl.syncSchema({ dryRun })` planea; sin `dryRun` agrega/elimina columnas y migra filas con `migrate(anterior)`.

## Propagación y multi-db

```ts
new ServerController(PedidoEntity, { db, getPropagation: () => ({ lineas: { producto: true } }), setPropagation: () => ({ lineas: true }) });
await pedidos.post({ cliente: "Ana", lineas: [{ ilinea: 1, iproducto: 1, cantidad: 2 }] });   // padre + detalles, transacción
```

Las relaciones de la misma base van en el mismo SQL; las de otra base (otro motor incluso) se resuelven por POJOs en lote. Filtros por relación cross-db también funcionan.

## Router

```ts
const router = createRouter(controllers, {
  basePath: "/api", cors: true, exposeErrors: false,
  context: async (req) => ({ state: { tenant: "x" } }),
  guard: (route, req) => route.id === "DELETE:/producto/{iproducto}" && req.headers.get("x-rol") !== "admin" ? new Response("no", { status: 403 }) : undefined,
  routes: [{ method: "GET", path: "salud", handler: () => ({ ok: true }) }],      // irregulares del API
  plugins: [auth, permisos],
});
Deno.serve(router.fetch);                 // o (await router.handle(req)) ?? siguiente()
```

Tabla de rutas: una por acción, id `METHOD:/ruta` (`GET:/producto/{iproducto}`); `/sse` solo si hay handler; `/cfg` solo si hay tabla; `/doc` siempre (pública por defecto). Una entidad `exposed: false` no publica nada; `administrable: false` publica solo lecturas. Rutas duplicadas o ambiguas fallan al construir.

## Seguridad por ruta

`security` en la entidad o el controller: `true` (todo protegido + permisos), `{ public, protected, permissions, actions }`; en rutas irregulares `"protected"`, `true` o `{ protected, permissions, action }`. Las puertas son las del registro (ver plugins.md). `ctx.state.session`, `ctx.state.permiso`, `ctx.state.can(accion)`.

## Hosts

```ts
registerAzure(app, router, { stream: true });        // una función por ruta; OPTIONS si hay CORS
export default defineWorker((env) => createRouter(buildControllers(pgDatabase(pool(env))), { basePath: "/api" }));
```
