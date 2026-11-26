# Skill: atencion

[← temario](README.md) · referencia: `docs/050-Plugins/140-Atencion.md` · relacionadas: [crm.md](crm.md), [whatsapp.md](whatsapp.md), [mensajes.md](mensajes.md), [calificaciones.md](calificaciones.md)

## Cuando usarla

- Vas a montar una **bandeja conversacional** (WhatsApp o Telegram) con bot y atencion humana, o a integrar la que
  ya existe (el CRM del estudio la usa completa).
- Necesitas **borradores**: que el bot proponga y una persona apruebe, corrija o rechace.
- Necesitas **modo manual por chat**, calificacion del cliente final o los tipos de mensaje que admite cada canal.

```ts
await at.registrarEntrante({ canal: "whatsapp", icuenta, cliente, mensaje });   // llega un mensaje
await at.proponer(iempresa, { ichat, texto });                                  // el bot propone
await at.setModo(iempresa, { ichat, modo: "entrenamiento" });                   // Manual / Auto
```

## Qué es

Bandeja de **atención conversacional omnicanal** (WhatsApp y Telegram) REUTILIZABLE: no conoce al CRM. El aislamiento es por `iempresa` (cualquier inquilino); el consumidor aporta la sesión con `services.contexto(req, sesion) → { iusuario, iempresa }` (el CRM lo hace con `crm.contexto`). Extiende lo que hacen `mensajes` (hilo) y `calificaciones` (nota) con dirección, canal, tipos, modo de entrenamiento y calificación del cliente final.

## Tablas (`exposed: false`)

| tabla | qué es |
|---|---|
| `atencion_canales` | número/bot del negocio: `canal`, `icuenta` (phone_number_id / bot), `nombre`, `cuenta`, `modo`; (`canal`,`icuenta`) ÚNICO: una cuenta pertenece a una sola empresa |
| `atencion_clientes` | cliente final: `iexterno` (wa_id/BSUID, user_id TG), `nombre`, `username`, `idioma`, `jetiquetas`, `icontacto`, primer/último contacto |
| `atencion_chats` | un cliente en un canal: `codigo` (4 dígitos), `modo` (null hereda del canal), `fhventana` (24 h WA), `estado` |
| `atencion_mensajes` | `direccion`, `origen` (cliente\|usuario\|bot), `iusuario`, `tipo`, `texto`, `jcontenido`, `ireply` (cita), `iexterno` (wamid: idempotencia), `estado` |
| `atencion_borradores` | lo que el bot propone en entrenamiento |
| `atencion_entrenamientos` | ejemplos: `correccion` (propuesto vs corregido) o `error_redaccion` (motivo) con `jcontexto` (últimos 10 mensajes) |
| `atencion_calificaciones` | nota 1–5 por mensaje con `jmotivos` y comentario |

## Matriz canal × capacidad (`CAPACIDADES`, `GET atencion/capacidades`)

Tipos: texto, imagen, audio (notas de voz), video, documento, reaccion, botones (sí/no), opciones, lista, encuesta, ubicacion, contacto, plantilla, sticker.
WhatsApp: todos menos `encuesta` (usa lista/botones); fuera de la ventana de 24 h solo `plantilla`. Telegram: todos menos `plantilla` y `lista` (usa `opciones` como teclado inline); `encuesta` nativa.

## Montar

```ts
const at = crearAtencion({
  db,
  cfg: { plazoCalificacionDias: 10, maxIntentosCodigo: 5, ventanaHoras: 24, canales: [{ iempresa: "acme", canal: "whatsapp", icuenta: "1522115", nombre: "Soporte", modo: "entrenamiento" }] },
  services: {
    contexto: async (req, sesion) => { const c = await crm.contexto(sesion.id, req.headers.get("x-empresa")); return { iusuario: c.iusuario, iempresa: c.iempresa }; },
    entregar: (canal, cliente, mensaje) => gateway.enviar(canal, cliente, mensaje),   // devuelve { iexterno }
    alMensaje: (mensaje, chat) => emitirSse(mensaje, chat),
  },
});
const router = createRouter(ctrls, { basePath: "/api", plugins: [auth, crm, at] });
await router.seed();   // tablas en cualquier motor + canales de cfg (idempotente)
```

## Flujo

1. El gateway (que verifica la firma) llama `at.registrarEntrante({ canal, icuenta, cliente, mensaje })`: la cuenta decide la empresa; idempotente por `mensaje.iexterno`; devuelve `{ nuevo, chat, mensaje, modo }`. Cuenta sin vincular → `canal: null`, nada se guarda.
2. El bot llama `at.proponer(iempresa, { ichat, texto })`: en `auto` se envía solo (`origen: bot`); en `entrenamiento` queda un borrador.
3. El humano: `POST atencion/borradores/resolver { id, accion }`: `enviar` tal cual, `corregir` (+`texto`: se envía corregido y se guarda el ejemplo), `reportar` (+`motivo`: error de redacción con contexto, no se envía) o `descartar`.
4. `POST atencion/enviar` (humano, cualquier tipo permitido), `POST atencion/modo { ichat | icanal, modo }`, `GET atencion/chats|mensajes|borradores|entrenamientos`.

## Calificación del cliente final (rutas públicas)

Enlace = id del chat + código de 4 dígitos. `GET atencion/calificacion?ichat=&codigo=` lista los mensajes enviados con su plazo (`vigente`); `POST atencion/calificar { ichat, codigo, imensaje, valor 1..5, motivos[], comentario }`. Plazo `cfg.plazoCalificacionDias` (10 por defecto); recalificar reemplaza; tras `maxIntentosCodigo` códigos malos el chat se bloquea 15 min (429). Código y chat inválidos dan el mismo 404.

## Verbos de servidor

`registrarCanal`, `canalDe`, `registrarEntrante`, `enviar`, `proponer`, `resolverBorrador`, `setModo`, `chats`, `mensajes`, `borradores`, `entrenamientos`, `vistaCalificacion`, `calificar`.

## Errores comunes

- Sin `services.contexto` las rutas protegidas fallan: el plugin no inventa la empresa.
- Sin `services.entregar` los salientes quedan `pendiente` (el gateway los toma de la tabla).
- Mensajes de otra empresa o chats ajenos responden «No existe» (404) sin distinguir el motivo.

## Modo Manual, presencia y borradores compartidos (como lo consume el CRM)

- **Manual = `entrenamiento`**. La base y el plugin siguen usando `entrenamiento`; la interfaz del CRM y su API
  (`POST /api/inbox/modo`) lo llaman **Manual**. El modo es **por chat** y **temporal**: se apaga solo a los 30
  minutos sin actividad del equipo y el front lo devuelve a `auto` al cerrar la pestaña (guarda los chats que el
  mismo encendio y los suelta).
- **Presencia**: en Manual el bot solo propone si hay alguien del equipo en ese chat. El CRM lo aplica en
  `proponerConReglas`: cuando no hay nadie, la propuesta se descarta con `omitido: "sin_presencia"`. El bot pregunta
  por `GET /api/bot/presencia?ichat=`.
- **Borradores compartidos**: el CRM guarda ademas el borrador de cada agente por chat (`crm_borradores`) para
  mostrar "X esta escribiendo..." y no pisarse; los del bot siguen en `atencion_borradores`.
- **Numeros de prueba**: los chats que nacen de un numero de PRUEBA arrancan en Manual (los marca el CRM).
- **Adjuntos con transcripcion**: una nota de voz o de video se transcribe al enviarse; el texto sobrevive a que el
  audio caduque.
