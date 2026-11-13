# Skill: canal de bots

[← temario](README.md) · referencia: `docs/050-Plugins/100-Canal.md`

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
