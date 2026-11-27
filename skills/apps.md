# Skill: apps (la instancia de negocio)

[← temario](README.md) · referencia: `docs/050-Plugins/190-Apps.md`

## Que es

La **app** es el clon aislable del negocio: su `iapp` viaja en la cabecera `X-App` (o en la sesion) y **toda** entidad de
su ambito lo filtra (catalogo, pedidos, pagos, reservas). Una empresa del CRM puede tener varias apps; cada una se
purga entera (se lleva su catalogo, sus pedidos y sus pagos).

La app guarda lo que el front necesita para pintarse (marca, modo, servidor) y lo que el CRM necesita para
administrarla (empresa, si es demo, soporte de WhatsApp). El negocio NO vive aqui.

## Montar

```ts
const apps = crearApps({ db, cfg: { cabecera: "x-app" } });   // o createServer(appsServer, { db, cfg: {} })
const router = createRouter(ctrls, { basePath: "/api", plugins: [apps] });
await router.seed();
```

Cliente:

```ts
const apps = createClient(appsPlugin, { baseUrl: "/api", headers: { "x-app": "riogo24" } });
const publica = await apps.publica("riogo24");                 // { nombre, modo, marca, servidor, contacto_wa }
const lista = await apps.listarApps({ modo: "restaurante" });   // las apps del ambito
await apps.crearApp({ nombre: "Rio Go 24", modo: "restaurante", iempresa: "acme" });
await apps.cambiarApp("riogo24", { modo: "tienda", bdemo: true });
```

## Tablas

| tabla | columnas |
|---|---|
| `apps_apps` | `iapp` (pk), `nombre`, `modo`, `iempresa`, `bdemo`, `servidor`, `marca` (json), `soporte_wa`, `contacto_wa`, `fhcre` |

## Modos

`restaurante | tienda | hotel | barberia | salon`. `restaurante` y `tienda` son productos con carrito; `hotel`,
`barberia` y `salon` son servicios con reserva. El modo decide plantilla, textos y flujo (lo lee el front).

## Rutas

| Ruta | Que hace |
|---|---|
| `GET apps/{iapp}/publica` | la app PUBLICA (sin sesion): `nombre`, `modo`, `marca`, `servidor`, `contacto_wa` y nada mas |
| `GET apps?modo=&iempresa=&q=` | las apps del ambito (permiso `apps.administrar`) |
| `POST apps` | crea la app (el `iapp` se deduce del nombre si no viene) |
| `PUT apps/{iapp}` | cambia lo editable (el `iapp` NO cambia) |
| `PUT apps` | lo mismo, con el `iapp` en el cuerpo |

## El ambito (`ambitoApp`)

```ts
import { ambitoApp } from "@Jeff-Aporta/DER/src/03-plugins/apps/index.ts";

const iapp = ambitoApp(ctx);        // cabecera X-App o claim iapp de la sesion; 400 si no hay ninguno
const iappOpcional = ambitoDe(ctx); // null si la peticion no trae ninguno
```

Lo usan los demas plugins: **toda** ruta de datos de una app filtra por `iapp` y, si la peticion no trae ambito,
responde 400 (nunca un listado entero). La lista de apps tambien: con `X-App` devuelve solo esa app; sin el, las de la
empresa de la sesion (`iempresa` de la sesion o cabecera `X-Empresa`); sin empresa tampoco, todas.

## La purga (el clon removible)

```ts
const r = await apps.purgarApp("riogo24", ["apps_apps", "catalogo_productos", "pagos_intentos"]);
// { iapp, tablas: [{ tabla, borrados }], total }
```

- Borra todas las filas con ese `iapp` en las tablas indicadas (cada tabla debe ser una entidad de DER de la misma base
  que el plugin, con la columna `iapp`).
- Si `apps_apps` va en la lista, tambien se borra la fila de la app.
- Solo se purga una app **demo** (`bdemo`); las demas exigen `forzar` (403 sin el).
- App inexistente: 404. Tabla que no administra ningun controller de esa base: 400.

## Permisos

`apps.administrar` protege la lista, el alta y el cambio (la publica es publica). La puerta la trae el plugin
`permissions` (matriz rol x accion en la base).

## Errores comunes

- **400** "Falta el ambito de la app: usa la cabecera X-APP": la peticion no trae `X-App` ni claim `iapp`.
- **403** "La app «x» no es demo: la purga exige forzar": purgar una app real necesita `forzar`.
- **404** "Esa app no existe": el `iapp` no esta dado de alta.
- **409** "Ya existe una app con ese iapp": la clave es unica.
