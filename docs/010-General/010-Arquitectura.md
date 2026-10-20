---
Titulo: Arquitectura y decisiones
Estado: vigente
Autor:
tags: [general, arquitectura]
---
# Arquitectura y decisiones

[← índice](../README.md)

## Capas

```
src/00 common        schemas.ts (TODOS los tipos y contratos Zod) · cast · errors · obj · sse
      ↑
src/01 objects       meta (schema → metadata) · zod (schema → Zod) · pojo · query · entity
      ↑
src/02 controllers   controller.ts (BaseController)
      ├── client/    ClientController (fetch)                       → solo zod
      └── server/    ServerController · Database · Router · schemas.ts (tipos con Kysely)
            ├── sqlite/   motor + fábrica (node:sqlite)
            ├── pg/       motor + fábrica (pool pg del consumidor)
            ├── pglite/   fábrica PGlite (reusa el motor pg)
            └── hosts/    adaptadores del ServerController a runtimes serverless
                 ├── azure/         Azure Functions
                 └── cloudflare/    Cloudflare Workers
      ↑
src/03 plugins       identity (login, tokens, hooks) · permissions (permisos por acción/rol)
      ↑
(motores como dimensiones; server/ vive aislado del cliente por dimensión)
```

- **Una definición, dos lados.** El schema JSON, el POJO, la entidad (singular, plural, rutas), los `pre*` compartidos y los contratos Zod son los mismos en el client y en el server. El server agrega lo propio de SQL (tabla, caso de identificadores, columnas calculadas, la tabla de configuración de `plural/cfg`) y el client lo propio de HTTP (`baseUrl`, headers, fetch).
- **BaseController** fija el flujo de toda acción: normalizar a POJO, verificar (`pre*`), override opcional y ejecutar. Client y server solo implementan `execute*`.
- **Motores como dimensiones.** `server/` no conoce ningún motor: recibe un `Engine` (contrato en `server/schemas.ts`). Cada carpeta de motor aporta su `Engine` y su fábrica de `Database`, así sus dependencias quedan aisladas.

## Qué se investigó antes de construir

Ningún estándar o librería cubre el conjunto completo. Faltaba algo que reuniera POJOs con getters/setters casteados, definiciones JSON compartidas entre client y server, rutas singular/plural con `entity/s`, `pre*` con mensaje truthy, SSE por verbo, `/cfg` y relaciones anidadas controladas por JData. Lo más cercano:

| Opción | Cubre | No cubre |
|---|---|---|
| Drizzle ORM (relational queries `with: {}`) | schema en TS, PG+SQLite, relaciones anidadas en 1 query | POJOs con casteo, capa REST, client compartido, `pre*`, SSE |
| Kysely | constructor SQL agnóstico (PG, SQLite, MySQL, MSSQL), parámetros, DDL | no es ORM: sin relaciones ni REST |
| ts-rest / tRPC / Hono RPC | contrato compartido client/server | sin SQL ni POJOs |
| OData / JSON:API / PostgREST | convenciones de filtros, select e include | son especificaciones de protocolo, no librerías TS |

**Decisión:** construir la capa de controllers encima de estándares maduros en lugar de reinventarlos:

- **Kysely** (solo en el server): compila el SQL por dialecto (comillas, parámetros `$1`/`?`, DDL, transacciones). Las relaciones anidadas usan subconsultas JSON propias por motor (`row_to_json`/`json_agg` en PG, `json_object`/`json_group_array` en SQLite), porque el helper de Kysely para SQLite no anida bien.
- **Zod 4**: contrato estándar de tipos. Cada schema JSON genera sus Zod (`row`, `insert`, `update`, `pk`, `molde`) y las apps consumidoras pueden reusarlos (formularios, validación).
- **`Obj`** (de `Jeff-Aporta/is-webcomponents`): operaciones parciales sobre JSON, usadas en las acciones de los POJOs y en `/cfg`.
- **Web APIs estándar** (`Request`/`Response`, `ReadableStream`, SSE según MDN): el router funciona con `Deno.serve`, Hono, Oak, Workers, etc.
- **PGlite** para probar PostgreSQL real sin servidor.

Si en el futuro se necesitan MySQL o MSSQL, Kysely ya los soporta: basta una carpeta `server/<motor>/` con su `Engine` (ver [motores.md](../040-Servidor/010-Motores-seed-y-sync.md)).

## Garantías verificadas por tests

- `tests/server.test.ts`: los mismos casos corren en SQLite y en PostgreSQL (PGlite).
- `tests/http.test.ts`: client ↔ router ↔ server punta a punta, incluido SSE en el cable y `/cfg`.
- `tests/arch.test.ts`: dependencias por carpeta, capas, `.ts` en imports, tipos solo en `schemas.ts` y referencia a esta documentación en cada entrada.
