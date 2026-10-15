---
Titulo: Propagación de detalles y multi-db
Estado: vigente
Autor:
tags: [controllers, propagacion, multidb]
---
# Propagación de detalles (`getPropagation` / `setPropagation`)

[← índice](../README.md) · `src/02 controllers/server/controller.ts` · tipos `WritePropagation` e `Include`

Las relaciones del schema (`kind: "one" | "many"`, `on`) definen la **cardinalidad**. El consumidor decide qué detalles se **leen** y cuáles se **escriben** junto al padre, que pueden ser distintos:

```ts
new ServerController(Pedido, {
  db, table: "pedidos",
  getPropagation: () => ({ lineas: { producto: true } }),  // get trae líneas y el producto de cada una
  setPropagation: () => ({ lineas: true }),                // post/put/delete escriben sólo las líneas
});
// o en una subclase: override getPropagation() / setPropagation()
```

| Acción | Con `setPropagation` |
|---|---|
| `get` | un solo SELECT con los detalles anidados como JSON (objeto 1:1, arreglo 1:N) según `getPropagation` (o `ctx.include`) |
| `post` | inserta el padre y después cada detalle, copiando la FK según `on`; recursivo con el anidamiento |
| `put` | actualiza el padre; por cada detalle **enviado** borra los actuales (en cascada) e inserta los nuevos. Una relación que no viene en el body no se toca, y `[]` la vacía |
| `delete` | borra los detalles (en cascada) y después el padre |
| `postList` / `putList` / `deleteList` | lo mismo por ítem, en una sola transacción |

- **Todo en una transacción:** si un detalle falla, no queda nada escrito.
- Cada detalle pasa por los `pre*` de su controller. El error se reporta con su ruta: `lineas[1]: La cantidad debe ser mayor a 0`.
- **Solo para relaciones de pertenencia** (detalles), nunca para catálogos: un `delete` de un pedido no debe borrar su categoría.
- **`seed()`** de un controller crea su tabla y, en cascada, las de los detalles que propaga (`getPropagation` ∪ `setPropagation`), sin ciclos. `seed({ propagate: false })` crea solo la propia. `db.seed()` y `router.seed()` crean todas.
- Utilidades públicas: `insertDeep`, `updateDeep`, `deleteDeep` y `detailRelations()`.

## Seed propagado

`seed()` reúne en un **set** todos los controllers alcanzables por `getPropagation` (anidado, con `"*"` expandido) ∪ `setPropagation` (anidado), `propagationControllers()`, y siembra cada uno **una vez** (cada uno sigue además su propia propagación). Así no queda un controller relacionado sin tabla:

```ts
await pedidos.seed();   // pedidos → pedido_lineas → productos → categorias (lo que alcance la propagación)
await db.seed();        // todos los de esa base + lo que propagan (aunque esté en otra base)
await router.seed();    // todos los del router (y plugins), con un set compartido
```

## Controllers en bases, motores y credenciales distintos

Cada `ServerController` tiene su `db` (motor + credenciales). Se relacionan **sólo por sus POJOs**: el registro de controllers es global (`findController(pojo)`), así una relación encuentra su detalle aunque viva en otra base.

| Operación | Misma base | Otra base (u otro motor) |
|---|---|---|
| `get` / `query` con include | un SQL con el detalle anidado como JSON | **join de aplicación**: consulta en lote al controller del detalle (`IN` sobre las llaves de `on`, con SU motor) y anexa los POJOs. Funciona a cualquier nivel del anidamiento (p.ej. SQLite → PG → SQLite) |
| filtro por relación (`where: { rel: {...} }`) | `EXISTS` en SQL | se consultan allá las llaves que cumplen y se traducen a un filtro local (`IN`) |
| escritura propagada | en la misma transacción | con la conexión del detalle: **no es atómica entre bases** |
| `seed` / `syncSchema` | — | cada controller crea/altera su tabla en SU base |

```ts
const lite = sqliteDatabase("app.db");
const pg = pgDatabase(pool);
new ServerController(Producto, { db: pg, table: "productos" });
new ServerController(Pedido, { db: lite, table: "pedidos", getPropagation: () => ({ lineas: { producto: true } }) });
```

Las columnas locales de `on` se agregan solas a la salida cuando una relación es de otra base (las necesita el join). Probado con SQLite + PostgreSQL mezclados en `tests/multidb.test.ts`.
