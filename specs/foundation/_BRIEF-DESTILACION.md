# Brief de destilación — reconstruir DER desde las specs

Eres el agente HOW. Reconstruyes `src/` de DER a partir de `specs/foundation/` sin mirar el código anterior.

## Qué es DER (en una línea)

Una librería TypeScript (Deno primero, sin build, consumible por CDN) para definir UNA vez, en JSON, los schemas de las entidades y sus POJOs, y reusarlos como controllers REST en el client (fetch) y en el server (SQL agnóstico), con plugins de seguridad que también son JSON.

## Reglas que nunca se negocian

1. Una definición, dos lados (`W-T-01`). Nada se duplica entre client y server: el server hace push de sus particularidades sobre lo transversal.
2. POJOs siempre, e indirectos (`W-T-02`): `controller.pojo(content)`, `registry.pojo(plural, content)`.
3. `pre*` truthy = error (`W-T-03`).
4. Registro global único (`W-T-04`): entidades por plural (duplicado = error), POJOs por nombre, puertas `extract`/`protected`/`permissions`, sesión singleton.
5. SQL con primitivas del motor (`W-T-05`); cinco motores (PG, PGlite, SQLite, MySQL, MSSQL) con el mismo resultado observable.
6. Hermético y por CDN (`W-T-06`): alias `@Jeff-Aporta/DER/`, `@Jeff-Aporta/wc-base/`, `@Jeff-Aporta/wc-diagrams/` fijados a SHA.
7. Capas hacia abajo, client ⟂ server, dependencias por dimensión (`W-T-07`).
8. Estilo (`HS-T-01`): `type` en una línea solo en `schemas.ts`, `index.ts` como barrel, kebab-case, carpetas ≥ 2 elementos, un import por línea, `#` privados, una sentencia por línea, sin funciones de una línea que solo deleguen.
9. Tests como especificación (`W-T-08`): nada se cierra en rojo; cada sección 6 describe lo que debe verificarse.

## Orden de trabajo

`10-objetos` → `20-controllers` → `30-servidor` → `40-router-hosts` → `50-plugins` → `60-arquitectura-cdn` (los guardianes al final, pero léelos primero: condicionan la forma de todo lo demás).

## Qué entregar

`src/` + `tests/` + `docs/` coherentes, `deno task check` y `deno task test` en verde, y estas specs sin cambios (si algo no cuadra, se corrige la spec siguiendo `W2H.md`, nunca se improvisa en el código).
