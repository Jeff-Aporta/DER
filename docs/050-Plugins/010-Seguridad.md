---
Titulo: Seguridad: identidad y permisos
Estado: vigente
Autor:
tags: [plugins, seguridad, jwt, json]
---
# Seguridad: puertas del registro y plugins JSON

[← índice](../README.md) · `src/01-objects/registry.ts` (puertas y sesión) · `src/03-plugins/` · tipos y Zod de cada plugin en su `schemas.ts` · contratos de plugin (`PluginDef`, `IrregularRoute`, `SecurityDef`, `SecurityHooks`) en `src/00-common/schemas.ts`; los de server (`ServerPluginDef`, `ServerPlugin`) en `src/02-controllers/server/schemas.ts`

## Las tres puertas (registro global)

La seguridad del Router no depende de ningún plugin: depende de tres puertas de **libre definición** en el registro global (`registry.secure({...})`):

| Puerta | Firma | Qué decide |
|---|---|---|
| `extract(req)` | `Request → SessionInfo \| null` | saca la sesión del request (p. ej. del JWT). Sin esta puerta **no hay seguridad**: toda ruta se sirve (skip). |
| `protected(info)` | `SessionInfo \| null → boolean` | si hay sesión válida (default: `info !== null`). Una ruta `protected` sin sesión válida → 401. |
| `permissions(info, action, entity, { method, route })` | `→ { allowed, value?, reason? }` | si la acción se permite; `value` viaja a los handlers en `ctx.state.permiso`. Sin puerta: permitido. |

`SessionInfo` es `{ id, role?, claims?, ... }`: cualquier sistema que produzca eso sirve. La sesión de cada request viaja en `ctx.session` y `ctx.state.session`; `ctx.state.can(accion, entidad?)` evalúa la puerta de permisos desde un handler; `controller.permissions(accion)` hace lo mismo desde código (fuera de un request usa `registry.session`, el **singleton** de sesión que el cliente deja al hacer login).

Los plugins JSON de identidad y permisos **aportan implementaciones** de esas puertas: entran al registro solo donde el consumidor no definió la suya (y `registry.secure({...})` siempre gana). Así:

| Lo que carga el consumidor | Qué pasa |
|---|---|
| nada (ni plugins ni puertas) | sin seguridad: las rutas `protected` se sirven (skip) |
| `identityServer` | `extract` del JWT: rutas protegidas exigen sesión (401); sin puerta de permisos todo pasa |
| `identityServer` + `permissionsServer` | además, matriz rol → acción (403 si se niega) |
| `permissionsServer` + un `extract` propio | permisos con el sistema de identidad del consumidor |
| `identityServer` + un `permissions` propio | identidad DER con el sistema de permisos del consumidor |

Los dos plugins son **herméticos**: ninguno importa al otro. La relación `usuario` del DER de permisos apunta a la entidad `identity.usuarios` por nombre y solo resuelve si esa entidad está registrada.

## Integración

```ts
import { createRouter, createServer, sqliteDatabase } from ".../src/02-controllers/server/sqlite.ts";
import { identityServer, permissionsServer } from ".../src/03-plugins/index.ts";

const auth = createServer(identityServer, { db, cfg: { secret: "env:JWT_SECRET", expiresIn: 86400, admin: { usuario: "admin", password: "env:ADMIN_PASSWORD" } }, env });
const permisos = createServer(permissionsServer, { db, cfg: { grupo: "API", rolBase: "USR", rolAdmin: "ADMIN", admins: ["admin"], denyByDefault: false } });
const router = createRouter(ctrls, { basePath: "/api", plugins: [auth, permisos] });
await router.seed();                   // tablas de todos (incl. plugins) + seed de cada plugin
```

`createServer(json, { db, cfg, env })` valida `cfg` con el Zod del plugin (`.strict()`), resuelve `"env:NOMBRE"` (de `env` o del proceso; en Workers, el `env` del fetch) y devuelve el plugin armado: `controllers.<clave>` (un `ServerController` por entidad del JSON), `list`, `routes` (irregulares ya resueltas), `security` (puertas enlazadas), `seed()`, `state` y las `ops` como métodos (`auth.login(...)`, `auth.verify(token)`, `permisos.load(der)`, `permisos.can(info, accion, verbo)`).

## Qué protege cada registro (por endpoint)

```ts
new ServerController(ProductoEntity, { db, security: { public: ["list", "get", "doc"] } });   // el resto: sesión + permisos
new ServerController(PedidoEntity, { db, security: true });                                   // todo protegido + permisos
new ServerController(NotaEntity,   { db, security: { permissions: false } });                 // sólo sesión
// sin `security` (ni en la entidad ni en el controller): pública
routes: [{ method: "GET", path: "reportes/x", security: "protected", handler }]               // sólo sesión; `true` = sesión + permisos
```

`security` se puede declarar en la **entidad** (compartida con el client) y el controller la sobreescribe. `SecurityDef`: `public` (gana), `protected` (`true` = todas las no públicas, o la lista), `permissions` (default `true`) y `actions` (ids personalizados). En rutas irregulares: `"public"`/`false`, `"protected"`, `true` o `{ protected, permissions, action }`. `/doc` es pública por defecto (contexto para agentes); para protegerla, inclúyela en la lista `protected`. La seguridad se resuelve por ruta (`RouteInfo.security`).

Orden en cada request: `extract` → (ruta protegida) `protected` → (con `permissions`) puerta de permisos → `guard` → `pre*`/`preConfirm` → acción. En una ruta pública la sesión se intenta igual (`ctx.session`), pero un token inválido no la bloquea.

## Plugin de identidad (`src/03-plugins/identity/`)

Las acciones de sesión son **paths de la entidad `usuarios`**: las que aún no conocen al usuario cuelgan del plural (`usuarios/…`); las del usuario de la sesión cuelgan del singular **sin pks** (`usuario/…`: el usuario es el del token). Solo el JWKS es un path irregular del plugin (ruta estándar).

| Path (op) | Ruta | Seguridad | Qué hace |
|---|---|---|---|
| `login` | `POST usuarios/login` `{ usuario, password }` | pública | `{ token, tipo: "Bearer", expira, usuario }` · 401 «Usuario o contraseña inválidos» · 429 bloqueado |
| `logout` | `DELETE usuario/logout` | sesión | revoca la sesión del token (204); el mismo token responde 401 después |
| `logoutAll` | `DELETE usuario/logout/all` | sesión | revoca **todas** las sesiones del usuario y devuelve `{ revocadas }` |
| `sessions` | `GET usuario/sessions` | sesión | sesiones vigentes con IP, dispositivo, SO, navegador, último acceso y `actual` |
| `changePassword` | `PUT usuario/password` `{ actual, nueva }` | sesión | exige la actual, aplica la política, revoca las demás sesiones |
| `events` | `GET usuarios/events` | sesión | auditoría filtrable por `iusuario`, `accion`, `desde`, `hasta`, `limit`, `offset` |
| `jwks` (irregular) | `GET /.well-known/jwks.json` | pública | llave pública (solo con `jwt.alg: "ES256"`) |
| CRUD + list `usuario` / `usuarios` | REST | sesión + permisos | `usuarios` es `exposed` y `administrable`; `password` se recibe y nunca se guarda ni devuelve |

- **Usuarios:** `identity_usuarios (iusuario string pk, nombre, email, bactivo, jdata, creado, hash)`. `hash` es una columna `hidden`: no se selecciona, no se retorna y no se puede pedir ni filtrar en `query()` (400). `sesiones`, `intentos` y `eventos` son `exposed: false`: solo se tocan por los paths de arriba.
- **Hash:** PBKDF2-SHA256 (100 000 iteraciones por defecto, el máximo de Workers) sobre `HMAC-SHA256(pepper, contraseña)`; `pepper` separado del `secret` (si falta, se usa el `secret`). Sal aleatoria de 16 bytes. Formato: `pbkdf2-sha256$<iter>$<sal>$<hash>`. Comparación en tiempo constante.
- **JWT HS384** (o **ES256** con `jwt: { alg, kid, privateJwk, publicJwk }` y `trustedIssuers` para aceptar tokens de otros emisores vía JWKS) con `sub` (iusuario), `jti` (sesión), `iat`, `exp`, `iss?` y `nombre?`. La verificación solo acepta el algoritmo configurado (un `alg: none` se rechaza), distingue «Token vencido» de «Token inválido: …» y exige la sesión `identity_sesiones` vigente y el usuario activo. **El rol no viaja en el token:** se lee en cada request.
- **`extract`:** `Authorization: Bearer <token>` → `{ id: sub, claims }`; sin cabecera → `null` (anónimo).
- **`seed`:** crea `admin` si está configurado y no existe. La secret key debe tener al menos 32 caracteres y nunca se versiona: va por `env:`.

## Plugin de permisos (`src/03-plugins/permissions/`)

### DER

```
permisos_grupos        (igrupo pk, nombre)                              grupo al que pertenecen los roles
permisos_roles         (irol pk, igrupo, nombre, bactivo)               el rol pertenece a un grupo
permisos_rolesusuario  (iusuario pk, irol pk, finicial, ffinal, bprincipal)   vigencia y rol principal; relación `usuario` → `identity.usuarios` (si existe)
permisos_accionesrol   (irol pk, iaccion pk, valor json)                iaccion = id de ruta, acción personalizada o "*"
```

### Vector de acciones

1. **Rol base** (`rolBase`, default `USR`, personalizable): define los valores por defecto de TODOS los roles. Un rol particular solo escribe sus diferencias: cargar en un rol un valor igual al del base (ya vigente o en la misma carga) es un 400 «Acciones que repiten el valor del rol base …».
2. Roles del usuario **vigentes** (`finicial ≤ ahora < ffinal`), **activos** y de roles del **grupo configurado**. El principal va primero. Sin rol vigente, el usuario es el rol base.
3. Efectivo(R) = (base − ids de R) + R. Primero el id exacto y luego el comodín `"*"`. Un valor partido por verbo (`{ "GET": true, "PUT": false }`) aporta solo el del método.
4. Decisión: sin valor o `{ "protected": true }` pasa (o se niega con `denyByDefault`); `false` → 403; `true`, un objeto o un texto pasan y el valor viaja en `ctx.state.permiso` (p.ej. `{ "descuentoMax": 10 }`).

Los ids son los de la tabla de rutas: `DELETE:/producto/{iproducto}`, `GET:/productos` (`list` y `query` comparten id: `query` es `GET plural?q=`)… **`/cfg` es una sola acción para GET y PUT: `CFG:/productos`.** Con `cfg.aliases` (`{ "DELETE:/producto/{iproducto}": "productos.borrar" }`) el consumidor personaliza el nombre que se quema en la BD: la puerta, el catálogo, el perfil y la carga usan el alias.

### Rutas

El recurso es uno solo, `/permisos`, y el verbo HTTP decide la operación: no hay sufijos de acción en la ruta.

| Ruta | Seguridad | Qué hace |
|---|---|---|
| `GET /permisos` | pública | perfil `{ usuario, irol, igrupo, roles, perms }`; sin sesión, el anónimo (`perms: {}`) |
| `PUT /permisos` | sesión + permisos | carga el DER `{ grupos, roles, rolesusuario, acciones }`: upsert en una transacción; `iaccion` puede ser el id de una ruta, una acción personalizada (`security.actions`) o "\*" (todas) |
| `GET /permisos?catalogo=1` | sesión + el permiso de `PUT /permisos` | acciones evaluables con sus rutas (para administrar acciones por rol) |
| CRUD + list `permisos/grupo(s)`, `permisos/rol(es)`, `permisos/rolusuario` (`rolesusuario`), `permisos/accion(es)` | sesión + permisos | administración del DER |

**`seed`:** crea el grupo configurado, el rol base, el rol administrador con `"*": true` y lo asigna como principal a `admins`.

## Acciones de seguridad personalizadas

Por defecto cada ruta se evalúa con su id autogenerado (`DELETE:/producto/{iproducto}`). En el registro se puede vincular a una acción propia, que además puede compartirse entre rutas:

```ts
new ServerController(ProductoEntity, {
  db,
  security: {
    public: ["list", "get"],
    actions: {
      delete: "productos.eliminar",
      put: "productos.editar", putList: "productos.editar",       // dos rutas, una acción
      getCfg: "productos.config", putCfg: "productos.config",     // un id para leer y escribir (como CFG:/ de ISS)
    },
  },
  routes: [{ method: "GET", path: "reportes/ventas", security: { protected: true, permissions: true, action: "reportes.ver" },
    async handler(_i, ctx) { const ok = await (ctx.state.can as CanFn)("auditoria"); /* ... */ } }],
});
createServer(permissionsServer, { db, cfg: { grupo: "API", actions: ["auditoria"] } });   // capacidades sólo de código
```

- Una acción compartida por varios verbos admite un valor partido: `{ "GET": true, "PUT": false }`.
- **`ctx.state.can(accion, entidad?)`** evalúa la puerta de permisos desde el handler o los hooks. Sin puertas responde permitido (skip); con sesión anónima, el plugin de permisos niega.
- **Catálogo** (`GET /permisos?catalogo=1`): `[{ id, routes: [{ id, method, path }] }]`. Las capacidades solo de código aparecen con `routes: []`.
- **Perfil:** las acciones compartidas por varios verbos se informan por verbo.
- **Carga del DER:** solo admite acciones declaradas (las de rutas, las personalizadas y las de `cfg.actions`) o `"*"`.

## Anatomía de un plugin JSON

```
src/03-plugins/<plugin>/
  schemas.ts   tipos (uno por línea) y Zod compartidos (sólo zod: seguro para el cliente)
  index.ts     el JSON TRANSVERSAL (`PluginDef`): entities (schema, singular/plural, table, exposed, administrable, security, hooks, paths…) e irregularPaths
  server.ts    `Obj.insert(transversal, { ...particularidades })`: handlers de los paths, hidden/actions/expose por entidad, security (puertas), cfg (Zod), seed, setup
```

- **El client y el server hablan el mismo idioma:** el server no es otro JSON, es el transversal con un push encima. Lo que el JSON define de la entidad (`EntityDef`) va a la entidad; lo demás (`hidden`, `actions`, `expose`, `sse`, `handler`/`sse` de endpoints y paths…) a la config del `ServerController`.
- **`exposed` y `administrable` explícitos por entidad:** `exposed: false` no publica ninguna ruta de la entidad; `administrable: false` publica solo lecturas (list, get, query, doc, getCfg): así el consumidor decide qué entidades del plugin se administran por CRUD (y el DER de permisos puede dar permisos sobre ellas).
- **Pojos indirectos:** `plugin.controllers.usuarios.pojo({ iusuario: "ana" })` o `registry.pojo("usuarios", ...)`; el plugin nunca exporta clases.
- **Paths irregulares** (`IrregularPath`: `{ method, path, prefix?, pks?, security?, zod?, returns?, ops? }`): dentro de una entidad (`paths`) cuelgan de su `plural` (default) o `singular`, y con `pks: true` llevan las pks (`usuario/{iusuario}/sufijo`, el handler las recibe en `input.pks`); a nivel de plugin (`irregularPaths`) no pertenecen a ninguna entidad. El client los llama con `plugin.call("path", body?, pks?)` (valida `zod` antes del fetch); el server les pone `handler(input, ctx)` / `sse(input, send, ctx)` con `this` = el plugin armado.
- **`ops` de cada path:** funciones con `this` = el plugin armado (`ClientPlugin` o `ServerPlugin`) que quedan como métodos (`auth.login()`); las del `index.ts` son de cliente, las del `server.ts` de server, y el server puede sobreescribir las del cliente.
- `tests/arch/arch.test.ts` vigila la estructura y que ninguna entrada de cliente alcance nada del servidor (ni por `import type`).

### Clientes

```ts
import { createClient, identity, permissions } from ".../src/03-plugins/client.ts";

const auth = createClient(identity, { baseUrl: "/api", onToken: (t) => guardar(t) });
await auth.login({ usuario: "ana", password: "..." });        // valida con el mismo Zod que el server; deja registry.session
const productos = new ClientController(ProductoEntity, { baseUrl: "/api", headers: auth.headers });  // manda el token
const permisos = createClient(permissions, { baseUrl: "/api", headers: auth.headers });
const { perms } = await permisos.profile();                     // GET /permisos
await permisos.load({ roles: [...], acciones: [...] });         // PUT /permisos
await permisos.catalog();                                       // GET /permisos?catalogo=1
await permisos.controllers.roles.query({ include: { acciones: true } });    // CRUD/list del DER
await auth.controllers.usuarios.post({ iusuario: "beto", password: "..." });
await auth.logout();                                            // DELETE usuario/logout, olvida el token y la sesión singleton
```

## Escribir un plugin propio

```ts
export const auditoria: PluginDef = {
  name: "auditoria",
  entities: {
    registros: {
      singular: "auditoria/registro", plural: "auditoria/registros", schema: {...}, security: true,
      exposed: true, administrable: false,                                   // solo lectura por CRUD
      paths: { resumen: { method: "GET", path: "resumen", security: "protected", ops: { resumen(this: ClientPlugin) { return this.call("resumen"); } } } },   // auditoria/registros/resumen
    },
  },
  irregularPaths: { salud: { method: "GET", path: "auditoria/salud" } },     // no pertenece a una entidad
};
export const auditoriaServer: ServerPluginDef = Obj.insert(auditoria, {
  entities: { registros: { paths: { resumen: { async handler(this: ServerPlugin) { return this.controllers.registros.query({ pageSize: 10 }); } } } } },
  irregularPaths: { salud: { handler: () => ({ ok: true }) } },
  security: { permissions(this: ServerPlugin, info, action) { /* otra capa más */ return { allowed: true }; } },
  async seed(this: ServerPlugin) { /* datos iniciales */ },
});
```

## Endurecimiento del login (`cfg.security` de identidad)

Configuración opcional, validada con `ZIdentitySecurityConfig` (`.strict()`). Sin ella el plugin se comporta como antes (sólo sesión y revocación), salvo que la auditoría de intentos y eventos **siempre** se escribe.

```ts
createServer(identityServer, { db, cfg: {
  secret: "env:JWT_SECRET",
  security: {
    maxAttempts: 5,        // fallos por IP o usuario antes de bloquear (1..100)
    windowSeconds: 900,    // ventana de conteo
    lockSeconds: 900,      // duración del bloqueo
    blockNewDevice: false, // true: rechaza un equipo no visto antes
    travel: { enabled: true, minMinutes: 5, block: false }, // cambio de IP en ventana corta
    password: { minLength: 12 }, // mínimo real: 8
  },
}});
```

### Tablas de auditoría

| Tabla | Contenido |
|---|---|
| `identity_intentos` | un renglón por intento: `ip`, `user_agent`, `dispositivo`, `so`, `navegador`, `resultado` (`ok`/`fallo`/`bloqueado`), `motivo`, `creado` |
| `identity_eventos` | `login`, `logout_all`, `password`, `bloqueo`, `dispositivo_nuevo`, `viaje_imposible` con `ip`, `user_agent`, `dispositivo` y `jdata` libre |
| `identity_sesiones` | `jti`, `iusuario`, `emitido`, `expira`, `brevocado` + `ip`, `user_agent`, `dispositivo`, `so`, `navegador`, `huella` y `ultimo_acceso` (throttle de 60 s) |

### Decisiones

1. **IP real:** con `trustProxy: N`, el salto N desde el final de `X-Forwarded-For`; con 0 (default), el primero; luego `X-Real-IP`.
2. **Dispositivo:** se deriva del `user-agent` (sin dependencias; `src/03-plugins/common/device.ts`) y se identifica con `huella` = SHA-256 del UA.
3. **Bloqueo:** cuenta fallos por **IP o usuario** dentro de `max(windowSeconds, lockSeconds)`; al alcanzar `maxAttempts` responde **429** «Demasiados intentos fallidos» incluso con la contraseña correcta, y expira solo.
4. **Dispositivo nuevo:** el primer login de un usuario nunca es «nuevo»; se compara la `huella` contra sus sesiones.
5. **Viaje imposible (básico):** sin geolocalización; cambia la IP y pasan menos de `travel.minMinutes` desde el último login correcto. Con `block: true` responde 403; si no, sólo se audita.
6. **Cambio de contraseña:** exige la actual, aplica `password.minLength`, prohíbe reutilizar la misma y revoca todas las demás sesiones (la actual sigue viva). Registra el evento `password`.
