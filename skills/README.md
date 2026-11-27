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
| Permisos RBAC (roles y matriz en la base) | [permisos.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/permisos.md) | permisos por ACCION: catálogo de acciones, matriz rol x acción editable, 8 roles de semilla, `puede`/`exigir`/`exigirPermiso` |
| Apps (aislamiento por iapp) | [apps.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/apps.md) | cada negocio con su `iapp`: filtro obligatorio, ficha publica, purga de demos |
| Catalogo de productos y servicios | [catalogo.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/catalogo.md) | categorias, items, disponibilidad de servicios, importador idempotente |
| Pagos (simulado, Wompi, Stripe, Mercado Pago) | [pagos.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/pagos.md) | transferencia con comprobante, tarjeta, efectivo acordado; webhooks firmados |
| Embeddings | [embeddings.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md) | caché por huella, búsqueda, reducción, reglas de purga en JSON |
| Gestión de archivos | [archivos.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/archivos.md) | carpetas, archivos, almacén del consumidor, relación libre `origin` + `idorigin` |
| Errores | [errores.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/errores.md) | reportar errores desde una app o **atenderlos como agente** (toma, bitácora, cierre, reglas) |
| Penalizaciones | [penalizaciones.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/penalizaciones.md) | frenar fuerza bruta con vectores por IP y global |
| Tiquetes (tks) | [tks.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/tks.md) | tabular tiquetes kanban con asignaciones y reglas de cierre |
| Tiquetes de negocio (entidad abstracta) | [tiquetes.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/tiquetes.md) | pedidos, entregas, reservas y solicitudes con catálogo de tipos y campos por empresa, bot (desde-chat/estado-chat) y discriminación TIQUETE vs ERROR |
| Mensajes | [mensajes.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/mensajes.md) | comentar cualquier entidad con un hilo de mensajes anidados |
| Calificaciones | [calificaciones.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/calificaciones.md) | calificar cualquier entidad de -10 a 10 |
| Reacciones | [reacciones.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/reacciones.md) | reaccionar con emojis a cualquier entidad |
| Notificaciones | [notificaciones.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/notificaciones.md) | campana con contador: avisos a un usuario o a todos, bandeja y marcar leídas |
| WhatsApp (Cloud API) | [whatsapp.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/whatsapp.md) | gateway de WhatsApp con varios números: número → app, entrantes idempotentes por wamid, ventana de 24 h, estados e historial |
| CRM (empresas, contactos y chat) | [crm.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/crm.md) | multi-tenant: login empresa+usuario+contraseña, usuarios↔empresas con rol, contactos por empresa y el chat (hilos, participantes, adjuntos, bot) |
| Atención omnicanal (WhatsApp/Telegram) | [atencion.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/atencion.md) | canales del negocio, clientes, chats con código, todos los tipos de mensaje, modo auto/entrenamiento con borradores y calificación del cliente final |
| Reportes (observaciones y auditoría) | [reportes.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/reportes.md) | marcar error sobre CUALQUIER entidad (`origin`+`idorigin`) y atenderlo como auditor/agente: toma, bitácora, cierre; por empresa y ámbito |
| Canal de bots | [canal.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/canal.md) | publicar, listar, editar y reaccionar mensajes de bots sobre D1/R2 |
| Voz (notas de voz) | [voz.md](https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/voz.md) | la voz de cada app como parte de su configuracion, y la sintesis de notas de voz |
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
| `03-plugins/permisos/` | permisos.md |
| `03-plugins/embeddings/` | embeddings.md |
| `03-plugins/archivos/` | archivos.md |
| `03-plugins/errores/` | errores.md |
| `03-plugins/penalizaciones/` | penalizaciones.md |
| `03-plugins/tks/` | tks.md |
| `03-plugins/tiquetes/` | tiquetes.md |
| `03-plugins/mensajes/` | mensajes.md |
| `03-plugins/calificaciones/` | calificaciones.md |
| `03-plugins/reacciones/` | reacciones.md |
| `03-plugins/notificaciones/` | notificaciones.md |
| `03-plugins/whatsapp/` | whatsapp.md |
| `03-plugins/crm/` | crm.md |
| `03-plugins/atencion/` | atencion.md |
| `03-plugins/voz/` | voz.md |
| `03-plugins/reportes/` | reportes.md |
| `03-plugins/canal/` | canal.md |

## Tres reglas que siempre aplican

- Una sola definición (schema JSON + entidad) para client y server; los pojos se instancian de forma indirecta (`controller.pojo(...)`, `registry.pojo(plural, ...)`).
- Un `pre*` que retorna texto es un error 400; falsy es OK.
- El registro global (`registry`) tiene las entidades por plural, las puertas de seguridad (`extract`, `protected`, `permissions`) y la sesión singleton; sin `extract` no hay seguridad.
