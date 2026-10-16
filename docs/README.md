---
Titulo: DER · Punto de entrada
Estado: vigente
Autor:
tags: [indice, agentes]
---
# DER: punto de entrada

> **Para agentes LLM:** este es el índice. Todo `mod.ts` consumible por CDN apunta aquí. Lee primero esta página, después solo el documento del tema que necesites. Las reglas de la sección [Reglas para agentes](#reglas-para-agentes) son obligatorias.

Librería TypeScript (Deno primero, sin build) para definir **una sola vez**, en JSON, los schemas de las entidades y sus POJOs, y reusarlos para:

- **Client:** controllers `fetch` que validan (Zod + `pre*`) antes de llamar a la API.
- **Server:** controllers SQL agnósticos del motor (PostgreSQL, SQLite), con relaciones anidadas, filtros, paginación, `seed()`, SSE y configuración JSON (`/cfg`).

## Mapa del paquete

| Capa | Carpeta | Entrada | Dependencias |
|---|---|---|---|
| Transversal: tipos, Zod, casteos, errores, `Obj`, SSE | `src/00 common/` | `src/00 common/mod.ts` | `zod` |
| Objetos: schema → POJO / Zod, entidades, query | `src/01 objects/` | `src/01 objects/mod.ts` | `zod` |
| Controller base (CRUD, query, list, listas, pre*, SSE, cfg) | `src/02 controllers/` | `src/02 controllers/mod.ts` | `zod` |
| Client (fetch) | `src/02 controllers/client/` | `.../client/mod.ts` | `zod` |
| Server core (agnóstico de motor) | `src/02 controllers/server/` | `.../server/mod.ts` | `zod`, `kysely` |
| Motor SQLite (`node:sqlite`) | `.../server/sqlite/` | `.../server/sqlite/mod.ts` | `zod`, `kysely` |
| Motor PostgreSQL (pool `pg` del consumidor) | `.../server/pg/` | `.../server/pg/mod.ts` | `zod`, `kysely` |
| PostgreSQL embebido (PGlite, WASM) | `.../server/pglite/` | `.../server/pglite/mod.ts` | `zod`, `kysely`, `@electric-sql/pglite` |
| Host Azure Functions (una función por ruta) | `.../server/hosts/azure/` | `.../server/hosts/azure/mod.ts` | — (el `app` lo pasa el consumidor) |
| Host Cloudflare Workers | `.../server/hosts/cloudflare/` | `.../server/hosts/cloudflare/mod.ts` | — |
| Plugins de seguridad (identidad + permisos) | `src/03 plugins/` | `src/03 plugins/mod.ts` (o `identity/`, `permissions/`) | `zod`, `kysely` |

`mod.ts` en la raíz equivale a `src/02 controllers/mod.ts` (el núcleo compartido, solo `zod`). Cada `mod.ts` reexporta todo lo de la capa anterior: con importar **una** entrada basta.

## Documentos

| Tema | Documento |
|---|---|
| Arquitectura, capas y decisiones (por qué Kysely, Zod, `Obj`; qué se investigó) | [010-General/010-Arquitectura.md](010-General/010-Arquitectura.md) |
| Consumir por CDN (jsDelivr / raw GitHub), import map y dependencias | [010-General/020-Consumo-por-CDN.md](010-General/020-Consumo-por-CDN.md) |
| Schemas JSON, columnas, relaciones, POJOs, casteos y Zod | [020-Objetos/010-Schemas-y-POJOs.md](020-Objetos/010-Schemas-y-POJOs.md) |
| Acciones JSON de POJOs y `Obj` (insert, insertIgnore, update, delete, get, replace) | [020-Objetos/020-Obj-y-acciones-JSON.md](020-Objetos/020-Obj-y-acciones-JSON.md) |
| Entidades: singular/plural, rutas REST, endpoints, `/sse`, `/cfg` | [020-Objetos/030-Entidades-y-rutas.md](020-Objetos/030-Entidades-y-rutas.md) |
| Controllers: flujo, `pre*`, hooks, overrides, client y server | [030-Controllers/010-Controllers.md](030-Controllers/010-Controllers.md) |
| `query()`: filtros, operadores, relaciones, orden, paginación, include | [020-Objetos/040-Query.md](020-Objetos/040-Query.md) |
| Motores SQL: PG, SQLite, PGlite, `seed()`, `syncSchema()` (migraciones), secuencias, índices, caso de identificadores, nuevo motor | [040-Servidor/010-Motores-seed-y-sync.md](040-Servidor/010-Motores-seed-y-sync.md) |
| Server-Sent Events y configuración JSON | [030-Controllers/030-SSE-y-cfg.md](030-Controllers/030-SSE-y-cfg.md) |
| Documentación servida: md autogenerado + secciones en `/doc`, vista iswc en `/doc?v=1` | [030-Controllers/040-Documentacion-servida.md](030-Controllers/040-Documentacion-servida.md) |
| Hosts: tabla de rutas, Azure Functions, Cloudflare Workers, rutas irregulares, CORS, guard | [040-Servidor/020-Hosts.md](040-Servidor/020-Hosts.md) |
| Seguridad: plugins de identidad (usuarios, hash, JWT, login/logout) y permisos (DER, vector de acciones) | [050-Plugins/010-Seguridad.md](050-Plugins/010-Seguridad.md) |
| Propagación de detalles (`getPropagation` / `setPropagation`), seed en cascada y controllers en bases/motores distintos | [030-Controllers/020-Propagacion-y-multi-db.md](030-Controllers/020-Propagacion-y-multi-db.md) |

## Ejemplo mínimo

```ts
// shared/domain.ts: lo importan front y back
import { defineEntity, defineSchema, pojoOf } from "<base>/mod.ts";

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
  pojo: Producto, singular: "producto", plural: "productos",
  hooks: { prePost: (p) => p.precio! < 0 && "El precio no puede ser negativo" },
});
```

```ts
// back
import { createRouter, ServerController, sqliteDatabase } from "<base>/src/02%20controllers/server/sqlite/mod.ts";
const db = sqliteDatabase("app.db");
const productos = new ServerController(ProductoEntity, { db, table: "productos" });
await db.seed();
Deno.serve(createRouter([productos], { basePath: "/api" }).fetch);
```

```ts
// front
import { ClientController } from "<base>/src/02%20controllers/client/mod.ts";
const productos = new ClientController(ProductoEntity, { baseUrl: "/api" });
const caros = await productos.query({ where: { precio: { gt: 10 } }, include: { categoria: true } });
```

Ejemplo completo y ejecutable: `examples/domain.ts` (compartido) y `examples/backend.ts` (server). Los tests (`tests/`) son la especificación ejecutable: `deno task test`.

## Reglas para agentes

1. **Tipos, interfaces y schemas Zod solo en `schemas.ts`.** Todo lo común va en `src/00 common/schemas.ts`. Lo del server que depende de Kysely va en `src/02 controllers/server/schemas.ts`. Los archivos de lógica no declaran `type`, `interface` ni `const Z...`. Lo vigila `tests/arch.test.ts`.
2. **Capas:** `00 common ← 01 objects ← 02 controllers ← 03 plugins`, y `client ⟂ server`. Solo se importa hacia abajo. La excepción es `import type`, que se borra al compilar.
3. **Dependencias por dimensión:** el client y el núcleo solo usan `zod`; el server agrega `kysely`; cada motor agrega lo suyo. Una dependencia nueva va en la carpeta más específica posible. Lo vigila `tests/arch.test.ts`.
4. **Imports internos por el alias `@Jeff-Aporta/DER/…` (nunca relativos) y siempre con `.ts`**; especificadores desnudos (`"zod"`, `"kysely"`) para las dependencias. El alias y las dependencias los resuelve el import map (el de este repo apunta a `./`; el del consumidor, al CDN). Lo vigila `tests/arch.test.ts`.
5. **Las acciones reciben siempre el POJO** (o `QuerySpec` en `query()`), nunca datos sueltos.
6. **`pre*` retorna truthy = mensaje de error** y falsy = OK.
7. **El SQL lo arma el controller** (bifurcando por motor). El SQL escrito a mano se admite solo en columnas calculadas (`computed`), nunca en relaciones.
8. **Tipado fuerte y sin advertencias en el editor:** `npm install` deja `node_modules` (Deno lo usa con `nodeModulesDir: "manual"`) y `tsconfig.json` es estricto (`noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noUnused*`, `noImplicitReturns`). Nada de `any` implícito; los accesos por índice se verifican (`meta.column(k)`, `meta.relation(k)`, `at()` en tests).
9. **Reglas generales en `preConfirm`**, no repetidas en cada `pre*`. La autorización por ruta va en `guard` (por `route.id`).
10. **Strings multilínea = arreglo de líneas** unido con `join("\n")` (nunca un template literal de varias líneas).
11. **Una sola norma de rutas para todos los hosts**: la tabla del Router. Un host nuevo es una carpeta `server/hosts/<host>/` que registra `router.routes` (cada `RouteDef.handle(req, params)`).
12. **La seguridad es por plugins** (JSON global con `pluginsFromConfig`). Sin plugins se omite; se declara por endpoint en el registro (`security`). Los secretos van siempre por `env:`.
13. **Documentación modular:** cada hoja `.md` vive en su carpeta numerada (`0x0-Tema/0x0-Hoja.md`), lleva
    frontmatter con `Titulo` y se lista en `docs/index.html` (visor `iswc-md-docs-vault`; lo vigila `tests/arch.test.ts`).
    `docs/README.md` es el punto de entrada. Un párrafo es una sola línea (el visor respeta los saltos).
14. **Tests:** `tests/<tema>.test.ts` (nunca `_test.ts`); los helpers de tests, sin sufijo (`tests/_util.ts`).
15. **Nomenclatura (sin prefijo T):** schema JSON `UsuarioSchema`, POJO `Usuario`, entidad REST `UsuarioEntity`, instancia de
    controller en plural `usuarios`; tablas con el prefijo de su dominio (`permisos_usuarios`), nombres de entidad
    `dominio.entidad` (`permisos.usuario`). Los plugins reusan las clases de otros plugins en vez de duplicar campos.
16. Antes de terminar un cambio: `npm install` (una vez), luego `deno task check` (tsc + deno check) y `deno task test` en verde.
