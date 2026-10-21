---
Titulo: Schemas, POJOs y Zod
Estado: vigente
Autor:
tags: [objetos, pojo, zod]
---
# Schemas, POJOs y Zod

[← índice](../README.md) · tipos en `src/00-common/schemas.ts` · lógica en `src/01-objects/{meta,pojo,zod}.ts`

## Schema JSON

```ts
export const ProductoSchema = defineSchema({
  columns: {
    iproducto: { type: "int", pk: true, autoincrement: true },
    nombre:    { type: "string", length: 100, nullable: false },
    precio:    { type: "decimal", precision: 12, scale: 2, nullable: false },
    tipo:      { type: "string", enum: ["fisico", "digital"], default: "fisico" },
    creado:    { type: "datetime", default: { sql: "CURRENT_TIMESTAMP" } },
    jconfig:   { type: "json", zod: ZProductoCfg },   // json con molde Zod
    meta:      { type: "json" },                     // json libre
    total:     { type: "float", virtual: true },     // la calcula el server
  },
  relations: {
    categoria: { kind: "one",  target: "categoria", on: { icategoria: "icategoria" } },
    lineas:    { kind: "many", target: "pedido/linea", on: { iproducto: "iproducto" } },
  },
  primaryKey: ["iproducto"], // opcional: orden explícito; si no, las columnas con pk:true en orden
  put: "insert",             // opcional: cómo aplica el PUT singular el cuerpo (insert | insertIgnore | update | replace)
});
```

`put` elige la operación con la que el `PUT singular/pks...` aplica el cuerpo sobre el registro actual; por defecto
`insert` (ajustes parciales, fusión profunda en los json con molde). Ver [modo del PUT](../030-Controllers/030-SSE-y-cfg.md).

`defineSchema` es la identidad tipada: conserva los literales para inferir los tipos TS de cada campo.

### Columnas (`ColumnDef`)

| type | TS | PG | SQLite | casteo del setter |
|---|---|---|---|---|
| `string` | string | `varchar(n)` / `text` | text | `toStr` |
| `text`, `uuid` | string | text / uuid | text | `toStr` |
| `int`, `bigint` | number | integer / bigint | integer | `toInt` (trunca) |
| `float`, `decimal` | number | double / numeric(p,s) | real / numeric | `toFloat` |
| `bool` | boolean | boolean | integer 0/1 | `toBool` (`1`, `"true"`, `"si"`…) |
| `date` | `"YYYY-MM-DD"` | date (se lee `::text`) | text | `toDate` |
| `datetime` | `Date` | timestamptz | text ISO | `toDateTime` |
| `time` | `"HH:MM:SS"` | time | text | `toTime` |
| `json` | inferido de `zod` o `any` | jsonb | text | identidad |

Opciones: `pk`, `autoincrement` (solo pk entera; en SQLite exige pk única), `sequence` (ver [secuencias](../040-Servidor/010-Motores-seed-y-sync.md)), `nullable` (default `true`, salvo las pk), `length`, `precision`/`scale`, `unique`, `default` (literal o `{ sql }`), `enum`, `virtual`, `zod` (refina el tipo; en `json` es su molde).

### Relaciones (`RelationDef`)

- `kind: "one"` → objeto o `null`; `kind: "many"` → arreglo.
- `target`: nombre de la entidad destino (JSON puro, se resuelve en diferido, porque `defineEntity` registra su POJO con `name ?? singular`) o un thunk anotado `(): PojoClass => TX`.
- `on`: `{ columnaLocal: columnaDelDetalle }`. El controller arma la correlación SQL.

## POJOs

```ts
export class Producto extends pojoOf(ProductoSchema) {
  declare categoria: Categoria | null;     // relaciones: solo el tipo (`declare`, nunca un campo de clase)
  get etiqueta() { return `${this.nombre} ($${this.precio})`; }  // getters propios: no se serializan
}
```

- `pojoOf(schema)` genera un getter/setter casteado por columna y relación. Los datos viven en `this.f`.
- También se puede escribir a mano (`class X extends Pojo { static override schema = S; get/set ... }`), con los casteos de `base.ts` (`toStr`, `toInt`, `toBool`…).
- `undefined` significa "no definido": `toJSON()` lo omite y un PUT no lo toca. `null` es un valor.
- API: `fromJSON`, `fromList`, `assign`, `toJSON`, `pkValues`, `pkOnly`, más las acciones JSON ([obj.md](020-Obj-y-acciones-JSON.md)): `insert`, `insertIgnore`, `update`, `delete`, `get`, `replace`.
- Nombres reservados (no pueden ser columnas): `f`, `assign`, `toJSON`, `pkValues`, `pkOnly`, `insert`, `insertIgnore`, `update`, `delete`, `get`, `replace`.

## Zod generado

`zodOf(Producto)` o `ProductoEntity.zod` devuelven:

| schema | uso |
|---|---|
| `row` | lectura, formularios y validación del resultado de las acciones parciales (todo opcional) |
| `insert` | POST: requeridos = no nullable, sin default y no autoincrement |
| `update` | PUT: pk requeridas, el resto opcional |
| `pk` | GET y DELETE |
| `molde` | molde de `Obj.insert`: `null` → null si la columna admite null; si no, se quita |

Los mensajes de error salen en español (`Falta el campo requerido "x"`, `"x" no puede ser nulo`, `"x" debe ser uno de: …`, `"x" supera N caracteres`). `ZQuerySpec`, `ZInclude`, `ZConsulta`, `ZJson`, `ZAccionObj` y `ZRefObj` están en `src/00-common/schemas.ts`. `z` se reexporta para que la app use la misma instancia.
