# Skill: objetos (schemas, POJOs, registro, secuencias, query)

[← temario](README.md) · referencia: `docs/020-Objetos/`

## Definir una entidad (lo único que comparten client y server)

```ts
const ProductoSchema = defineSchema({
  columns: {
    iproducto: { type: "int", pk: true, autoincrement: true },
    nombre: { type: "string", length: 100, nullable: false },
    precio: { type: "decimal", nullable: false },
    tipo: { type: "string", enum: ["fisico", "digital"], default: "fisico" },
    codigo: { type: "string", pk: false, sequence: { base: 36 } },       // "1".."z","10"… quemado en base 36
    jconfig: { type: "json", zod: ZProductoCfg },                        // json con molde: push parcial
    total: { type: "float", virtual: true },                             // la calcula el server (computed)
  },
  relations: { categoria: { kind: "one", target: "categoria", on: { icategoria: "icategoria" } } },
});
export const ProductoEntity = defineEntity({
  schema: ProductoSchema,            // o `pojo: Producto` si quieres una clase propia
  singular: "producto", plural: "productos",   // tabla por defecto: "productos"
  listColumns: ["iproducto", "nombre"], getInclude: { categoria: true },
  hooks: { prePost: (p) => p.precio! < 0 && "El precio no puede ser negativo" },
  endpoints: { ajustarStock: { method: "POST", scope: "one", returns: "pojo" } },
  paths: { resumen: { method: "GET", path: "resumen" } },               // irregular de la entidad: productos/resumen
  security: { public: ["list", "get", "doc"] },
  exposed: true, administrable: true,                                   // false = sin API / solo lectura
});
```

- Tipos: `string text int bigint float decimal bool date datetime time json uuid`. Pks compuestas: varias `pk: true` (o `primaryKey`).
- Secuencias: `sequence: true | { name, start, increment, scope, pattern, base (2..36), as }`. Base > 10 exige columna de texto. Con `scope` es un consecutivo por grupo.
- Nunca dos entidades con el mismo plural ni el mismo `name` (error al definir).

## POJOs: siempre indirectos

```ts
const p = productos.pojo({ nombre: "Café", precio: "3.5" });   // castea: precio → 3.5
registry.pojo("productos", { iproducto: 1 });                   // desde cualquier lado, por el plural
p.insert({ jconfig: { ui: { color: "rojo" } } });               // push parcial validado por el molde
p.toJSON(); p.pkValues(); p.pkOnly();
```

## Registro global

```ts
registry.entity("productos")      // Entity (lanza si no existe)
registry.entities()               // [{ key, entity }]
registry.secure({ extract, protected, permissions })   // puertas (ver plugins.md)
registry.session                  // sesión singleton (la deja el login del cliente)
```

## Query

```ts
await productos.query({
  select: ["iproducto", "nombre"],
  where: { precio: { gte: 10 }, nombre: { contains: "cafe" }, categoria: { nombre: "Bebidas" }, $or: [{ stock: 0 }, { tipo: "digital" }] },
  orderBy: ["-precio", "nombre"], page: 1, pageSize: 20,
  include: { categoria: true },
});
```

Operadores: `eq ne gt gte lt lte in nin between like ilike contains startsWith endsWith isNull`; `null` = IS NULL; arreglo = IN; relación = EXISTS; `$and $or $not`.

## Zod generado

`zodOf(Producto)` o `entity.zod` → `row`, `insert`, `update`, `pk`, `molde`: úsalos en formularios y validaciones del front.

## Diagramas para is-webcomponents

`erDiagramPayload(entities)` / `classDiagramPayload(entities)` devuelven exactamente el `ErSpec` / `ClassSpec` del kit (tipos por CDN): se incrustan tal cual en `<iswc-er-diagram>` / `<iswc-class-diagram>`.
