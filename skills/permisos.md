# Skill: permisos (RBAC: roles, acciones y matriz en la base)

[← temario](README.md) · general: [plugins.md](plugins.md) · referencia: `docs/050-Plugins/180-Permisos.md`

## Que es

El transversal de **roles y permisos**: el codigo NO conoce nombres de rol, solo comprueba **ACCIONES**
(`usuarios.rol`, `tiquetes.ver`…). Los roles, el catalogo de acciones y la matriz (rol x accion) viven **en la base**:
cambiar un permiso es un `PUT` (o un UPDATE), no un despliegue.

No confundir con [permissions](permissions.md): aquel plugin trae grupos, roles y un vector de acciones por verbo
(`DELETE:/producto/{id}`) para las tablas del DER; este trae el catalogo de acciones del **negocio** (bandeja, chat,
tiquetes, errores, empresa) con su matriz por rol, y es el que usa el CRM.

## Montar

```ts
const permisos = createServer(permisosServer, { db, cfg: { cabeceraEmpresa: "x-empresa" }, services: { contexto } });
const router = createRouter([], { basePath: "/api", plugins: [auth, permisos] });
await router.seed();
```

Cliente:

```ts
const permisos = createClient(permisosPlugin, { baseUrl: "/api", headers: auth.headers });
const { permisos: mapa } = await permisos.misPermisos();     // accion -> permitido
if (mapa["usuarios.rol"]) { ... }                             // el boton solo si puede
```

## Tablas

| tabla | columnas |
|---|---|
| `rbac_roles` | `irol` (pk), `iempresa` (null = GLOBAL), `clave`, `nombre`, `descripcion`, `etiqueta`, `nivel`, `sistema`, `bactivo`, `fhcre` |
| `rbac_acciones` | `clave` (pk), `grupo`, `descripcion`, `orden`, `sistema` |
| `rbac_matriz` | `irol` + `clave` (pk), `permitido` — la matriz editable |
| `rbac_usuarios_roles` | `iusuario` + `iempresa` + `irol` (pk), `fhcre`, `fhasigno` |

- `irol`: la clave si el rol es global (`propietario`), `empresa:clave` si es de una empresa (`acme:supervisor`).
- `iempresa` null = rol GLOBAL: aplica en cualquier empresa. `empresa` = `*` (o vacia, o "todas") = ambito global.
- `nivel` ordena y desempata (badge, rol principal); **no concede permisos**.

## La semilla (dato de arranque, no logica)

`seed()` inserta **solo lo que falta**: si el rol o la accion ya existe, no se toca (el dueno manda). Para anadir
sin desplegar: `PUT permisos/acciones` (accion nueva) o `PUT permisos/roles/{irol}/matriz` (celdas). Cambiar la
matriz de un rol de sistema es lo previsto: **los roles de sistema no se borran, su matriz se edita**.

**8 roles** y **41 acciones** (el catalogo completo, en `ACCIONES_SEMILLA` / `ROLES_SEMILLA`):

| rol | etiqueta | nivel | que puede |
|---|---|---|---|
| `propietario` | ROOT | 100 | todo (`*`) |
| `gerente` | GERENTE | 90 | todo menos `permisos.editar` (no edita matrices) |
| `admin` | ADMN | 80 | opera la empresa, pero sin `permisos.*`, sin `empresa.canales` y **sin `errores.gestionar`** |
| `auditor` | AUDITOR | 70 | vigila: `errores.ver`, `errores.solicitar`, `salud.ver`, `metricas.ver`, `tiquetes.ver`… |
| `agente` | AGENTE | 50 | bandeja, chat, contactos, prospectos y tiquetes |
| `wrkr` | WRKR | 30 | **solo tiquetes**: `ver`, `adoptar`, `estado`, `comentar`, `cerrar` (ni conversaciones, ni errores, ni estadisticas) |
| `lector` | LECTURA | 20 | solo lectura |
| `cliente` | CLIENTE | 10 | cliente final: sin permisos |

`errores.gestionar` queda **solo para propietario y gerente**: el admin tiene `errores.ver` y nada mas.

## Rutas

| Ruta | Que hace |
|---|---|
| `GET permisos/mios` | el rol de la sesion y el mapa COMPLETO accion -> permitido (lo que pinta el front) |
| `GET permisos/puede?clave=usuarios.rol` | decision para la sesion en la empresa activa |
| `GET permisos/roles` | catalogo de roles (globales + los de la empresa) — exige `permisos.ver` |
| `POST permisos/roles` | crea un rol (de empresa o global) y opcionalmente su matriz |
| `PUT permisos/roles/{irol}` | nombre, descripcion, etiqueta, nivel o baja del rol |
| `DELETE permisos/roles/{irol}` | borra un rol de empresa (los de sistema no se borran) |
| `GET permisos/roles/{irol}/matriz` | la matriz del rol contra TODO el catalogo |
| `PUT permisos/roles/{irol}/matriz` | cambia celdas (`{ acciones: [{ clave, permitido }], reemplazar? }`) |
| `GET permisos/acciones` | el catalogo completo de acciones |
| `PUT permisos/acciones` | alta/edicion de una accion (sin desplegar) |
| `GET permisos/usuarios/{iusuario}/roles` | roles del usuario en la empresa activa |
| `PUT permisos/usuarios/{iusuario}/roles` | reemplaza los roles del usuario en la empresa activa |

## Verbos (desde codigo)

```ts
await permisos["exigir"](usuario, empresa, "usuarios.rol");   // 403 si no puede
const ok = await permisos["puede"](usuario, empresa, "usuarios.rol");
const mapa = await permisos["permisosDe"](usuario, empresa);  // accion -> permitido
const mio = await permisos["misPermisos"](usuario, empresa);  // rol, roles y mapa completo
await permisos["exigirPermiso"](ctx, "tiquetes.cerrar");     // en un handler: lee la sesion y la empresa
const puede = await permisos["tienePermiso"](ctx, "tiquetes.cerrar");
```

## Reglas

- El permiso se resuelve por **ACCION**: para cada rol vigente del usuario, la celda explicita gana sobre el
  comodin `*` del mismo rol; los roles se **suman** (union: el permiso de cualquiera vale).
- La empresa sale de `services.contexto` (el que la resuelve y valida) o, si no hay, de la cabecera `x-empresa`.
- Un rol global solo lo edita quien tenga comodin; nadie asigna ni edita un rol de nivel igual o superior al suyo
  (no hay escalada de privilegios).
- Los roles de una empresa **no aplican** en otra (salvo los globales).
- Alias de compatibilidad: si el usuario no tiene filas en `rbac_usuarios_roles`, el servidor puede derivar su
  rol del `servicios.rolesDerivados` (en el CRM, `crm_miembros.rol`).

## Errores comunes

- Cambiar la semilla no cambia nada: la semilla es de arranque. Edita la **matriz** (`PUT .../matriz`) o la fila.
- `403` en una ruta: al usuario le falta la accion en la **empresa activa**; revisa `x-empresa` y la asignacion.
- Asignar un rol de otra empresa da 403: los roles de empresa no se comparten.
- Anadir una accion a la matriz que no esta en el catalogo da 400: primero `PUT permisos/acciones`.
