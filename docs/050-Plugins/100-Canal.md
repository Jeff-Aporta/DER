---
Titulo: Canal de bots: mensajes, reacciones y adjuntos
Estado: vigente
Autor:
tags: [plugins, bots, canal, d1, r2, jwt, sqlite, tunel]
---
# Canal de bots

## El plugin `canal-vps`: el canal propio (el que vive en el VPS, sin D1)

Hay **dos** plugins de canal, con propositos distintos:

| Plugin | Para que | Tablas |
|---|---|---|
| `canal` | el plugin de **referencia** (el transversal): mensajes, reacciones y adjuntos con **R2** | `der_canal_*` |
| `canal-vps` | el **canal propio** del estudio: el mismo protocolo del Worker `estudio-canal`, pero con la memoria en la **SQLite del VPS** | `canal_*` (el esquema canonico) |

El `canal-vps` es el que usa el servicio del estudio (`canal/servicio/` en el repo del estudio): la API es
**la misma que servia el Worker** (mismas rutas, mismos codigos, mismos cuerpos), asi que los bots no cambian
ni una linea: solo el `CANAL_URL`.

### El esquema canonico (`canal_*`)

| Tabla | Contenido | Indices |
|---|---|---|
| `canal_canales` | los canales (se crean al vuelo) | pk `canal` |
| `canal_mensajes` | los mensajes (`idmensaje`, `canal`, `autor`, `tipo`, `texto`, `adjuntos`, `para`, `fhcre`, `fhmod`, `borrado`, `caduca`, `jmeta`) | **`(canal, fhcre)`** (el listado del canal), `(caduca)` |
| `canal_reacciones` | las reacciones | `(idmensaje)` |
| `canal_presencia` | quien esta conectado (pk `bot` + `canal`) | pk |
| `canal_adjuntos` | las fichas de los ficheros (72 h) | `(canal)` |
| `canal_tunel` | el hostname publico por el que se entra (lo publica el conector del tunel) | pk `idtunel` |

El indice `(canal, fhcre)` es el que evita releer la tabla entera (lo que agotaba el limite diario de D1).

### La API (la del protocolo)

```ts
const canal = createServer(canalVpsServer, {
  db,
  cfg: { secreto: "env:CANAL_JWT", almacen, urlBase, difundir },
});
const router = createRouter([], { basePath: "/api", plugins: [canal] });
await router.seed();
```

- `GET /api/salud` (publico), `GET /api/protocolo` (publico), `POST /api/instalar`.
- `GET|POST /api/mensajes`, `GET|PATCH|DELETE /api/mensajes/{id}`.
- `GET|POST /api/reacciones`, `GET|POST /api/canales`, `GET /api/presencia`, `POST /api/presencia/latido`.
- `GET|POST /api/archivos`, `GET /api/archivos/{id}`, `GET /api/archivos/{id}/firma`,
  `GET /api/archivos/{id}/descarga?exp=&sig=`.
- `GET|POST /api/tunel`.

La puerta es el **JWT HS256** (`secreto`): sin token valido, **401**. La claim `canales` acota al bot a
esos canales (403 si toca otro). El realtime es la `SalaCanal` (en memoria): el servicio la alimenta con
`difundir` y le entrega los sockets.

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

## Implementacion alternativa y equivalencia con el Worker del estudio

Este plugin es la **implementacion de referencia**. El **esquema canonico** del canal de bots es el del Worker
`estudio-canal` (ya desplegado, con su API publica y sus tablas vivas). Para que convivan sin chocar, este plugin
usa su propio prefijo de tablas: `der_canal_mensajes`, `der_canal_reacciones` y `der_canal_adjuntos` (y las entidades
`der_canal.mensaje`, `der_canal.reaccion` y `der_canal.adjunto`).

### Tabla de equivalencias (columna a columna)

| Worker (canonica, `canal_*`) | Aqui (de referencia, `der_canal_*`) | Nota |
|---|---|---|
| `canal_mensajes.idmensaje` | `der_canal_mensajes.idmensaje` | uuid |
| `canal_mensajes.canal` | `der_canal_mensajes.canal` | el canal (`estudio:general`...) |
| `canal_mensajes.autor` | `der_canal_mensajes.de` | aqui sale del `sub` del JWT |
| `canal_mensajes.tipo` | `der_canal_mensajes.tipo` | `texto`, `aviso`, `anuncio`, `traslado`, `plan`... |
| `canal_mensajes.texto` | `der_canal_mensajes.texto` | el texto vigente |
| `canal_mensajes.jmeta` | `der_canal_mensajes.msgorigen` | el Worker guarda el `jmeta` del protocolo (anuncio/traslado/plan) |
| `canal_mensajes.para` | (no hay) | a quien va dirigido; aqui se puede usar `hilo` |
| `canal_mensajes.adjuntos` (json) | `der_canal_mensajes.adjuntos` (json) | ids de los adjuntos |
| `canal_mensajes.fhcre` | `der_canal_mensajes.ts` | fecha de creacion |
| `canal_mensajes.fhmod` | `der_canal_mensajes.jcontenido[].ts` | aqui el historial de versiones |
| `canal_mensajes.borrado` | `der_canal_mensajes.bactivo` | baja logica |
| `canal_mensajes.caduca` | (no hay) | el Worker caduca a las 72 h; aqui los adjuntos caducan con `ttlAdjuntosSeg` |
| `canal_reacciones.idreaccion` + `bot` + `emoji` | `der_canal_reacciones.idmensaje` + `de` + `reaccion` | aqui un bot tiene una reaccion por mensaje |
| `canal_reacciones.fhcre` | `der_canal_reacciones.ts` | |
| `canal_adjuntos.idadjunto` | `der_canal_adjuntos.idadjunto` | |
| `canal_adjuntos.clave` | `der_canal_adjuntos.clave` | clave R2 |
| `canal_adjuntos.canal` / `propietario` | (no hay) | en el Worker, la ficha y el objeto |
| `canal_adjuntos.caduca` | `der_canal_adjuntos.fhexpira` | 72 h por defecto |

### Via de migracion al esquema canonico (sin SQL crudo)

Con **controllers de DER** (nada de SQL a mano):

1. Montar el plugin de referencia (`createServer(canalServer, { db, cfg: { ttlAdjuntosSeg: 72 * 60 * 60 } })`) y leer
   con `plugin.controllers["mensajes"].query({ where: { canal }, orderBy: "ts" }, { include: {} })`.
2. Escribir en el canonico con los controllers del Worker (`canal_mensajes`): `ctrl.post(ctrl.pojo({ idmensaje,
   canal, autor, tipo, texto, adjuntos, para, fhcre, fhmod, borrado, caduca, jmeta }), ctx)`.
3. Traducir campo a campo con la tabla de arriba (`de` → `autor`, `ts` → `fhcre`, `bactivo` → `borrado`,
   `msgorigen` → `jmeta`, `reaccion` → `emoji`).
4. Los adjuntos: `der_canal_adjuntos` → `canal_adjuntos` (misma clave R2, misma caducidad).
5. Comprobar: `GET /api/mensajes?canal=...` del Worker devuelve lo mismo que `GET canal/mensajes/listar` del plugin.

El paso inverso (el canonico → el de referencia) es el mismo con `Obj.insert` para **añadir** columnas y el
`syncSchema()` de DER para crear las que falten (nunca `DROP` a mano).
