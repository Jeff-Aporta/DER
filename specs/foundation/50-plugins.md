# 50 — Plugins JSON: createClient / createServer, identidad y permisos

Área `PLG`. Un plugin es un JSON transversal; el consumidor arma lo que necesita y nunca recibe clases.

## 1. WHAT

### Plugin JSON

- **[W-PLG-01]** Un plugin transversal es `{ name, entities?, routes?, ops? }`: `entities` (clave → definición de entidad con `schema`, singular/plural, `table`, `security`, hooks…), `routes` (clave → ruta irregular `{ method, path, prefix?, entity?, security?, zod?, returns?, id? }`) y `ops` (operaciones del cliente con `this` = el plugin armado).
- **[W-PLG-02]** El JSON del server es el transversal con un push (`Obj.insert`) de particularidades: por entidad lo de servidor (`hidden`, `actions`, `expose`, `sse`, `computed`, handlers de endpoints…), por ruta `handler`/`sse`, más `cfg` (Zod de la configuración), `security` (implementaciones de puertas), `seed` y `setup`. Lo que define la entidad va a la entidad; lo demás a la config del controller; el server puede sobreescribir `ops`.
- **[W-PLG-03]** `createClient(json, { baseUrl, fetch?, headers?, token?, onToken? })` devuelve `{ name, def, config, controllers (uno por clave), state, token, setToken, headers(), request(), call(ruta, body?, params?) }` + las `ops` como métodos. `call` resuelve la ruta (prefijo + `{params}`), valida el body con `zod` antes del fetch (error de validación sin salir), manda GET como query string, y castea según `returns` (`pojo`, `list`, `json`, `void`/204). `headers()` incluye `Authorization: Bearer <token>` cuando hay token y `setToken` avisa a `onToken`.
- **[W-PLG-04]** `createServer(json, { db, cfg?, env? })` valida `cfg` con el Zod del plugin (error «Configuración de "x" inválida: …»), resuelve `"env:NOMBRE"` en profundidad (de `env` o del proceso; ausente → error que nombra la variable), crea un `ServerController` por entidad en `db`, resuelve las rutas irregulares (sin `handler` ni `sse` → error), enlaza las puertas con `this` = plugin, expone `ops` como métodos, llama `setup` y devuelve el plugin (`controllers`, `list`, `routes`, `security`, `state`, `router`, `seed()`).
- **[W-PLG-05]** Una entidad de plugin se registra una sola vez en el registro global: si el client y el server del mismo proceso arman el mismo JSON, comparten la misma entidad (misma clave de plural y mismo nombre). El nombre default es `<plugin>.<clave>`.
- **[W-PLG-06]** Hermeticidad: un plugin no depende de otro; referencia entidades ajenas solo por nombre (resuelto en diferido) y funciona sin ellas. El consumidor puede usar identidad con un sistema de permisos propio, permisos con un sistema de identidad propio, o ninguno.

### Identidad

- **[W-PLG-07]** Entidades: `usuarios` (`iusuario` pk texto, `nombre`, `email`, `bactivo` default true, `jdata`, `creado`, `hash` oculto, `password` virtual), `sesiones`, `intentos`, `eventos`; tablas `identity_*`. `password` llega en POST/PUT (mínimo 8, «La contraseña debe tener al menos 8 caracteres»; obligatoria al crear: «Falta la contraseña»), se guarda solo su hash y nunca se devuelve ni se puede consultar o filtrar (400).
- **[W-PLG-08]** Configuración: `secret` (obligatorio, ≥ 32 caracteres, `env:`), `pepper` (≥ 32; default el secret), `expiresIn` (86400), `issuer`, `iterations` (10000..100000, default 100000), `admin` `{ usuario, password ≥ 8, nombre? }`, `security` (`maxAttempts` 1..100, `windowSeconds`, `lockSeconds`, `blockNewDevice`, `travel { enabled, minMinutes, block }`, `password { minLength ≥ 8 }`), `jwt` (`alg` HS384|ES256, `kid`, `privateJwk`, `publicJwk`), `trustProxy` 0..10, `trustedIssuers`. Claves desconocidas se rechazan.
- **[W-PLG-09]** `POST login { usuario, password }` → `{ token, tipo: "Bearer", expira, usuario: { iusuario, nombre } }` y crea una sesión; 400 si falta un campo; 401 «Usuario o contraseña inválidos» ante usuario inexistente, contraseña errada o usuario inactivo; 429 «Demasiados intentos fallidos…» si hay bloqueo (por IP o por usuario, `maxAttempts` fallos en la ventana; expira tras `lockSeconds`, incluso con la contraseña correcta); 403 «Dispositivo no reconocido…» con `blockNewDevice` y huella nueva (el primer login nunca es nuevo); 403 «…ubicación inesperada» con `travel.block` y cambio de IP en menos de `minMinutes` desde el último login correcto. Cada intento se audita (IP real, user-agent, SO, navegador, tipo de equipo, resultado `ok|fallo|bloqueado`, motivo) y cada login/evento de seguridad queda en `eventos`.
- **[W-PLG-10]** Token: JWT HS384 (o ES256 con JWKS en `GET /.well-known/jwks.json`; `trustedIssuers` acepta tokens ES256 de otros emisores) con `sub`, `jti`, `iat`, `exp`, `iss?`, `nombre?`. La puerta `extract` lee `Authorization: Bearer <token>`: sin cabecera → anónimo; cabecera malformada o token no verificable → 401 «Token inválido: …»; vencido → 401 «Token vencido»; sesión revocada/inexistente → 401 «Sesión cerrada o inexistente»; usuario inactivo → 401 «Usuario inactivo». El rol no viaja en el token. El último acceso de la sesión se refresca con throttle.
- **[W-PLG-11]** Rutas con sesión: `DELETE logout` (204; revoca la sesión), `DELETE logout/all` (`{ revocadas }`), `GET sessions` (vigentes con ip/dispositivo/so/navegador/último acceso y `actual`), `PUT password { actual, nueva }` (401 si la actual no coincide; 400 si no cumple la política o es igual; revoca las demás sesiones y devuelve `{ revocadas }`), `GET events` (filtros `iusuario`, `accion`, `desde`, `hasta`, `limit` 1..500, `offset`; fecha inválida o límite fuera de rango → 400). Sin sesión → 401.
- **[W-PLG-12]** Cliente: `login` (valida con el mismo Zod; guarda el token y deja la sesión singleton del registro `{ id, nombre, expira }`), `logout`/`logoutAll` (olvidan el token y la sesión aunque falle la petición), `sessions`, `changePassword(actual, nueva)`, `events(query)`; `headers()` sirve para cualquier otro controller.
- **[W-PLG-13]** `seed`: crea el usuario `admin` configurado si no existe.

### Permisos

- **[W-PLG-14]** Entidades (nombres `permisos.*`): `grupos` (`igrupo`, `nombre`; relación `roles`), `roles` (`irol`, `igrupo` no nulo, `nombre`, `bactivo` default true; relaciones `acciones`, `grupo`), `rolesUsuario` (`iusuario`+`irol` pk, `finicial`, `ffinal`, `bprincipal`; relaciones `rol`, `usuario` → `identity.usuarios`), `acciones` (`irol`+`iaccion` pk, `valor` json); tablas `permisos_grupos`, `permisos_roles`, `permisos_rolesusuario`, `permisos_accionesrol`. Todas protegidas con permisos.
- **[W-PLG-15]** Configuración: `grupo` (API), `rolBase` (USR), `rolAdmin` (ADMIN), `admins`, `actions` (capacidades solo de código), `denyByDefault` (false). Claves desconocidas se rechazan.
- **[W-PLG-16]** Vector de acciones: roles del usuario vigentes (`finicial ≤ ahora < ffinal`), activos y del grupo configurado, el principal primero; sin rol vigente, el rol base. Valor efectivo de una acción y verbo: el del rol principal y si no el del base; id exacto antes que `"*"`; un valor partido por verbo (`{ GET, PUT }`) aporta solo el del verbo y si no lo trae cae al siguiente. Decisión: sin valor o `{ protected: true }` → permitido (o negado con `denyByDefault`: «Sin permiso definido: id»); `false` o `"false"` → negado («Sin permiso: id»); otro valor → permitido y el valor viaja al handler. Sin sesión → negado «Requiere autenticación».
- **[W-PLG-17]** Rutas: `GET permisos` (pública) → perfil `{ usuario, irol, igrupo, roles, perms }` (anónimo: `usuario: null`, rol base, `perms: {}`; con sesión, `perms` trae el valor efectivo de cada acción del catálogo, por verbo cuando la acción la comparten varios); `GET permisos?catalogo=1` → catálogo `[{ id, routes }]` (401 sin sesión; 403 sin el permiso de `PUT permisos`); `PUT permisos` (sesión + permisos) → carga del DER `{ grupos, roles, rolesusuario, acciones }` con upsert en una transacción y respuesta con los conteos; una acción no declarada (ni ruta evaluable, ni personalizada, ni de `cfg.actions`, ni `"*"`) → 400 «Acciones no declaradas: …».
- **[W-PLG-18]** Acciones personalizadas: `security.actions` del controller vincula acciones a ids propios (compartibles entre rutas); una ruta irregular lleva `security.action`; el catálogo las muestra con sus rutas y las capacidades de código con `routes: []`; el id autogenerado reemplazado no aparece.
- **[W-PLG-19]** Cliente: `profile()`, `catalog()`, `load(der)` (valida con el mismo Zod antes de salir) y los controllers del DER.
- **[W-PLG-20]** `seed`: crea el grupo, el rol base, el rol admin con `"*": true` y lo asigna como principal a `admins`.

## 2. HOW débil

- **[HW-PLG-01]** Las operaciones en proceso (`login`, `verify`, `logout`, `can`, `profile`, `load`…) son las mismas funciones que usan los handlers HTTP: una sola implementación.
- **[HW-PLG-02]** La IP real: con `trustProxy: N`, el salto N desde el final de `X-Forwarded-For`; con 0, el primero; luego `X-Real-IP`. El dispositivo se deduce del user-agent sin dependencias y la huella es un hash estable del user-agent.

## 3. HOW fuerte

- **[HS-PLG-01]** Archivos: `src/03-plugins/common/{crypto,device}.ts`, `src/03-plugins/identity/{schemas,index,server}.ts`, `src/03-plugins/permissions/{schemas,index,server,rules}.ts`, entradas `src/03-plugins/index.ts` (server) y `src/03-plugins/client.ts` (client). Exportes: `identity`, `identityServer`, `permissions`, `permissionsServer`, `decide`, `effectiveValue`, `createClient`, `createServer`, `resolveEnv`, `clientIp`, `deviceInfo`, `huellaOf`, `hashPassword`, `verifyPassword`, `signJwt`, `verifyJwt`, `signJwtEs256`, `verifyJwtEs256`, `generateEs256KeyPair`, `importEs256PrivateKey`, `importEs256PublicKey`, `b64urlEncode`, `b64urlDecode`, `randomId`, `timingSafeEqual`.
- **[HS-PLG-02]** Hash: `pbkdf2-sha256$<iteraciones>$<sal b64url>$<hash b64url>` sobre HMAC-SHA256(pepper, contraseña), sal de 16 bytes, comparación en tiempo constante.

## 6. Pruebas

- Sin plugins ni puertas nada aplica; login/logout; públicas vs protegidas; códigos distintos para vencido, firma ajena y `alg: none`; hash nunca expuesto ni consultable, sal aleatoria, cambio de contraseña por PUT; pojos indirectos y tabla `identity_usuarios`.
- Carga del DER, vector por rol, comodín admin, vigencia, perfil, CRUD del DER, catálogo y su permiso, acción no declarada; `denyByDefault`; solo identidad.
- Hermeticidad: permisos con `extract` propio del consumidor; identidad con `permissions` propio.
- Configuración inválida (claves extra, env ausente, secret corto, `security` fuera de rango), `resolveEnv`, `env` del runtime.
- Endurecimiento: auditoría de intentos y eventos, bloqueo que expira, dispositivo nuevo (bloqueo y solo auditoría), viaje imposible, `sessions`, `logout/all`, `password` con política y revocación, `events` con filtros; el cliente JSON con sesión singleton.
- Reglas puras del vector; por verbo vía HTTP; roles inactivos/futuros/de otro grupo; valor al handler; `permissions()` desde código; usuario inactivo pierde sus tokens.
- Clientes: token en otros controllers, validación local sin salir, logout revoca; perfil, carga, catálogo, DER con `include` del usuario (sin hash).
- ES256: firma/verificación, kid, manipulación, JWK, login + JWKS; utilidades de IP y dispositivo.

## 7. Notas

- `registry.secure(null)` limpia las puertas: imprescindible entre pruebas porque el registro es un singleton del proceso.
