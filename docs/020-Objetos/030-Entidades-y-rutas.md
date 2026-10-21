---
Titulo: Entidades y rutas REST
Estado: vigente
Autor:
tags: [objetos, rutas, rest, registro]
---
# Entidades y rutas REST

[← índice](../README.md) · `src/01-objects/entity.ts` · `src/01-objects/registry.ts` · tipos `EntityDef`, `EndpointDef`, `CfgDef`, `Hooks`, `SecurityDef`

```ts
export const ProductoEntity = defineEntity({
  pojo: Producto,                   // clase; o `schema: ProductoSchema` y el POJO se genera (pojos indirectos: ctrl.pojo())
  singular: "producto",
  plural: "productos",
  name: "producto",                 // opcional (default singular): nombre para `target` en relaciones
  table: "productos",               // opcional: default el plural (`permisos/roles` → `permisos_roles`), luego el singular
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
  cfg: { zod: ZProductosCfg },      // configuración de la entidad: habilita plural/cfg (si el server define la tabla de cfg)
  security: { public: ["list", "get", "doc"] },   // compartida con el client; el server puede sobreescribirla
  itemHooksOnLists: true,           // en las listas, corre también el pre singular por ítem
});
```

## Registro global

`defineEntity` registra la entidad en el **registro global** (`registry`, singleton) por su plural (la ruta plural completa: `productos`, `permisos/roles`, `crisis/s`). Dos entidades con el mismo plural es un error: el consumidor define otro plural. También registra el POJO por `name` (lo que resuelve `target: "nombre"` en las relaciones); dos entidades con el mismo `name` es un error.

```ts
registry.entity("productos")              // la Entity
registry.pojo("productos", { nombre: "A" }) // instancia del POJO (indirecta: nunca la clase)
registry.entities()                       // [{ key, entity }]
registry.has("productos")
```

Ahí mismo viven las **puertas de seguridad** (`registry.secure({ extract, protected, permissions })`) y la **sesión singleton** (`registry.session`): ver [seguridad.md](../050-Plugins/010-Seguridad.md).

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
| `getCfg` | GET | `plural/cfg` | → JSON de la entidad (con los defaults del molde) |
| `putCfg` | PUT | `plural/cfg` | JSON parcial (`Obj.update`) → JSON completo |
| `doc` | GET | `plural/doc` | → markdown (autogenerado + secciones) |
| `docView` | GET | `plural/doc?v=1` | → HTML (la misma doc en la vista iswc) |
| variante SSE | mismo método | ruta + `/sse` | igual a la acción |

- **`/cfg` y `/doc` existen SOLO en el plural**: los singulares no los tienen.
- **singular === plural**: el plural usa el sufijo `s` (`crisis/s`, `crisis/s/query`). Con `pluralSuffix`/`singularSuffix` se personaliza (`crisis/todas`, `crisis/una/x`).
  - **Límite de diseño:** una pk cuyo valor es literalmente `"s"` (`GET /crisis/s` → list, no get) colisiona con el plural por defecto. Para no chocar: o el plural usa otro sufijo (`pluralSuffix`), o la pk nunca vale `"s"` (p. ej. UUID).
- Una ruta puede tener varios segmentos (`singular: "pedido/linea"` → `pedido/linea/1/2`).
- Al resolver una ruta, el plural tiene prioridad sobre el singular.
- Segmentos reservados para endpoints: `query`, `sse`, `cfg`, `doc`. Un endpoint tampoco puede llamarse como una acción CRUD.
- Respuestas: `post`/`postList` → 201; `null` en get/put/delete → 404; `/cfg` sin tabla de cfg en el server → 404; un `pre*` → 400 `{ error }`; sin sesión en ruta protegida → 401; permiso negado → 403; error interno → 500 (con el mensaje solo si `exposeErrors`).

## Rutas irregulares

Los paths que no siguen REST (`IrregularPath`) se declaran en JSON. **Dentro de la entidad** (`paths`) cuelgan de su `plural` (default) o `singular`, y con `pks: true` llevan las pks (`usuario/{iusuario}/sufijo`; el handler las recibe en `input.pks`): `paths: { resumen: { method: "GET", path: "resumen" } }` → `productos/resumen`. En el server se implementan en `config.paths` (`this` = el controller) y en el client se llaman con `plugin.call("resumen", body?, pks?)` o con `fetch`. Los que no pertenecen a ninguna entidad (`irregularPaths` de un plugin, `routes` del router) van con su ruta completa. Ver [hosts.md](../040-Servidor/020-Hosts.md) y [seguridad.md](../050-Plugins/010-Seguridad.md).

`exposed: false` no publica ninguna ruta de la entidad; `administrable: false` publica solo lecturas (list, get, query, doc, getCfg). Ambos son explícitos en las entidades de los plugins.

## Endpoints especiales

La entidad declara el **contrato** (método, scope, retorno y `pre` compartido). El server da la implementación y el client la llama:

```ts
// server
new ServerController(ProductoEntity, { db, endpoints: {
  ajustarStock: {
    async handler(p, ctx) { const a = await this.get(p.pkOnly(), ctx); a!.stock! += p.stock!; return this.put(a!, ctx); },
    async sse(p, send) { send("ajustando"); /* ... */ send("listo"); },
  },
}});
// client
const r = await productos.call<Producto>("ajustarStock", { iproducto: 1, stock: 5 });
for await (const t of productos.stream("ajustarStock", { iproducto: 1, stock: 5 })) console.log(t);
```

`this` es el controller y `ctx` trae `request`, `exec` (transacción), `state`, `session`, `include` y `signal`.
