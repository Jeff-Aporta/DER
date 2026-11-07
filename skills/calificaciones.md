# Skill: calificaciones

[← temario](README.md) · referencia: `docs/050-Plugins/090-Calificaciones-y-reacciones.md`

## Qué es

Toda entidad puede ser calificada con un entero de -10 (lo peor) a 10 (lo mejor); 0 es neutro. Con -10 y 10 se
cubren el dislike y el like. La PK es (espacio, referencia, usuario): un usuario califica una entidad una sola vez.

## Montar

```ts
const calificaciones = createServer(calificacionesServer, { db, cfg: {} });
const router = createRouter(ctrls, { basePath: "/api", plugins: [calificaciones] });
await router.seed();
```

## Tabla

| columna | tipo | qué es |
|---|---|---|
| `tdespacio` | string 60 (pk) | el tipo de contexto |
| `iref` | string 120 (pk) | la entidad calificada |
| `iusuario` | string 120 (pk) | quién calibre |
| `valor` | int | de -10 a 10 (0 es neutro) |

## Reglas

- Quien califica es la sesión: el `iusuario` de la fila es el de la sesión.
- No hay borrado: una calificación se cambia (hasta 0, que es neutro) pero nunca se elimina (`DELETE` responde 400).
- Fuera de rango: 400 con el detalle (`La calificación va de -10 a 10`).

## Rutas

| Ruta | Qué hace |
|---|---|
| `POST calificaciones/calificar` | califica o recalifica la entidad de la sesión |
| CRUD `calificaciones` | completo (el `iusuario` lo pone la sesión) |
