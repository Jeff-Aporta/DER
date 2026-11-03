# Skill: penalizaciones

[← temario](README.md) · referencia: `docs/050-Plugins/050-Penalizaciones.md` · la usa: [errores.md](errores.md)

Frena la fuerza bruta contra cualquier secreto (hoy, el código de los reportes). Una tabla: `id` + `intentos` (JSON con los últimos fallos).

## Vectores

Por ámbito hay dos: `<ambito>:ip:<ip>` y `<ambito>:global`. Cada fallo se anota en los dos.

- **Decide el de la IP** mientras se conozca.
- **Decide el global** si no hay IP, o si entre todos llegan `umbralGlobal` fallos (10) en `ventanaGlobalMin` (60): señal de ataque, se ignora la IP y se frena a todos.

## Escala

`escalaMin` da los minutos tras el fallo número n: por defecto `[0, 0, 5, 10, 15, 20, 25, 30]`; desde el último se repite. Los fallos más viejos que `ventanaMin` (1440) ya no cuentan. Se configura: `cfg: { escalaMin: [...] }`.

## Uso

```ts
const multas = createServer(penalizacionesServer, { db, cfg: {} });
const intento = { ambito: "errores", ip };
const v = await multas.verificar(intento);       // { penalizado, restanteMs, vector, fallidos }
if (v.penalizado) return 429;                    // este rechazo NO cuenta como fallo
if (!correcto) await multas.fallo(intento);
else await multas.acierto(intento);              // limpia la IP; el global se vacía solo con su ventana
```

Verifica **antes** de comparar el secreto: durante la penalización ni el secreto correcto pasa. La IP debe ser la real del host (`ipReal` / servicio `ipDe`): una IP falsificable anula el vector.

Lectura y escritura no son atómicas: en una ráfaga concurrente se pueden colar unos pocos intentos de más. El vector global acota el daño.
