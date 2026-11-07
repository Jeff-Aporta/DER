---
Titulo: Mensajes: el hilo que cualquier entidad puede tener
Estado: vigente
Autor:
tags: [plugins, mensajes, comentarios, chat, hilo]
---
# Mensajes

El sistema de conversación transversal: comentarios, mensajes privados, reseñas o el detalle de un tiquete usan el mismo
DER. Solo cambian el componente y las reglas del controlador; el modelo es uno.

## Entidad `mensajes` (tabla `mensajes_mensajes`)

| Columna | Tipo | Qué es |
|---|---|---|
| `tdespacio` | string 60 (pk) | el tipo de contexto (`tks`, `privado`, `video`…) |
| `iref` | string 120 (pk) | el id de la entidad comentada |
| `imensaje` | string 300 (pk) | el índice en el hilo: `0`, `1`, `10.0`, `10.0.1`… |
| `jcontenido` | json | el historial de versiones: `[{ contenido, fhcre, adjuntos }]` (la última es la vigente) |
| `indexcita` | string 300 | el índice del mensaje citado |
| `bactivo` | bool | baja lógica |
| `iusuario` | string 120 | quién lo escribió |
| `qtotalrespuestas` | virtual | cuántas respuestas anidadas tiene |

## Entidad `adjuntos` (tabla `mensajes_adjuntos`)

`iadjunto` (uuid, pk), `nombre`, `mime`, `bytes`, `clave` (la clave en el almacén del consumidor, R2), `url`, `fhcre`,
`iusuario` y `jmeta`. Los bytes los mueve el almacén que vincula la API: el plugin solo guarda la ficha.

## El índice del hilo

- El primer nivel se numera `0`, `1`, `2`… en el orden de publicación.
- La respuesta a `10` es `10.0`, `10.1`…; la respuesta a `10.0` es `10.0.0`.
- No hay límite de niveles: el controlador decide hasta dónde se anida.
- `indexcita` guarda el índice del mensaje citado, así se sabe a qué responde sin recorrer el árbol.
- Editar agrega una versión al historial: lo anterior nunca se pierde y siempre se puede recuperar.

## Rutas

| Ruta | Seguridad | Qué hace |
|---|---|---|
| `POST mensajes/publicar` | sesión | publica y calcula el índice siguiente del hilo |
| `PUT mensaje/{tdespacio}/{iref}/{imensaje}/editar` | sesión | agrega una versión (lo anterior no se pierde) |
| `GET mensajes/hilo?tdespacio=&iref=` | sesión | el hilo en árbol: primer nivel y respuestas anidadas |
| CRUD `mensajes` | sesión | completo (quien llama pone el `imensaje`) |
| CRUD `adjuntos` | sesión | fichas de los adjuntos |
| `POST adjuntos/registrar` | sesión | registra un adjunto ya subido al almacén |

## Montar

```ts
const mensajes = createServer(mensajesServer, { db, cfg: {} });
const router = createRouter(ctrls, { basePath: "/api", plugins: [mensajes] });
await router.seed();
```
