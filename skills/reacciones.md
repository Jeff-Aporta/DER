# Skill: reacciones

[← temario](README.md) · referencia: `docs/050-Plugins/090-Calificaciones-y-reacciones.md`

## Qué es

Toda entidad puede recibir reacciones (publicaciones, comentarios, tiquetes, mensajes). La reacción es un emoji (o clave
corta) que un usuario pone sobre una entidad. Con esta tabla salen las métricas: reacciones más usadas, menos usadas y
las de cada usuario.

## Montar

```ts
const reacciones = createServer(reaccionesServer, { db, cfg: {} });
const router = createRouter(ctrls, { basePath: "/api", plugins: [reacciones] });
await router.seed();
```

## Tabla

| columna | tipo | qué es |
|---|---|---|
| `tdespacio` | string 60 (pk) | el tipo de contexto |
| `iref` | string 120 (pk) | la entidad |
| `iusuario` | string 120 (pk) | quién reaccionó |
| `reaccion` | string 64 | el emoji (o clave corta) |

## Reglas

- Quien reacciona es la sesión: el `iusuario` de la fila es el de la sesión.
- Una reacción por usuario y entidad: cambiarla es un `PUT`.
- A diferencia de la calificación, la reacción se puede retirar (se borra la fila).

## Rutas

| Ruta | Qué hace |
|---|---|
| `POST reacciones/reaccionar` | reacciona o cambia la reacción de la sesión |
| CRUD `reacciones` | completo |
