---
Titulo: Canal de bots: mensajes, reacciones y adjuntos
Estado: vigente
Autor:
tags: [plugins, bots, canal, d1, r2, jwt]
---
# Canal de bots

El plugin `canal` es la base de datos del canal entre bots. Reutiliza el patrón de versiones de `mensajes` (`jcontenido`, `indexcita` y baja lógica), pero añade los datos que necesita un sistema distribuido de bots: canal, hilo, autor, tipo, mensaje de origen, marca de tiempo, reacciones y adjuntos R2.

## Modelo de datos

### `canal_mensajes`

| Columna | Tipo | Qué es |
|---|---|---|
| `idmensaje` | string 64 (pk) | id global (uuid) |
| `canal` | string 160 | canal lógico (`ops`, `principal`, …) |
| `hilo` | string 160 | hilo opcional dentro del canal |
| `de` | string 120 | bot autor; sale del `sub` del JWT |
| `texto` | text | texto vigente |
| `tipo` | string 40 | `texto`, `estado`, `comando`, … |
| `msgorigen` | string 240 | id del mensaje en el sistema de origen |
| `ts` | datetime | fecha real del mensaje |
| `jcontenido` | json | `[{ texto, ts, adjuntos }]`; la última versión es la vigente |
| `indexcita` | string 64 | id del mensaje citado |
| `bactivo` | bool | baja lógica |
| `adjuntos` | json | ids de `canal_adjuntos` |

### `canal_reacciones`

La PK es `idmensaje` + `de`: un bot tiene una reacción por mensaje; puede cambiarla o quitarla. También guarda `reaccion` y `ts`.

### `canal_adjuntos`

La PK es `idadjunto`; guarda `idmensaje`, `nombre`, `mime`, `bytes`, `clave` (la clave R2), `fhexpira` y `ts`. La caducidad predeterminada es de 72 horas y se configura con `ttlAdjuntosSeg`.

## API

| Ruta | Qué hace |
|---|---|
| `POST canal/mensajes/publicar` | publica; el autor es el bot de la sesión |
| `GET canal/mensajes/listar?canal=&hilo=&desde=&limite=` | filtra por canal/hilo y fecha inclusiva `desde`; ordena por `ts` |
| `PUT canal/mensaje/{idmensaje}/editar` | agrega una versión; nada del historial se pierde |
| `DELETE canal/mensaje/{idmensaje}/eliminar` | baja lógica |
| `POST canal/reacciones/reaccionar` | pone o cambia la reacción del autor |
| `DELETE canal/reacciones/quitar` | quita la reacción del autor |
| `GET canal/mensaje/{idmensaje}/reacciones` | lista reacciones |
| `POST canal/adjuntos/registrar` | registra la ficha de un objeto ya subido a R2 |
| `GET canal/adjuntos/listar?idmensaje=` | lista adjuntos |

## Versiones y citas

`publicar` crea la primera versión en `jcontenido`. `editar` agrega otra y actualiza `texto`; el PUT directo con un texto nuevo también pasa por el hook `prePut` y conserva el historial. `indexcita` apunta al id de otro mensaje y debe existir. La baja nunca borra la fila: cambia `bactivo` a false y el listado la omite.

## Integración en un Worker

```ts
import { d1Database } from "@Jeff-Aporta/DER/src/02-controllers/server/d1.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { defineWorker } from "@Jeff-Aporta/DER/src/02-controllers/server/hosts/cloudflare.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { canalServer } from "@Jeff-Aporta/DER/src/03-plugins/canal/server.ts";
import { jwtSecurityHooks } from "@Jeff-Aporta/DER/src/03-plugins/common/jwt.ts";
import { r2CronHandler } from "@Jeff-Aporta/DER/src/03-plugins/common/r2.ts";

const worker = defineWorker((env) => {
  const db = d1Database(env.DB);
  const canal = createServer(canalServer, { db, cfg: { ttlAdjuntosSeg: 72 * 60 * 60 } });
  registry.secure(jwtSecurityHooks({ secret: env.JWT_SECRET, issuer: "bots" }));
  const router = createRouter([], { basePath: "/api", plugins: [canal] });
  return router;
});

export default {
  fetch: worker.fetch,
  scheduled: (_event, env) => r2CronHandler(env.FILES)(),
};
```

El binding D1 es la opción recomendada dentro del Worker. La variante `d1HttpDatabase` de `src/02-controllers/server/d1.ts` habla con la API REST para uso remoto o pruebas.

## Adjuntos R2

El helper `r2Almacen(env.FILES)` sube el objeto, guarda `der-expira` en sus metadatos y devuelve la ficha. El canal guarda esa ficha en D1. R2 no tiene caducidad nativa por objeto: el Cron purga los vencidos y el bucket debe tener además una regla de lifecycle de 3 días como red de seguridad.

La subida R2 y la escritura de la ficha no son atómicas (tampoco lo son las escrituras múltiples en D1). El Worker debe compensar un fallo borrando el objeto huérfano o reintentando la ficha.

## Realtime

DER no contiene WebSocket, Durable Object ni el servicio Realtime. El Worker es dueño del transporte: primero persiste con el plugin y después difunde la fila guardada. Si la difusión falla, el dato sigue en D1 y se puede recuperar con el listado desde `ts`.

## Migrar el chat SQLite existente

La migración se hace por los controllers de DER; no por SQL crudo:

```ts
const viejo = createServer(mensajesServer, { db: dbViejo });
const nuevo = createServer(canalServer, { db: dbNuevo });
for (const m of await viejo.controllers["mensajes"]!.query({ pageSize: 1000 })) {
  const versiones = (m.jcontenido ?? []).map((v) => ({ texto: v.contenido, ts: v.fhcre, adjuntos: v.adjuntos ?? [] }));
  const vigente = versiones.at(-1);
  await nuevo.controllers["mensajes"]!.post(nuevo.controllers["mensajes"]!.pojo({
    idmensaje: crypto.randomUUID(),
    canal: m.tdespacio,
    hilo: m.iref,
    de: m.iusuario ?? "legacy",
    texto: vigente?.contenido ?? vigente?.texto ?? "",
    tipo: "texto",
    msgorigen: m.imensaje,
    ts: vigente?.fhcre ?? vigente?.ts ?? new Date().toISOString(),
    jcontenido: versiones,
    indexcita: m.indexcita,
    bactivo: m.bactivo,
    adjuntos: vigente?.adjuntos ?? [],
  }));
}
```

El mapeo principal es `tdespacio → canal`, `iref → hilo`, `iusuario → de`, el último elemento de `jcontenido → texto/jcontenido`, `imensaje → msgorigen` e `indexcita → indexcita`. Los adjuntos de `mensajes_adjuntos` se copian con sus controllers a `canal_adjuntos`, conservando `clave`, `mime` y `bytes`, y se les asigna una caducidad de 72 horas. Para una migración grande, la lectura y la escritura pueden hacerse por lotes con `page`/`pageSize`.
