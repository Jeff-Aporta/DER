# Skill: notificaciones

[← temario](README.md) · referencia: `docs/050-Plugins/110-Notificaciones.md`

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

## Errores comunes

- `leer` sin `ids` ni `todas` → 400.
- Una notificación `*` no tiene `leida` propia en la tabla: se resuelve por usuario en la bandeja.
- `notificar` por HTTP queda tras `protected`; quién puede crear lo decide la puerta `permissions` del consumidor.
