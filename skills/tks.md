# Skill: tiquetes (tks)

[← temario](README.md) · referencia: `docs/050-Plugins/070-Tks.md`

## Qué es

El tablero transversal que toda app puede montar: tiquetes numerados (autoincremental), con contenido (`requerimiento`),
idea resumida (`proposito`), pendientes (`jtodo`), columna del kanban (`estado`), regla de cierre (`bfinalizado`),
fecha de alta (`fhcre`), baja lógica (`bactivo`), autor (`iusuario`) y asignación (`jasignados`: usuarios, roles y
grupos; `*` en grupos = todos).

## Montar

```ts
const tks = createServer(tksServer, { db, cfg: { estadosFinalizados: ["finalizado"] } });
const router = createRouter(ctrls, { basePath: "/api", plugins: [tks] });
await router.seed();
```

Cliente:

```ts
const tks = createClient(tksPlugin, { baseUrl: "/api", headers: auth.headers });
const fila = await tks.crearTk({ requerimiento: "#42", proposito: "Arreglar el login" });
const lista = await tks.misTks();
```

## Tabla

| columna | tipo | qué es |
|---|---|---|
| `itk` | int pk autoincrement | el número del tiquete (1, 2, 3…) |
| `requerimiento` | text | el contenido (html|md) |
| `proposito` | string 300 | la idea resumida del foco |
| `jtodo` | json | los pendientes: `[{ hecho, contenido, jedit }]` |
| `estado` | string 40 | la columna del tablero (`por_hacer` por defecto) |
| `bfinalizado` | bool | la regla de cierre |
| `fhcre` | datetime | desde cuándo está abierto |
| `bactivo` | bool | baja lógica (archivar) |
| `iusuario` | string 120 | quién lo creó |
| `jasignados` | json | `{ usuarios, roles, grupos }` |
| `qtotalmensajes` | virtual | cuántos mensajes tiene |
| `qcalificacion` | virtual | la calificación promedio |

## Reglas

- El alta pone `fhcre` (ahora), `iusuario` (la sesión), `estado` (`por_hacer`) y `bfinalizado` (la regla).
- `cfg.estadosFinalizados`: los estados que cierran un tiquete; con esa lista, `bfinalizado` lo manda el estado y el
  valor manual no cuenta. Sin lista, el usuario puede marcarlo a mano (`cfg.permitirFinalizadoManual`).
- La baja es lógica: `DELETE` archiva (`bactivo` false) y la fila nunca se borra.
- `misTks`: lo que la sesión ve (quien lo creó o si está asignado por usuario, rol o grupo; `*` en grupos = todos), con
  la paginación de DER (`page`, `pageSize`) y filtros (`estado`, `q`).
- Las columnas de métrica se encienden en `seed` si el consumidor instaló los plugins de mensajes y de calificaciones:
  un plugin no depende de otro.

## Rutas

| Ruta | Qué hace |
|---|---|
| `GET/POST/PUT/DELETE tk…` | CRUD del tiquete (`POST` en el singular) |
| `GET tks` · `GET tks?q=` | lista y consulta (con filtros y paginación) |
| `POST tks/crear` | crea con los defaults del servidor |
| `GET tks/mis` | los tiquetes que la sesión ve |

## Errores comunes

- `POST` va al singular (`/api/tk`), no al plural: en el plural es `postList`.
- Sin `extract` no hay seguridad: sin sesión, las rutas protegidas responden 401.
- `jasignados` con `*` solo en `grupos`: es el comodín de "todos".
