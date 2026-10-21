# MegaRetail Global S.A. — laboratorio DER

Primer laboratorio de DER: una app completa (API + front) para una cadena de sedes, construida **consumiendo DER
únicamente por CDN** (jsDelivr fijado a un SHA) y el kit de web components `iswc` también por CDN. Hermético: no hay
rutas locales hacia `src/` de DER ni hacia el kit; se puede copiar la carpeta a cualquier sitio y funciona igual.

```
labs/megaretail/
├── api/         Deno + DER server + SQLite (node:sqlite) · dueño del DER del lab (src/domain/) · flujos · reportes ·
│                vendor/megaretail.js (DER cliente + zod + dominio, para el navegador) · sirve el front en /app
└── front/       web components mr-* (estándar iswc-foundation) · todo generado desde JSON · consume el vendor del api por CDN
```

## Levantar

Requisitos: Deno 2.x (probado con 2.9). Nada que instalar: DER, zod, kysely y el kit llegan por CDN/npm al primer arranque.

```bash
cd labs/megaretail/front && deno task build     # dist/ del front (sass + deno bundle). Ya viene construido en el repo.
cd ../api && deno task dev                      # http://localhost:8787/app  (front)  ·  http://localhost:8787/api (REST)
```

- `deno task dev` crea `megaretail.db` (SQLite) con tablas, permisos, usuarios y datos de muestra la primera vez.
  `DB=:memory: deno task dev` para una base efímera; `PORT=9000` cambia el puerto.
- `deno task vendor` (en `api/`) reconstruye `vendor/megaretail.js`; `deno task front` (en `api/`) reconstruye el front; `deno task dev` (en `front/`) lo reconstruye al guardar.
- Documentación del API generada por DER: `http://localhost:8787/api/doc?v=1`.

## Probar

| Dónde | Comando | Qué cubre |
|---|---|---|
| `api/` | `deno task check` · `deno task test` | flujos transaccionales (compra, venta con rollback, transferencia, anulación, ajuste de precios, limpieza), reportes, seguridad por rol y el servido del front, todo con SQLite en memoria |
| `front/` | `deno task check` · `deno task test` | generador de formularios (schema → controles, JSON de UI con `Obj.insert`, valores y Zod), columnas del grid, indicadores, coherencia de los JSON de UI con el DER |

Prueba manual end to end (con `deno task dev` arriba): abrir `http://localhost:8787/app`, elegir usuario en la barra,
**Catálogo → Productos → Nuevo** (formulario generado, modal de categoría), **Operaciones → Registrar venta** (carrito;
pide una cantidad absurda y verás el 400 de stock sin que quede nada escrito), **Reportes → Cubo**.

## El DER (`api/src/domain/domain.ts`)

Once entidades definidas una sola vez con `defineSchema`/`defineEntity`: `sede`, `proveedor`, `categoria`, `producto`,
`producto_proveedor` (N:M con `costo_compra`), `inventario_sede`, `vendedor`, `cliente`, `venta`, `detalle_venta` y
`movimiento_inventario`. Relaciones `one`/`many`, enums (`estado`, `tipo_movimiento`), autoincrement en todas las pks,
secuencia con patrón en `venta.consecutivo` (`VTA-000001`), columna calculada `inventario.critico`
(`stock_actual < stock_minimo`) y `security: true` en todas (sesión + permisos). `venta`, `detalle_venta` y
`movimiento_inventario` son `administrable: false`: sólo se escriben por los flujos.

Los flujos y reportes son **`paths` de las entidades** (JSON transversal con su Zod); el server pone el handler y el front
los llama con `createClient(megaretail).call(...)`:

| Path | Ruta | Qué hace |
|---|---|---|
| `compra` | `POST /api/inventarios/compra` | Entrada en movimientos + suma en inventario (crea la fila con stock 0) |
| `registrar` | `POST /api/ventas/registrar` | Cabecera + validación de stock por ítem + detalles + descuento + Salidas; **rollback total** si falta stock |
| `transferencia` | `POST /api/inventarios/transferencia` | Resta en origen, suma en destino, dos movimientos; atómico |
| `anular` | `POST /api/venta/{id_venta}/anular` | Estado `Anulada`, reintegro de stock y movimientos inversos |
| `ajustePrecios` | `POST /api/productos/ajuste-precios` | +5 % (configurable) en Tecnología cuando el proveedor principal subió su costo |
| `limpieza` | `POST /api/productos/limpieza` | Borra productos sin ventas ni movimientos en 2 años con sus dependientes (`dryRun` opcional) |
| `ranking` | `GET /api/vendedores/ranking` | Top 3 por sede del último trimestre con % del total de la sede |
| `alertas` | `GET /api/inventarios/alertas` | Stock crítico (columna calculada) con el proveedor de menor costo |
| `fieles` | `GET /api/clientes/fieles` | Top 10 clientes: gasto, compras, ticket promedio, sede frecuente |
| `cubo` | `GET /api/ventas/cubo` | Sede × categoría con subtotales y gran total (ROLLUP calculado en el endpoint) |

Interpretación de "el proveedor subió su costo": `producto_proveedor.costo_anterior` guarda el costo previo (lo deja el
server al cambiar `costo_compra` por PUT; la semilla lo trae simulado). Se ajusta cuando `costo_compra > costo_anterior`
y luego se iguala para no repetir el aumento.

## Seguridad: usuarios y permisos sin contraseña

El lab usa los plugins **identidad** (`usuarios`) y **permisos** (grupos, roles, roles por usuario, acciones) de DER tal
cual, con CRUD libre desde el front (sección *Seguridad*). La única diferencia: la puerta `extract` la define el lab
(`api/src/security.ts`) y lee la cabecera `x-usuario` que pone el selector de usuario del front. No hay login ni
contraseña (el hook de `usuarios` exige una, así que el JSON de UI envía la ficticia `sin-clave-laboratorio`).

Usuarios de muestra y lo que puede cada rol (el rol base `USR` sólo lee; `ADMIN` todo):

| Usuario | Rol | Puede |
|---|---|---|
| `admin` | ADMIN | todo (`*`) |
| `ana` | VENDEDOR | `ventas.registrar`, `ventas.anular` |
| `beto` | BODEGA | `inventario.comprar`, `inventario.transferir` |
| `carla` | GERENTE | `catalogo.escribir` (CRUD del catálogo), `productos.ajustar-precios`, `productos.limpiar` |
| `dario` | — (base) | sólo lectura y reportes |

Las acciones usan alias legibles (`cfg.aliases` del plugin). El botón de la llave en la barra muestra el perfil de
`GET /api/permisos`: rol efectivo y valor de cada acción. Cambiar el usuario repinta la vista: los botones se
deshabilitan y, si se fuerza una llamada, el API responde 401/403.

## Front: todo nace de JSON

Componentes `mr-*` (prefijo del lab) sobre el kit `iswc` (`src/js/components/mr/`, cada uno con `.ts` + `.scss` + `.md`
+ `.json`). Ninguno sabe de una entidad concreta: todo lo leen de DER (registro, schema, Zod) y de los JSON de `ui/`.

| JSON | Define |
|---|---|
| `ui/app.json` | título, API, navegación (secciones con entidades, flujos o reportes), títulos e íconos por entidad |
| `ui/entidades/<plural>.json` | personalización de una entidad: etiqueta de fila, permiso de escritura, columnas del grid, `campos` del formulario |
| `ui/flujos.json` | cada flujo: `schema` tipo DER (relaciones → selectores modales, `lista` → carrito), `campos`, `path`, `permiso` |
| `ui/reportes.json` | cada reporte: `params` (formulario), `columnas`, `stats` (consultas `Obj.getValue`), `groupBy`, `filtro` |

- **Generador de formularios** (`core/form-model.ts`): del schema JSON sale el modelo base (tipo → control, enum →
  select, fechas ISO, pks/secuencias ocultas, relaciones `one` → `<mr-relation-field>`), y el JSON de UI se aplica con
  `Obj.insert` (upsert profundo del kit): convertir a `radio`, ocultar con `valor` por defecto, agregar campos extra,
  cambiar etiquetas, orden… Antes de enviar se valida con el Zod de DER (`insert`/`update`).
- **Data view de relaciones** (`<mr-relation-picker>`): modal con el `<mr-entity-grid>` de la otra entidad; `one` elige
  exactamente una fila, `many` (1:N / N:M) permite selección múltiple.
- **Listados** (`<mr-entity-grid>`): `<iswc-ag-grid>` del kit con columnas derivadas, datos por `query` (`GET
  plural?q=<base64url>`) y paginación en el server (`<mr-pager>`); las relaciones `one` se incluyen para mostrar su
  etiqueta en vez de la FK.
- **Flujos y reportes** (`<mr-flow>`, `<mr-report>`, `<mr-stats>`): formulario generado + `plugin.call(path)` (validación
  Zod del path en el cliente) y tabla/indicadores desde JSON.

Pines: DER `dd6d4b733c95c42c7e652a3cf78b0e957f2e530d`; `wc-base`/`wc-diagrams` (raw) `de72fa69…` (el que trae el
`deno.json` de DER); kit en el navegador (`dist/cdn` + íconos) `a1df39adb9e421de874dd624901b72daa9e25e5c`; vendor del api
`70e7e10ef91056214ffd92c708b3e9ba8f31d6b9`.

## Vendor del api por CDN

El dominio vive sólo en `api/src/domain/`. El front no lo importa por ruta: `api/src/vendor.ts` (núcleo y cliente de DER,
plugins `identity`/`permissions`, `z` y el dominio) se bundlea a `api/vendor/megaretail.js` y se versiona en git. El front
importa todo de `@megaretail/vendor`:

- En el navegador, el import map de `front/index.html` lo apunta a
  `https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@<sha>/labs/megaretail/api/vendor/megaretail.js`.
- Para `deno check`/`deno test`, `front/deno.json` lo apunta a `…@<sha>/labs/megaretail/api/src/vendor.ts`.

Al cambiar el dominio: `deno task vendor` en `api/`, commit y push, y luego actualizar el SHA en `front/deno.json` y
`front/index.html` (mismo SHA en ambos) y reconstruir el front.

## Hallazgos sobre DER (no se parchó la librería)

- El kit no se puede importar como TS en el navegador: el front se **bundlea** (`deno bundle --platform browser`) dejando
  `@megaretail/vendor` como externo; DER, zod y el dominio llegan en un solo vendor por CDN (un solo `registry`).
- El pin `f4356a41…` del kit (el de `docView` de DER) no trae `iswc-app-shell`/`iswc-app-nav` y su tarball excede el
  límite de jsDelivr (503 intermitentes): el front usa `a1df39ad…`, que lo corrige.
- `query()` no devuelve el total de filas: el paginador del front no muestra "de N" (desactiva "siguiente" cuando la
  página viene incompleta). Un `count` opcional en `QuerySpec` lo resolvería.
- No hay agregaciones (GROUP BY/ROLLUP) en `query()`: los reportes agregan en el handler sobre `query` paginada.
- El `ClientController` no tiene `call()` para los `paths` de la entidad: se usa `createClient(plugin).call(...)`
  (el dominio se expone también como `PluginDef` en `api/src/domain/domain.ts` para eso).
- Las rutas irregulares del router cuelgan del `basePath` (`/api/app`); `main.ts` añade el alias `/app` en la raíz.
- Las relaciones `many` del formulario (selección múltiple) viajan en el cuerpo pero el server no propaga la escritura
  salvo con `setPropagation`; en el lab se muestran como demostración del selector.
