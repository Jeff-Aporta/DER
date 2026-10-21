# 20 — Controllers: base común y client fetch

Área `CTL`. El flujo de toda acción, igual en client y server; el client lo implementa con fetch.

## 1. WHAT

### API común

- **[W-CTL-01]** Todo controller expone `pojo(content?)`/`pojos(list)`, `get`, `post`, `put`, `delete`, `list`, `query`, `postList`, `putList`, `deleteList`, `getCfg`, `putCfg`, `doc`, `call(endpoint, arg)`, `stream(acción|endpoint, arg)` (y `openStream`), `verify`, `permissions(acción, ctx?, extra?)` y `assertPermission`. Las acciones aceptan objetos planos pero trabajan con el POJO de la entidad (`W-T-02`).
- **[W-CTL-02]** Flujo de una acción: normalizar a POJO → verificar → override de `actions` (opcional, con `next()` a la implementación por defecto) → ejecutar. Los overrides cubren solo las nueve acciones CRUD/colección, no cfg, endpoints, SSE ni doc.

### Verificación

- **[W-CTL-03]** Orden: (1) reglas automáticas del schema: pks presentes («Faltan las llaves primarias: a, b»), requeridos en `post` («Faltan campos requeridos: a, b») y el Zod de la acción; `query` se valida estructuralmente y contra columnas/relaciones; (2) `preConfirm` de la entidad y luego del controller, en TODAS las acciones; (3) hooks específicos de la entidad; (4) hooks específicos del controller. El primer mensaje corta con error de validación (400). `true` equivale a «Datos inválidos».
- **[W-CTL-04]** En las listas (`postList`, `putList`, `deleteList`): lista vacía → «La lista está vacía»; se verifica cada ítem con las reglas automáticas y, si `itemHooksOnLists`, con el pre singular, prefijando `[i] `; luego el pre de lista.
- **[W-CTL-05]** `preConfirm` recibe una entrada discriminada por `action` (`get|post|put|delete` con `arg` pojo; `list`; `query` con el spec; `postList|putList|deleteList` con la lista; `getCfg`; `putCfg` con `cambios`; `endpoint` con `name` y `arg`), más el `ctx`.
- **[W-CTL-06]** Endpoints: `scope: "one"` exige pks presentes y valida con el Zod `pk`; `scope: "many"` exige un arreglo. Un endpoint declarado en la entidad pero sin implementación en el server responde 501 «no tiene implementación».

### Configuración de la entidad (`/cfg`)

- **[W-CTL-07]** `getCfg` devuelve el JSON guardado con los defaults del molde aplicados; `putCfg(parcial)` exige un objeto JSON, lo valida contra el molde parcial (solo llaves que el molde define; una llave desconocida se rechaza), aplica `Obj.update` sobre el actual y valida el resultado completo (una regla sobre el objeto completo puede rechazar un fragmento válido); devuelve la config completa. Sin `cfg` en la entidad: error de validación «no define configuración (cfg)». Hooks: `preGetCfg`, `prePutCfg`.

### SSE

- **[W-CTL-08]** `stream` verifica antes de abrir el stream (un pre falla sin emitir nada) y entrega cada texto emitido; un error a mitad llega tras lo emitido (en proceso lanza; en el cable viaja como `event: error`; el client lanza `HttpError`). Una acción sin variante SSE responde 404.

### Permisos desde el controller

- **[W-CTL-09]** `permissions(acción, ctx?, { method? })` consulta la puerta `permissions()` del registro con la sesión del `ctx` (si el ctx no trae `session`, la sesión singleton del registro), el id de la acción y el nombre de la entidad; sin puerta, permitido. `assertPermission` lanza 403 con la razón si se niega y devuelve el valor efectivo.

### Client (fetch)

- **[W-CTL-10]** `ClientController({ baseUrl, fetch?, headers?, hooks?, actions? })`: los `pre*` compartidos corren ANTES del fetch (un pre que falla no sale a la red); `headers` puede ser fijo o una función (incluso asíncrona) y las cabeceras por llamada (`ctx.headers`) ganan; `baseUrl` normaliza la barra final; `ctx.signal` cancela la petición; `ctx.session` se toma de la sesión singleton.
- **[W-CTL-11]** Respuestas: 400 → `ValidationError` con el mensaje del server; otros ≥ 400 → `HttpError(status, mensaje)` (500 llega como «Error interno» salvo que el server exponga errores); 404 en `get`/`put`/`delete` → `null`; 404 en `/cfg`, `doc`, endpoints o listas → `NotFoundError`; 204 en endpoint → `undefined`. El mensaje se toma de `{ error }` JSON, del texto plano o de `status statusText`.
- **[W-CTL-12]** Transporte: `get` manda `?include=<json>` (el del ctx o el `getInclude` de la entidad); `query` por POST con body (o GET `?q=`); un endpoint GET manda su argumento como `?q=<json>`; las listas mandan el arreglo; `delete` y `list` no mandan body. Los resultados se castean a POJOs (`returns: "pojo" | "list" | "json"` en endpoints).

## 2. HOW débil

- **[HW-CTL-01]** El client expone `request(method, path, body?, ctx?, accept?)` reutilizable (es lo que usan los plugins JSON).

## 3. HOW fuerte

- **[HS-CTL-01]** Archivos: `src/02-controllers/{controller,plugin,index}.ts`, `src/02-controllers/client/{controller,plugin,index}.ts`. Exportes: `BaseController`, `ClientController`, `clientRequest`, `errorMessage`, `createClient`, `pluginEntity`, `routePath`, `ENTITY_KEYS`.
- **[HS-CTL-02]** Cabeceras del client: `accept: application/json` (o `text/markdown` en doc, `text/event-stream` en SSE) y `content-type: application/json` cuando hay body.

## 6. Pruebas

- Orden de verificación y `preConfirm` en todas las acciones (incluido `putCfg` con `cambios` y endpoints con `name`), con `ctx.state` disponible.
- Listas: `[i]` en el mensaje, transacción (en el server) que revierte todo.
- Cliente punta a punta: rutas exactas que se llaman (CRUD, listas, query, pks compuestas y codificadas, `crisis/s`), pre antes del fetch, 400 del server traducido, `?q=` en endpoints GET, 204, 500 sin detalle, cabeceras de config + por llamada, `AbortSignal`.
- `/cfg`: defaults, PUT parcial solo `update`, fragmento inválido rechazado en el client sin salir, entidad sin cfg.
- `permissions()` desde código con una sesión dada y el verbo.

## 7. Notas

- `verify` es público para que un controller verifique un detalle de otra entidad (propagación) sin ejecutar la acción.
