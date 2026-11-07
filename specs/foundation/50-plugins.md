# 50 — Plugins JSON: createClient / createServer, identidad, permisos, embeddings, archivos, errores y penalizaciones

Área `PLG`. Un plugin es un JSON transversal; el consumidor arma lo que necesita y nunca recibe clases.

## 1. WHAT

### Plugin JSON

- **[W-PLG-01]** Un plugin transversal es `{ name, entities?, irregularPaths? }`: `entities` (clave → definición de entidad con `schema`, singular/plural, `table`, `security`, hooks, `paths` y, EXPLÍCITOS, `exposed` y `administrable`) e `irregularPaths` (clave → path que no pertenece a ninguna entidad). Un path (`IrregularPath`) es `{ method, path, prefix?, pks?, security?, zod?, returns?, id?, ops? }`; sus `ops` son funciones con `this` = el plugin armado que quedan como métodos del plugin.
- **[W-PLG-02]** El JSON del server es el transversal con un push (`Obj.insert`) de particularidades: por entidad lo de servidor (`hidden`, `actions`, `expose`, `sse`, `computed`, handlers de endpoints y de `paths`…), por path `handler`/`sse` (y `ops` de server), más `cfg` (Zod de la configuración), `security` (implementaciones de puertas), `seed` y `setup`. Lo que define la entidad va a la entidad; lo demás a la config del controller; el server puede sobreescribir `ops`.
- **[W-PLG-03]** `createClient(json, { baseUrl, fetch?, headers?, token?, onToken? })` devuelve `{ name, def, config, controllers (uno por clave), state, token, setToken, headers(), request(), call(path, body?, pks?) }` + las `ops` de todos los paths como métodos. `call` busca el path (irregular del plugin o `paths` de una entidad), resuelve la ruta (prefijo, `{pks}` desde un objeto `{ pk: valor }` o un pojo), valida el body con `zod` antes del fetch (error de validación sin salir), manda GET como query string, y castea según `returns` (`pojo`, `list`, `json`, `void`/204). `headers()` incluye `Authorization: Bearer <token>` cuando hay token y `setToken` avisa a `onToken`.
- **[W-PLG-04]** `createServer(json, { db, cfg?, env?, services? })` (`services`: dependencias vivas que no son JSON, disponibles en `plugin.services`) valida `cfg` con el Zod del plugin (error «Configuración de "x" inválida: …»), resuelve `"env:NOMBRE"` en profundidad (de `env` o del proceso; ausente → error que nombra la variable), crea un `ServerController` por entidad en `db` (una `exposed: false` no publica rutas), resuelve los paths (sin `handler` ni `sse` → error), enlaza las puertas con `this` = plugin, expone las `ops` como métodos, llama `setup` y devuelve el plugin (`controllers`, `list`, `routes`, `security`, `state`, `router`, `seed()`).
- **[W-PLG-05]** Una entidad de plugin se registra una sola vez en el registro global: si el client y el server del mismo proceso arman el mismo JSON, comparten la misma entidad (misma clave de plural y mismo nombre). El nombre default es `<plugin>.<clave>`.
- **[W-PLG-06]** Hermeticidad: un plugin no depende de otro; referencia entidades ajenas solo por nombre (resuelto en diferido) y funciona sin ellas. El consumidor puede usar identidad con un sistema de permisos propio, permisos con un sistema de identidad propio, o ninguno.

### Identidad

- **[W-PLG-07]** Entidades: `usuarios` (`iusuario` pk texto, `nombre`, `email`, `bactivo` default true, `jdata`, `creado`, `hash` oculto, `password` virtual; `exposed` y `administrable`), `sesiones`, `intentos`, `eventos` (`exposed: false`: solo se tocan por los paths de sesión); tablas `identity_*`. `password` llega en POST/PUT (mínimo 8, «La contraseña debe tener al menos 8 caracteres»; obligatoria al crear: «Falta la contraseña»), se guarda solo su hash y nunca se devuelve ni se puede consultar o filtrar (400).
- **[W-PLG-08]** Configuración: `secret` (obligatorio, ≥ 32 caracteres, `env:`), `pepper` (≥ 32; default el secret), `expiresIn` (86400), `issuer`, `iterations` (10000..100000, default 100000), `admin` `{ usuario, password ≥ 8, nombre? }`, `security` (`maxAttempts` 1..100, `windowSeconds`, `lockSeconds`, `blockNewDevice`, `travel { enabled, minMinutes, block }`, `password { minLength ≥ 8 }`), `jwt` (`alg` HS384|ES256, `kid`, `privateJwk`, `publicJwk`), `trustProxy` 0..10, `trustedIssuers`. Claves desconocidas se rechazan.
- **[W-PLG-09]** Las acciones de sesión son `paths` de la entidad `usuarios`: las que aún no conocen al usuario cuelgan del plural (`usuarios/login`, `usuarios/events`); las del usuario de la sesión cuelgan del singular sin pks (`usuario/logout`, `usuario/logout/all`, `usuario/sessions`, `usuario/password`). `POST usuarios/login { usuario, password }` → `{ token, tipo: "Bearer", expira, usuario: { iusuario, nombre } }` y crea una sesión; 400 si falta un campo; 401 «Usuario o contraseña inválidos» ante usuario inexistente, contraseña errada o usuario inactivo; 429 «Demasiados intentos fallidos…» si hay bloqueo (por IP o por usuario, `maxAttempts` fallos en la ventana; expira tras `lockSeconds`, incluso con la contraseña correcta); 403 «Dispositivo no reconocido…» con `blockNewDevice` y huella nueva (el primer login nunca es nuevo); 403 «…ubicación inesperada» con `travel.block` y cambio de IP en menos de `minMinutes` desde el último login correcto. Cada intento se audita (IP real, user-agent, SO, navegador, tipo de equipo, resultado `ok|fallo|bloqueado`, motivo) y cada login/evento de seguridad queda en `eventos`.
- **[W-PLG-10]** Token: JWT HS384 (o ES256 con JWKS en `GET /.well-known/jwks.json`; `trustedIssuers` acepta tokens ES256 de otros emisores) con `sub`, `jti`, `iat`, `exp`, `iss?`, `nombre?`. La puerta `extract` lee `Authorization: Bearer <token>`: sin cabecera → anónimo; cabecera malformada o token no verificable → 401 «Token inválido: …»; vencido → 401 «Token vencido»; sesión revocada/inexistente → 401 «Sesión cerrada o inexistente»; usuario inactivo → 401 «Usuario inactivo». El rol no viaja en el token. El último acceso de la sesión se refresca con throttle.
- **[W-PLG-11]** Paths con sesión: `DELETE usuario/logout` (204; revoca la sesión), `DELETE usuario/logout/all` (`{ revocadas }`), `GET usuario/sessions` (vigentes con ip/dispositivo/so/navegador/último acceso y `actual`), `PUT usuario/password { actual, nueva }` (401 si la actual no coincide; 400 si no cumple la política o es igual; revoca las demás sesiones y devuelve `{ revocadas }`), `GET usuarios/events` (filtros `iusuario`, `accion`, `desde`, `hasta`, `limit` 1..500, `offset`; fecha inválida o límite fuera de rango → 400). Sin sesión → 401. El único path irregular del plugin es `GET /.well-known/jwks.json`.
- **[W-PLG-12]** Cliente: `login` (valida con el mismo Zod; guarda el token y deja la sesión singleton del registro `{ id, nombre, expira }`), `logout`/`logoutAll` (olvidan el token y la sesión aunque falle la petición), `sessions`, `changePassword(actual, nueva)`, `events(query)`; `headers()` sirve para cualquier otro controller.
- **[W-PLG-13]** `seed`: crea el usuario `admin` configurado si no existe.

### Permisos

- **[W-PLG-14]** Entidades (nombres `permisos.*`, todas `exposed` y `administrable`: un rol con permiso edita el DER por CRUD): `grupos` (`igrupo`, `nombre`; relación `roles`), `roles` (`irol`, `igrupo` no nulo, `nombre`, `bactivo` default true; relaciones `acciones`, `grupo`), `rolesUsuario` (`iusuario`+`irol` pk, `finicial`, `ffinal`, `bprincipal`; relaciones `rol`, `usuario` → `identity.usuarios`), `acciones` (`irol`+`iaccion` pk, `valor` json); tablas `permisos_grupos`, `permisos_roles`, `permisos_rolesusuario`, `permisos_accionesrol`. Todas protegidas con permisos.
- **[W-PLG-15]** Configuración: `grupo` (API), `rolBase` (USR, personalizable), `rolAdmin` (ADMIN), `admins`, `actions` (capacidades solo de código), `denyByDefault` (false), `aliases` (id de acción → nombre que se quema en la BD). Claves desconocidas se rechazan.
- **[W-PLG-16]** Vector de acciones: el rol base define los valores por defecto de todos; roles del usuario vigentes (`finicial ≤ ahora < ffinal`), activos y del grupo configurado, el principal primero; sin rol vigente, el rol base. Valor efectivo de una acción y verbo: el del rol principal y si no el del base; id exacto antes que `"*"`; un valor partido por verbo (`{ GET, PUT }`) aporta solo el del verbo y si no lo trae cae al siguiente. Decisión: sin valor o `{ protected: true }` → permitido (o negado con `denyByDefault`: «Sin permiso definido: id»); `false` o `"false"` → negado («Sin permiso: id»); otro valor → permitido y el valor viaja al handler. Sin sesión → negado «Requiere autenticación».
- **[W-PLG-17]** Paths irregulares: `GET permisos` (pública) → perfil `{ usuario, irol, igrupo, roles, perms }` (anónimo: `usuario: null`, rol base, `perms: {}`; con sesión, `perms` trae el valor efectivo de cada acción del catálogo, por verbo cuando la acción la comparten varios); `GET permisos?catalogo=1` → catálogo `[{ id, routes }]` (401 sin sesión; 403 sin el permiso de `PUT permisos`); `PUT permisos` (sesión + permisos) → carga del DER `{ grupos, roles, rolesusuario, acciones }` con upsert en una transacción y respuesta con los conteos; una acción no declarada (ni ruta evaluable, ni personalizada, ni de `cfg.actions`, ni `"*"`) → 400 «Acciones no declaradas: …»; un valor de un rol particular igual al del rol base (ya vigente o en la misma carga) → 400 «Acciones que repiten el valor del rol base <base>: rol:accion, …».
- **[W-PLG-18]** Acciones personalizadas y alias: `security.actions` del controller vincula acciones a ids propios (compartibles entre rutas); una ruta irregular lleva `security.action`; `/cfg` es una sola acción `CFG:/<plural>` para GET y PUT; `cfg.aliases` renombra cualquier id (de ruta, personalizado o de código) y la puerta, el catálogo, el perfil y la carga usan el alias; el catálogo muestra las acciones con sus rutas y las capacidades de código con `routes: []`; el id autogenerado reemplazado no aparece.
- **[W-PLG-19]** Cliente: `profile()`, `catalog()`, `load(der)` (valida con el mismo Zod antes de salir) y los controllers del DER.
- **[W-PLG-20]** `seed`: crea el grupo, el rol base, el rol admin con `"*": true` y lo asigna como principal a `admins`.

### Embeddings

- **[W-PLG-21]** Caché por huella: `embeber` calcula la huella del texto canónico (Unicode NFKC, espacios colapsados, recorte, minúsculas por defecto) y, si existe para ese modelo y proyección, incrementa `hits`, fija `fultimohit` y devuelve sin llamar al modelo. Un hit y un miss devuelven el mismo vector. El texto no se guarda. Texto vacío → 400; miss sin proveedor → 503; número de vectores o dimensiones inesperadas → 502.
- **[W-PLG-22]** Una fila por referencia (`tipo`, `entidad`, `id`): otro registro con el mismo texto copia el vector sin llamar al modelo y cuenta como hit. Un documento con otro texto pierde su fila anterior. `modelo` y `dims` son columnas.
- **[W-PLG-23]** Entidades `cache`, `proyecciones`, `contadores` y `cursores`: expuestas, no administrables y con seguridad; el vector nunca sale por CRUD. Depuración por el JSON de consulta de DER.
- **[W-PLG-24]** Reducción por modelo (`metodo`, `dims`, `decimales`, `semilla`): la proyección se guarda con un id derivado de sus parámetros, se lee de la tabla y se aplica igual a documentos y consultas, en cualquier isolate. Otra proyección es otro espacio: sus filas no sirven como hit.
- **[W-PLG-25]** Reglas de purga como datos validados: forma con Zod (claves desconocidas, identificadores mal formados, regla sin criterio sin `todo: true`, nombres reservados y más de 90 parámetros se rechazan al armar) y contra la entidad (desconocida, en otra base, pk compuesta, columna inexistente, virtual, oculta o json, operador o valor incompatible con el tipo) en `seed`, `purgar` y `reglas`. Nunca aceptan SQL.
- **[W-PLG-26]** Criterios en AND: alcance (`entidad`, `tipo`, `modelo`), `sinHitsDias` (último hit o, si nunca hubo, creación), `edadDias`, `hitsMenorQue`, `donde` sobre columnas de la entidad referida y `huerfanos`; junto a `donde`, `huerfanos` es O. `donde` y `huerfanos` aplican solo a documentos.
- **[W-PLG-27]** Corrida: `obsoletas`, reglas por prioridad, `general` (salvo alcances `excluirDeGeneral`) y, si se supera `maxFilas` o `maxBytes`, reglas `soloPresion` por `orden` y `lru` hasta `objetivoPct`, lo menos usado primero. `lote` × `maxLotes` acota la corrida y `pendiente` avisa que falta otra.
- **[W-PLG-28]** Simulación: mismo plan sin borrar, con lo que cada paso tomaría sin contar lo de los anteriores y una muestra sin vector; en pasos normales coincide con la corrida real, y bajo presión la parte de un paso se marca `estimado`.
- **[W-PLG-29]** Búsqueda: `exacta` (columna igual sin mayúsculas, o misma huella del documento) > `contiene` > `embedding` (índice inyectado o coseno sobre la caché, con `minScore`); un registro queda con su mejor origen. `filtros` por entidad aplica a todas las fuentes. Sin proveedor degrada a texto con `semantica: false`. Un índice con otras dimensiones que la proyección → error.
- **[W-PLG-30]** Estadísticas: filas, bytes, hits, misses, purgadas y tasa, total, por modelo y por referencia; hits, misses y purgadas sobreviven a la purga.
- **[W-PLG-31]** Alimentación: `alimentar` lee de cada entidad configurada una tanda con pk mayor que su cursor guardado, arma el texto con `columnas` y `etiquetas`, y embebe; lo que ya estaba es hit. `reiniciar` vuelve al principio.

### Servicios del consumidor, auditoría y LLM

- **[W-PLG-40]** DER no ejecuta servicios externos: define datos, rutas y helpers. Lo externo lo vincula el consumidor en `services` del plugin o en el singleton `servicios`, en ese orden.
- **[W-PLG-41]** El singleton guarda credenciales con `env:` resuelto; un `env:` sin definir deja el campo fuera sin tumbar el arranque (el servicio es opcional).
- **[W-PLG-42]** Las entidades con dueño comparten `COLUMNAS_AUDITORIA`: `propietario_tipo` (`usuario`, `pagina`, `ninguno`), `propietario`, `apporigin`, `iporigin`, `fhcre`, `fhmod`.
- **[W-PLG-43]** `proveedorLlm` no llama a ningún modelo: ejecuta acciones del consumidor con su credencial y responde qué regla aplica a un mime. Sin credencial, la acción no está disponible.

### Gestión de archivos

- **[W-PLG-50]** Carpetas y archivos con CRUD; la `ruta` de una carpeta la deriva el server y `(ipadre, nombre)` es único.
- **[W-PLG-51]** Un archivo se relaciona con cualquier tabla por `origin` + `idorigin`, sin FK rígida.
- **[W-PLG-52]** Los bytes los mueve un almacén del consumidor; sin él, las rutas que lo necesitan responden 503.
- **[W-PLG-53]** Subida: rechaza vacíos, excesos y ejecutables; objeto primero y fila después, con compensación si falla la fila.
- **[W-PLG-54]** Descarga pública pero firmada con vida corta; una firma vencida o alterada responde 403.
- **[W-PLG-55]** Borrar una fila, también en plural, borra su objeto.
- **[W-PLG-56]** `archivos/arbol` da subcarpetas y archivos visibles de una carpeta.

### Errores

- **[W-PLG-60]** Con sesión confiable el reporte pasa directo; sin ella exige el código (mínimo 8) y aplica penalizaciones; sin código configurado exige sesión.
- **[W-PLG-61]** Un reporte con adjuntos espera en `recibiendo` hasta `listo` o `recibiendoMin`; solo entonces entra a la cola y se avisa al consumidor. Si el aviso falla, el reporte queda.
- **[W-PLG-62]** Adjuntos con un token firmado de corta vida del reporte.
- **[W-PLG-63]** Cada adjunto sigue la regla del proveedor de LLM; con `conservar: false` y acción exitosa el original no se guarda. Sin regla, credencial o si la acción falla, se conserva: nada se pierde.
- **[W-PLG-64]** Tomar es atómico: entre dos agentes solo uno gana, el otro recibe 409. Una toma vencida se puede retomar.
- **[W-PLG-65]** Solo quien tiene la toma registra avance o suelta. Cada avance renueva la toma y queda en la bitácora que ve quien reportó.
- **[W-PLG-66]** `DELETE errores` cierra varios atendidos y se lleva sus archivos; el seguimiento de una fila borrada responde `atendido`.

### Penalizaciones

- **[W-PLG-70]** Una tabla: `id` del vector e `intentos` en JSON. Dos vectores por ámbito: IP y global; cada fallo se anota en los dos.
- **[W-PLG-71]** Decide la IP; sin IP, o con `umbralGlobal` fallos en `ventanaGlobalMin`, decide el global.
- **[W-PLG-72]** Escala configurable, por defecto 0, 0, 5, 10, 15, 20, 25 y 30 minutos, repitiendo el último.
- **[W-PLG-73]** Un intento rechazado por estar penalizado no cuenta, y durante la penalización ni el secreto correcto pasa.

### Tiquetes, mensajes, calificaciones y reacciones

- **[W-PLG-80]** Tiquetes: entidad `tks` (tabla `tks_tks`) con `itk` autoincremental, `requerimiento` (html|md), `proposito`, `jtodo` (`[{hecho, contenido, jedit}]`), `estado` (columna kanban), `bfinalizado`, `fhcre`, `bactivo`, `iusuario` y `jasignados` (`{usuarios, roles, grupos}`; `*` en grupos = todos). CRUD completo y `POST tk` como alta.
- **[W-PLG-81]** El alta de un tiquete pone `fhcre` (ahora), `iusuario` (la sesión), `estado` (`por_hacer`) y `bfinalizado` (la regla); `cfg.estadosFinalizados` declara los estados que cierran un tiquete y, con esa lista, el estado manda sobre el valor manual; sin lista, `cfg.permitirFinalizadoManual` deja marcarlo a mano.
- **[W-PLG-82]** La baja de un tiquete es lógica: `DELETE` (y el borrado en plural) archiva (`bactivo` false) y la fila no se borra.
- **[W-PLG-83]** `GET tks/mis` devuelve los tiquetes que la sesión ve (quien lo creó, o si está asignado por usuario, rol o grupo; `*` = todos), con la paginación de DER (`page`, `pageSize`) y los filtros `estado` y `q`.
- **[W-PLG-84]** Mensajes: entidad `mensajes` (tabla `mensajes_mensajes`) con la PK (`tdespacio`, `iref`, `imensaje`), `jcontenido` (historial de versiones: la última es la vigente), `indexcita`, `bactivo`, `iusuario` y la virtual `qtotalrespuestas`. El índice es `x`, `x.y`, `x.y.z`… sin límite de niveles.
- **[W-PLG-85]** `POST mensajes/publicar` calcula el índice siguiente del hilo (el hijo libre de la cita) y guarda la primera versión; `PUT mensaje/{tdespacio}/{iref}/{imensaje}/editar` agrega una versión sin perder lo anterior; `GET mensajes/hilo` devuelve el árbol.
- **[W-PLG-86]** Adjuntos: entidad `adjuntos` (tabla `mensajes_adjuntos`) con la ficha del archivo (`clave` en el almacén del consumidor, `url`, `mime`, `bytes`); los bytes los mueve el consumidor.
- **[W-PLG-87]** Calificaciones: entidad `calificaciones` (tabla `calificaciones_calificaciones`) con la PK (`tdespacio`, `iref`, `iusuario`) y `valor` entero de -10 a 10 (0 neutro); fuera de rango es 400; no hay borrado (se cambia, incluso a 0).
- **[W-PLG-88]** Reacciones: entidad `reacciones` (tabla `reacciones_reacciones`) con la PK (`tdespacio`, `iref`, `iusuario`) y `reaccion` (emoji o clave corta); una por usuario y entidad, cambiable y retirable.
- **[W-PLG-89]** Las referencias (espacio, id de la entidad, usuario) son definiciones abiertas: sin FK. La coherencia la mantiene el sistema, no el motor.

## 2. HOW débil

- **[HW-PLG-01]** Las operaciones en proceso (`login`, `verify`, `logout`, `can`, `profile`, `load`…) son las mismas funciones que usan los handlers HTTP: una sola implementación.
- **[HW-PLG-02]** La IP real: con `trustProxy: N`, el salto N desde el final de `X-Forwarded-For`; con 0, el primero; luego `X-Real-IP`. El dispositivo se deduce del user-agent sin dependencias y la huella es un hash estable del user-agent.

- **[HW-PLG-03]** Embeddings en D1: ninguna sentencia supera 100 parámetros, nada depende de transacciones y el borrado va por tandas de select + delete por `icache`. Un conflicto de inserción entre dos requests no falla.

## 3. HOW fuerte

- **[HS-PLG-01]** Archivos: `src/03-plugins/common/{crypto,device}.ts`, `src/03-plugins/identity/{schemas,index,server}.ts`, `src/03-plugins/permissions/{schemas,index,server,rules}.ts`, entradas `src/03-plugins/index.ts` (server) y `src/03-plugins/client.ts` (client). Exportes: `identity`, `identityServer`, `permissions`, `permissionsServer`, `decide`, `effectiveValue`, `createClient`, `createServer`, `resolveEnv`, `clientIp`, `deviceInfo`, `huellaOf`, `hashPassword`, `verifyPassword`, `signJwt`, `verifyJwt`, `signJwtEs256`, `verifyJwtEs256`, `generateEs256KeyPair`, `importEs256PrivateKey`, `importEs256PublicKey`, `b64urlEncode`, `b64urlDecode`, `randomId`, `timingSafeEqual`.
- **[HS-PLG-02]** Hash: `pbkdf2-sha256$<iteraciones>$<sal b64url>$<hash b64url>` sobre HMAC-SHA256(pepper, contraseña), sal de 16 bytes, comparación en tiempo constante.

- **[HS-PLG-03]** Embeddings: `src/03-plugins/embeddings/{schemas,index,server,cache,purga,rules,vectores,proveedores}.ts`; exportes `embeddings`, `embeddingsServer`, `workersAi`, `vectorizeIndice`; tablas `embeddings_cache`, `embeddings_proyecciones`, `embeddings_contadores`, `embeddings_cursores`; rutas `embeddings/{embeber,buscar,estadisticas,purgar,reglas,alimentar}`.
- **[HS-PLG-04]** Vector: L2, proyección, L2, redondeo; texto base64url de int8 (1-2 decimales), int16 (3-4) o float32 little-endian. Proyección aleatoria: Achlioptas con mulberry32; cambiarla exige subir `VERSION_PROYECCION`.

## 6. Pruebas

- Sin plugins ni puertas nada aplica; login/logout; públicas vs protegidas; códigos distintos para vencido, firma ajena y `alg: none`; hash nunca expuesto ni consultable, sal aleatoria, cambio de contraseña por PUT; pojos indirectos y tabla `identity_usuarios`.
- Carga del DER, vector por rol, comodín admin, vigencia, perfil, CRUD del DER, catálogo y su permiso, acción no declarada; `denyByDefault`; solo identidad.
- Hermeticidad: permisos con `extract` propio del consumidor; identidad con `permissions` propio.
- Configuración inválida (claves extra, env ausente, secret corto, `security` fuera de rango), `resolveEnv`, `env` del runtime.
- Endurecimiento: auditoría de intentos y eventos, bloqueo que expira, dispositivo nuevo (bloqueo y solo auditoría), viaje imposible, `sessions`, `logout/all`, `password` con política y revocación, `events` con filtros; el cliente JSON con sesión singleton.
- Reglas puras del vector; por verbo vía HTTP; roles inactivos/futuros/de otro grupo; valor al handler; `permissions()` desde código; usuario inactivo pierde sus tokens.
- Clientes: token en otros controllers, validación local sin salir, logout revoca; perfil, carga, catálogo, DER con `include` del usuario (sin hash).
- ES256: firma/verificación, kid, manipulación, JWK, login + JWKS; utilidades de IP y dispositivo.
- Embeddings sobre D1 simulado con el límite de parámetros y sobre PGlite: hit sin llamar al modelo, referencias, texto editado, proyección entre isolates, obsoletas, estadísticas, regla combinada del pedido, operadores, huérfanos, general con exclusiones, simulación igual a la corrida real, presión por filas y por bytes, tandas con pendiente, prioridad de búsqueda, filtros por inquilino, adaptadores, alimentación, HTTP sin vector, y el JSON del README válido.

## 7. Notas

- Embeddings: el vector es texto base64url porque DER no tiene tipo binario. La proyección de consultas solo existe en TypeScript. El coseno local está acotado por `maxCandidatos`.
- `registry.secure(null)` limpia las puertas: imprescindible entre pruebas porque el registro es un singleton del proceso.
