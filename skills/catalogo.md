# Skill: catálogo (por app)

[← temario](README.md) · referencia: `docs/050-Plugins/200-Catalogo.md`

## Que es

El **catálogo** de cada **app** (`iapp`): sus categorías, sus productos y servicios y la disponibilidad de los
servicios. Aislado por app: el catálogo de un restaurante y el de una tienda no se mezclan, y el clon de una app se
purga entero (ver [apps](apps.md)).

La **lectura es pública** (solo `GET`, sin sesión): es lo que necesita el front de la app. La **escritura** exige
sesión y el permiso `catalogo.editar`.

## Montar

```ts
const catalogo = crearCatalogo({ db, cfg: { appPorDefecto: "riogo24" } });   // o createServer(catalogoServer, { db, cfg: {} })
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

## Tablas

| tabla | columnas |
|---|---|
| `catalogo_categorias` | `iapp` + `icategoria` (pk), `nombre`, `orden`, `bactivo`, `fhcre`, `fhmod` |
| `catalogo_items` | `iapp` + `iitem` (pk), `icategoria`, `tipo` (`producto`\|`servicio`), `codigo`, `nombre`, `descripcion`, `precio`, `moneda`, `imagen`, `imagen_mini`, `bactivo`, `bdestacado`, `duracion_min`, `jextras` (json), `fhcre`, `fhmod` |
| `catalogo_disponibilidad` | `iapp` + `iitem` + `dia_semana` + `desde` (pk), `hasta`, `cupos`, `fhcre` |

- `precio`: **entero en pesos (COP)**, sin centavos. `duracion_min`: los minutos del servicio. `jextras`: json libre
  (adicionales, variantes). `dia_semana`: `1` = lunes … `7` = domingo.

## Rutas

| Ruta | Que hace |
|---|---|
| `GET catalogo/categorias` | las categorías activas de la app (publica) |
| `GET catalogo/items?categoria=&q=&pagina=&porPagina=` | la página de items activos (`{ items, total, pagina, porPagina }`, publica) |
| `GET catalogo/item/{iitem}` | un item activo (publica) |
| `GET catalogo/disponibilidad?iitem=&fecha=` | las franjas de un servicio (las del día de `fecha`, o todas; publica) |
| `POST catalogo/categorias` | crea una categoría (permiso `catalogo.editar`) |
| `PUT catalogo/categorias/{icategoria}` | cambia nombre, orden o estado |
| `DELETE catalogo/categorias/{icategoria}` | baja lógica |
| `POST catalogo/items` | crea un producto o un servicio |
| `PUT catalogo/items/{iitem}` | cambia un item (el `codigo` no cambia) |
| `DELETE catalogo/items/{iitem}` | baja lógica |
| `POST catalogo/disponibilidad` | deja (o cambia) una franja de un servicio |
| `DELETE catalogo/disponibilidad/{iitem}` | quita todas las franjas de un servicio |
| `POST catalogo/importar` | importa el catálogo de la app (idempotente por código) |

`q` busca en nombre, descripción y código. `pagina` es 1-based; `porPagina` (20 por defecto, 100 el tope). `fecha` es
`YYYY-MM-DD` (el día de la semana se calcula en UTC).

## El ambito (`iapp`)

La app de la peticion sale de la cabecera `X-App` (o del claim `iapp` de la sesion); sin ninguna, la respuesta es **400**
("Falta el ambito de la app: usa la cabecera X-APP"), nunca un listado entero. `cfg.appPorDefecto` pone la app de una
instalacion de un solo clon; `cfg.cabecera` cambia el nombre de la cabecera (`x-app` por defecto).

Un item de otra app es **404**. El ambito es local de este plugin: el orquestador lo une con el `ambitoApp` del plugin
`apps`.

## La importacion (idempotente por codigo)

```ts
import { importarCatalogo } from "@Jeff-Aporta/DER/src/03-plugins/catalogo/server.ts";

const r = await importarCatalogo(catalogo, "riogo24", {
  categorias: [{ codigo: "bebidas", nombre: "Bebidas", orden: 1 }],
  items: [{ codigo: "lim-001", categoria: "bebidas", tipo: "producto", nombre: "Limonada", precio: 12000 }],
  disponibilidad: [{ codigo: "corte-001", dia_semana: 1, desde: "09:00", hasta: "12:00", cupos: 3 }],
});
// { categorias: { creadas, actualizadas }, items: { creados, actualizados }, disponibilidad: { creadas, actualizadas } }
```

- La categoria se busca por su `codigo` (que es su `icategoria`) y el item por su `codigo`: importar dos veces lo mismo
  **no** duplica, la segunda vez actualiza.
- Lo que **no** viene en la importacion se conserva.
- La categoria de un item y la disponibilidad de un servicio se referencian por **codigo** (el `iitem` lo genera el
  servidor). La disponibilidad solo aplica a servicios.

## Permisos

`catalogo.editar` protege toda la escritura (categorias, items, disponibilidad e importacion). La puerta la trae el
plugin `permissions` (matriz rol x accion en la base).

## Errores comunes

- **400** "Falta el ambito de la app: usa la cabecera X-APP": la peticion no trae `X-App` ni claim `iapp`.
- **400** "Solo un servicio tiene disponibilidad": la franja se pidio para un producto.
- **400** "La categoria «x» no existe": el item apunta a una categoria que no esta dada de alta.
- **404** "Ese item no existe": el item no esta en esa app (o esta inactivo).
- **409** "Ya existe el item con el codigo «x»": el codigo es unico por app.
