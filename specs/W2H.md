# W2H — Cómo mantener las specs fundación (What → How)

> Pasos que siguen los agentes que cambian DER para dejar `specs/foundation/` al día, enfocados en el **WHAT** más que en el HOW. Las specs son la fundación desde la que se reconstruye `src/` ([`FOUNDATION.md`](FOUNDATION.md)): si una regla no está en ellas, no existe para la reconstrucción.

## 1. Cuándo actualizar

Antes de cerrar CUALQUIER cambio que altere algo observable: una ruta, un payload, una regla de negocio, una columna o tabla, una clave de configuración, un motor, una puerta de seguridad, un mensaje de error, un paso del seed o del sync, o una prueba que describe comportamiento. Un refactor interno sin efecto observable no toca las specs (salvo que cambie un `[HS-*]`).

## 2. Pasos

1. **Ubica la spec** en el mapa de `FOUNDATION.md` (sección 1). Un cambio puede tocar varias (p. ej. una ruta nueva: `40` + su dominio + `50` si tiene seguridad).
2. **Escribe primero el WHAT**: qué observa el consumidor (el que define entidades, el client, el que llama a la API), la regla, el caso borde y el error. Un requisito por viñeta, con ID nuevo `[W-<AREA>-NN]` (no reutilices IDs borrados).
3. **Solo si el WHAT no alcanza**, agrega `[HW-*]`: guía semántica que deja libertad al agente HOW.
4. **Solo si es contrato**, agrega o ajusta `[HS-*]`: nombres exactos de rutas, campos, tablas, claves, archivos, tecnologías. Si dudas entre HW y HS, elige HW.
5. **Pruebas**: actualiza la sección 6 con QUÉ debe verificarse (WHAT o HOW débil), nunca el cómo. Si la prueba nueva existe en `tests/`, su intención debe poder leerse en la spec.
6. **Elimina lo obsoleto** en la misma spec (no dejes reglas que el código ya no cumple). Las diferencias conocidas o deuda van a la sección 7 "Notas".
7. **Reglas transversales**: si el cambio introduce una regla que aplica a todo (como "pojos siempre indirectos"), agrégala a la sección 0 de `FOUNDATION.md` y al brief `foundation/_BRIEF-DESTILACION.md`.
8. **Docs**: `docs/` explica el HOW para humanos y agentes que consumen; si la spec cambió, revisa la hoja de docs del mismo tema.
9. **Verifica**: `deno task check` y `deno task test` (incluye el guardián de cobertura de specs en `tests/arch/arch.test.ts`).

## 3. Lo que NO va en las specs

- Código pegado, nombres de funciones internas, rutas de archivos de implementación (salvo `[HS-*]` de estructura obligatoria).
- Historia de cómo se llegó a una decisión (va en el mensaje de commit).
- Secretos o credenciales en claro.

## 4. Checklist de cierre

- [ ] WHAT escrito y con ID
- [ ] HW/HS solo donde hacía falta
- [ ] Sección 6 (pruebas) al día
- [ ] Lo obsoleto eliminado
- [ ] Hoja de `docs/` del tema revisada
- [ ] Guardián de specs en verde
