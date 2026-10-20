---
Titulo: SSE y configuración JSON
Estado: vigente
Autor:
tags: [controllers, sse, cfg]
---
# Server-Sent Events, configuración de la entidad (`plural/cfg`) y modo del PUT

[← índice](../README.md)

## SSE (`/sse`)

Cualquier acción o endpoint tiene su variante SSE agregando `/sse` a la ruta, con el **mismo método** (`POST producto/sse`, `GET productos/sse`, `POST producto/1/ajustarStock/sse`). Sirve para feedback de procesos o el efecto "type write" de un LLM.

- **Cada evento es texto plano.** Qué representa (JSON, XML, tokens…) lo decide quien consume.
- El servidor define qué se envía y cómo: `sse: { post(pojo, send, ctx) { send("..."); } }` en el ServerController, o `endpoints.<n>.sse`.
- Los `pre*` corren **antes** de abrir el stream: si fallan, la respuesta es un 400 normal, no un stream.
- Formato según [MDN](https://developer.mozilla.org/es/docs/Web/API/Server-sent_events/Using_server-sent_events): `data: <línea>` por cada línea (los textos multilínea se respetan), un evento por `send`, `event: error` si el handler lanza y el cierre de la conexión marca el fin.
- Client: `for await (const texto of ctrl.stream("post", pojo)) { ... }`. Usa `fetch` + parser propio (no `EventSource`), así que funciona con POST, PUT y DELETE con body. Para GET también sirve `new EventSource(url)`.
- En proceso (server), `ctrl.stream(...)` itera los textos sin HTTP.

## Configuración de la entidad (`plural/cfg`)

Es la configuración de la **entidad**, no de un registro: sus valores por defecto. Por eso vive **solo en el plural**;
los singulares no tienen `/cfg`. Es solo JSON y siempre está tipada con Zod.

```ts
// entidad (compartida): el molde Zod es obligatorio; sus .default(...) son el punto de partida
cfg: { zod: z.object({ moneda: z.string().default("COP"), stockMinimo: z.number().int().default(5) }) }
```

| | Client | HTTP | Resultado |
|---|---|---|---|
| leer | `getCfg()` | `GET plural/cfg` | el JSON guardado con los defaults del molde aplicados |
| ajustar | `putCfg(parcial)` | `PUT plural/cfg` | el JSON completo ya ajustado |

- El PUT es **parcial** y solo admite `update` (`Obj.update`): cambia llaves que el molde ya define (con sus defaults)
  y nunca crea otras. Una sola llave anidada ajusta un pedazo sin tocar el resto.
- El alcance de las llaves lo da el molde: el **fragmento** se valida en el client antes del fetch y una llave que el
  molde no define se rechaza; el resultado completo se vuelve a validar con el molde en el server.
- Hooks: `preGetCfg(ctx)` y `prePutCfg(parcial, ctx)`; `preConfirm` recibe `{ action: "getCfg" | "putCfg", arg: undefined }`.

### Dónde vive en el server: la tabla de configuración

Una tabla con **una fila por entidad**. El consumidor elige los nombres, pero declara explícitamente qué columna es cada
cosa, así las rutas quedan bien definidas:

```ts
// para toda la base (todas sus entidades con cfg)…
const db = sqliteDatabase("app.db", { cfg: { table: "der_cfg", columns: { pk: "id", json: "jcfg", fecha: "fhultact" } } });
// …o por controller (sobreescribe la de la base); `cfg: false` apaga /cfg en ese controller
new ServerController(ProductoEntity, { db, table: "productos", cfg: { table: "productos_cfg", columns: { ... } } });
```

| Columna | Qué guarda |
|---|---|
| `pk` | el plural de la entidad (`productos`); solo se elige el nombre de la columna (`id`, `entidad`…) |
| `json` | el JSON de la configuración |
| `fecha` | fecha y hora de la última actualización (la pone el PUT) |

- **Sin tabla de cfg no se exponen** las rutas `/cfg` (ni en el router ni en la doc); el client recibe 404.
- `seed()` crea la tabla si no existe. El PUT corre en una transacción: leer, ajustar, validar y guardar.

## Modo del PUT singular (`schema.put`)

El `PUT singular/pks...` aplica el cuerpo recibido sobre el registro actual con una operación de `Obj`, guiada por el
molde Zod de cada columna json. Se elige en el schema y por defecto es `insert`:

| `schema.put` | Efecto |
|---|---|
| `insert` (default) | ajuste parcial: lo no enviado se conserva y dentro de los json con molde se fusiona en profundidad |
| `insertIgnore` | solo completa lo que no está definido (nunca pisa) |
| `update` | solo cambia lo que ya está definido |
| `replace` | reemplazo directo de todo el registro (lo no enviado queda vacío) |

```ts
defineSchema({ columns: { ... }, put: "update" })
```
