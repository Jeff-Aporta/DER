# FOUNDATION — Specs fundación de DER

> Las specs son la **fundación** desde la que se reconstruye `src/` si un día se decide un refactor completo: si una regla no está aquí, no existe para la reconstrucción. Están escritas en **WHAT** (qué observa el consumidor, qué regla aplica, qué caso borde y qué error) y, solo cuando hace falta, en **HOW** (`HW` = guía semántica con libertad; `HS` = contrato exacto: nombres, rutas, tablas, tecnologías). Cómo mantenerlas: [`W2H.md`](W2H.md). Brief para el agente que reconstruye: [`foundation/_BRIEF-DESTILACION.md`](foundation/_BRIEF-DESTILACION.md).

## 0. Reglas transversales (aplican a todo)

- **[W-T-01]** Una sola definición (schema JSON, POJO, entidad, hooks compartidos, contratos Zod) sirve al client y al server; lo propio de cada lado se agrega encima sin duplicar la definición.
- **[W-T-02]** Las acciones reciben y devuelven POJOs de la entidad (o `QuerySpec` en `query`); nunca datos sueltos. Los POJOs se instancian de forma indirecta (`controller.pojo`, `registry.pojo`), nunca exigiendo conocer la clase.
- **[W-T-03]** Un `pre*` retorna truthy = mensaje de error (HTTP 400) y falsy = OK; el primer error corta.
- **[W-T-04]** Existe un único registro global (singleton) donde queda toda entidad por su plural, cada POJO por el nombre de su entidad, las puertas de seguridad y la sesión singleton.
- **[W-T-05]** El SQL lo arma el controller con primitivas del motor; el consumidor solo escribe SQL en columnas calculadas.
- **[W-T-06]** El proyecto es hermético: nada versionado referencia carpetas de la máquina; lo de otros proyectos llega por CDN fijado a un SHA.
- **[W-T-07]** Las capas solo importan hacia abajo (`00-common ← 01-objects ← 02-controllers ← 03-plugins`), el client nunca alcanza el server y cada dimensión declara sus dependencias (`zod` en el núcleo y el client; `kysely` en el server; drivers y pools los aporta el consumidor).
- **[W-T-08]** Los tests son la especificación ejecutable: un test rojo se arregla, nunca se salta; todo cambio observable actualiza estas specs antes de cerrarse.
- **[HS-T-01]** Tipos y Zod viven solo en archivos `schemas.ts`, con `type` (nunca `interface`) y un tipo por línea; los barrels se llaman `index.ts`; las carpetas van en kebab-case y tienen al menos dos elementos; los imports internos van por el alias `@Jeff-Aporta/DER/` con `.ts`, uno por línea; lo de is-webcomponents por `@Jeff-Aporta/wc-base/` y `@Jeff-Aporta/wc-diagrams/`; los miembros privados usan `#`.

## 1. Mapa

| # | Spec | Área | Cubre |
|---|---|---|---|
| 10 | [foundation/10-objetos.md](foundation/10-objetos.md) | `OBJ` | schemas JSON, columnas, secuencias, POJOs y casteos, Zod generado, registro global, entidades y rutas, query, diagramas |
| 20 | [foundation/20-controllers.md](foundation/20-controllers.md) | `CTL` | controller base (flujo, verificación, overrides, cfg, doc, endpoints, SSE, permisos) y client fetch |
| 30 | [foundation/30-servidor.md](foundation/30-servidor.md) | `SRV` | ServerController, motores (PG, PGlite, SQLite, MySQL, MSSQL), seed, syncSchema, secuencias, índices, propagación, multi-db |
| 40 | [foundation/40-router-hosts.md](foundation/40-router-hosts.md) | `RTR` | tabla de rutas, Router, seguridad por ruta con las puertas del registro, CORS, guard, documentación servida, hosts |
| 50 | [foundation/50-plugins.md](foundation/50-plugins.md) | `PLG` | plugins JSON (`createClient` / `createServer`), identidad, permisos, hermeticidad |
| 60 | [foundation/60-arquitectura-cdn.md](foundation/60-arquitectura-cdn.md) | `ARQ` | capas, dependencias, consumo por CDN, estilo del código, guardianes y organización de tests |

## 2. Convenciones de IDs

- `[W-<AREA>-NN]` requisito WHAT (observable). `[HW-<AREA>-NN]` guía HOW débil (libertad de implementación). `[HS-<AREA>-NN]` contrato HOW fuerte (nombres exactos).
- Los IDs no se reutilizan: uno borrado queda borrado. Las áreas son las del mapa más `T` (transversal).
- Cada spec tiene las secciones: 1 WHAT, 2 HOW débil, 3 HOW fuerte, 6 Pruebas (QUÉ se verifica), 7 Notas (deuda y diferencias conocidas).

## 3. Reconstrucción

Para reconstruir `src/` desde cero: leer `0`, luego las specs en el orden del mapa, implementar cada `[W-*]` respetando los `[HS-*]`, y dar por terminado solo cuando los tests descritos en cada sección 6 existan y estén en verde (`deno task check` y `deno task test`). El guardián `tests/arch/arch.test.ts` verifica que cada spec del mapa existe, tiene IDs y que no hay IDs repetidos.
