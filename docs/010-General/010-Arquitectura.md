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
src/00-common        schemas.ts (TODOS los tipos y Zod, uno por línea) · base.ts (Obj + errores + casteos) · sse.ts
      ↑
src/01-objects       meta (schema → metadata, secuencias) · zod (schema → Zod) · pojo · registry (singleton) · query · entity · diagram
      ↑
src/02-controllers   controller.ts (BaseController: CRUD, pre*, pojo(), permissions()) · plugin.ts (lo común de los plugins JSON)
      ├── client/    ClientController (fetch) · plugin.ts (createClient)                      → solo zod
      └── server/    ServerController · Database · Router · routes · doc · plugin.ts (createServer) · schemas.ts (tipos con Kysely)
            ├── engines.ts   postgres · sqlite · mysql · mssql (contrato Engine)
            ├── sqlite.ts    fábrica: node:sqlite | better-sqlite3 | sqlite3 asíncrono
            ├── pg.ts        fábrica: pool pg del consumidor
            ├── pglite.ts    fábrica: PGlite (reusa el motor postgres)
            ├── mysql.ts     fábrica: pool mysql2 del consumidor
            ├── mssql.ts     fábrica: tedious + tarn del consumidor
            └── hosts/       azure.ts (Azure Functions) · cloudflare.ts (Workers)
      ↑
src/03-plugins       common/ (crypto, device) · identity/ · permissions/  — cada plugin: schemas.ts · index.ts (JSON transversal) · server.ts (push)
```

- **Una definición, dos lados.** El schema JSON, el POJO, la entidad (singular, plural, tabla, rutas, seguridad), los `pre*` compartidos y los contratos Zod son los mismos en el client y en el server. El server agrega lo propio de SQL (caso de identificadores, columnas calculadas, la tabla de configuración de `plural/cfg`) y el client lo propio de HTTP (`baseUrl`, headers, fetch).
- **Registro global (singleton).** Toda entidad queda registrada por su plural; los POJOs por el nombre de su entidad (para `target`); las puertas de seguridad y la sesión singleton viven ahí. Es el "contexto global" desde el que cualquier controller recupera instancias de otra entidad (`registry.pojo("productos", {...})`).
- **BaseController** fija el flujo de toda acción: normalizar a POJO, verificar (`pre*`), override opcional y ejecutar. Client y server solo implementan `execute*`. Expone `pojo(content?)` (instancia indirecta) y `permissions(action)` (puerta del registro).
- **Motores como primitivas.** `server/` no conoce ningún motor: recibe un `Engine` (contrato en `server/schemas.ts`). Todos los motores incluidos viven en `engines.ts`; cada fábrica (`sqlite.ts`, `pg.ts`…) aísla sus dependencias.
- **Plugins como JSON.** Un plugin es un JSON transversal (entidades con schema, rutas regulares e irregulares, operaciones del cliente). El server lo reusa tal cual inyectándole sus particularidades con `Obj.insert` (handlers, hidden, puertas). El consumidor arma lo que necesita con `createClient` / `createServer`: nunca recibe clases.

## Qué se investigó antes de construir

Ningún estándar o librería cubre el conjunto completo. Faltaba algo que reuniera POJOs con getters/setters casteados, definiciones JSON compartidas entre client y server, rutas singular/plural con `entity/s`, `pre*` con mensaje truthy, SSE por verbo, `/cfg` y relaciones anidadas controladas por JData. Lo más cercano:

| Opción | Cubre | No cubre |
|---|---|---|
| Drizzle ORM (relational queries `with: {}`) | schema en TS, PG+SQLite, relaciones anidadas en 1 query | POJOs con casteo, capa REST, client compartido, `pre*`, SSE |
| Kysely | constructor SQL agnóstico (PG, SQLite, MySQL, MSSQL), parámetros, DDL | no es ORM: sin relaciones ni REST |
| ts-rest / tRPC / Hono RPC | contrato compartido client/server | sin SQL ni POJOs |
| OData / JSON:API / PostgREST | convenciones de filtros, select e include | son especificaciones de protocolo, no librerías TS |

**Decisión:** construir la capa de controllers encima de estándares maduros en lugar de reinventarlos:

- **Kysely** (solo en el server): compila el SQL por dialecto (comillas, parámetros, DDL, transacciones). Las relaciones anidadas usan subconsultas JSON propias por motor (`row_to_json`/`json_agg` en PG, `json_object`/`json_group_array` en SQLite, `json_object`/`json_arrayagg` en MySQL, `for json path` en MSSQL).
- **Zod 4**: contrato estándar de tipos. Cada schema JSON genera sus Zod (`row`, `insert`, `update`, `pk`, `molde`) y las apps consumidoras pueden reusarlos (formularios, validación).
- **`Obj`** (de `Jeff-Aporta/is-webcomponents`, por CDN fijado a SHA): operaciones parciales sobre JSON, usadas en las acciones de los POJOs, en `/cfg` y en el push de los plugins.
- **Tipos de diagramas del kit** (`ErSpec`, `ClassSpec` de is-webcomponents, por CDN): el payload que DER genera es exactamente el que `<iswc-er-diagram>` y `<iswc-class-diagram>` leen.
- **Web APIs estándar** (`Request`/`Response`, `ReadableStream`, SSE según MDN): el router funciona con `Deno.serve`, Hono, Oak, Workers, etc.
- **PGlite** para probar PostgreSQL real sin servidor; MySQL y MSSQL se verifican compilando su SQL sin conexión.

## Garantías verificadas por tests

- `tests/server/server.test.ts`: los mismos casos corren en SQLite y en PostgreSQL (PGlite); `tests/server/engines.test.ts` compila el SQL de MySQL y MSSQL y prueba el driver SQLite asíncrono.
- `tests/http/http.test.ts`: client ↔ router ↔ server punta a punta, incluido SSE en el cable y `/cfg`.
- `tests/plugins/`: identidad, permisos, endurecimiento del login, clientes JSON y hermeticidad entre plugins.
- `tests/arch/arch.test.ts`: dependencias por archivo, capas, alias e imports de una línea, tipos solo en `schemas.ts` (y en una línea), `#` privados, carpetas de dos o más elementos, estructura JSON de los plugins, aliases de iswc fijados a SHA y referencia a esta documentación en cada entrada.
