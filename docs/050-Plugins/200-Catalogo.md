---
Titulo: "Catálogo: los productos y servicios de cada app (iapp)"
Estado: vigente
Autor:
tags: [plugins, catalogo, iapp, productos, servicios, disponibilidad, precios]
---
# Catálogo (por app)

El **catálogo** es lo que la app ofrece: sus **categorías**, sus **productos** y **servicios** y la **disponibilidad** de
los servicios. Vive en el ámbito de la **app** (`iapp`): el catálogo de un restaurante y el de una tienda son tablas
distintas, aisladas por `iapp`, y el clon de una app se purga entero (ver [apps](190-Apps.md)).

La **lectura es pública** (solo `GET`, sin sesión): es lo que necesita el front de la app, que no tiene sesión. La
**escritura** exige sesión y el permiso `catalogo.editar`.

## Tablas

| Tabla | Columnas |
|---|---|
| `catalogo_categorias` | `iapp` + `icategoria` (pk), `nombre`, `orden`, `bactivo`, `fhcre`, `fhmod` |
| `catalogo_items` | `iapp` + `iitem` (pk), `icategoria`, `tipo`, `codigo`, `nombre`, `descripcion`, `precio`, `moneda`, `imagen`, `imagen_mini`, `bactivo`, `bdestacado`, `duracion_min`, `jextras` (json), `fhcre`, `fhmod` |
| `catalogo_disponibilidad` | `iapp` + `iitem` + `dia_semana` + `desde` (pk), `hasta`, `cupos`, `fhcre` |

- `iapp`: la app a la que pertenece la fila. **Toda** lectura y **toda** escritura filtran por él.
- `icategoria`: el código de la categoría (`bebidas`). En la importación es la llave de la categoría.
- `iitem`: el id del item (lo genera el servidor). `codigo` es el código de negocio (`lim-001`) y la llave **idempotente**
  de la importación.
- `tipo`: `producto` (lo que se compra) o `servicio` (lo que se agenda).
- `precio`: **entero en pesos (COP)**, sin centavos. `moneda` (`COP` por defecto) acompaña la cifra.
- `duracion_min`: los minutos del servicio (null en un producto).
- `jextras`: json libre con lo que el item necesite (adicionales, variantes, notas).
- `bdestacado`: lo que el front pone arriba.
- `dia_semana`: `1` = lunes … `7` = domingo. `desde`/`hasta` son `HH:MM` y `cupos` es cuántos caben en esa franja.

## Rutas

| Ruta | Seguridad | Que hace |
|---|---|---|
| `GET catalogo/categorias` | publica | las categorías activas de la app (`orden`, luego nombre) |
| `GET catalogo/items?categoria=&q=&pagina=&porPagina=` | publica | la página de items activos (`{ items, total, pagina, porPagina }`) |
| `GET catalogo/item/{iitem}` | publica | un item activo (404 si no existe o está inactivo) |
| `GET catalogo/disponibilidad?iitem=&fecha=` | publica | las franjas de un servicio (las del día de `fecha`, o todas) |
| `POST catalogo/categorias` | `catalogo.editar` | crea una categoría |
| `PUT catalogo/categorias/{icategoria}` | `catalogo.editar` | cambia nombre, orden o estado |
| `DELETE catalogo/categorias/{icategoria}` | `catalogo.editar` | baja lógica (la fila se conserva) |
| `POST catalogo/items` | `catalogo.editar` | crea un producto o un servicio |
| `PUT catalogo/items/{iitem}` | `catalogo.editar` | cambia un item (el `codigo` no cambia) |
| `DELETE catalogo/items/{iitem}` | `catalogo.editar` | baja lógica del item |
| `POST catalogo/disponibilidad` | `catalogo.editar` | deja (o cambia) una franja de un servicio |
| `DELETE catalogo/disponibilidad/{iitem}` | `catalogo.editar` | quita todas las franjas de un servicio |
| `POST catalogo/importar` | `catalogo.editar` | importa el catálogo de la app (idempotente por código) |

- `q` busca en nombre, descripción y código. `pagina` es 1-based; `porPagina` (20 por defecto, 100 el tope).
- `fecha` es `YYYY-MM-DD`: el día de la semana se calcula en UTC (el día no se corre por zona horaria).
- La disponibilidad es **solo de los servicios**: un producto da 400 ("Solo un servicio tiene disponibilidad").

## El ámbito (`iapp`)

La app de la petición sale de la cabecera `X-App` (o del claim `iapp` de la sesión); sin ninguna, la respuesta es **400**
("Falta el ambito de la app: usa la cabecera X-APP"), nunca un listado entero. `cfg.appPorDefecto` pone la app de una
instalación de un solo clon y `cfg.cabecera` cambia el nombre de la cabecera (`x-app` por defecto).

Un item de otra app es **404** (nunca se distingue de que no exista). El ámbito es local de este plugin; el orquestador
lo une con el `ambitoApp` del plugin `apps`.

## La importación (idempotente por código)

```ts
import { importarCatalogo } from "@Jeff-Aporta/DER/src/03-plugins/catalogo/server.ts";

const r = await importarCatalogo(catalogo, "riogo24", {
  categorias: [{ codigo: "bebidas", nombre: "Bebidas", orden: 1 }],
  items: [{ codigo: "lim-001", categoria: "bebidas", tipo: "producto", nombre: "Limonada", precio: 12000 }],
  disponibilidad: [{ codigo: "corte-001", dia_semana: 1, desde: "09:00", hasta: "12:00", cupos: 3 }],
});
// { categorias: { creadas: 1, actualizadas: 0 }, items: { creados: 1, actualizados: 0 }, disponibilidad: { creadas: 1, actualizadas: 0 } }
```

- **Idempotente por código**: la categoría se busca por su `codigo` (que es su `icategoria`) y el item por su `codigo`.
  Importar dos veces lo mismo **no** duplica: la segunda vez actualiza.
- Lo que **no** viene en la importación se conserva (si no, la app perdería datos al reimportar).
- La categoría de un item se referencia por su código: si no existe, la importación da 400.
- La disponibilidad se referencia por el **código** del item (su `iitem` lo genera el servidor) y solo aplica a servicios.
- Es la vía para sembrar un clon (los 171 productos de Rio Go 24, por ejemplo).

## Montar

```ts
const catalogo = crearCatalogo({ db, cfg: { appPorDefecto: "riogo24" } });
const router = createRouter(ctrls, { basePath: "/api", plugins: [catalogo] });
await router.seed();
```

Cliente:

```ts
const cat = createClient(catalogoPlugin, { baseUrl: "/api", headers: { "x-app": "riogo24" } });
const categorias = await cat.categorias();
const { items, total } = await cat.items({ categoria: "bebidas", q: "limonada", pagina: 1 });
const servicio = await cat.item("srv-corte");
const franjas = await cat.disponibilidad(servicio.iitem, "2026-12-07");
```

## Permisos

| Acción | Qué protege |
|---|---|
| `catalogo.editar` | toda la escritura (categorías, items, disponibilidad e importación) |

La puerta la trae el plugin `permissions` (matriz rol × acción en la base). Sin ese plugin, las rutas de escritura
exigirán sesión y listo; las de lectura son públicas de todos modos. Con el plugin RBAC `permisos`, la acción
`catalogo.editar` tiene que estar en su catálogo de acciones (igual que `apps.administrar` para el plugin `apps`).

## Errores comunes

- **400** "Falta el ambito de la app: usa la cabecera X-APP": la petición no trae `X-App` ni claim `iapp`.
- **400** "Solo un servicio tiene disponibilidad": la franja se pidió para un producto.
- **400** "La categoría «x» no existe": el item apunta a una categoría que no está dada de alta.
- **400** "La hora «hasta» debe ser posterior a «desde»": la franja está al revés.
- **404** "Ese item no existe": el item no está en esa app (o está inactivo).
- **409** "Ya existe el item con el código «x»": el código es único por app.

## Pruebas

`tests/plugins/catalogo.test.ts` (caja negra sobre el router real): filtro por `iapp` (una app no ve el catálogo de
otra), lectura pública (solo `GET`) frente a escritura con `catalogo.editar` (401 sin sesión, 403 sin permiso),
importación idempotente por código y disponibilidad de un servicio por día de la semana.
