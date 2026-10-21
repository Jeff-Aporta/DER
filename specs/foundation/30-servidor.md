# 30 — Servidor: ServerController, motores, seed, sync, secuencias, índices, propagación

Área `SRV`. Depende de `zod` + `kysely`; pools y drivers los aporta el consumidor.

## 1. WHAT

### Configuración

- **[W-SRV-01]** `ServerController(entity, { db, table?, identifierCase?, columnNames?, computed?, relations?, sse?, endpoints?, cfg?, expose?, routes?, security?, hidden?, indexes?, autoIndexes?, getPropagation?, setPropagation?, defaultOrder?, register?, hooks?, actions?, doc?, docBase? })`. `table` default: la de la entidad. `computed` solo admite columnas virtuales; `columnNames` solo columnas existentes (si no, error al construir). Se registra en su `db` salvo `register: false`.
- **[W-SRV-02]** `identifierCase` (`preserve` default, `lower`, `upper`) aplica a tabla y columnas en todos los motores; los resultados siempre vuelven con los nombres de campo del POJO.
- **[W-SRV-03]** Una columna `hidden` nunca se selecciona ni se devuelve, no se puede pedir en `select` ni filtrar (ni vía relaciones o lógicos): error de validación «"x" no es consultable».
- **[W-SRV-04]** Columnas calculadas: un string con `{campo}` se convierte en la referencia correcta (alias, caso, motor); `{ pg, sqlite, mysql, mssql }` elige por motor (sin expresión para el motor actual → error «computed sin expresión para el motor X»); o una función con helpers. `list()` no evalúa calculadas; `query()`/`get()` sí, y se puede filtrar y ordenar por ellas.

### Motores

- **[W-SRV-05]** Motores incluidos: PostgreSQL (pool `pg`-compatible), PGlite (embebido), SQLite (`node:sqlite` por ruta, un driver síncrono con `prepare()` como better-sqlite3, o un driver asíncrono con `all`/`run` por callback como sqlite3), MySQL/MariaDB (pool `mysql2`) y Microsoft SQL Server (`tedious` + `tarn`). Cualquier dialecto de Kysely sirve con un `Engine` propio.
- **[W-SRV-06]** El resultado observable (POJOs casteados, relaciones anidadas, filtros, orden, paginación, escrituras que devuelven la fila) es idéntico en todos los motores. Lo que cambia queda dentro del motor: tipos DDL, booleanos, fechas/horas (siempre texto `YYYY-MM-DD` / `HH:MM:SS` al leer), JSON, agregación de relaciones, LIKE sin mayúsculas, paginación, cómo devuelve filas una escritura, identity, secuencias e índices.
- **[W-SRV-07]** Escrituras: en motores con `RETURNING` la fila vuelve de la misma sentencia; en MSSQL con `OUTPUT inserted/deleted`; en MySQL se inserta/actualiza y se relee por pk (la pk autoincrement se toma del id insertado; en `delete` se lee antes de borrar).
- **[W-SRV-08]** MSSQL: toda consulta ordenada lleva `OFFSET` (vale también como subconsulta); `CREATE TABLE`/`INDEX` sin `IF NOT EXISTS` se protegen consultando el catálogo.

### Lectura

- **[W-SRV-09]** `get` incluye por defecto `getPropagation()` (config) o el `getInclude` de la entidad; `ctx.include` lo sobreescribe (`{}` = sin relaciones). `list` devuelve `listColumns` aplanadas, sin relaciones ni calculadas. `query` aplica `select`, `where`, `orderBy`, `page`/`pageSize` e `include`; el orden por defecto es `defaultOrder` o las pks (paginación estable).
- **[W-SRV-10]** Las relaciones de la misma base se resuelven en el mismo SQL (subconsulta JSON correlacionada, anidable); las de otra base se resuelven con un join de aplicación por POJOs (consulta en lote con `IN` sobre las llaves de `on`) y se anexan a sus dueños, a cualquier profundidad. Un filtro por relación de la misma base es `EXISTS`; de otra base se traduce a un filtro local sobre las columnas de `on` (sin coincidencias → nada).
- **[W-SRV-11]** Una relación cuyo POJO destino no tiene controller registrado produce un error que nombra la entidad y la relación («"x" usa la relación "y": …»). `relations.<rel>.controller` permite fijar el controller a mano.

### Escritura

- **[W-SRV-12]** `post` completa las columnas con secuencia que no vienen, respeta un valor explícito y devuelve la fila guardada (con defaults e identity). `put` singular aplica el body sobre el registro actual según `schema.put`: `insert` (default: parcial, json con molde fusiona en profundidad), `insertIgnore` (solo completa), `update` (solo cambia lo definido), `replace` (todo el registro; lo no enviado queda vacío); un registro inexistente → `null`. `delete` devuelve la fila borrada o `null`.
- **[W-SRV-13]** Las listas corren en una transacción: un pre fallido o un registro inexistente (`[i] No encontrado: pks`) revierte todo. `db.transaction(fn)` comparte una transacción entre controllers; lanzar dentro revierte.

### Propagación de detalles

- **[W-SRV-14]** `setPropagation()` declara qué relaciones (de pertenencia, anidables) se escriben junto al padre: `post` inserta el padre y luego sus detalles copiando la FK de `on` y verificando cada detalle con su `pre*` (error «rel[i]: mensaje» revierte todo); `put` borra los detalles enviados y los reinserta (una relación no enviada no se toca; `[]` vacía); `delete` borra los detalles en cascada antes que el padre. Todo en una transacción; un detalle en otra base escribe con su propia conexión (no atómico entre bases).
- **[W-SRV-15]** `getPropagation()` declara qué se extrae en `get` (puede diferir de lo que se escribe). `propagationControllers()` es el conjunto alcanzable (lectura ∪ escritura, anidado, `"*"` expandido); `detailRelations()` las relaciones de detalle.

### Seed, sync, secuencias e índices

- **[W-SRV-16]** `seed()` crea la tabla si no existe a partir de las columnas persistidas (tipos, `NOT NULL`, `UNIQUE`, `DEFAULT` literal o SQL, pk simple o compuesta, identity), las secuencias globales, los índices y la tabla de configuración si aplica; luego siembra en cascada los controllers que alcanza la propagación (cada uno en SU base, una sola vez, sin ciclos). `db.seed()` siembra todos los de la base; `propagate: false` solo la propia. Errores: autoincrement en columna no entera; en SQLite autoincrement exige ser la única pk.
- **[W-SRV-17]** `syncSchema({ migrate?, keepExtra?, dryRun? })` sincroniza la tabla con el POJO: exige un getter/setter por columna persistida (si no, error que nombra las columnas), crea la tabla si no existe, agrega las columnas que faltan (con su default), pasa cada fila por `migrate(anterior)` con las columnas viejas presentes, elimina las sobrantes (salvo `keepExtra`), todo en una transacción; devuelve `{ table, created, added, dropped, migrated, dryRun }`. No migra la pk (error si falta). Recrea secuencias e índices faltantes.
- **[W-SRV-18]** Secuencias globales: una secuencia real del motor (PG, MSSQL) o una tabla `_sequences` con incremento atómico (SQLite, MySQL); `start`/`increment` se respetan; nombradas se comparten; no retroceden si la transacción falla. Por ámbito: máximo del grupo + incremento dentro de la transacción del insert; sin los valores del ámbito → error de validación «La secuencia de "x" requiere: a, b». El valor sale numérico o en texto (formateado y en su base) según `W-OBJ-06`.
- **[W-SRV-19]** Índices automáticos (default): la FK local de cada relación 1:1 y las llaves remotas de cada detalle 1:N de la misma base (en la tabla del detalle), salvo que ya sean prefijo de la pk o una FK única; explícitos con `indexes: [{ columns, unique?, name? }]`. Nombres `ix_<tabla>_<cols>` / `ux_…`. Los que una relación 1:N pide sobre otra tabla los crea esa tabla al sembrarse (el orden del seed no importa).

### Configuración y documentación

- **[W-SRV-20]** `/cfg` se expone solo si la entidad define `cfg` y hay tabla de configuración (en la base o en el controller; `cfg: false` la apaga): una fila por entidad (pk = plural) con el JSON y la fecha de la última actualización; sin tabla → 404 «no expone configuración».
- **[W-SRV-21]** `doc()` compone el contrato autogenerado de la entidad (rutas, columnas, relaciones, diagrama, consulta, cfg si aplica, verificaciones) con las fuentes `.md` del controller o de la entidad (ruta local, `file:` o URL, indistinto) como secciones con encabezados bajados un nivel; `docView()` lo entrega en la vista del kit iswc.

## 2. HOW débil

- **[HW-SRV-01]** Las relaciones diferidas (cross-db) se resuelven después de ejecutar el SQL principal, recorriendo el camino hasta los dueños y pidiendo al controller del detalle en lote.
- **[HW-SRV-02]** El SQL se compone con los bloques `sql` de Kysely (identificadores siempre entrecomillados por el dialecto); los parámetros nunca se interpolan.

## 3. HOW fuerte

- **[HS-SRV-01]** Archivos: `src/02-controllers/server/{schemas,engines,database,controller,routes,router,doc,plugin,index,sqlite,pg,pglite,mysql,mssql}.ts` y `hosts/{azure,cloudflare}.ts`. Fábricas: `sqliteDatabase`, `pgDatabase`, `pgliteDatabase`, `mysqlDatabase`, `mssqlDatabase`; motores `postgres`, `sqlite`, `mysql`, `mssql`; `asyncSqliteDialect`, `nodeSqliteAdapter`, `pglitePool`.
- **[HS-SRV-02]** Contrato `Engine`: `name`, `returning` (`returning|output|none`), `ifNotExists`, `escape`, `defaultValues`, `columnType`, `selectExpr`, `toDb`, `readJson`, `jsonOne`, `jsonMany`, `ilike`, `page`, `autoincrement`, `createSequence`, `nextValue`, `createIndex`.
- **[HS-SRV-03]** Tabla de secuencias emuladas: `_sequences (name, value, increment)`. Tabla de cfg: la declara el consumidor con `{ table, columns: { pk, json, fecha } }`.
- **[HS-SRV-04]** Cabeceras SSE: `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache`, `x-accel-buffering: no`; cada texto es un evento `message` (líneas múltiples en varios `data:`); un fallo del handler emite `event: error`.

## 6. Pruebas

- Los mismos casos en SQLite y PostgreSQL (PGlite): seed, CRUD con casteos, defaults, identity, json, fechas; `list` aplanado; `query` con cada operador, relación (EXISTS), calculadas, paginación estable; relaciones anidadas 1:N y 1:1 con pks compuestas y `"*"`; pre automáticos, hooks de server, listas transaccionales, transacción compartida; endpoints, overrides y SSE en proceso; `/cfg` y PUT singular por modo; `identifierCase upper` y `singular === plural`; columnas renombradas, `hidden` no consultable, calculadas por motor y función.
- MySQL y MSSQL sin servidor: el SQL compilado (agregación JSON, LIKE, paginación, identificadores), tipos DDL y modo de escritura; el driver SQLite asíncrono con seed, autoincrement, query y rollback.
- Propagación de 1 y 2 niveles con secuencias por ámbito: post/get/put/delete en cascada, detalle inválido que revierte, seed propagado sin ciclos; multi-db (SQLite + PGlite) con lectura mixta, filtros cross-db en ambos sentidos, escritura propagada y seed en cada base.
- Secuencias: global con inicio, con formato, por ámbito numérica y con formato, valor explícito respetado, base 36 en pk, por ámbito en base 16 con patrón (lectura del máximo en su base), numérica quemada como texto; índices explícitos únicos y automáticos sin depender del orden del seed; `syncSchema` recrea un índice faltante.
- `syncSchema`: agrega, conserva, migra con la fila anterior, elimina, crea si no existe, falla sin accessor.

## 7. Notas

- MySQL y MSSQL se verifican por compilación de SQL y tipos; no hay servidor en la batería. Un consumidor que los use debe correr su propia prueba de humo con su pool.
- Las secuencias por ámbito bajo alta concurrencia se respaldan con un índice único.
