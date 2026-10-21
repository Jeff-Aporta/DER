# Skill: entidades de permisos (plugin de permisos)

[← temario](README.md) · general: [plugins.md](plugins.md) · referencia: `docs/050-Plugins/010-Seguridad.md`

## DER (todas expuestas y administrables: un rol con permiso edita el DER por CRUD)

| Clave | Ruta | Tabla | Campos |
|---|---|---|---|
| `grupos` | `permisos/grupo(s)` | `permisos_grupos` | `igrupo`, `nombre` |
| `roles` | `permisos/rol(es)` | `permisos_roles` | `irol`, `igrupo`, `nombre`, `bactivo` |
| `rolesUsuario` | `permisos/rolusuario` · `permisos/rolesusuario` | `permisos_rolesusuario` | `iusuario`, `irol`, `finicial`, `ffinal`, `bprincipal` (relación `usuario` → `identity.usuarios` si existe) |
| `acciones` | `permisos/accion(es)` | `permisos_accionesrol` | `irol`, `iaccion`, `valor` (json) |

## Paths irregulares

| Op | Ruta | Sesión | Qué hace |
|---|---|---|---|
| `profile()` | `GET permisos` | opcional | `{ usuario, irol, igrupo, roles, perms }` (anónimo: rol base, `perms: {}`) |
| `catalog()` | `GET permisos?catalogo=1` | sí + permiso de carga | `[{ id, routes }]`: acciones evaluables (alias aplicados) |
| `load(der)` | `PUT permisos` | sí + permisos | upsert de `{ grupos, roles, rolesusuario, acciones }` en una transacción |
| server: `can(info, accion, verbo)` | — | — | decisión en proceso |

## Reglas del vector de acciones

1. **Rol base** (default `USR`, configurable con `rolBase`): define los valores por defecto de TODOS. Un rol particular solo escribe diferencias: cargar en un rol un valor igual al del base es un error 400 («Acciones que repiten el valor del rol base …»).
2. Roles vigentes del usuario (activos, en fecha, del `grupo` configurado), el principal primero; sin rol vigente, el base.
3. Valor efectivo: rol → base; id exacto → `"*"`; valor partido por verbo `{ GET: true, PUT: false }` aporta solo el del verbo.
4. Decisión: sin valor o `{ protected: true }` → pasa (o niega con `denyByDefault`); `false` → 403; otro valor → pasa y viaja en `ctx.state.permiso`.

## Ids de acción y alias

- Por defecto, el id de la ruta: `DELETE:/producto/{iproducto}`, `GET:/productos` (`list` y `query` comparten id)…
- `/cfg` es UNA acción para GET y PUT: `CFG:/productos`.
- Personalizadas en el registro: `security: { actions: { delete: "productos.eliminar", getCfg: "productos.config", putCfg: "productos.config" } }`; en rutas irregulares `security: { protected: true, permissions: true, action: "reportes.ver" }`; capacidades solo de código en `cfg.actions`.
- **Alias** (`cfg.aliases`): `{ "DELETE:/producto/{iproducto}": "productos.borrar", "CFG:/productos": "productos.config" }` renombra lo que se quema en la BD; catálogo, perfil, carga y puerta usan el alias.

## Configuración

```ts
createServer(permissionsServer, { db, cfg: { grupo: "API", rolBase: "USR", rolAdmin: "ADMIN", admins: ["admin"], actions: ["auditoria"], denyByDefault: false, aliases: {} } });
```

`seed()` crea el grupo, el rol base, el rol admin con `"*": true` y asigna `admins`.

## Cliente

```ts
const permisos = createClient(permissions, { baseUrl: "/api", headers: auth.headers });
const { perms } = await permisos.profile();
await permisos.load({ roles: [{ irol: "VENDEDOR", igrupo: "API" }], acciones: [{ irol: "VENDEDOR", iaccion: "POST:/producto", valor: true }] });
await permisos.controllers.roles.query({ include: { acciones: true } });
```
