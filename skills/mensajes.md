# Skill: mensajes

[← temario](README.md) · referencia: `docs/050-Plugins/080-Mensajes.md`

## Qué es

El sistema de conversación transversal: cualquier entidad puede ser comentada, mensajada o reseñada con el mismo DER.
Solo cambian el componente y las reglas del controlador. El hilo se apoya en un espacio (`tdespacio`) y una referencia
(`iref`).

## Montar

```ts
const mensajes = createServer(mensajesServer, { db, cfg: {} });
const router = createRouter(ctrls, { basePath: "/api", plugins: [mensajes] });
await router.seed();
```

## Tabla

| columna | tipo | qué es |
|---|---|---|
| `tdespacio` | string 60 (pk) | el tipo de contexto (`tks`, `privado`, `video`…) |
| `iref` | string 120 (pk) | el id de la entidad comentada |
| `imensaje` | string 300 (pk) | el índice en el hilo: `0`, `1`, `10.0`, `10.0.1`… |
| `jcontenido` | json | el historial de versiones: `[{ contenido, fhcre, adjuntos }]` (la última es la vigente) |
| `indexcita` | string 300 | el índice del mensaje citado |
| `bactivo` | bool | baja lógica |
| `iusuario` | string 120 | quién lo escribió |
| `qtotalrespuestas` | virtual | cuántas respuestas anidadas tiene |

## El índice

- El primer nivel se numera `0`, `1`, `2`… en el orden de publicación.
- La respuesta a `10` es `10.0`, `10.1`…; la respuesta a `10.0` es `10.0.0`.
- El índice no tiene límite de niveles: el controlador decide hasta dónde se anida.
- `indexcita` guarda el índice del mensaje citado (el padre), así se sabe a qué responde sin recorrer el árbol.
- Las llaves son abiertas (sin FK): el sistema mantiene la coherencia.

## Rutas

| Ruta | Qué hace |
|---|---|
| `POST mensajes/publicar` | publica y calcula el índice siguiente del hilo |
| `PUT mensaje/{tdespacio}/{iref}/{imensaje}/editar` | agrega una versión (lo anterior no se pierde) |
| `GET mensajes/hilo?tdespacio=&iref=` | el hilo en árbol (primer nivel y respuestas) |
| CRUD `mensajes` | completo (el `imensaje` lo pone quien llama) |
| CRUD `adjuntos` | fichas de los adjuntos (los bytes los mueve el almacén del consumidor) |

## El autor y la fecha

- `publicar` acepta dos campos opcionales: `iusuario` (quién escribe) y `fhcre` (la fecha de esa versión, ISO).
- Si no se dan, manda la sesión (el `iusuario`) y la hora de ahora (el `fhcre`).
- `editar` acepta `fhcre`: la fecha de la versión nueva (la anterior no se toca).
- Sirve para lo que viene de otro sitio (un chat, un correo, un formulario): así el mensaje conserva su hora
  original y el sistema puede ordenarlo por ella.

## Errores comunes

- El `POST` del CRUD exige el `imensaje`: para que lo calcule el servidor, use `mensajes/publicar`.
- Editar por `PUT` con `jcontenido` como texto agrega una versión; con arreglo, reemplaza el historial.
- La baja es lógica: `DELETE` marca `bactivo` false y la fila se conserva.
