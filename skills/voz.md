# Skill: voz

[← temario](README.md) · la usa: [whatsapp.md](whatsapp.md), [atencion.md](atencion.md)

La voz con la que habla una app y la sintesis de las notas de voz. La voz **es parte de la configuracion de la app**, no un parametro suelto: por eso se cambia en cualquier momento desde el panel de administracion y todos los bots usan la misma.

## La tabla

`voz_app` (iapp, motor, voz, perfil, idioma, tono, activa)

- **iapp**: que app habla asi (`chat-assistant`, `crm`, ...).
- **motor**: `qwen`, `edge`, `kokoro` u `otro`. DER **no conoce ningun motor**: el consumidor lo implementa.
- **voz**: la clave de la voz (`aiden`, `serena`, ...); la cataloga el motor.
- **perfil**: `rapido` (para responder en vivo, sin tono) o `video` (con tono: risa, susurro).
- **idioma**, **tono**: pistas para el motor.
- **activa**: con `false` la app responde solo por texto.

## El motor (lo pone el consumidor)

DER llama al contrato `MotorVoz`; el motor de verdad (Qwen3-TTS, Edge, Kokoro) vive en el consumidor:

```ts
const voz = createServer(vozServer, {
  db,
  cfg: { vidaDias: 30, guardar: true },
  services: {
    motor: {
      async sintetizar({ texto, voz, perfil, idioma, tono }) {
        return await losBytesDelMotor(texto, voz, perfil, idioma, tono);   // Uint8Array
      },
      async voces() { return [{ clave: "aiden", nombre: "Aiden" }]; },
    },
    guardar: async (datos) => { await r2.put(clave, datos.bytes, ...); return { clave, url }; },
  },
});
```

## Uso

```ts
await voz.configDe("chat-assistant");     // la voz de esa app (o la de por defecto)
await voz.configurar("chat-assistant", { voz: "serena", perfil: "rapido" });
const a = await voz.sintetizar({ texto: "Listo, ya esta.", iapp: "chat-assistant" });
a.bytes;   // OGG/Opus (lo que quiere WhatsApp para las notas de voz)
a.guardado;  // { clave, url } si el consumidor dio almacen
```

## Guardar y los 30 dias

Si el consumidor da el servicio `guardar`, el audio queda guardado con su caducidad (`vidaDias`, 30 por defecto) y se puede volver a escuchar (por ejemplo, en la conversacion del CRM). El almacen (R2) pone su politica de borrado y el plugin de archivos suelta la fila.

## Rutas

- `GET /api/voz/config?iapp=` — la voz de esa app.
- `POST /api/voz/config` — cambia la voz (`{ iapp, voz, perfil, motor, idioma, tono, activa }`).
- `GET /api/voz/voces` — las voces que el motor tiene (para el selector del panel).
- `POST /api/voz/sintetizar` — sintetiza; devuelve el audio binario (no JSON).

## Cuando usarla

- Una app necesita **hablar**: notas de voz o audios con una voz configurable por app (`voz_app`).
- Quieres centralizar la voz (un panel la cambia y todos los bots usan la misma).

```ts
await voz.configurar("chat-assistant", { voz: "serena", perfil: "rapido" });
const a = await voz.sintetizar({ texto: "Listo", iapp: "chat-assistant" });   // audio binario
```

## Como lo usa el CRM del estudio (api-crm)

- `POST /api/voz/nota` (token del canal) sintetiza la nota que manda el bot y devuelve el audio binario.
- La transcripcion (voz -> texto) **no** es de este plugin: el API del CRM usa un motor STT (`QWEN_STT_URL` o whisper
  de Groq) y guarda el texto en `crm_transcripciones`; sin motor queda `pendiente` (nunca se inventa).
