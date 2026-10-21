# Skill: controllers (client fetch y server SQL)

[← temario](README.md) · referencia: `docs/030-Controllers/`

## API común

```ts
ctrl.pojo(content?)            ctrl.get(pojo)  ctrl.post(pojo)  ctrl.put(pojo)  ctrl.delete(pojo)
ctrl.list()                    ctrl.query(spec)                 ctrl.postList / putList / deleteList(pojos)
ctrl.call("endpoint", arg)     ctrl.stream("accion"|"endpoint", arg)   // SSE: AsyncIterable<string>
ctrl.getCfg() / ctrl.putCfg(parcial)   ctrl.doc()   ctrl.verify(accion, arg, ctx)
ctrl.permissions("accion", ctx?, { method })   ctrl.assertPermission("accion")   // puerta del registro
```

Todo recibe y devuelve POJOs (objetos planos se convierten). `post`/`postList` crean; `put` singular es parcial (`schema.put`: `insert` default, `insertIgnore`, `update`, `replace`); `null` = no encontrado.

## Verificación (`pre*`): truthy = error 400

Orden: reglas automáticas del schema → `preConfirm` (entidad, luego controller; corre en TODO) → `preX` de la entidad → `preX` del controller. En listas, además el pre singular por ítem (`[i] mensaje`).

```ts
hooks: {
  preConfirm(input, ctx) {                          // input discriminado por action
    if (!ctx.session) return "Sesión requerida";
    if (input.action === "post" && input.arg.nombre === "x") return "Nombre inválido";
  },
  prePost(p) { return p.precio! < 0 && "negativo"; },
}
actions: { async delete(p, ctx, next) { /* this = controller */ return next(p); } }   // override con next()
```

## Client

```ts
const productos = new ClientController(ProductoEntity, { baseUrl: "https://api.x/api", headers: () => ({ authorization: `Bearer ${token}` }) });
const caros = await productos.query({ where: { precio: { gt: 10 } } });   // los pre* corren ANTES del fetch
```

400 → `ValidationError`; otros → `HttpError(status)`; 404 en get/put/delete → `null`. `ctx.headers` por llamada, `ctx.signal` cancela, `ctx.session` = `registry.session`.

## Server

```ts
const productos = new ServerController(ProductoEntity, {
  db,                                              // table: default el plural de la entidad
  identifierCase: "lower", columnNames: { nombre: "nom_prod" },
  computed: { total: "{precio} * {stock}" },       // o { pg, sqlite, mysql, mssql } o función
  hidden: ["hash"], indexes: [{ columns: ["nombre"], unique: true }],
  endpoints: { ajustarStock: { async handler(p, ctx) { /* this = controller */ } } },
  paths: { resumen: { handler({ query, pks }, ctx) { /* path irregular de la entidad */ } } },
  sse: { post(p, send) { send("creando"); } },
  getPropagation: () => ({ lineas: true }), setPropagation: () => ({ lineas: true }),   // detalles que se leen/escriben con el padre
  security: { public: ["list"], actions: { delete: "productos.eliminar" } },
});
await db.seed();                                   // tablas, secuencias, índices, cfg
await productos.syncSchema({ migrate: (prev) => ({ ... }) });   // migraciones
```

Transacción compartida: `db.transaction(async (tx) => { await a.post(x, tx); await b.postList(ys, tx); })`.

## `/cfg` (configuración de la entidad)

Solo en el plural (`GET/PUT productos/cfg`), requiere `cfg: { zod }` en la entidad y tabla de cfg en la base (`sqliteDatabase(ruta, { cfg: { table, columns: { pk, json, fecha } } })`). El PUT es parcial (`Obj.update`: solo llaves del molde). Para permisos, GET y PUT son UNA acción: `CFG:/productos`.

## `/doc`

`GET productos/doc` → markdown autogenerado (rutas, columnas, relaciones, diagrama) + las fuentes `doc` del controller; `?v=1` → la vista HTML del kit. `GET {base}/doc` → el índice del API.
