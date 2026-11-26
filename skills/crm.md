# Skill: crm

[← temario](README.md) · referencia: `docs/050-Plugins/130-CRM.md` · relacionadas: [reportes.md](reportes.md), [atencion.md](atencion.md) (canales WhatsApp/Telegram, modo entrenamiento y calificación; reutiliza `crm.contexto`), [identity.md](identity.md), [permissions.md](permissions.md), [archivos.md](archivos.md), [notificaciones.md](notificaciones.md)

## Cuando usarla

- Montas (o tocas) un API **multi-empresa** con usuarios que entran a varias empresas con un rol por empresa.
- Necesitas **contactos** por empresa y el **chat interno** (hilos, participantes, mensajes, adjuntos).
- Vas a agregar rutas propias que dependan de la empresa activa ("la puerta" es `crm.contexto`).

```ts
const ctx = await crm.contexto(sesion.id, req.headers.get("x-empresa"));   // { iusuario, iempresa, rol }
await crm.enviarChat(ctx, { hilo: "general", texto: "Hola" });
```

## Qué es

El modelo **multi-tenant** de un CRM: **empresas**, **usuarios↔empresas N:M con un rol por empresa**, **contactos por
empresa** y el **chat** (conversaciones, participantes, mensajes, adjuntos) con el mismo comportamiento que el chat de
peon (hilos por clave, historial paginado, búsqueda, no leídas, adjuntos 4 × 8 MB, cita de contexto, widget y
respuesta del bot por canal). Todo se filtra por la **empresa activa**. La contraseña y la sesión son del plugin
`identity`: el CRM solo decide A QUÉ EMPRESAS entra cada usuario y con qué rol.

## Tablas (`exposed: false`: ninguna se publica por CRUD, un CRUD cruzaría empresas)

| tabla | columnas | qué es |
|---|---|---|
| `crm_empresas` | `iempresa` (pk), `codigo` (único), `nombre`, `nit`, `bactivo`, `jdata`, `fhcre` | el inquilino |
| `crm_miembros` | `iempresa`+`iusuario` (pk), `rol`, `bactivo`, `fhcre` | usuario↔empresa N:M con rol por empresa |
| `crm_contactos` | `id` (pk), `iempresa`, `nombre`, `email`, `telefono`, `cargo`, `notas`, `jetiquetas`, `iresponsable`, `bactivo`, `fhcre`, `fhmod` | clientes/leads de la empresa |
| `crm_conversaciones` | `id` (pk), `iempresa`, `clave`, `titulo`, `tipo` (bot\|directa\|grupo), `icontacto`, `creador`, `ultimo`, `qmensajes`, `bactivo`, `fhcre`, `factualizado` | el hilo (peon: «hilos») |
| `crm_participantes` | `iconversacion`+`iparticipante` (pk), `tipo` (usuario\|bot\|contacto), `iempresa`, `fhlectura`, `fhcre` | quién está y hasta cuándo leyó |
| `crm_mensajes` | `id` (pk, ordenable), `iempresa`, `iconversacion`, `autor`, `iautor`, `texto`, `jwidget`, `jcontexto`, `bactivo`, `fhcre` | la línea de chat (peon: «chat») |
| `crm_adjuntos` | `id` (pk), `iempresa`, `imensaje`, `nombre`, `tipo`, `tamano`, `clave`, `fhcre` | ficha; los bytes los mueve el almacén (contrato de [archivos.md](archivos.md)) |

Roles (de menor a mayor): `lector` (lee), `auditor` (lee y atiende los [reportes](reportes.md) de la empresa), `agente` (escribe contactos y chats de grupo), `admin` (miembros, baja de contactos, administra grupos), `propietario`. Nadie asigna ni toca un rol por encima del suyo; una empresa no se queda sin propietario activo.

## Montar

```ts
const auth = createServer(identityServer, { db, cfg: { secret: "env:JWT_SECRET", admin: { usuario: "admin", password: "env:ADMIN_PASSWORD" } } });
const crm = crearCrm({
  db,
  cfg: { canalToken: "env:CANAL_TOKEN", superadmins: ["admin"], empresas: [{ iempresa: "acme", nombre: "Acme SAS", miembros: [{ iusuario: "ana", rol: "propietario" }], contactos: [{ id: "c1", nombre: "Cliente 1" }] }] },
  services: {
    login: (i, req) => auth.login(i, req),                    // OBLIGATORIO para crm/login (contraseña = identidad)
    almacen,                                                   // bytes de adjuntos (contrato AlmacenArchivos)
    canal: (paquete) => enviarAlBot(paquete),                  // entrega al bot; true = aceptado
    alMensaje: (linea, para) => emitirSse(linea, para),        // tiempo real
    notificar: (para, titulo, texto, enlace) => notif.notificar({ destinatarios: para, titulo, texto, enlace }),
  },
});
const router = createRouter(ctrls, { basePath: "/api", plugins: [auth, crm] });
await router.seed();   // tablas en cualquier motor + empresas/miembros/contactos de cfg (idempotente)
```

## Login y empresa activa

- `POST crm/login { empresa, usuario, password }` (`empresa` = código o id) → `{ token, expira, usuario, empresa, empresas }`. Siempre el mismo 401 si algo falla; la contraseña se verifica SIEMPRE (cuenta intentos y bloqueos de identidad).
- La empresa **no viaja en el token**: cada petición manda `X-Empresa: <iempresa>` (constante `CABECERA_EMPRESA`) y el server la valida contra `crm_miembros` (403 si no pertenece o está dada de baja). Con una sola empresa se deduce; con varias y sin cabecera, 400.
- `GET crm/yo` perfil + empresas (selector); `GET crm/empresas`; `POST crm/empresas` (solo `cfg.superadmins`).

## Rutas (todas `protected` salvo `login` y `respuesta`)

| Ruta | Rol mín. | Qué hace |
|---|---|---|
| `GET/POST crm/miembros` | lector / admin | lista; alta o cambio de rol/baja |
| `GET/POST crm/contactos`, `PUT crm/contactos/{id}` | lector / agente (baja: admin) | `?q=&limite=`; edita |
| `GET crm/chat?iconversacion=\|hilo=&limite=&antes=&q=` | lector | historial: página más reciente en orden cronológico, `hayMas` |
| `POST crm/chat` | lector (grupo/directa: agente) | `{ hilo\|iconversacion, texto, contexto, transcripcion, adjuntos[], tipo, participantes }`; crea el hilo; bot → `canal` |
| `GET crm/chat/hilos?q=` | lector | mis conversaciones con `noLeidas` |
| `POST crm/chat/leer { iconversacion }` | lector | marca leída |
| `GET crm/chat/adjuntos/{id}` | lector | bytes (solo quien es parte) |
| `POST crm/conversaciones` | lector (no bot: agente) | abre/reusa directa, grupo o bot |
| `GET/POST crm/conversaciones/participantes`, `POST …/quitar` | lector / agente | solo grupos: creador o admin; uno sale solo |
| `POST crm/chat/respuesta` | público + `Authorization: Bearer cfg.canalToken` | respuesta del bot `{ empresa, para, hilo, texto, widget }` |

## Cliente

```ts
const crm = createClient(crmPlugin, { baseUrl: "/api", headers: () => ({ [CABECERA_EMPRESA]: empresaActiva }) });
const { empresas } = await crm.login({ empresa: "acme", usuario: "ana", password });   // guarda el token
await crm.enviarChat({ hilo: "general", texto: "Hola" });
const { lineas, hayMas } = await crm.chat({ hilo: "general", limite: 30 });
```
Ops: `login`, `yo`, `empresas`, `crearEmpresa`, `miembros`, `vincularMiembro`, `contactos`, `crearContacto`, `editarContacto`, `chat`, `enviarChat`, `hilos`, `leerChat`, `abrirConversacion`, `participantes`, `agregarParticipante`, `quitarParticipante`, `respuestaBot`. Adjuntos: `crm.request("GET", "crm/chat/adjuntos/ID")`.

## Verbos de servidor (sin HTTP; los usan los handlers)

`crearEmpresa`, `empresa`, `empresasDe(usuario)`, `vincularMiembro`, `miembros`, `contexto(usuario, empresa?)` → `{ iusuario, iempresa, rol, empresa }` (la puerta), `login`, `crearContacto`, `contactos`, `editarContacto`, `abrirConversacion(ctx, input)`, `enviarChat(ctx, input)`, `responderBot(input)`, `historial(ctx, q)`, `hilos(ctx, q)`, `leerChat`, `agregarParticipante`, `quitarParticipante`, `participantes`, `adjunto`. Un API con rutas propias hace `const ctx = await crm.contexto(sesion.id, req.headers.get("x-empresa")); await crm.enviarChat(ctx, body)`.

## Errores comunes

- Olvidar `services.login`: `crm/login` falla (`Error`); el plugin no importa identidad para seguir hermético.
- Consultar las tablas del CRM sin `iempresa` en el `where`: cruza inquilinos. Usa los verbos (`ctx.iempresa`).
- Dos usuarios con el mismo hilo `general`: es normal, la clave solo es única entre las conversaciones DEL usuario (cada uno tiene la suya con el bot).
- Mensajes `lector` en grupos: 403; en el chat con el bot sí pueden escribir.

## Extensiones del consumidor CRM (api-crm)

El CRM del estudio suma a este plugin, en su propia base y con rutas propias: notas internas (`crm_notas`), marcas de
prueba (`crm_marcas`), modo Manual por chat (`crm_modos`), presencia (`crm_presencia`), perfil con nombre confirmado
(`crm_perfiles`), resumenes diarios (`crm_resumenes`), avatares (`crm_avatares`), grupos de la bandeja
(`crm_grupos`, `crm_grupo_chats`), prospectos privados (`crm_prospectos`), contactos automaticos
(`crm_contactos_auto`), retencion (`crm_retencion`) y transcripciones (`crm_transcripciones`). Nada de eso se
publica por CRUD: todo va por `/api/*` filtrando la empresa activa. `GET crm/miembros` se envuelve para sumar
`avatarUrl`. El front entra por `usuarios/login` (identidad) y resuelve la empresa con `GET crm/yo`.
