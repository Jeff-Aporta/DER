# Skill: contratos (el contrato homogéneo que sirve el servidor)

[← temario](README.md) · referencia: `docs/050-Plugins/220-Contratos.md` · los datos: [catalogo.md](catalogo.md), [apps.md](apps.md)

## Qué es

El **contrato** es el JSON que el servidor publica en `GET contratos` y que cualquier front descarga: las entidades
montadas (con su **JSON Schema**, sus pks, su `iapp` y sus rutas) y las rutas irregulares, con una **versión** (sha256
del contenido). Entre apps sólo cambia el `iapp`.

```ts
// server: monta el plugin y su ruta publica
const contratos = createServer(contratosServer, { db });
const router = createRouter(ctrls, { basePath: "/api", plugins: [catalogo, pagos, contratos] });

// cliente: descarga el contrato y habla con cualquier entidad
const api = clienteContratos({ servidor: "https://api.ejemplo.com/api", iapp: "riogo24" });
const items = await api.listar("catalogo.item", { q: "limonada", pagina: 1, tamano: 20 });
const uno = await api.ver("catalogo.item", ["riogo24", "lim-001"]);
```

## La convención REST (una sola)

Las rutas las genera el controller de la entidad (su `singular` y su `plural`): el contrato las publica, no las inventa.

| Acción | Método | Ruta |
|---|---|---|
| lista | `GET` | `{plural}` |
| consulta (filtros, orden, página) | `GET` | `{plural}?q=<json base64url>` |
| alta de una | `POST` | `{singular}` |
| alta de varias | `POST` | `{plural}` (cuerpo: arreglo) |
| cambio | `PUT` | `{singular}/{pk}` |
| cambio de varias | `PUT` | `{plural}` (cuerpo: arreglo) |
| baja | `DELETE` | `{singular}/{pk}` |
| baja de varias | `DELETE` | `{plural}` (cuerpo: arreglo) |
| doc / config | `GET` | `{plural}/doc`, `{plural}/cfg` |

- El `POST` de una fila va al **singular**; el del plural crea varias.
- `{pk}` son las pks en orden (con pks compuestas, varios segmentos).
- La cabecera **`x-app` es obligatoria** en las entidades que tienen `iapp` (el contrato lo dice en `iapp`).

## Qué sirve el contrato

| Campo | Qué es |
|---|---|
| `version` | sha256 del contenido: cambia si cambia un esquema (no cambia por la fecha) |
| `generado` | cuándo se generó (ISO 8601) |
| `entidades[]` | `nombre`, `singular`, `plural`, `pk`, `iapp`, `publica`, `esquema`, `rutas` |
| `rutasExtra[]` | las rutas irregulares: `metodo`, `path`, `publica`, `entrada?`, `salida?` |

- **Sólo sale lo que el servidor publica**: una entidad `exposed: false` no sale; una columna `hidden` no sale del
  esquema; una ruta no registrada no sale.
- `?plugins=catalogo,pagos` acota el contrato a esos plugins.
- El **cliente valida** cada respuesta con el esquema del contrato (`z.fromJSONSchema`): si no cuadra, falla.
- El cliente **cachea por versión**: en memoria y en el `localStorage` (si existe); `recargar()` fuerza la descarga.

## Montar

```ts
// cliente (el `servidor` incluye el basePath del API)
const api = clienteContratos({ servidor: "https://api.ejemplo.com/api", iapp: "riogo24", fetch });

// las rutas del contrato, tal cual
api.listar("catalogo.item", { q: "limonada", pagina: 1, tamano: 20, orden: "-precio", filtros: { bactivo: true } });
api.ver("catalogo.item", ["riogo24", "lim-001"]);
api.crear("catalogo.item", { nombre: "Limonada", precio: 12000 });
api.editar("catalogo.item", ["riogo24", "lim-001"], { precio: 13000 });
api.borrar("catalogo.item", ["riogo24", "lim-001"]);
api.llamar("catalogo/items", undefined, { params: { categoria: "bebidas" } });
```

- `listar` con opciones viaja en el `q` de DER (`where`, `orderBy`, `page`, `pageSize`); el `q` de texto se busca en las
  columnas de texto de la entidad.
- `llamar` es para las rutas irregulares: el método sale del contrato y los `{param}` se rellenan con `params`.
