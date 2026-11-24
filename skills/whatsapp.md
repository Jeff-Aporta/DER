# Skill: whatsapp

[← temario](README.md) · referencia: `docs/050-Plugins/120-WhatsApp.md`

## Qué es

El modelo de datos y los comportamientos de un **gateway de WhatsApp Cloud API con varios números** (una sola app
de Meta). Cada número (`phone_number_id`) se vincula a una **app** (contrato, perfil del bot, autorespuesta); cada
contacto tiene **una conversación por número** con su **ventana de servicio de 24 h**; cada mensaje se guarda **una
sola vez por `wamid`** (Meta reintenta los webhooks). El webhook HTTP (verificación de la firma sobre el cuerpo
crudo, 200 inmediato, cola y envío) lo pone el gateway: el plugin guarda y decide.

## Tablas

| tabla | columnas | qué es |
|---|---|---|
| `whatsapp_apps` | `slug` (pk), `nombre`, `perfil`, `contrato`, `jconfig`, `bautorespuesta`, `bactivo`, `fhcre` | quién atiende: contrato (system prompt) y perfil del bot |
| `whatsapp_numeros` | `iphone` (pk), `app`, `display`, `nombre`, `tipo` (prueba\|produccion), `bactivo`, `fhcre` | un número → una app |
| `whatsapp_contactos` | `id` (pk), `waid` (único), `nombre`, `fhcre`, `fhult` | el usuario de WhatsApp |
| `whatsapp_conversaciones` | `id` (pk), `icontacto`, `iphone`, `app`, `estado` (abierta\|cerrada), `fhventana`, `fhabierta`, `fhult` | contacto × número; `fhventana` = fin de la ventana |
| `whatsapp_mensajes` | `id` (pk), `wamid` (único), `iconversacion`, `direccion`, `tipo`, `texto`, `estado`, `error`, `jpayload`, `fhcre`, `fhestado` | entrantes y salientes |
| `whatsapp_eventos` | `id` (pk), `iphone`, `campo`, `jpayload`, `fhcre` | todo lo que llega, crudo |

Los ids son texto ordenable por llegada (el historial se ordena por id). Ninguna tabla se publica por CRUD
(`exposed: false`). Estados: `recibido`, `pendiente`, `enviado`, `entregado`, `leido`, `fallido`.

## Montar (gateway con rutas propias)

```ts
import { crearWhatsapp } from "@Jeff-Aporta/DER/src/03-plugins/whatsapp/server.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";

const wa = crearWhatsapp({ db: sqliteDatabase("datos/whatsapp.sqlite"), cfg: {
  apps: [{ slug: "chat-assistant", nombre: "Chat Assistant", perfil: "dsh-chat-assistant", contrato }],
  numeros: [{ iphone: "1522115044307992", app: "chat-assistant", tipo: "prueba" }],
} });
await wa.seed();                                      // tablas + apps + números de cfg (idempotente)
const { nuevos } = await wa.procesarWebhook(json);    // tras verificar X-Hub-Signature-256
for (const e of nuevos) if (e.app?.bautorespuesta) encolar(e);   // e.nuevo siempre true aquí
const turnos = await wa.historial(e.conversacion.id); // [{ role: "user" | "assistant", content }]
if (await wa.ventanaAbierta(e.conversacion.id)) { /* texto libre */ } else { /* plantilla */ }
await wa.guardarSaliente({ iconversacion, texto, wamid });                     // enviado
await wa.guardarSaliente({ iconversacion, texto, estado: "fallido", error });  // Meta lo rechazó
```

| Verbo | Qué hace |
|---|---|
| `vincularApp(input)` / `vincularNumero(input)` | alta o cambio; un número solo se vincula a una app que existe (si no, 400) |
| `numeros()` / `appDeNumero(iphone)` | números activos; la app activa de un número (null si no hay) |
| `registrarEntrante(input)` | idempotente por `wamid` (`nuevo: false` en el reintento), contacto + conversación |
| `abrirConversacion(icontacto, iphone, entrante?, fh?)` | reusa con ventana vigente (el entrante la extiende); vencida, cierra y abre otra; el saliente no abre ventana |
| `guardarSaliente(input)` | `enviado` con `wamid`, `pendiente` sin él, `fallido` con `error`; idempotente por `wamid` |
| `actualizarEstado({ wamid, status })` | `sent/delivered/read/failed` → español, sin retroceder; null si el wamid no es nuestro |
| `historial(iconversacion, max?)` | turnos con texto en orden cronológico (`cfg.historial`, 20 por defecto) |
| `ventanaAbierta(iconversacion, fh?)` | ¿texto libre o plantilla? |
| `procesarWebhook(json)` | evento crudo + entrantes + estados de todo el payload de Meta |
| `conversaciones(iphone?, limite?)` | las últimas por actividad |

## Rutas (con las puertas del registro)

| Ruta | Seguridad | Qué hace |
|---|---|---|
| `GET whatsapp/conversaciones?iphone=&limite=` | protected | últimas conversaciones |
| `GET whatsapp/historial?iconversacion=&max=` | protected | turnos de una conversación |
| `POST whatsapp/vincular` `{ iphone, app, display?, nombre?, tipo?, bactivo? }` | protected | vincula o mueve un número |

## Cambiar de motor

Las tablas salen del JSON: `seed()` las crea en SQLite, PostgreSQL, PGlite, D1 o SQLite por HTTP, y `cfg.apps` +
`cfg.numeros` dejan la configuración. Migrar = seed en la base nueva + copiar filas (las mismas columnas).
