---
Titulo: Atención omnicanal: WhatsApp y Telegram con modo entrenamiento y calificación
Estado: vigente
Autor:
tags: [plugins, atencion, whatsapp, telegram, entrenamiento, calificacion]
---
# Atención omnicanal

Bandeja conversacional reutilizable (no depende del CRM). Guía corta en la skill [`skills/atencion.md`](../../skills/atencion.md).

## Modelo

`atencion_canales` (cuenta del negocio, única por canal+cuenta → una empresa), `atencion_clientes` (todo lo mapeable del
cliente final), `atencion_chats` (id + código de 4 dígitos, modo, ventana de 24 h), `atencion_mensajes` (todos los tipos,
con origen cliente/usuario/bot, cita y estado), `atencion_borradores`, `atencion_entrenamientos` y
`atencion_calificaciones`. Referencias abiertas, sin FK; ids de texto ordenables por llegada.

## Reglas

- **Aislamiento**: toda fila lleva `iempresa` y todo verbo la recibe; lo de otra empresa es 404. En HTTP la empresa y el
  usuario salen de `services.contexto` (el consumidor, p. ej. el CRM).
- **Matriz canal × capacidad**: cada canal solo admite sus tipos; WhatsApp exige plantilla fuera de la ventana de 24 h.
- **Modo**: `auto` (el bot responde solo) o `entrenamiento` (el bot propone; el humano envía, corrige, reporta error de
  redacción con contexto o descarta). Las correcciones y reportes quedan como ejemplos de entrenamiento.
- **Calificación**: enlace con id de chat + código de 4 dígitos (tiempo constante, bloqueo por intentos), por mensaje
  saliente, 1 a 5 con motivos, dentro de `plazoCalificacionDias` (10).
- Entrantes idempotentes por id externo (wamid, message_id).

## Servidor y seed

`crearAtencion({ db, cfg, services })` con los verbos de la skill. `seed()` crea las tablas en cualquier motor
(SQLite, PostgreSQL, PGlite, D1…) y vincula los canales de `cfg.canales`; repetirlo no duplica nada.

## Como lo usa el CRM (api-crm)

- **Modo Manual**: la interfaz del CRM llama **Manual** a `entrenamiento`. El API del CRM guarda el modo por **chat**
  en `crm_modos` (no toca `atencion_chats.modo`, que sigue siendo el modo del canal) y lo traduce al verbo
  `setModo`/`atencion/modo`. La ruta propia es `POST /api/inbox/modo` (`{ ichat, modo: "auto"|"manual"|"entrenamiento" }`);
  `POST /api/atencion/modo` queda para el modo por canal (compatibilidad).
- **Temporal**: el modo manual de un chat se apaga solo a los 30 minutos sin actividad del equipo (`MODO_MANUAL_MIN`)
  y el front lo devuelve a `auto` al cerrar o esconder la pestaña.
- **Con presencia**: en modo manual el bot solo debe proponer si hay alguien del equipo con ese chat abierto. Esa
  regla la aplica el CRM (`GET /api/bot/presencia?ichat=` y `proponerConReglas`), no el plugin: el plugin sigue
  aceptando `proponer` como siempre.
- **Borradores compartidos**: ademas de `atencion_borradores` (lo que propone el bot), el CRM guarda el borrador de
  CADA agente por chat (`crm_borradores`, `GET/POST /api/borrador`) y lo difunde por WebSocket ("X esta escribiendo...").
- **Adjuntos y transcripcion**: el envio de una nota de voz o de video se envuelve en `POST /api/atencion/enviar`
  para transcribirla; el texto queda en `crm_transcripciones` y en el mensaje, porque el audio caduca a los 30 dias.
- **Grupos de chats** (carpetas de la bandeja) NO son de este plugin: viven en el API del CRM (`crm_grupos`).
