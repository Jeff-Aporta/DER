---
Titulo: Calificaciones y reacciones: el voto sobre cualquier entidad
Estado: vigente
Autor:
tags: [plugins, calificaciones, reacciones, votos, metricas]
---
# Calificaciones y reacciones

Dos plugins hermanos, con el mismo DER: toda entidad puede ser calificada o reaccionar. Son la base de las métricas
de calidad (promedios, reacciones más y menos usadas) y de los "likes" sin inventar un modelo nuevo.

## Entidad `calificaciones` (tabla `calificaciones_calificaciones`)

| Columna | Tipo | Qué es |
|---|---|---|
| `tdespacio` | string 60 (pk) | el tipo de contexto |
| `iref` | string 120 (pk) | la entidad calificada |
| `iusuario` | string 120 (pk) | quién calibre |
| `valor` | int | de -10 (lo peor) a 10 (lo mejor); 0 es neutro |

- Con -10 y 10 se cubren el dislike y el like; 0 es "no calificado".
- Quien califica es la sesión: el `iusuario` de la fila es el de la sesión.
- **No hay borrado**: una calificación se cambia (hasta 0, que es neutro) pero nunca se elimina (`DELETE` responde 400).
- Fuera de rango: 400 con el detalle.

## Entidad `reacciones` (tabla `reacciones_reacciones`)

| Columna | Tipo | Qué es |
|---|---|---|
| `tdespacio` | string 60 (pk) | el tipo de contexto |
| `iref` | string 120 (pk) | la entidad |
| `iusuario` | string 120 (pk) | quién reaccionó |
| `reaccion` | string 64 | el emoji (o clave corta) |

- Una reacción por usuario y entidad; cambiarla es un `PUT`.
- A diferencia de la calificación, la reacción se puede retirar.

## Rutas

| Ruta | Seguridad | Qué hace |
|---|---|---|
| `POST calificaciones/calificar` | sesión | califica o recalifica la entidad de la sesión |
| CRUD `calificaciones` | sesión | completo (el `iusuario` lo pone la sesión) |
| `POST reacciones/reaccionar` | sesión | reacciona o cambia la reacción de la sesión |
| CRUD `reacciones` | sesión | completo |

## Montar

```ts
const calificaciones = createServer(calificacionesServer, { db, cfg: {} });
const reacciones = createServer(reaccionesServer, { db, cfg: {} });
const router = createRouter(ctrls, { basePath: "/api", plugins: [calificaciones, reacciones] });
await router.seed();
```
