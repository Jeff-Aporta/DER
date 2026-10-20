---
Titulo: Obj y acciones JSON
Estado: vigente
Autor:
tags: [objetos, obj, json]
---
# `Obj` y acciones JSON de los POJOs

[← índice](../README.md) · `src/00 common/obj.ts` importa `Obj` de `Jeff-Aporta/is-webcomponents` **por URL** (siempre la versión vigente; `deno task sync` la refresca) · contratos en `src/00 common/schemas.ts` § obj

`Obj` reúne las operaciones **virtuales**: transforman JSON **en memoria**, sin leer archivos ni la red. Las **físicas** (`RefObj`: referencias `{ path, query, actions }` que leen otros JSON) viven en iswc y DER no las usa.

## Nomenclatura

| Acción | Qué hace |
|---|---|
| `insert(base, cambios, molde?)` | upsert profundo: lo no mencionado se conserva; `null` quita según el molde |
| `insertIgnore(base, nuevos)` | agrega solo lo que **no** existe y nunca pisa |
| `update(base, cambios)` | cambia solo lo que **ya** existe y no crea |
| `delete(base, query)` | quita lo marcado por la consulta |
| `get(base, query)` | la estructura desde la raíz con solo lo marcado |
| `getValue(base, query)` | el valor exacto de la única hoja marcada (`null` si no existe) |
| `replace(base, valor)` | reemplazo directo; es lo que aplica sin molde Zod |
| `aplicar(base, acciones)` | aplica en orden una lista `TAccionObj[]` (`{ op, valor \| query }`) |

**Consulta** (`TConsulta`): copia la forma del dato y marca con truthy lo pedido. `"*"` = todos y `"[campo=valor]"` = el primer elemento con ese campo. Nada muta: cada operación devuelve un objeto nuevo.

## Acciones en los POJOs: tipadas y siempre dentro del molde

```ts
const p = await productos.get({ iproducto: 1 });
p.insert({ precio: 2.5, jconfig: { ui: { orden: 3 } } });   // Patch<Producto>: tipado
p.insertIgnore({ stock: 0 });                                // solo si stock no está definido
p.update({ nombre: "X" });                                  // solo si nombre ya está definido
p.delete({ meta: true });                                   // deja meta sin definir
p.get({ nombre: true, precio: true });                      // → { nombre, precio }
p.replace({ iproducto: 1, nombre: "Nuevo" });              // reemplaza todo el contenido
```

Reglas:

1. **Con molde Zod** (columnas tipadas, relaciones y `json` con `zod`), las acciones son parciales y profundas. El resultado se castea y se valida con `zod.row`. Si queda fuera del molde se lanza `ValidationError` y el POJO **no cambia**.
2. **Sin molde** (columna `json` sin `zod`, el "toJSON sin Zod"), la acción hace **replace directo** de esa columna: `insert` reemplaza; `insertIgnore` solo asigna si no existía; `update` solo si existía.
3. `null` en `insert`: en una columna nullable deja `null`; en una no nula la quita (queda sin definir); en un `json` con molde aplica la semántica del molde (opcional → se borra, default → el default…).
4. Entidad: `ProductoEntity.patch(pojo, cambios)` devuelve una copia con el `insert` aplicado (el original no cambia) y `ProductoEntity.aplicar(pojo, acciones)` aplica una lista `TAccionObj[]` y valida.

El PUT singular aplica por defecto esta misma semántica de `insert` sobre el registro (`schema.put` elige otra), y `plural/cfg` ajusta la configuración de la entidad con `update` ([sse-y-cfg.md](../030-Controllers/030-SSE-y-cfg.md)).
