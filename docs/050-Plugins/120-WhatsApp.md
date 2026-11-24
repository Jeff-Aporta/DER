---
Titulo: WhatsApp: gateway multi-número de la Cloud API
Estado: vigente
Autor:
tags: [plugins, whatsapp, meta, bots, mensajeria]
---
# WhatsApp

Modelo y comportamientos de un gateway de WhatsApp Cloud API con varios números bajo una sola app de Meta. Guía
corta y ejemplos en la skill [`skills/whatsapp.md`](../../skills/whatsapp.md).

## Modelo

- `whatsapp_apps`: quién atiende (contrato, perfil del bot, `bautorespuesta`). `whatsapp_numeros`: cada
  `phone_number_id` vinculado a una app. Vincular otro número es una fila (o una entrada de `cfg.numeros`).
- `whatsapp_contactos` (`waid` único), `whatsapp_conversaciones` (contacto × número, con `fhventana`),
  `whatsapp_mensajes` (`wamid` único) y `whatsapp_eventos` (el webhook crudo).
- Referencias abiertas, sin FK (como el resto de plugins). Ids de texto ordenables por llegada.

## Reglas

- Idempotencia: un entrante con un `wamid` ya guardado devuelve `nuevo: false` y no crea nada.
- Ventana de 24 h (`cfg.ventanaHoras`): cada entrante la extiende; vencida, la conversación se cierra y se abre
  otra. Un saliente nunca abre ni extiende la ventana. `ventanaAbierta` decide texto libre o plantilla.
- Estados de Meta en inglés → español (`sent` enviado, `delivered` entregado, `read` leído, `failed` fallido; lo
  desconocido es fallido) y nunca retroceden.
- Un número sin vincular no pierde el mensaje: se guarda con `app` null y el gateway decide.

## Servidor

`crearWhatsapp({ db, cfg })` devuelve el plugin con los verbos (`procesarWebhook`, `registrarEntrante`,
`abrirConversacion`, `guardarSaliente`, `actualizarEstado`, `historial`, `ventanaAbierta`, `vincularApp`,
`vincularNumero`, `numeros`, `appDeNumero`, `registrarEvento`, `conversaciones`). `seed()` crea las tablas en el
motor que sea y deja las apps y números de `cfg`. El webhook HTTP no es del plugin: la firma `X-Hub-Signature-256`
se verifica sobre el cuerpo crudo en el gateway.

## Rutas irregulares

`GET whatsapp/conversaciones`, `GET whatsapp/historial`, `POST whatsapp/vincular` (todas `protected`).

## Pruebas

`tests/plugins/whatsapp.test.ts`, en SQLite y en PGlite con el mismo seed: seed idempotente con números
vinculados, reintento por wamid, número → app y desconocido sin perder, ventana que se extiende y vence, estados
sin retroceso, historial cronológico, vincular a app inexistente (400) y rutas `protected`.
