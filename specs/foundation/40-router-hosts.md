# 40 — Router, tabla de rutas, seguridad por ruta, documentación servida y hosts

Área `RTR`. Una sola norma de rutas para todos los hosts.

## 1. WHAT

### Tabla de rutas

- **[W-RTR-01]** El Router construye una tabla con una ruta por acción de cada controller (y de los plugins), con id estable `METHOD:/ruta` (`GET:/producto/{iproducto}`), parámetros `{pk}`, `kind` (`action`, `extra`, `doc`), `entity` dueña, `sse` y `security` efectiva. Incluye `GET:/doc` general, `plural/doc` por entidad, `plural/cfg` solo si el controller expone cfg, y la variante `/sse` solo si hay handler SSE.
- **[W-RTR-02]** `expose` limita qué acciones se registran (como `aplicar`). Dos rutas con la misma forma (los parámetros son intercambiables) es un error al construir: «Ruta duplicada o ambigua».
- **[W-RTR-16]** Una entidad `exposed: false` no publica ninguna ruta; una `administrable: false` publica solo las de lectura (`list`, `get`, `query`, `doc`, `getCfg`): nunca `post`, `put`, `delete`, listas de escritura ni `putCfg`.
- **[W-RTR-03]** Rutas irregulares (`paths` de la entidad implementados en `config.paths` del controller, `routes` del controller o del router, `irregularPaths` de un plugin): `{ method, path con {params}, handler?, sse?, id?, security?, prefix?, pks? }`; en una entidad `prefix` `plural` (default) o `singular` la cuelga de ella y `pks: true` (solo con `singular`, si no error) antepone `{pk}` por cada pk y entrega sus valores en `input.pks`; sin `handler` ni `sse` es error. Un `Response` devuelto pasa tal cual; `undefined` → 204; otro valor → JSON 200. Su `/sse` emite lo que `send` reciba.
- **[W-RTR-04]** Al resolver un request, la ruta con más segmentos literales gana sobre la que tiene parámetros en esa posición (`crisis/s` es list, `crisis/x1` es get). Sin ruta → 404 `{ error: "Ruta no encontrada" }`.

### Ejecución común

- **[W-RTR-05]** Para toda ruta y todo host, en orden: contexto (`context(req)` mezclado en el ctx; `state.route` y `state.basePath`), seguridad (ver abajo), `guard(route, req, ctx)` (un `Response` corta; lanzar `HttpError` responde su status), CORS y errores. Un `HttpError` responde su status con `{ error }`; un body o `q` que no es JSON → 400; cualquier otro error → 500 `{ error: "Error interno" }` (o el mensaje con `exposeErrors`), reportado por `onError` o `console.error`.
- **[W-RTR-06]** Dispatch de acciones: `get`/`delete` arman el pojo con las pks de la URL; `put` con pks + body; `post` exige un objeto; listas exigen un arreglo; `GET plural` con `?q=` es `query` (el spec en base64url o JSON plano; se evalúa con la seguridad y el `expose` de `query`, no los de `list`) y sin `q` es `list`; `?include=` fija el include con la misma codificación; un `q`/`include` indescifrable → 400; `post`/`postList` responden 201; `null` → 404 `{ error: "No encontrado" }`; cfg y endpoints responden 200 con JSON; SSE responde el stream.
- **[W-RTR-07]** CORS opcional: preflight `OPTIONS` (204 si alguna ruta atiende el path, 404 si no) y cabeceras `access-control-*` en toda respuesta, con `origin`, `methods`, `headers`, `maxAge` configurables.

### Seguridad por ruta

- **[W-RTR-08]** La seguridad de cada ruta sale de `security` del controller (o, si no, de la entidad): `true` = todo protegido con permisos (menos `doc`); `{ public, protected, permissions, actions }`; sin nada = pública. `doc` es pública salvo que se incluya explícitamente en `protected`. `getCfg` y `putCfg` se evalúan con UNA acción, `CFG:/<plural>`, salvo que `actions` la personalice. En rutas irregulares: `"public"`/`false`, `"protected"` (solo sesión), `true` (sesión + permisos) o `{ protected, permissions, action }`.
- **[W-RTR-09]** Puertas: si el registro no tiene `extract`, no hay seguridad (toda ruta se sirve). Con `extract`: se obtiene la sesión en cada request (`ctx.session`, `ctx.state.session`); en una ruta pública un token inválido no bloquea; en una protegida, un `extract` que lanza responde ese error y la falta de sesión válida (`protected()` del registro, default `!== null`) responde 401 «Requiere autenticación: <id>»; si además evalúa permisos, `permissions(sesión, acción, entidad, { method, route })` decide (403 con la razón o «Sin permiso: <id>») y su valor queda en `ctx.state.permiso`. La acción es `security.action` o el id de la ruta.
- **[W-RTR-10]** `ctx.state.can(acción, entidad?)` evalúa la puerta de permisos con la sesión del request (sin puertas: permitido con valor `true`).
- **[W-RTR-11]** Los plugins pasados al Router aportan sus controllers y rutas, reciben el router (`plugin.router`) y sus puertas entran al registro solo donde el consumidor no definió la suya. `router.seed()` siembra todos los controllers (incluidos los de plugins, cada uno en su base, una vez) y luego el seed de cada plugin.

### Documentación servida

- **[W-RTR-12]** `GET {base}/doc` es el índice del API en markdown (tabla de entidades con sus rutas y hojas, diagramas ER y de clases) más las fuentes `doc` del router como secciones; `?v=1` (cualquier valor salvo `0`/`false`) entrega la vista HTML del kit iswc (pin por SHA de 40 configurable; otro pin → error) con todas las hojas embebidas. `plural/doc` y `plural/doc?v=1` lo mismo por entidad. Las fuentes `.md` pueden ser rutas locales (relativas a `docBase` o al cwd), `file:` o `http(s)`.

### Hosts

- **[W-RTR-13]** Deno/Bun/Node: `router.fetch` (404 si no hay ruta) o `router.handle` (`null` si no hay ruta, para encadenar).
- **[W-RTR-14]** Azure Functions: una función por ruta de la tabla, con nombre válido y único derivado de `METHOD_ruta`, `authLevel` configurable, body como stream (SSE en vivo) o como bytes (`stream: false`); con CORS, un `OPTIONS` por ruta; un primer segmento reservado del host (`runtime`, `admin`) es un error al registrar («Ruta reservada»). Devuelve lo registrado.
- **[W-RTR-15]** Cloudflare Workers: `defineWorker(setup)` crea el router una vez por isolate con el `env` de los bindings y lo reusa; si el setup falla, se reintenta en el siguiente request.

## 2. HOW débil

- **[HW-RTR-01]** El Router no conoce ningún host: cada host recorre `router.routes` y adapta `Request`/`Response`.

## 3. HOW fuerte

- **[HS-RTR-01]** Exportes: `Router`, `createRouter`, `sseResponse`, `joinPath`, `routeId`, `routeKey`, `matchTemplate`, `literalCount`, `controllerRouteSpecs`, `controllerSecurity`, `routeSecurity`, `registerAzure`, `azureFunctionName`, `azureToRequest`, `responseToAzure`, `AZURE_RESERVED_PREFIXES`, `defineWorker`, `readDocSource`, `composeDoc`, `composeFromSources`, `demoteHeadings`, `slug`, `entityContractMd`, `apiIndexMd`, `entitySheetPath`, `vaultHtml`, `ISWC_PIN`, `LIB_DOCS`.
- **[HS-RTR-02]** Claves del estado del request: `state.route`, `state.basePath`, `state.session`, `state.permiso`, `state.can`.

## 6. Pruebas

- La tabla expone cada acción con su id (incluidos `/cfg`, `/doc`, `/sse` solo con handler, pks compuestas, `crisis/s`), `expose` limita, duplicadas/ambiguas fallan, literal gana a parámetro.
- Rutas irregulares de controller (`this` = controller), de router y de plugin, con params, query, body, `Response` crudo, 204 y SSE.
- CORS (preflight y cabeceras) y `guard` por id de ruta.
- Seguridad: sin `extract` todo se sirve; públicas vs protegidas; token inválido/vencido/ajeno/`alg: none` con códigos distintos; 403 con razón; `doc` pública por defecto y protegible; `state.can` sin plugins permite.
- Documentación: `/doc` compuesto (fuentes locales, `file:`, http y función), encabezados bajados, `?v=1` con el pin y las hojas, índice del API con diagramas.
- Azure: una función por ruta, nombres únicos, `OPTIONS` con CORS, SSE en stream y en bytes, prefijo reservado; Cloudflare: router por isolate y reintento. En ambos, `GET plural?q=` consulta (pública → resultado; protegida → 401/403 en JSON) y `q` inválido → 400.

## 7. Notas

- La señal del request solo se toma en rutas SSE (leer `req.signal` en cada request avisa en Deno 2.9+).
