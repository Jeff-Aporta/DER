---
Titulo: Controllers
Estado: vigente
Autor:
tags: [controllers]
---
# Controllers

[← índice](../README.md) · `src/02 controllers/controller.ts` (base) · `client/controller.ts` · `server/controller.ts`

## API común (client y server)

```ts
get(pojo, ctx?)            → P | null          post(pojo, ctx?)        → P
put(pojo, ctx?)            → P | null          delete(pojo, ctx?)      → P | null
list(ctx?)                 → P[]   (aplanado, listColumns, sin relaciones)
query(spec, ctx?)          → P[]   (siempre arreglo; ver query.md)
postList / putList / deleteList(pojos, ctx?)  → P[]   (en el server, en una transacción)
call(endpoint, arg, ctx?)  → resultado del endpoint especial
stream(acción|endpoint, arg?, ctx?) → AsyncIterable<string>   (SSE)
getCfg(pojo, ctx?)         → JSON | null       putCfg(pojo, parcial, ctx?) → JSON | null
doc(ctx?)                  → string (md autogenerado + secciones `doc`; ver doc-endpoint.md)
verify(acción, arg, ctx)   → string | null     (ejecuta las verificaciones sin la acción)
```

Siempre reciben **pojos**: se aceptan objetos planos, pero se convierten al POJO de la entidad antes de verificar.

## Flujo de una acción

```
normalizar a POJO → verify (pre*) → override de `actions` (opcional, con next) → execute
```

### Verificación (`pre*`)

Retornar **truthy = mensaje de error** (`return "falta precio"`) y falsy = OK. `true` → "Datos inválidos". Se puede retornar una promesa. El primer error corta y lanza `ValidationError` (HTTP 400). Orden:

1. **Reglas automáticas del schema:** pk presentes; requeridos presentes en `post`; luego el Zod de la acción (`insert`, `update`, `pk`): tipos, enums, longitud, no nulos. `query` se valida con `ZQuerySpec` y además se verifica que los campos y las relaciones existan.
2. **`preConfirm` (regla general)**: entidad y luego controller. Corre en TODAS las acciones (CRUD, list, query, listas, endpoints, `/cfg` y sus `/sse`), antes del pre* específico.
3. **Hooks específicos de la entidad** (compartidos: corren en el client antes del fetch y otra vez en el server).
4. **Hooks específicos del controller** (propios de cada lado; p. ej. el server verifica una FK en la BD).

### `preConfirm`: una regla para todas las acciones

Recibe una entrada tipada como unión discriminada por `action` (`ConfirmInput<P>`): al preguntar por `input.action`, TS sabe la forma exacta de `input.arg`.

```ts
hooks: {
  preConfirm(input, ctx) {
    if (!ctx.state.user) return "Sesión requerida";                       // aplica a todo
    if (input.action === "post" && input.arg.nombre === "x") return "Nombre inválido"; // arg: TProducto
    if (input.action === "putCfg" && "secreto" in input.cambios) return "No editable";
    if (input.action === "endpoint" && input.name === "importar") { /* ... */ }
  },
}
```

Hooks disponibles: `preGet`, `prePost`, `prePut`, `preDelete`, `preList(ctx)`, `preQuery(spec)`, `prePostList(list)`, `prePutList(list)`, `preDeleteList(list)`, `preGetCfg(pojo)`, `prePutCfg(pojo, parcial)`, más `pre` en cada endpoint. En las listas se ejecuta también el pre singular por ítem, con el mensaje prefijado `[i] `.

### Overrides

```ts
actions: {
  async delete(p, ctx, next) {          // this = controller
    if (await tieneMovimientos(p)) throw new ValidationError("Tiene movimientos");
    return next(p);                      // la implementación por defecto
  },
}
```

## ClientController

```ts
new ClientController(Producto, {
  baseUrl: "https://api.x.com/api",
  fetch,                                       // opcional (tests, interceptores)
  headers: async () => ({ authorization: `Bearer ${token}` }),
  hooks: { /* pre* solo del front */ },
  actions: { /* overrides de fetch */ },
});
```

400 → `ValidationError`, otros ≥ 400 → `HttpError`, 404 en get/put/delete/cfg → `null`. `request()` es la utilidad de bajo nivel para fetch personalizados.

## ServerController

```ts
new ServerController(Producto, {
  db,                               // Database (de server/sqlite, server/pg o server/pglite)
  table: "productos",
  identifierCase: "lower",          // "preserve" | "lower" | "upper" para tabla y columnas (default: el del db)
  columnNames: { nombre: "nom_prod" },
  computed: { total: "{precio} * {stock}" },  // SQL a mano solo para columnas virtuales
  relations: { categoria: { controller: () => otroCtrl } }, // opcional
  defaultOrder: "-creado",
  hooks, actions, sse, endpoints,
  cfg: { table: "productos_cfg", column: "jdata" },          // opcional (ver sse-y-cfg.md)
});
```

- **Relaciones:** las resuelve el controller registrado para el POJO destino (`db.controllerFor`). Cada controller se registra en su `db` al construirse.
- **Columnas calculadas:** un string con `{campo}` se convierte en la referencia correcta según el motor, el alias y el caso. También aceptan `{ pg, sqlite }` por motor o una función `({ col, alias, engine }) => sql`.
- **Transacciones:** las listas abren una transacción. Para compartir una entre controllers: `db.transaction(async (tx) => { await a.post(x, tx); await b.postList(ys, tx); })`.
- **Utilidades públicas** para acciones a medida: `buildSelect`, `buildWhere`, `relationExpr`, `pkWhere`, `col`, `dbCol`, `fieldExpr`, `rows`, `select`, `selectOne`, `insertOne`, `updateOne`, `deleteOne`, `inTransaction`, `loadCfg`, `saveCfg`, `seed`.

## Router

Detalles anidados en lectura y escritura (`getPropagation` / `setPropagation`): ver [propagacion.md](020-Propagacion-y-multi-db.md). Seguridad por endpoint (`security`) con los plugins de identidad y permisos: ver [seguridad.md](../050-Plugins/010-Seguridad.md).

El Router arma la **tabla de rutas** (una por acción, con id `METHOD:/ruta`) que registran los hosts (Deno/Bun/Node, Azure Functions, Cloudflare Workers). Ver [hosts.md](../040-Servidor/020-Hosts.md): `expose`, rutas irregulares (`routes`), `guard` y `cors`.

```ts
const router = createRouter([productos, categorias], {
  basePath: "/api",
  context: async (req) => ({ state: { user: await auth(req) } }),
  exposeErrors: false,
});
Deno.serve(router.fetch);                    // o: (await router.handle(req)) ?? next()
```
