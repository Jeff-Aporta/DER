---
Titulo: Notificaciones: la campana con contador
Estado: vigente
Autor:
tags: [plugins, notificaciones, campana, tiempo-real]
---
# Notificaciones

Plugin para avisar a un usuario (o a todos) y llevar la cuenta de lo que no ha leído. Guía corta y ejemplos en la
skill [`skills/notificaciones.md`](../../skills/notificaciones.md).

## Modelo

- `notificaciones_notificaciones`: una fila por destinatario. `iusuario = "*"` = para todos (una sola fila).
- `notificaciones_lecturas`: quién leyó cada notificación `*` (PK `inotificacion + iusuario`).
- Relación libre con la entidad de origen: `tdespacio` + `iref` (como mensajes y reacciones). `enlace` lo
  interpreta el front.
- Ninguna de las dos tablas se publica por CRUD (`exposed: false`): solo las rutas irregulares, que usan la sesión.

## Rutas irregulares

`GET notificaciones/bandeja`, `POST notificaciones/leer`, `POST notificaciones/notificar` (todas `protected`).

## Servidor sin puertas

Para APIs con rutas y sesión propias, `crearNotificaciones({ db, services })` devuelve el plugin con los verbos
`notificar`, `bandeja`, `leer` y `noLeidas` como métodos, y `seed()` crea las tablas.

## Tiempo real

`services.alNotificar(filas)` tras cada creación; el transporte (SSE, WebSocket) lo pone el consumidor.

## Actor y push

`iactor`/`actor` = quién lo hizo (avatar y nombre; nadie se notifica a sí mismo). `notificaciones_suscripciones`
guarda los dispositivos (`webpush` con VAPID, `fcm` con Capacitor); `services.enviarPush` hace el envío real y una
respuesta «caducada» desactiva la suscripción. Detalle en la skill.

## Pruebas

`tests/plugins/notificaciones.test.ts`: bandeja por sesión, lecturas por usuario de las `*`, contador, nadie marca
las de otro, verbos sin router, actor que no se notifica a sí mismo, suscripciones sin duplicados y caducadas.
