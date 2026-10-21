---
Titulo: Seguridad: identidad y permisos
Estado: vigente
Autor:
tags: [plugins, seguridad, jwt]
---
# Seguridad: plugins de identidad y permisos

[← índice](../README.md) · `src/03-plugins/` · tipos y Zod en `src/03-plugins/schemas.ts` · contrato de plugin (`Plugin`, `RouteSecurity`, `SecurityDef`) en `src/02-controllers/server/schemas.ts`

Destilado de SEG de ISS-AyudasCPIA, con **ids únicos string** (sin pares `itercero/icontacto`) y como **plugins** del Router: si no se cargan, la seguridad se omite.

## Integración: un JSON global

```ts
import { pluginsFromConfig } from ".../src/03-plugins/index.ts";

const plugins = pluginsFromConfig({
  identity: { secret: "env:JWT_SECRET", expiresIn: 86400, admin: { usuario: "admin", password: "env:ADMIN_PASSWORD" } },
  permissions: { grupo: "API", rolBase: "USR", rolAdmin: "ADMIN", denyByDefault: false },
}, { db, env });                       // env: en Workers, el del fetch; si no, el del proceso

const router = createRouter(ctrls, { basePath: "/api", plugins });
await router.seed();                   // tablas de todos (incl. plugins) + seed de cada plugin
```

| Plugins cargados | Rutas `protected` | Matriz de permisos |
|---|---|---|
| ninguno | se sirven sin JWT (skip) | no |
| `identity` | exigen JWT válido y vigente (401) | no |
| `identity` + `permissions` | exigen JWT | sí: rol → acción (403 si se niega) |

La configuración se valida con `ZPluginsConfig` (`.strict()`). `"env:NOMBRE"` se resuelve con `resolveEnv`.

## Qué protege cada registro (por endpoint)

```ts
new ServerController(ProductoEntity, {
  db, table: "productos",
  security: { public: ["list", "get", "doc"] },   // el resto: JWT + permisos
});
new ServerController(PedidoEntity, { db, table: "pedidos", security: true });            // todo protegido + permisos
new ServerController(NotaEntity,   { db, table: "notas",   security: { permissions: false } }); // sólo JWT
// sin `security`: pública
routes: [{ method: "GET", path: "reportes/x", security: { protected: true, permissions: true }, handler }]
```

`SecurityDef`: `public` (gana), `protected` (`true` = todas las no públicas, o la lista) y `permissions` (default `true`). `/doc` es pública por defecto (contexto para agentes); para protegerla, inclúyela en la lista `protected`. La seguridad se resuelve por ruta (`RouteInfo.security`): es por endpoint, como en una API.

Orden en cada request: autenticación (identidad) → autorización (permisos) → `guard` → `pre*`/`preConfirm` → acción. En una ruta pública la identidad se intenta igual (`ctx.state.identity`), pero un token inválido no la bloquea. `ctx.state.identity` y `ctx.state.permiso` (el valor efectivo) llegan a los handlers y hooks.

## Plugin de identidad (`src/03-plugins/identity/`)

| Ruta | Seguridad | Qué hace |
|---|---|---|
| `POST /login` `{ usuario, password }` | pública | `{ token, tipo: "Bearer", expira, usuario }` · 401 «Usuario o contraseña inválidos» |
| `DELETE /logout` | JWT | revoca la sesión del token (204); el mismo token responde 401 después |
| `DELETE /logout/all` | JWT | revoca **todas** las sesiones del usuario y devuelve `{ revocadas }` |
| `GET /sessions` | JWT | sesiones vigentes con IP, dispositivo, SO, navegador, último acceso y `actual` |
| `PUT /password` `{ actual, nueva }` | JWT | exige la actual, aplica la política, revoca las demás sesiones |
| `GET /events` | JWT | auditoría filtrable por `iusuario`, `accion`, `desde`, `hasta`, `limit`, `offset` |
| CRUD + list `usuario` / `usuarios` | JWT + permisos | alta/edición de usuarios; `password` se recibe y nunca se guarda ni devuelve |

- **Usuarios:** `permisos_usuarios (iusuario string pk, nombre, email, bactivo, jdata, creado, hash)`. `hash` es una columna `hidden`: no se selecciona, no se retorna y no se puede pedir ni filtrar en `query()` (400).
- **Hash:** PBKDF2-SHA256 (100 000 iteraciones por defecto, el máximo de Workers) sobre `HMAC-SHA256(secret, contraseña)`: la secret key es un *pepper*. Sal aleatoria de 16 bytes. Formato: `pbkdf2-sha256$<iter>$<sal>$<hash>`. La comparación es en tiempo constante.
- **JWT HS384** con `sub` (iusuario), `jti` (sesión), `iat`, `exp`, `iss?` y `nombre?`. La verificación solo acepta HS384 (un `alg: none` se rechaza), distingue «Token vencido» de «Token inválido: …» y exige la sesión `permisos_sesiones (jti, iusuario, emitido, expira, brevocado)` vigente y el usuario activo. **El rol no viaja en el token:** se lee en cada request, así un cambio aplica de inmediato.
- **`seed`:** crea `admin` si está configurado y no existe.
- La secret key debe tener al menos 32 caracteres y nunca se versiona: va por `env:`.

## Plugin de permisos (`src/03-plugins/permissions/`)

### DER

```
permisos_grupos        (igrupo pk, nombre)                              grupo al que pertenecen los roles
permisos_roles         (irol pk, igrupo, nombre, bactivo)               el rol pertenece a un grupo
permisos_rolesusuario  (iusuario pk, irol pk, finicial, ffinal, bprincipal)   vigencia y rol principal; relación `usuario` → `Usuario` (identidad)
permisos_accionesrol   (irol pk, iaccion pk, valor json)                iaccion = id de ruta, acción personalizada o "*"
```

### Vector de acciones

1. Roles del usuario **vigentes** (`finicial ≤ ahora < ffinal`), **activos** y de roles del **grupo configurado**. El principal va primero. Sin rol vigente, el usuario es el rol base.
2. Efectivo(R) = (base − ids de R) + R. Primero el id exacto y luego el comodín `"*"`. Un valor partido por verbo (`{ "GET": true, "PUT": false }`) aporta solo el del método.
3. Decisión: sin valor o `{ "protected": true }` pasa (o se niega con `denyByDefault`); `false` → 403; `true`, un objeto o un texto pasan y el valor viaja en `ctx.state.permiso` (p.ej. `{ "descuentoMax": 10 }`).

Los ids son los de la tabla de rutas: `DELETE:/producto/{iproducto}`, `POST:/productos/query`…

### Rutas

| Ruta | Seguridad | Qué hace |
|---|---|---|

El recurso es uno solo, `/permisos`, y el verbo HTTP decide la operación: no hay sufijos de acción en la ruta.

| `GET /permisos` | pública | perfil `{ usuario, irol, igrupo, roles, perms }`; sin token, el anónimo (`perms: {}`) |
| `PUT /permisos` | JWT + permisos | carga el DER `{ grupos, roles, rolesusuario, acciones }`: upsert en una transacción; `iaccion` puede ser el id de una ruta, una acción personalizada (`security.actions` del controller) o "\*" (todas) |
| `GET /permisos?catalogo=1` | JWT + el permiso de `PUT /permisos` | acciones evaluables con sus rutas (para administrar acciones por rol) |
| CRUD + list `permisos/grupo(s)`, `permisos/rol(es)`, `permisos/rolusuario` (`rolesusuario`), `permisos/accion(es)` | JWT + permisos | administración del DER |

**`seed`:** crea el grupo configurado, el rol base, el rol administrador con `"*": true` y lo asigna como principal a `admins` (y al admin de identidad).

## Escribir un plugin propio

```ts
const auditoria: Plugin = {
  name: "auditoria",
  controllers: [registroCtrl],
  routes: [{ method: "GET", path: "auditoria", security: true, handler() { /* ... */ } }],
  async authorize(route, identity, ctx) { /* otra capa más */ return { allowed: true }; },
  async seed(router) { /* datos iniciales */ },
};
```

## Acciones de seguridad personalizadas

Por defecto cada ruta se evalúa con su id autogenerado (`DELETE:/producto/{iproducto}`). En el registro se puede vincular a una acción propia, que además puede compartirse entre rutas:

```ts
new ServerController(ProductoEntity, {
  db, table: "productos",
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
pluginsFromConfig({ ..., permissions: { grupo: "API", actions: ["auditoria"] } }, { db });   // capacidades sólo de código
```

- Una acción compartida por varios verbos admite un valor partido: `{ "GET": true, "PUT": false }`.
- **`ctx.state.can(accion, metodo?)`** evalúa una acción desde el handler o los hooks. Sin plugins de seguridad
  responde permitido (skip); con identidad pero sin token, denegado.
- **Catálogo** (`GET /permisos?catalogo=1`): `[{ id, routes: [{ id, method, path }] }]`. Las capacidades solo de
  código aparecen con `routes: []`.
- **Perfil:** las acciones compartidas por varios verbos se informan por verbo.
- **Carga del DER:** solo admite acciones declaradas (las de rutas, las personalizadas y las de
  `permissions.actions`) o `"*"`.

## Estructura estándar de cada plugin

```
src/03-plugins/<plugin>/
  schemas.ts        tipos y Zod compartidos (sólo zod: seguro para el cliente)
  Objetos/          un archivo por entidad (schema JSON, POJO, entidad) + mod.ts
  Controladores/    server.ts (ServerControllers + rutas del plugin), client.ts (ClientControllers), utilidades de servidor
  mod.ts            entrada de servidor (todo)
  client.ts         entrada de cliente (schemas + Objetos + Controladores/client): sólo zod
```

`src/03-plugins/schemas.ts` tiene la configuración global y los contratos del lado servidor (`IdentityPlugin`, `PermissionsPlugin`); `src/03-plugins/client.ts` reúne los dos clientes. `tests/arch.test.ts` vigila la estructura y que ninguna entrada de cliente alcance nada del servidor (ni por `import type`).

### Clientes

```ts
import { IdentityClient, PermissionsClient } from ".../src/03-plugins/client.ts";

const auth = new IdentityClient({ baseUrl: "/api", onToken: (t) => guardar(t) });
await auth.login({ usuario: "ana", password: "..." });        // valida con el mismo Zod que el server
const productos = new ClientController(ProductoEntity, { baseUrl: "/api", headers: auth.headers });  // manda el token
const permisos = new PermissionsClient({ baseUrl: "/api", headers: auth.headers });
const { perms } = await permisos.profile();                     // GET /permisos
await permisos.load({ roles: [...], acciones: [...] });         // PUT /permisos
await permisos.catalog();                                       // GET /permisos?catalogo=1
await permisos.roles.query({ include: { acciones: true } });    // CRUD/list del DER
await auth.usuarios.post({ iusuario: "beto", password: "..." });
await auth.logout();                                            // DELETE /logout y olvida el token
```

## Endurecimiento del login (`identity.security`)

Configuración opcional, validada con `ZIdentitySecurityConfig` (`.strict()`). Sin ella el plugin se comporta
como antes (sólo JWT y revocación), salvo que la auditoría de intentos y eventos **siempre** se escribe.

```ts
identity: {
  secret: "env:JWT_SECRET",
  security: {
    maxAttempts: 5,        // fallos por IP o usuario antes de bloquear (1..100)
    windowSeconds: 900,    // ventana de conteo
    lockSeconds: 900,      // duración del bloqueo
    blockNewDevice: false, // true: rechaza un equipo no visto antes
    travel: { enabled: true, minMinutes: 5, block: false }, // cambio de IP en ventana corta
    password: { minLength: 12 }, // mínimo real: 8
  },
}
```

### Tablas de auditoría

| Tabla | Contenido |
|---|---|
| `permisos_intentos` | un renglón por intento: `ip`, `user_agent`, `dispositivo`, `so`, `navegador`, `resultado` (`ok`/`fallo`/`bloqueado`), `motivo`, `creado` |
| `permisos_eventos` | `login`, `logout_all`, `password`, `bloqueo`, `dispositivo_nuevo`, `viaje_imposible` con `ip`, `user_agent`, `dispositivo` y `jdata` libre |
| `permisos_sesiones` | amplía con `ip`, `user_agent`, `dispositivo`, `so`, `navegador`, `huella` y `ultimo_acceso` (throttle de 60 s) |

> **Migración:** `router.seed()` usa `CREATE TABLE IF NOT EXISTS`; en una base existente las columnas nuevas de
> `permisos_sesiones` se crean con `syncSchema()` (o recreando la tabla). Las tablas nuevas sí se crean solas.

### Decisiones

1. **IP real:** primer salto de `X-Forwarded-For`, luego `X-Real-IP`; sin socket en la API Web.
2. **Dispositivo:** se deriva del `user-agent` (sin dependencias) y se identifica con `huella` = SHA-256 del UA.
3. **Bloqueo:** cuenta fallos por **IP o usuario** dentro de `max(`windowSeconds`, `lockSeconds`)`; al alcanzar
   `maxAttempts` responde **429** «Demasiados intentos fallidos» incluso con la contraseña correcta, y expira solo.
4. **Dispositivo nuevo:** el primer login de un usuario nunca es «nuevo»; se compara la `huella` contra sus sesiones.
5. **Viaje imposible (básico):** sin geolocalización; cambia la IP y pasan menos de `travel.minMinutes` desde el
   último login correcto. Con `block: true` responde 403; si no, sólo se audita.
6. **Cambio de contraseña:** exige la actual, aplica `password.minLength`, prohíbe reutilizar la misma y revoca
   todas las demás sesiones (la actual sigue viva). Registra el evento `password`.
