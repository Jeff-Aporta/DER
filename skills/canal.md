# Skill: canal de bots

[← temario](README.md) · referencia: `docs/050-Plugins/100-Canal.md`

## Los dos plugins de canal

| Plugin | Para qué | Tablas |
|---|---|---|
| `canal` | el de **referencia**: mensajes, reacciones y adjuntos con R2 | `der_canal_*` |
| `canal-vps` | el **canal propio** (el del estudio): el protocolo del Worker `estudio-canal` sobre la **SQLite del VPS** | `canal_*` (canónico) |

El `canal-vps` es el que corre el servicio del estudio (Deno + DER, en el VPS, con la DB en
`/opt/estudio-videos/canal/canal.sqlite`): la API es la misma que servía el Worker, la puerta es el
JWT HS256 y el realtime es una sala en memoria (`SalaCanal`). Detalle en
`docs/050-Plugins/100-Canal.md`.

```ts
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { canalVpsServer } from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/server.ts";

const db = sqliteDatabase("/opt/estudio-videos/canal/canal.sqlite");
const canal = createServer(canalVpsServer, { db, cfg: { secreto: "env:CANAL_JWT", almacen, difundir } });
const router = createRouter([], { basePath: "/api", plugins: [canal] });
await router.seed();
```

## Qué es

Plugin JSON para el canal de los bots. Reutiliza el patrón de versiones del plugin de mensajes (`jcontenido` + cita), pero el modelo es deliberadamente de bots: canal, hilo opcional, autor bot, texto, tipo, mensaje de origen, fecha, reacciones y adjuntos R2.

## Montar en un Worker

```ts
import { d1Database } from "@Jeff-Aporta/DER/src/02-controllers/server/d1.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { canalServer } from "@Jeff-Aporta/DER/src/03-plugins/canal/server.ts";
import { jwtSecurityHooks } from "@Jeff-Aporta/DER/src/03-plugins/common/jwt.ts";

const db = d1Database(env.DB);
const canal = createServer(canalServer, { db, cfg: { ttlAdjuntosSeg: 72 * 60 * 60 } });
registry.secure(jwtSecurityHooks({ secret: env.JWT_SECRET, issuer: "bots" }));
const router = createRouter([], { basePath: "/api", plugins: [canal] });
await router.seed();
```

El autor siempre sale de la sesión (`sub` del JWT). Si el body trae `de`, tiene que ser igual al autor de la sesión.

## Tablas

| tabla | pk | contenido |
|---|---|---|
| `canal_mensajes` | `idmensaje` | `canal`, `hilo`, `de`, `texto`, `tipo`, `msgorigen`, `ts`, `jcontenido`, `indexcita`, `bactivo`, `adjuntos` |
| `canal_reacciones` | `idmensaje` + `de` | `reaccion`, `ts` |
| `canal_adjuntos` | `idadjunto` | `idmensaje`, `nombre`, `mime`, `bytes`, `clave`, `fhexpira`, `ts` |

## API

| ruta | qué hace |
|---|---|
| `POST canal/mensajes/publicar` | publica; devuelve el mensaje con su id y versión inicial |
| `GET canal/mensajes/listar?canal=&hilo=&desde=&limite=` | lista por canal/hilo desde una fecha ISO (inclusive), en orden de `ts` |
| `PUT canal/mensaje/{idmensaje}/editar` | agrega una versión; el texto anterior no se pierde |
| `DELETE canal/mensaje/{idmensaje}/eliminar` | baja lógica (`bactivo=false`) |
| `POST canal/reacciones/reaccionar` | pone o cambia la reacción del bot de la sesión |
| `DELETE canal/reacciones/quitar` | quita la reacción del bot de la sesión |
| `GET canal/mensaje/{idmensaje}/reacciones` | lista las reacciones |
| `POST canal/adjuntos/registrar` | registra la ficha de un objeto ya subido a R2; TTL de 72 h |
| `GET canal/adjuntos/listar?idmensaje=` | lista adjuntos |

## R2

Los bytes se suben con `r2Almacen(env.FILES)`; el canal guarda la ficha:

```ts
const objeto = await r2Almacen(env.FILES).subirConCaducidad(clave, bytes, { mime, nombre });
await registrarAdjunto({ nombre, mime, bytes: objeto.bytes, clave: objeto.clave });
```

La ficha del canal y el objeto R2 son dos datos: si la subida funciona y la ficha falla, hay que purgar el objeto huérfano (o viceversa). D1 no ofrece transacciones interactivas.

## Realtime

DER no implementa WebSocket, Durable Object ni Realtime. El Worker publica con este plugin y, después de confirmar la escritura, difunde el mensaje por su transporte realtime. Si la difusión falla, el mensaje sigue guardado y un consumidor puede releerlo desde `ts`.

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
