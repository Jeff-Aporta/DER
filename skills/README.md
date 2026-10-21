# Skills de DER — temario para agentes

> Punto de entrada de las **skills**: guías cortas, con ejemplos, para que un agente consuma o modifique DER sin leer el código. Cada archivo de `src/` enlaza esta skill general y la particular de su tema por CDN. URL base: `https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/`. La referencia completa está en `docs/` y el WHAT en `specs/`.

## Cómo usar este temario

1. Lee primero la skill del tema por el que entraste (la "particular" que enlaza el archivo).
2. Si vas a consumir DER desde otro proyecto, lee además [consumo-cdn.md](consumo-cdn.md).
3. Si vas a modificar DER, lee [estilo.md](estilo.md) antes de tocar nada.

## Índice

| Skill | CDN | Léela cuando… |
|---|---|---|
| Consumo por CDN y Deno | [consumo-cdn.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/consumo-cdn.md) | vas a importar DER desde una app (import map, entradas, dependencias) |
| Objetos: schemas, POJOs, registro, query | [objetos.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/objetos.md) | defines entidades, columnas, secuencias, relaciones o consultas |
| Controllers (client y server) | [controllers.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/controllers.md) | llamas acciones, escribes `pre*`, overrides, `/cfg`, `/doc`, permisos desde código |
| Servidor: motores, seed, router, hosts | [servidor.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md) | levantas un API: base de datos, tablas, propagación, rutas, Azure/Workers |
| Plugins JSON | [plugins.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md) | armas o escribes un plugin (`createClient`/`createServer`, `paths`, puertas de seguridad) |
| Entidad `usuarios` (identidad) | [identity.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/identity.md) | login, sesiones, contraseñas, auditoría, JWT |
| Entidades de permisos | [permissions.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/permissions.md) | roles, rol base, acciones, alias, catálogo, carga del DER |
| Estilo y reglas para modificar DER | [estilo.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/estilo.md) | vas a editar `src/`, `tests/`, `docs/` o `specs/` |

## Mapa archivo → skill particular

| Carpeta de `src/` | Skill particular |
|---|---|
| `00-common/`, `01-objects/` | objetos.md |
| `02-controllers/` (base, `client/`, `plugin.ts`) | controllers.md |
| `02-controllers/server/` (y `hosts/`) | servidor.md |
| `03-plugins/common/`, `03-plugins/index.ts`, `03-plugins/client.ts` | plugins.md |
| `03-plugins/identity/` | identity.md |
| `03-plugins/permissions/` | permissions.md |

## Tres reglas que siempre aplican

- Una sola definición (schema JSON + entidad) para client y server; los pojos se instancian de forma indirecta (`controller.pojo(...)`, `registry.pojo(plural, ...)`).
- Un `pre*` que retorna texto es un error 400; falsy es OK.
- El registro global (`registry`) tiene las entidades por plural, las puertas de seguridad (`extract`, `protected`, `permissions`) y la sesión singleton; sin `extract` no hay seguridad.
