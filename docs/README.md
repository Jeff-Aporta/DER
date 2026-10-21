---
Titulo: DER · Punto de entrada
Estado: vigente
Autor:
tags: [indice, agentes]
---
# DER: punto de entrada

> **Para agentes LLM:** este es el índice. Todo `index.ts` consumible por CDN apunta aquí. Lee primero esta página, después solo el documento del tema que necesites. Las reglas de la sección [Reglas para agentes](#reglas-para-agentes) son obligatorias. Las **specs fundación** (el WHAT desde el que se reconstruye `src/`) viven en `specs/` (ver `specs/FOUNDATION.md` y `specs/W2H.md`).

Librería TypeScript (Deno primero, sin build) para definir **una sola vez**, en JSON, los schemas de las entidades y sus POJOs, y reusarlos para:

- **Client:** controllers `fetch` que validan (Zod + `pre*`) antes de llamar a la API.
- **Server:** controllers SQL agnósticos del motor (PostgreSQL, PGlite, SQLite, MySQL, MSSQL), con relaciones anidadas, filtros, paginación, `seed()`, SSE, configuración de la entidad (`plural/cfg`) y documentación servida (`plural/doc`).
- **Plugins JSON:** identidad y permisos como un JSON transversal que el consumidor arma con `createClient` / `createServer`; herméticos y reemplazables por un sistema propio.

## Mapa del paquete

| Capa | Carpeta | Entrada | Dependencias |
|---|---|---|---|
| Transversal: tipos, Zod, `Obj` + errores + casteos (`base.ts`), SSE | `src/00-common/` | `src/00-common/index.ts` | `zod` |
| Objetos: schema → POJO / Zod, entidades, registro global, query, diagramas | `src/01-objects/` | `src/01-objects/index.ts` | `zod` |
| Controller base (CRUD, query, list, listas, pre*, SSE, cfg, permisos, `pojo()`) y lo común de los plugins | `src/02-controllers/` | `src/02-controllers/index.ts` | `zod` |
| Client (fetch) + `createClient` | `src/02-controllers/client/` | `.../client/index.ts` | `zod` |
| Server core (agnóstico de motor) + `createServer` | `src/02-controllers/server/` | `.../server/index.ts` | `zod`, `kysely` |
| Motor SQLite (`node:sqlite`, better-sqlite3 o sqlite3) | `.../server/sqlite.ts` | `.../server/sqlite.ts` | `zod`, `kysely` |
| Motor PostgreSQL (pool `pg` del consumidor) | `.../server/pg.ts` | `.../server/pg.ts` | `zod`, `kysely` |
| PostgreSQL embebido (PGlite, WASM) | `.../server/pglite.ts` | `.../server/pglite.ts` | `zod`, `kysely`, `@electric-sql/pglite` |
| Motor MySQL / MariaDB (pool `mysql2` del consumidor) | `.../server/mysql.ts` | `.../server/mysql.ts` | `zod`, `kysely` |
| Motor Microsoft SQL Server (`tedious` + `tarn` del consumidor) | `.../server/mssql.ts` | `.../server/mssql.ts` | `zod`, `kysely` |
| Host Azure Functions (una función por ruta) | `.../server/hosts/azure.ts` | `.../server/hosts/azure.ts` | — (el `app` lo pasa el consumidor) |
| Host Cloudflare Workers | `.../server/hosts/cloudflare.ts` | `.../server/hosts/cloudflare.ts` | — |
| Plugins de seguridad (server): identidad + permisos como JSON | `src/03-plugins/` | `src/03-plugins/index.ts` | `zod`, `kysely` |
| Plugins de seguridad (client): los JSON transversales | `src/03-plugins/` | `src/03-plugins/client.ts` | `zod` |

`index.ts` en la raíz equivale a `src/02-controllers/index.ts` (el núcleo compartido, solo `zod`). Cada `index.ts` reexporta todo lo de la capa anterior: con importar **una** entrada basta. Lo de is-webcomponents (`Obj`, sus contratos y los tipos de los diagramas) llega por CDN con los alias `@Jeff-Aporta/wc-base/` y `@Jeff-Aporta/wc-diagrams/` fijados a un SHA en `deno.json`.

## Documentos

| Tema | Documento |
|---|---|
| Arquitectura, capas y decisiones (por qué Kysely, Zod, `Obj`; qué se investigó) | [010-General/010-Arquitectura.md](010-General/010-Arquitectura.md) |
| Consumir por CDN (jsDelivr / raw GitHub), import map y dependencias | [010-General/020-Consumo-por-CDN.md](010-General/020-Consumo-por-CDN.md) |
| Schemas JSON, columnas, relaciones, POJOs, casteos y Zod | [020-Objetos/010-Schemas-y-POJOs.md](020-Objetos/010-Schemas-y-POJOs.md) |
| Acciones JSON de POJOs y `Obj` (insert, insertIgnore, update, delete, get, replace) | [020-Objetos/020-Obj-y-acciones-JSON.md](020-Objetos/020-Obj-y-acciones-JSON.md) |
| Entidades: singular/plural, tabla, registro global, rutas REST, endpoints, `/sse`, `/cfg`, seguridad | [020-Objetos/030-Entidades-y-rutas.md](020-Objetos/030-Entidades-y-rutas.md) |
| Controllers: flujo, `pre*`, hooks, overrides, `pojo()`, `permissions()`, client y server | [030-Controllers/010-Controllers.md](030-Controllers/010-Controllers.md) |
| `query()`: filtros, operadores, relaciones, orden, paginación, include | [020-Objetos/040-Query.md](020-Objetos/040-Query.md) |
| Motores SQL: PG, PGlite, SQLite, MySQL, MSSQL, `seed()`, `syncSchema()`, secuencias (base 2..36), índices, nuevo motor | [040-Servidor/010-Motores-seed-y-sync.md](040-Servidor/010-Motores-seed-y-sync.md) |
| Server-Sent Events, configuración de la entidad y modo del PUT | [030-Controllers/030-SSE-y-cfg.md](030-Controllers/030-SSE-y-cfg.md) |
| Documentación servida: md autogenerado + secciones en `/doc`, vista iswc en `/doc?v=1`, diagramas con los tipos del kit | [030-Controllers/040-Documentacion-servida.md](030-Controllers/040-Documentacion-servida.md) |
| Hosts: tabla de rutas, Azure Functions, Cloudflare Workers, rutas irregulares, CORS, guard | [040-Servidor/020-Hosts.md](040-Servidor/020-Hosts.md) |
| Seguridad: puertas del registro, plugins JSON de identidad y permisos, `createClient`/`createServer`, plugin propio | [050-Plugins/010-Seguridad.md](050-Plugins/010-Seguridad.md) |
| Propagación de detalles (`getPropagation` / `setPropagation`), seed en cascada y controllers en bases/motores distintos | [030-Controllers/020-Propagacion-y-multi-db.md](030-Controllers/020-Propagacion-y-multi-db.md) |

## Ejemplo mínimo

```ts
// shared/domain.ts: lo importan front y back
import { defineEntity, defineSchema, pojoOf } from "<base>/index.ts";

export const ProductoSchema = defineSchema({
  columns: {
    iproducto: { type: "int", pk: true, autoincrement: true },
    nombre: { type: "string", length: 100, nullable: false },
    precio: { type: "decimal", nullable: false },
    icategoria: { type: "int" },
  },
  relations: { categoria: { kind: "one", target: "categoria", on: { icategoria: "icategoria" } } },
});
export class Producto extends pojoOf(ProductoSchema) {
  declare categoria: Categoria | null;
}
export const ProductoEntity = defineEntity({
  pojo: Producto, singular: "producto", plural: "productos",   // tabla por defecto: "productos"
  hooks: { prePost: (p) => p.precio! < 0 && "El precio no puede ser negativo" },
});
// o sin clase: defineEntity({ schema: ProductoSchema, singular, plural }) y los pojos con controller.pojo(content)
```

```ts
// back
import { createRouter, ServerController, sqliteDatabase } from "<base>/src/02-controllers/server/sqlite.ts";
const db = sqliteDatabase("app.db");
const productos = new ServerController(ProductoEntity, { db });
await db.seed();
Deno.serve(createRouter([productos], { basePath: "/api" }).fetch);
```

```ts
// front
import { ClientController } from "<base>/src/02-controllers/client/index.ts";
const productos = new ClientController(ProductoEntity, { baseUrl: "/api" });
const caros = await productos.query({ where: { precio: { gt: 10 } }, include: { categoria: true } });
```

Ejemplo completo y ejecutable: `examples/domain.ts` (compartido) y `examples/backend.ts` (server). Los tests (`tests/`) son la especificación ejecutable: `deno task test`.

## Reglas para agentes

1. **Tipos y schemas Zod solo en `schemas.ts`**, siempre con `type` (nunca `interface`) y **cada tipo en una línea**. Todo lo común va en `src/00-common/schemas.ts`; lo del server que depende de Kysely en `src/02-controllers/server/schemas.ts`; lo de cada plugin en su `schemas.ts`. Lo vigila `tests/arch/arch.test.ts`.
2. **Capas:** `00-common ← 01-objects ← 02-controllers ← 03-plugins`, y `client ⟂ server`. Solo se importa hacia abajo. La excepción es `import type`, que se borra al compilar.
3. **Dependencias por dimensión:** el client y el núcleo solo usan `zod`; el server agrega `kysely`; cada motor agrega lo suyo (y los pools/drivers los aporta el consumidor). Una dependencia nueva va en el archivo más específico posible.
4. **Imports internos por el alias `@Jeff-Aporta/DER/…` (nunca relativos), siempre con `.ts` y UN import por línea**; especificadores desnudos (`"zod"`, `"kysely"`) para las dependencias; lo de iswc por `@Jeff-Aporta/wc-*` (nunca una URL directa). Los barrels se llaman `index.ts`.
5. **Estilo plano:** una sentencia por línea; sin funciones de una línea que solo deleguen; sin carpetas de menos de dos elementos; carpetas en kebab-case (sin espacios: así la URL del CDN es legible). Los miembros privados usan `#` (no `private`/`protected` con nombre; `protected abstract` solo para el contrato base→hijos).
6. **Las acciones reciben siempre el POJO** (o `QuerySpec` en `query()`), nunca datos sueltos. Los pojos se instancian de forma indirecta: `controller.pojo(content?)` o `registry.pojo(plural, content?)`.
7. **`pre*` retorna truthy = mensaje de error** y falsy = OK. Las reglas generales van en `preConfirm`.
8. **El SQL lo arma el controller** con las primitivas del `Engine`. El SQL escrito a mano se admite solo en columnas calculadas (`computed`), nunca en relaciones.
9. **Registro global único:** toda entidad se registra por su plural (dos entidades con el mismo plural es un error); la tabla por defecto es el plural; las puertas de seguridad (`extract`, `protected`, `permissions`) y la sesión singleton viven ahí.
10. **Tipado fuerte y sin advertencias:** `deno.json` es estricto (`noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noUnused*`, `noImplicitReturns`). Nada de `any` implícito.
11. **Strings multilínea = arreglo de líneas** unido con `join("\n")` (nunca un template literal de varias líneas).
12. **Una sola norma de rutas para todos los hosts**: la tabla del Router. Un host nuevo es un archivo `server/hosts/<host>.ts` que registra `router.routes`. `/cfg` y `/doc` existen solo en el plural.
13. **La seguridad es por plugins JSON** (`createServer(identityServer, …)`, `createServer(permissionsServer, …)`) o por puertas propias del consumidor en el registro. Sin `extract` se omite; se declara por endpoint (`security` en la entidad o el controller; `"protected"` / `true` en paths irregulares). Un plugin declara `irregularPaths` (sin entidad) y `paths` dentro de cada entidad (con prefijo singular/plural y pks opcionales), y cada entidad dice si es `exposed` y `administrable`. `/cfg` es una sola acción `CFG:/plural`. Los secretos van siempre por `env:`.
14. **Documentación modular:** cada hoja `.md` vive en su carpeta numerada, lleva frontmatter con `Titulo` y se lista en `docs/index.html`. Un párrafo es una sola línea.
15. **Tests:** `tests/<tema>/<nombre>.test.ts`, en carpetas de dos o más archivos; helpers sin sufijo (`tests/_util.ts`). Un test rojo se arregla, nunca se salta.
16. **Nomenclatura:** schema JSON `UsuarioSchema`, POJO `Usuario`, entidad REST `UsuarioEntity`, instancia de controller en plural `usuarios`; tablas con el prefijo de su dominio (`permisos_roles`, `identity_usuarios`), nombres de entidad `dominio.entidad` (`permisos.rol`). Un plugin no reusa clases de otro: referencia su entidad por nombre y sigue funcionando sin ella.
17. **Specs antes de cerrar:** todo cambio observable actualiza `specs/foundation/` siguiendo `specs/W2H.md`. Luego `deno task check`, `deno lint` y `deno task test` en verde (solo Deno: no hay package.json ni node_modules).
