# Skill: notificaciones

[← temario](README.md) · referencia: `docs/050-Plugins/110-Notificaciones.md`

## Cuando usarla

- Necesitas la **campana de avisos** con contador de no leidas para una app.
- Quieres avisos para un usuario, para todos (`destinatarios: ["*"]`) o **push** al navegador/Android.

```ts
await notif.notificar({ destinatarios: ["ana"], titulo: "Chat asignado", enlace: "/chat/abc" });
const { items, noLeidas } = await notif.bandeja("ana", 30);
```

## Qué es

Avisos para un usuario (o para todos) con **contador de no leídas**: la campana de cualquier app. Una notificación
tiene destinatario, título, texto, tipo, un enlace libre (lo interpreta el front: `noticias:12`, `/tks/42`…) y, si
viene de una entidad, su origen (`tdespacio` + `iref`, la misma relación libre de mensajes y reacciones).

## Tablas

| tabla | columnas | qué es |
|---|---|---|
| `notificaciones_notificaciones` | `id` (pk), `iusuario`, `titulo`, `texto`, `tipo`, `enlace`, `tdespacio`, `iref`, `leida`, `fhcre` | una fila por destinatario; `iusuario = "*"` es para todos |
| `notificaciones_lecturas` | `inotificacion` + `iusuario` (pk), `fhcre` | quién leyó cada notificación para todos (una fila general sirve a todos) |

Las dos entidades van con `exposed: false`: **nunca** se publican por CRUD (cada quien ve solo lo suyo).

## Montar (con las puertas del registro)

```ts
import { crearNotificaciones } from "@Jeff-Aporta/DER/src/03-plugins/notificaciones/server.ts";

const notif = crearNotificaciones({ db, services: { alNotificar: (filas) => emitirEnVivo(filas) } });
const router = createRouter(ctrls, { basePath: "/api", plugins: [notif] });
await router.seed();
```

| Ruta | Seguridad | Qué hace |
|---|---|---|
| `GET notificaciones/bandeja?limite=50` | protected | las últimas de la sesión (propias + `*`, con `leida` resuelta para ella) y `noLeidas` |
| `POST notificaciones/leer` `{ ids? , todas? }` | protected | marca leídas; solo toca las suyas y las de todos |
| `POST notificaciones/notificar` `{ destinatarios, titulo, texto?, tipo?, enlace?, tdespacio?, iref? }` | protected (+ `permissions` del consumidor) | crea una por destinatario (repetidos fuera) |

## Montar (API con rutas propias, sin puertas del registro)

El plugin armado trae los mismos verbos como métodos de servidor; las tablas se crean con `notif.seed()`:

```ts
const notif = crearNotificaciones({ db });
await notif.seed();
await notif.notificar({ destinatarios: ["*"], titulo: "Hay una noticia nueva", enlace: "noticias:7" });
const { items, noLeidas } = await notif.bandeja(cedula, 30);
await notif.leer(cedula, { todas: true });
await notif.noLeidas(cedula);
```

## Tiempo real

`services.alNotificar(filas)` se llama después de crear (todas las filas de esa llamada). El consumidor decide el
transporte: SSE, WebSocket, canal de Cloudflare. Sin el servicio, la campana se entera al refrescar.

## Cliente

```ts
const notif = createClient(notificacionesPlugin, { baseUrl: "/api", headers: auth.headers });
await notif.bandeja();  await notif.leer({ todas: true });  await notif.notificar({ destinatarios: ["ana"], titulo: "Hola" });
```

## Quién lo hizo (estilo red social)

`notificar` acepta `iactor` (id de quien lo hizo) y `actor` (su nombre): el front pinta su avatar y el texto
«Ana registró a Luz». Nadie recibe la notificación de algo que hizo él mismo (ni en la suya ni en las `*`).

## Push fuera de la app (navegador y Android)

| tabla | columnas |
|---|---|
| `notificaciones_suscripciones` | `id` (sha256 del endpoint), `iusuario`, `canal` (`webpush` · `fcm`), `endpoint`, `claves` (p256dh/auth), `agente`, `activa`, `fhcre` |

| Ruta | Qué hace |
|---|---|
| `POST notificaciones/suscribir` `{ canal, endpoint, claves? }` | guarda la suscripción del dispositivo de la sesión (sin duplicados) |
| `POST notificaciones/desuscribir` `{ endpoint }` | la desactiva |

DER **no envía** push: tras crear, llama `services.enviarPush(suscripcion, notificacion)` por cada suscripción activa
del destinatario (las `*` a todas). Si devuelve `"caducada"`, la suscripción se desactiva.

- **Navegador (Web Push)**: el consumidor genera claves VAPID (`VAPID_PUBLICA`/`VAPID_PRIVADA` en el entorno), el
  front pide permiso, registra un service worker y hace `registration.pushManager.subscribe({ userVisibleOnly: true,
  applicationServerKey })`; manda `subscription.toJSON()` a `suscribir` con `canal: "webpush"`. `enviarPush` cifra y
  envía con la librería de Web Push que elija el consumidor.
- **Android (FCM vía Capacitor)**: al migrar, `@capacitor/push-notifications` da el token → `suscribir` con
  `canal: "fcm"` y el token en `endpoint`; `enviarPush` llama a la API HTTP v1 de FCM con la cuenta de servicio.
- Sin `enviarPush`, las suscripciones se guardan y no se envía nada (la campana y el SSE siguen funcionando).

## Errores comunes

- `leer` sin `ids` ni `todas` → 400.
- Una notificación `*` no tiene `leida` propia en la tabla: se resuelve por usuario en la bandeja.
- `notificar` por HTTP queda tras `protected`; quién puede crear lo decide la puerta `permissions` del consumidor.

## Como lo usa el CRM del estudio (hoy, sin este plugin)

El CRM **no** monta este plugin: sus avisos son del **navegador** (permiso, service worker `sw.js` y el centro de
notificaciones del front) y el tiempo real viaja por WebSocket (`/api/ws`: avisos `mensaje`, `borrador`, `presencia`,
`modo`). El centro guarda lo recibido para que no se pierda si el navegador no muestra avisos, y cada fila abre su
chat. (PENDIENTE) si se quiere push nativo o campana persistente en el servidor: ahi entra este plugin.
