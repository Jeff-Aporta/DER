---
Titulo: "Contratos: el contrato homogéneo que sirve el servidor y consume el front"
Estado: vigente
Autor:
tags: [plugins, contratos, esquema, json-schema, version, iapp, cliente]
---
# Contratos (el contrato que el servidor sirve)

Los **contratos** son la respuesta del servidor a la pregunta «¿qué hay aquí y cómo se llama?». El servidor publica
**un solo contrato para todo el API** (`GET contratos`): las entidades montadas, su JSON Schema, sus rutas y una
**versión**. El front lo descarga, arma sus validadores con el mismo esquema y habla con cualquier entidad sin
saber nada del servidor: **entre apps sólo cambia el `iapp`**.

El contrato describe **lo que el servidor realmente publica**: una entidad con `exposed: false` no sale, una columna
`hidden` no sale del esquema y una ruta que no está registrada no sale.

## La convención REST (una sola, la de DER)

Las rutas las genera el controller de cada entidad, con su `singular` y su `plural`. No hay excepciones: lo que el
servidor publica es lo que dice el contrato.

| Acción | Método | Ruta | Qué hace |
|---|---|---|---|
| lista | `GET` | `{plural}` | las filas de la entidad (las de `listColumns`) |
| consulta | `GET` | `{plural}?q=<json base64url>` | la misma lista con filtros, orden y página |
| alta | `POST` | `{singular}` | **crea una** fila |
| alta en lote | `POST` | `{plural}` | crea **varias** (el cuerpo es un arreglo) |
| cambio | `PUT` | `{singular}/{pk}` | cambia una fila |
| cambio en lote | `PUT` | `{plural}` | cambia varias (el cuerpo es un arreglo) |
| baja | `DELETE` | `{singular}/{pk}` | borra una fila |
| baja en lote | `DELETE` | `{plural}` | borra varias (el cuerpo es un arreglo) |
| documentación | `GET` | `{plural}/doc` | la doc de la entidad (`?v=1` la vista HTML) |
| configuración | `GET`/`PUT` | `{plural}/cfg` | la configuración de la entidad (si el servidor la define) |

- `{pk}` son las pks de la entidad, en orden: con pks compuestas son varios segmentos (`{singular}/{pk1}/{pk2}`).
- `?q=` lleva la **consulta de DER** en base64url (`where`, `orderBy`, `page`, `pageSize`, `include`, `select`); sin
  `q` la ruta es la lista simple. El `q` de la lista del cliente (el texto que se busca) se convierte a ese `where`.
- **La cabecera `x-app` es obligatoria en las entidades que tienen `iapp`** (el `contrato` lo dice en `iapp`): es lo
  que aísla los datos de cada app. El cliente la manda siempre.

> Ojo con el `POST`: en DER el **alta de una** va al **singular** (`POST {singular}`) y el del plural crea **varias**
> (`POST {plural}`, cuerpo arreglo). El contrato lo dice tal cual (`rutas.post` = `"{singular}"`).

## La ruta del servidor

```ts
const contratos = createServer(contratosServer, { db });
const router = createRouter(ctrls, { basePath: "/api", plugins: [catalogo, pagos, contratos] });
await router.seed();
```

`GET /api/contratos` es **pública** (no pide sesión: es lo que el front necesita antes de tener usuario) y responde:

```json
{
  "version": "9f2c…",
  "generado": "2026-12-01T10:00:00.000Z",
  "entidades": [
    {
      "nombre": "catalogo.item",
      "singular": "catalogo_item",
      "plural": "catalogo_items",
      "pk": ["iapp", "iitem"],
      "iapp": true,
      "publica": { "list": true, "get": true },
      "esquema": { "type": "object", "properties": { "precio": { "anyOf": [{ "type": "integer" }, { "type": "null" }] } } },
      "rutas": {
        "list": "catalogo_items",
        "get": "catalogo_item/{iapp}/{iitem}",
        "post": "catalogo_item",
        "put": "catalogo_item/{iapp}/{iitem}",
        "delete": "catalogo_item/{iapp}/{iitem}"
      }
    }
  ],
  "rutasExtra": [{ "metodo": "GET", "path": "catalogo/items", "publica": true }]
}
```

| Campo | Qué es |
|---|---|
| `version` | sha256 del contenido (entidades + rutas): **cambia si cambia un esquema**; no cambia por la fecha |
| `generado` | cuándo se generó (ISO 8601) |
| `entidades` | las entidades montadas que el servidor publica, ordenadas por nombre |
| `entidades[].pk` | las pks (en orden: son los segmentos de la URL) |
| `entidades[].iapp` | si la entidad es de app (entonces la cabecera `x-app` es obligatoria) |
| `entidades[].publica` | si la lista y el detalle se sirven sin sesión |
| `entidades[].esquema` | el JSON Schema de la entidad (`z.toJSONSchema` de zod 4), sin las columnas ocultas |
| `entidades[].rutas` | las cinco rutas (las que el controller publica; `""` = esa ruta no existe) |
| `rutasExtra` | las rutas irregulares (las de los plugins), con su `entrada` y su `salida` cuando se conocen |

- El **filtro**: `GET /api/contratos?plugins=catalogo,pagos` acota el contrato a esos plugins (las entidades y las
  rutas de los demás no salen). Sin filtro, sale todo lo montado.
- La **versión** no depende de la fecha: el front puede cachear el contrato y sólo volver a descargarlo si cambia.

## El cliente

```ts
import { clienteContratos } from "@Jeff-Aporta/DER/src/03-plugins/contratos/index.ts";

const api = clienteContratos({ servidor: "https://api.ejemplo.com/api", iapp: "riogo24" });

const items = await api.listar("catalogo.item", { q: "limonada", pagina: 1, tamano: 20, orden: "-precio" });
const uno = await api.ver("catalogo.item", ["riogo24", "lim-001"]);
const creado = await api.crear("catalogo.item", { nombre: "Limonada", precio: 12000 });
await api.editar("catalogo.item", ["riogo24", "lim-001"], { precio: 13000 });
await api.borrar("catalogo.item", ["riogo24", "lim-001"]);
const catalogo = await api.llamar("catalogo/items", undefined, { params: { categoria: "bebidas" } });
```

- `servidor`: la URL del API **con su `basePath`** (`https://api.ejemplo.com/api`). Las rutas del contrato van detrás.
- `iapp`: la cabecera `x-app`: **viaja en todas las peticiones** (contrato, listas, altas y rutas irregulares).
- `fetch`: para pruebas (o para meter un `Authorization`).
- `listar(entidad, opciones)`: `q` (texto: busca en las columnas de texto de la entidad), `pagina`, `tamano`, `orden`
  (`"campo"` o `"-campo"`), `filtros` (por campo), `incluir` (relaciones) y `campos` (selección). Con opciones, la
  consulta viaja en el `q` de DER.
- `ver`, `crear`, `editar` y `borrar`: usan las rutas del contrato (nunca una ruta inventada). El `id` son las pks: una
  sola (texto) o varias (arreglo, o texto con `/`).
- `llamar(ruta, cuerpo?, opciones?)`: una ruta irregular del contrato. El método sale del contrato (o de
  `opciones.metodo`) y los `{param}` se rellenan con `opciones.params`.
- **El cliente valida**: cada respuesta se contrasta con el JSON Schema del contrato (`z.fromJSONSchema`). Si el
  servidor devuelve algo que no cumple, el cliente **falla** en vez de dejar pasar el dato roto.
- **El caché**: el contrato se guarda en memoria y en el `localStorage` (si existe) con su versión. Si el servidor no
  responde, el cliente sirve la copia cacheada. `recargar()` fuerza la descarga.

## Errores comunes

- **"El contrato no tiene la entidad «x»"**: el nombre no está en el contrato (se busca por `nombre`, por `singular` o
  por `plural`).
- **"El servidor no publica POST para «x»"**: la entidad es de sólo lectura (`administrable: false`): su `rutas.post`
  viene vacía.
- **"La respuesta de … no cumple el contrato"**: el servidor devolvió algo que no cuadra con su propio esquema.
- **"[GET …] 401"**: la ruta pide sesión (el contrato dice si es pública o no).

## Pruebas

`tests/plugins/contratos.test.ts`: el contrato lista las entidades montadas con su esquema y sus rutas, no expone los
campos ocultos ni las entidades no publicadas, la versión cambia si cambia un esquema, el filtro `?plugins=` acota el
contrato, el cliente rechaza una respuesta que no cumple, manda siempre `x-app` y hace el CRUD por las rutas del
contrato.
