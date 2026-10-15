---
Titulo: Entidades y rutas REST
Estado: vigente
Autor:
tags: [objetos, rutas, rest]
---
# Entidades y rutas REST

[← índice](../README.md) · `src/01 objects/entity.ts` · tipos `EntityDef`, `EndpointDef`, `CfgDef`, `Hooks`

```ts
export const ProductoEntity = defineEntity({
  pojo: Producto,
  singular: "producto",
  plural: "productos",
  name: "producto",                 // opcional (default singular): nombre para `target` en relaciones
  singularSuffix: undefined,        // segmento extra tras el singular
  pluralSuffix: undefined,          // default "s" SOLO si singular === plural
  listColumns: ["iproducto", "nombre"], // lo que devuelve list() (aplanado)
  getInclude: { categoria: true },  // include por defecto de get()
  pageSize: 50, maxPageSize: 1000,
  hooks: { prePost(p) { if (p.precio! < 0) return "El precio no puede ser negativo"; } },
  endpoints: {
    ajustarStock: { method: "POST", scope: "one", returns: "pojo" },
    importar:     { method: "POST", scope: "many", returns: "list" },
  },
  cfg: { column: "jconfig" },       // habilita /cfg
  itemHooksOnLists: true,           // en las listas, corre también el pre singular por ítem
});
```

## Tabla de rutas

`basePath` (router) / `baseUrl` (client) va delante. Las pks se codifican con `encodeURIComponent`.

| acción | método | ruta | parámetro |
|---|---|---|---|
| `get` | GET | `singular/pk1/pk2/...` (`?include=<json>`) | pojo (pks) |
| `post` | POST | `singular` | pojo en el body |
| `put` | PUT | `singular/pk1/pk2/...` | pojo en el body (parcial: lo `undefined` no se toca) |
| `delete` | DELETE | `singular/pk1/pk2/...` | pojo (pks) |
| `list` | GET | `plural` | — |
| `query` | POST (o GET `?q=<json>`) | `plural/query` | `QuerySpec` |
| `postList` | POST | `plural` | pojo[] |
| `putList` | PUT | `plural` | pojo[] |
| `deleteList` | DELETE | `plural` | pojo[] (pks) |
| endpoint `scope:"one"` | `def.method` | `singular/pks.../nombre` | pojo |
| endpoint `scope:"many"` | `def.method` | `plural/nombre` | pojo[] (GET: `?q=`) |
| `getCfg` | GET | `singular/pks.../cfg` | pojo (pks) → JSON |
| `putCfg` | PUT | `singular/pks.../cfg` | JSON parcial → JSON completo |
| `doc` | GET | `plural/doc` | → markdown (autogenerado + secciones) |
| `docView` | GET | `plural/doc?v=1` | → HTML (la misma doc en la vista iswc) |
| variante SSE | mismo método | ruta + `/sse` | igual a la acción |

- **singular === plural**: el plural usa el sufijo `s` (`crisis/s`, `crisis/s/query`). Con `pluralSuffix`/`singularSuffix` se personaliza (`crisis/todas`, `crisis/una/x`).
- Una ruta puede tener varios segmentos (`singular: "pedido/linea"` → `pedido/linea/1/2`).
- Al resolver una ruta, el plural tiene prioridad sobre el singular.
- Segmentos reservados para endpoints: `query`, `sse`, `cfg`, `doc`. Un endpoint tampoco puede llamarse como una acción CRUD.
- Respuestas: `post`/`postList` → 201; `null` en get/put/delete/cfg → 404; un `pre*` → 400 `{ error }`; error interno → 500 (con el mensaje solo si `exposeErrors`).

## Endpoints especiales

La entidad declara el **contrato** (método, scope, retorno y `pre` compartido). El server da la implementación y el client la llama:

```ts
// server
new ServerController(ProductoEntity, { db, table: "productos", endpoints: {
  ajustarStock: {
    async handler(p, ctx) { const a = await this.get(p.pkOnly(), ctx); a!.stock! += p.stock!; return this.put(a!, ctx); },
    async sse(p, send) { send("ajustando"); /* ... */ send("listo"); },
  },
}});
// client
const r = await productos.call<Producto>("ajustarStock", { iproducto: 1, stock: 5 });
for await (const t of productos.stream("ajustarStock", { iproducto: 1, stock: 5 })) console.log(t);
```

`this` es el controller y `ctx` trae `request`, `exec` (transacción), `state`, `include` y `signal`.
