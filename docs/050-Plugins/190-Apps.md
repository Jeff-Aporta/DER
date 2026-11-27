---
Titulo: "Apps: la instancia de negocio (iapp) con su marca, su modo y su purga"
Estado: vigente
Autor:
tags: [plugins, apps, iapp, aislamiento, purga, marcas]
---
# Apps (la instancia de negocio)

Una **app** es el clon que se **aísla** del resto: su `iapp` (el identificador de la instancia) viaja en la cabecera
`X-App` —o en la sesión— y **toda** entidad de su ámbito lo filtra. Una empresa del CRM puede tener varias apps
(`riogo24`, `hotel-bogota`…), y cada una es **removible**: un comando de purga borra todo lo suyo.

La app guarda lo que el front necesita para **pintarse** (marca, modo, servidor) y lo que el CRM necesita para
**administrarla** (empresa, si es demo, soporte de WhatsApp). No guarda el negocio: el catalogo, los pedidos y los pagos
viven en sus propios plugins, siempre con `iapp`.

## Tabla

| Tabla | Columnas |
|---|---|
| `apps_apps` | `iapp` (pk), `nombre`, `modo`, `iempresa`, `bdemo`, `servidor`, `marca` (json), `soporte_wa`, `contacto_wa`, `fhcre` |

- `iapp`: la clave de la instancia (`riogo24`). Es texto libre, pero se normaliza a minúsculas y sin espacios.
- `modo`: `restaurante | tienda | hotel | barberia | salon`. Decide la plantilla, los textos y el flujo: `restaurante`
  y `tienda` son productos con carrito; `hotel`, `barberia` y `salon` son servicios con reserva.
- `iempresa`: la empresa del CRM que administra la app (puede estar vacía: una app de prueba vive suelta).
- `bdemo`: la app es de demostración. **Solo** una app demo se puede purgar sin `forzar`.
- `servidor`: la URL del API que atiende la app (la lee el front para hablar con el backend).
- `marca`: json `{ colores: [], logo, favicon }` (lo que pinta el front).
- `soporte_wa` / `contacto_wa`: si la empresa contrató soporte por WhatsApp y el número de contacto.
- `fhcre`: cuándo se creó.

## Rutas

| Ruta | Seguridad | Que hace |
|---|---|---|
| `GET apps/{iapp}/publica` | publica | la app tal como la ve el front: `nombre`, `modo`, `marca`, `servidor`, `contacto_wa` (nada de datos internos) |
| `GET apps?modo=&iempresa=&q=` | `apps.administrar` | las apps del ámbito (la del `X-App` si lo hay; si no, las de la empresa de la sesión) |
| `POST apps` | `apps.administrar` | crea la app (el `iapp` se deduce del nombre si no viene) |
| `PUT apps/{iapp}` | `apps.administrar` | cambia lo editable de la app (el `iapp` **no** cambia) |
| `PUT apps` | `apps.administrar` | lo mismo, con el `iapp` en el cuerpo |

La **publica** no exige sesión y filtra: no devuelve ni la empresa, ni si es demo, ni la fecha de creación, ni la clave.
Solo lo que el front puede pintar.

## El ámbito (`ambitoApp`)

```ts
import { ambitoApp } from "@Jeff-Aporta/DER/src/03-plugins/apps/index.ts";

const iapp = ambitoApp(ctx);        // la cabecera X-App o el claim iapp de la sesión; 400 si no hay ninguna
```

Es el helper que usan los demás plugins (catalogo, pedidos, pagos, reservas): **toda** ruta de datos filtra por `iapp`, y
si la petición no trae ámbito, la respuesta es un **400** ("Falta el ambito de la app: usa la cabecera X-APP"), nunca un
listado entero.

La lista de apps también respeta el aislamiento: con `X-App` devuelve **solo** esa app; sin él, las de la empresa de la
sesión (`iempresa` de la sesión o cabecera `X-Empresa`); sin empresa tampoco (el instalador), todas.

## La purga (el clon removible)

```ts
const r = await apps.purgarApp("riogo24", ["apps_apps", "catalogo_productos", "pagos_intentos"]);
// { iapp: "riogo24", tablas: [{ tabla: "catalogo_productos", borrados: 171 }], total: 171 }
```

- Borra **todas** las filas con ese `iapp` en las tablas indicadas (cada tabla debe ser una entidad de DER de la **misma
  base** que el plugin y tener la columna `iapp`).
- Si `apps_apps` va en la lista, también se borra la fila de la app (el clon desaparece entero).
- Solo se purga una app **demo** (`bdemo`); para las demás hace falta `forzar` (403 sin él).
- Una app que no existe da 404 y una tabla que no administra ningún controller de esa base da 400.

## Permisos

| Acción | Qué protege |
|---|---|
| `apps.administrar` | la lista, el alta y el cambio de apps |

La puerta la trae el plugin `permissions` (matriz rol × acción en la base). Sin ese plugin, las rutas exigirán sesión y
listo.

## Errores comunes

- **400** "Falta el ambito de la app": la petición no trae `X-App` ni claim `iapp`.
- **403** "La app «x» no es demo: la purga exige forzar": la purga de una app real necesita `forzar`.
- **404** "Esa app no existe": el `iapp` no está dado de alta.
- **409** "Ya existe una app con ese iapp": la clave es única.
- Un `PUT` no cambia el `iapp`: para cambiarlo hay que dar de alta otra app.
