---
Titulo: "Permisos: roles, acciones y matriz (RBAC en la base)"
Estado: vigente
Autor:
tags: [plugins, permisos, rbac, roles, acciones, matriz, multiempresa]
---
# Permisos (RBAC)

El transversal de **roles y permisos**: el codigo no conoce nombres de rol, solo comprueba **ACCIONES**
(`usuarios.rol`, `tiquetes.ver`). Los roles, el catalogo de acciones y la matriz (rol x accion) viven **en la base**:
cambiar un permiso es un `PUT`, no un despliegue.

No confundir con el plugin de [seguridad](010-Seguridad.md) (`permissions`): aquel trae grupos, roles y un vector de
acciones por verbo para las tablas del DER; este trae el catalogo de acciones del **negocio** (bandeja, chat, tiquetes,
errores, empresa) con su matriz por rol, y es el que usa el CRM.

## Entidades

| Tabla | Columnas |
|---|---|
| `permisos_roles` | `irol` (pk), `iempresa` (null = GLOBAL), `clave`, `nombre`, `descripcion`, `etiqueta`, `nivel`, `sistema`, `bactivo`, `fhcre` |
| `permisos_acciones` | `clave` (pk), `grupo`, `descripcion`, `orden`, `sistema` |
| `permisos_rol_accion` | `irol` + `clave` (pk), `permitido` — la matriz editable |
| `permisos_usuarios_roles` | `iusuario` + `iempresa` + `irol` (pk), `fhcre`, `fhasigno` |

- `irol`: la clave si el rol es global (`propietario`), `empresa:clave` si es de una empresa (`acme:supervisor`).
- `iempresa` null = rol GLOBAL: aplica en cualquier empresa. La empresa global se escribe `*` (tambien valen "" y "todas").
- `nivel` ordena y desempata (badge, rol principal); **no concede permisos**.
- `sistema: true` = rol o accion de fabrica: no se borra, pero **su matriz se edita**.

## La semilla

`seed()` inserta **solo lo que falta** (si el rol o la accion ya existe, no se toca: el dueno manda). Para anadir sin
desplegar: `PUT permisos/acciones` (accion nueva) o `PUT permisos/roles/{irol}/matriz` (celdas).

- **8 roles**: `propietario` (ROOT, todo), `gerente` (GERENTE, todo menos `permisos.editar`), `admin` (ADMN, opera sin
  `permisos.*` ni `empresa.canales` ni `errores.gestionar`), `auditor` (AUDITOR, vigila), `agente` (AGENTE, atiende),
  `wrkr` (WRKR, **solo tiquetes**: ver, adoptar, estado, comentar y cerrar), `lector` (LECTURA, solo lee) y `cliente`
  (CLIENTE, cliente final sin permisos).
- **41 acciones** en 17 grupos (`permisos`, `inbox`, `chat`, `contactos`, `prospectos`, `metricas`, `usuarios`,
  `empresa`, `notificaciones`, `retencion`, `tiquetes`, `errores`, `salud`, `csat`, `entrenamientos`, `adjuntos`).
- `errores.gestionar` queda **solo para propietario y gerente**; el admin tiene `errores.ver`.

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

## Verbos (server)

| Verbo | Que hace |
|---|---|
| `puede(usuario, empresa, clave)` | decision (true/false) |
| `exigir(usuario, empresa, clave)` | lanza 403 si no puede |
| `permisosDe(usuario, empresa)` | mapa accion -> permitido |
| `rolesDe(usuario, empresa)` | los roles vigentes del usuario en esa empresa |
| `misPermisos(usuario, empresa)` | rol principal, roles y mapa completo |
| `catalogo()` | el catalogo de acciones |
| `roles(empresa)` | los roles visibles en esa empresa |
| `matriz(irol)` | la matriz del rol contra el catalogo |
| `crearRol` / `editarRol` / `borrarRol` / `ponerMatriz` / `crearAccion` | administracion (exigen actor y nivel) |
| `rolesUsuario` / `asignarRoles` / `quitarRol` / `ponerRoles` | asignacion de roles a usuarios |
| `exigirPermiso(ctx, clave)` / `tienePermiso(ctx, clave)` | en un handler: leen la sesion y la empresa activa |

## Reglas

- El permiso se resuelve por **ACCION**: para cada rol vigente del usuario, la celda explicita gana sobre el comodin
  `*` del mismo rol; los roles se **suman** (union: el permiso de cualquiera vale).
- La empresa sale de `services.contexto` (el que la resuelve y valida) o, si no hay, de la cabecera `x-empresa`.
- Un rol global solo lo edita quien tenga comodin; nadie asigna ni edita un rol de nivel igual o superior al suyo.
- Los roles de una empresa **no aplican** en otra (salvo los globales).
- Alias de compatibilidad: si el usuario no tiene filas en `permisos_usuarios_roles`, el servidor puede derivar su rol
  del servicio `rolesDerivados` (en el CRM, `crm_miembros.rol`).

## Configuracion

```ts
createServer(permisosServer, {
  db,
  cfg: { cabeceraEmpresa: "x-empresa", empresaGlobal: "*", accionesExtra: [{ clave: "miapp.facturar", grupo: "miapp" }], asignaciones: [{ iusuario: "u1", iempresa: "acme", roles: ["propietario"] }] },
  services: { contexto },
});
```

## Errores comunes

- Cambiar la semilla no cambia nada: la semilla es de arranque. Edita la **matriz** (`PUT .../matriz`) o la fila.
- `403` en una ruta: al usuario le falta la accion en la **empresa activa**; revisa `x-empresa` y la asignacion.
- Asignar un rol de otra empresa da 403: los roles de empresa no se comparten.
- Poner en la matriz una accion que no esta en el catalogo da 400: primero `PUT permisos/acciones`.
