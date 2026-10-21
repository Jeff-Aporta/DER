# 10 — Objetos: schemas, POJOs, Zod, registro, entidades, query, diagramas

Área `OBJ`. Lo reusable tal cual en front y back: solo depende de `zod` (y de `Obj` del kit iswc por CDN).

## 1. WHAT

### Schema JSON y columnas

- **[W-OBJ-01]** Un schema es un JSON con `columns` (nombre → definición), `relations` opcionales, `primaryKey` opcional (orden explícito de pks) y `put` (modo del PUT singular). Debe tener al menos una pk; una pk no puede ser virtual; un nombre de campo solo admite `[A-Za-z_][A-Za-z0-9_]*`; un nombre no puede ser columna y relación a la vez. Cualquier violación es un error al definirlo.
- **[W-OBJ-02]** Tipos de columna: `string`, `text`, `int`, `bigint`, `float`, `decimal`, `bool`, `date`, `datetime`, `time`, `json`, `uuid`. Propiedades: `pk`, `autoincrement` (solo pks enteras), `nullable` (default true salvo pks), `length`, `precision`/`scale`, `unique`, `default` (literal o `{ sql }`), `enum`, `virtual` (no se persiste), `sequence`, `zod` (refina el valor; en `json` es su molde).
- **[W-OBJ-03]** Una relación es `kind: "one" | "many"`, `target` (nombre de entidad o thunk a la clase) y `on` (`columnaLocal: columnaDelDetalle`). `one` entrega un objeto o `null`; `many` una lista (vacía si no hay).
- **[W-OBJ-04]** Una columna es obligatoria al insertar cuando no es nullable (o es pk) y no tiene `default`, `sequence`, `autoincrement` ni `virtual`.

### Secuencias

- **[W-OBJ-05]** `sequence: true | { name?, start?, increment?, scope?, pattern?, base?, as? }`. Global por defecto (compartible entre columnas/tablas por `name`); con `scope` es un consecutivo por grupo (máximo del grupo + incremento); `pattern` (`"FAC-{n:5}"`, `{n:ancho}` rellena con ceros) formatea el número en columnas de texto.
- **[W-OBJ-06]** `base` es la base en la que se quema el número: entero entre 2 y 36, default 10. `as` dice si el valor es `number` o `string`; default `number` en columnas numéricas y `string` en columnas de texto. Reglas: base > 10 exige `as: "string"` y por tanto una columna `string`/`text`; `as: "number"` exige columna numérica; `as: "string"` exige columna de texto. Cualquier combinación inválida es un error al definir el schema (antes de tocar una base de datos).
- **[W-OBJ-07]** Con `scope`, el máximo del grupo se lee en la base de la secuencia a partir del último tramo alfanumérico del valor guardado (lo que deja el patrón al final); si no hay valores, se parte de `start`.

### POJOs y casteos

- **[W-OBJ-08]** Un POJO tiene un getter/setter por columna y por relación; los setters castean según el tipo (`string` → texto, `int` → entero truncado, `bool` → acepta `1/0/"si"/"true"…`, `date` → `YYYY-MM-DD` sin corrimiento de zona, `datetime` → `Date`, `time` → `HH:MM:SS`, `json` → tal cual); `undefined` se conserva como "no definido" (PUT parcial). Las relaciones castean al POJO destino (uno o lista).
- **[W-OBJ-09]** Se declara con clase (`class X extends pojoOf(Schema)`) o sin clase (`defineEntity({ schema })` genera el POJO). Nombres reservados que no pueden ser columna: `f`, `assign`, `toJSON`, `pkValues`, `pkOnly`, `constructor`, `insert`, `insertIgnore`, `update`, `delete`, `get`, `replace`.
- **[W-OBJ-10]** `toJSON()` serializa columnas (incluidas virtuales) y relaciones definidas, omite `undefined` y convierte `Date` a ISO. `pkValues()` y `pkOnly()` operan sobre las pks. `assign` solo toma llaves conocidas del schema.
- **[W-OBJ-11]** Acciones JSON parciales y tipadas sobre el POJO: `insert` (upsert profundo; `null` → null si la columna lo admite, si no se quita), `insertIgnore` (solo agrega lo no definido), `update` (solo cambia lo definido), `delete(query)`, `get(query)`, `replace(obj)`. Una columna `json` con `zod` fusiona en profundidad; sin `zod` se reemplaza completa. El resultado se valida contra el molde: si no cumple, lanza error de validación y el POJO no cambia.

### Zod generado

- **[W-OBJ-12]** Cada schema genera cinco schemas Zod idénticos en client y server: `row` (lectura: todo opcional, nullable según la columna), `insert` (POST: requeridos según `W-OBJ-04`), `update` (PUT: pks requeridas, resto opcional), `pk` (solo pks) y `molde` (el de `Obj.insert`). Los mensajes son en español: «Falta el campo requerido "x"», «"x" no puede ser nulo», «"x" debe ser un entero», «"x" debe ser uno de: a, b», «"x" supera N caracteres».

### Registro global

- **[W-OBJ-13]** Definir una entidad la registra por su plural completo (la ruta plural: `productos`, `permisos/roles`, `crisis/s`). Dos entidades con el mismo plural es un error cuyo mensaje nombra el plural y la entidad previa. También registra el POJO por `name`; dos entidades distintas con el mismo `name` es un error.
- **[W-OBJ-14]** Desde el registro se recupera una entidad por su plural, la lista de entidades, y una instancia de POJO por plural y contenido (`registry.pojo`). Pedir un plural inexistente es un error que nombra el plural.
- **[W-OBJ-15]** El registro guarda las puertas de seguridad (`extract`, `protected`, `permissions`) y la sesión singleton (`session`); `secure(null)` las borra; `clear()` vacía todo (pruebas).

### Entidades y rutas

- **[W-OBJ-16]** Una entidad tiene `pojo` o `schema` (uno de los dos; sin ninguno es error), `singular`, `plural`, `name` (default `singular`), `table` (default: el plural, luego el singular, con todo lo que no sea `[A-Za-z0-9_]` convertido a `_`; vacío = error), sufijos, `listColumns` (deben ser columnas), `getInclude`, `pageSize` (50), `maxPageSize` (1000), `hooks`, `endpoints`, `paths` (irregulares de la entidad: cuelgan de su plural o singular, opcionalmente con pks), `cfg` (exige `zod`), `doc`, `itemHooksOnLists` (true), `security`, `exposed` (default true: se publica por API) y `administrable` (default true: admite escrituras por CRUD).
- **[W-OBJ-17]** Rutas (sin base): `get` GET `singular/pks`; `post` POST `singular`; `put` PUT `singular/pks`; `delete` DELETE `singular/pks`; `list` GET `plural`; `query` POST o GET `plural/query`; `postList`/`putList`/`deleteList` POST/PUT/DELETE `plural`; `getCfg`/`putCfg` GET/PUT `plural/cfg`; `doc` GET `plural/doc` (`?v=1` vista); endpoint `one` `singular/pks/nombre`, `many` `plural/nombre`. Cualquier ruta + `/sse` es su variante SSE. `/cfg` y `/doc` existen solo en el plural.
- **[W-OBJ-18]** Si `singular === plural`, el plural lleva el sufijo `s` (o `pluralSuffix`). Un segmento solo admite `[A-Za-z0-9_.~-]` y puede tener varios niveles (`pedido/linea`). Singular y plural resueltos no pueden coincidir. Las pks viajan codificadas (`encodeURIComponent`). Al resolver, el plural tiene prioridad.
- **[W-OBJ-19]** Un endpoint no puede llamarse como una acción CRUD ni usar los segmentos reservados `query`, `sse`, `cfg`, `doc`.
- **[W-OBJ-20]** `patch(pojo, cambios)` devuelve una copia con el upsert aplicado (no muta); `aplicar(pojo, acciones)` aplica acciones `Obj` y valida.

### Query

- **[W-OBJ-21]** `QuerySpec`: `select` (columnas), `where`, `orderBy` (`"campo"`, `"-campo"`, `"+campo"` o `{ field, dir }`), `page` (1-based), `pageSize` (default de la entidad, tope `maxPageSize`), `include` (JData: `true`, objeto anidado, `"*"` = todas).
- **[W-OBJ-22]** `where`: `campo: valor` (igualdad; `null` → IS NULL; arreglo → IN), `campo: { eq, ne, gt, gte, lt, lte, in, nin, between, like, ilike, contains, startsWith, endsWith, isNull }`, `relacion: { …filtro del detalle }` y `$and`, `$or`, `$not`. `contains`/`startsWith`/`endsWith` no distinguen mayúsculas y escapan comodines.
- **[W-OBJ-23]** La validación estructural es compartida y da mensajes claros: «La consulta debe ser un objeto», «select: "x" no es una columna», «orderBy: "x" no es una columna», «page debe ser un entero >= 1», «pageSize no puede superar N», «where.$or debe ser un arreglo», «where.campo.in debe ser un arreglo», «where.campo.between debe ser [desde, hasta]», «where.x: "y" no es columna ni relación», «include.x: "y" no es una relación», «operador desconocido "z"». Una clave desconocida del spec se rechaza.

### Diagramas

- **[W-OBJ-24]** De una lista de entidades se generan los payloads `{ erDiagram }` y `{ classDiagram }` del kit is-webcomponents, con exactamente sus tipos (importados del kit por CDN) y ya normalizados: `direction` (ER default `LR`, clases default `TB`), `ratio` (default 1.4), id de relación `entidad.relacion`, `identifying` (true en 1:N), `methods: []`. `kind: "one"` → `fromCard many / toCard one`; `many` → `one / many`; pk → `key: "PK"`; columna local de `on` → `key: "FK"`; relación en `propagations` → `dashStyle: "dashed"` y `kind: "dependency"` con etiqueta «propaga»; `nullableCards` + FK nullable → `zeroOrOne`/`zeroOrMany`.

## 2. HOW débil

- **[HW-OBJ-01]** La metadata del schema (pks, persistidas, virtuales, relaciones) se calcula una vez por schema y se cachea.
- **[HW-OBJ-02]** `Obj` (insert, insertIgnore, update, delete, get, getValue, replace, aplicar, esquemaInsert, esPlano) se reexporta del kit; DER no lo reimplementa.

## 3. HOW fuerte

- **[HS-OBJ-01]** Archivos: `src/00-common/{schemas,base,sse,index}.ts` y `src/01-objects/{meta,zod,pojo,registry,query,entity,diagram,index}.ts`. `base.ts` reúne `Obj`, `HttpError`/`ValidationError`/`NotFoundError` y los casteos `toStr`, `toInt`, `toFloat`, `toBool`, `toDate`, `toDateTime`, `toTime`, `toJson`, `CASTS`.
- **[HS-OBJ-02]** Exportes: `defineSchema`, `schemaMeta`, `sequenceOf`, `isRequiredOnInsert`, `columnZod`, `schemaZod`, `zodOf`, `pojoValues`, `zodMessage`, `Pojo`, `pojoOf`, `resolvePojo`, `castRelation`, `registry`, `normalizeOrder`, `expandInclude`, `validateQuery`, `validateWhere`, `validateInclude`, `isOpsObject`, `Entity`, `defineEntity`, `erDiagramPayload`, `classDiagramPayload`, `diagramPayloads`.
- **[HS-OBJ-03]** Tipos de diagrama: `@Jeff-Aporta/wc-diagrams/diagram-types.schemas.ts` (`ErSpec`, `ClassSpec` y afines); `Obj` y `TConsulta`/`TAccionObj`: `@Jeff-Aporta/wc-base/lib/obj.ts` y `.../schemas.ts`.

## 6. Pruebas

- Casteos por tipo de columna y conservación de `undefined`; acciones JSON del POJO (molde, json sin molde, relaciones, rechazo fuera del molde sin mutar).
- Zod por acción (`insert`, `update`, `pk`, `row`) con requeridos y enums.
- Rutas: singular/plural, pks compuestas y codificación, sufijo `s`, sufijos personalizados, `match` de acciones/endpoints/sse, validaciones de definición (segmento inválido, endpoint que choca con CRUD, segmento reservado).
- Validación de query: cada mensaje de `W-OBJ-23`.
- Registro: entidad por plural, pojo indirecto, tabla por defecto con `/` → `_`, `table` explícita, plural y nombre duplicados, plural inexistente.
- Secuencias: cada combinación válida e inválida de `base`/`as`/tipo (`W-OBJ-06`), incluido el error al construir el POJO.
- Diagramas: cobertura de entidades, PK/FK, cardinalidades, `nullableCards`, propagación punteada y `dependency`, los dos payloads juntos.

## 7. Notas

- `Entity.patch`/`aplicar` existen para armar bodies de PUT en el client; no son acciones HTTP.
- El límite de diseño de `W-OBJ-18`: una pk que vale literalmente `"s"` colisiona con el plural por defecto; se evita con `pluralSuffix` o pks que nunca valgan `"s"`.
