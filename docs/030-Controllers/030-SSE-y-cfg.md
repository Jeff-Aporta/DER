---
Titulo: SSE y configuración JSON
Estado: vigente
Autor:
tags: [controllers, sse, cfg]
---
# Server-Sent Events y configuración JSON (`/cfg`)

[← índice](../README.md)

## SSE (`/sse`)

Cualquier acción o endpoint tiene su variante SSE agregando `/sse` a la ruta, con el **mismo método** (`POST producto/sse`, `GET productos/sse`, `POST producto/1/ajustarStock/sse`). Sirve para feedback de procesos o el efecto "type write" de un LLM.

- **Cada evento es texto plano.** Qué representa (JSON, XML, tokens…) lo decide quien consume.
- El servidor define qué se envía y cómo: `sse: { post(pojo, send, ctx) { send("..."); } }` en el ServerController, o `endpoints.<n>.sse`.
- Los `pre*` corren **antes** de abrir el stream: si fallan, la respuesta es un 400 normal, no un stream.
- Formato según [MDN](https://developer.mozilla.org/es/docs/Web/API/Server-sent_events/Using_server-sent_events): `data: <línea>` por cada línea (los textos multilínea se respetan), un evento por `send`, `event: error` si el handler lanza y el cierre de la conexión marca el fin.
- Client: `for await (const texto of ctrl.stream("post", pojo)) { ... }`. Usa `fetch` + parser propio (no `EventSource`), así que funciona con POST, PUT y DELETE con body. Para GET también sirve `new EventSource(url)`.
- En proceso (server), `ctrl.stream(...)` itera los textos sin HTTP.

## Configuración JSON (`/cfg`)

Para los `jconfig` de las entidades: **solo modifica JSON**.

```ts
// entidad (compartida)
cfg: { column: "jconfig", zod: ZProductoCfg }   // zod opcional; si se omite, se usa el `zod` de la columna
```

| | Client | HTTP | Resultado |
|---|---|---|---|
| leer | `getCfg(pojo)` | `GET singular/pks.../cfg` | el JSON (`{}` si está vacío), `null`/404 si la entidad no existe |
| ajustar | `putCfg(pojo, parcial)` | `PUT singular/pks.../cfg` | el JSON completo ya fusionado |

- El PUT es **parcial**: se aplica con `Obj.push`, así una sola llave ajusta un pedazo sin afectar el resto, y `null` quita la llave.
- Con molde Zod, el **fragmento** se valida en el client antes del fetch (`Obj.esquemaPush(molde)`) y el resultado se valida completo en el server. Sin molde, el JSON es de libre definición.
- Hooks: `preGetCfg(pojo)` y `prePutCfg(pojo, parcial)`.

### Dónde vive en el server (`ServerController.cfg`)

| Modo | Configuración |
|---|---|
| Columna de la propia tabla (default) | `entity.cfg.column` (debe ser una columna `json` persistida) |
| Otra tabla | `cfg: { table: "pedidos_cfg", column: "jdata", keys?: { ipedido: "id_pedido" } }`: UPDATE y, si no hay fila, INSERT |
| Libre definición | `cfg: { load(pojo, ctx) { ... }, save(pojo, json, ctx) { ... } }` (`load` retorna `undefined` → 404) |

El PUT corre en una transacción: leer, fusionar, validar y guardar.
