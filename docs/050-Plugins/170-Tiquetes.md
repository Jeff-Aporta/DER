---
Titulo: "Tiquetes: la entidad abstracta (pedidos, entregas, reservas y solicitudes)"
Estado: vigente
Autor:
tags: [plugins, tiquetes, pedidos, reservas, bot, errores]
---
# Tiquetes (entidad abstracta)

Un **tiquete** es la entidad generica del sistema: lo mismo sirve para un **pedido** de un restaurante, una **entrega**
de una tienda, una **reserva** de un hotel o una **solicitud** de atencion. Lo que cambia entre empresas es el **tipo**:
su catalogo (que tipos existen y que campos propios lleva `datos`) es JSON por empresa, asi que no hay que tocar codigo
para que un restaurante trabaje pedidos y un hotel, reservas.

No reemplaza a [tks](070-Tks.md): `tks` es el tablero kanban interno de trabajo; `tiquetes` es la entidad de negocio,
con su ciclo de vida, su historial, su integracion con el bot y la discriminacion frente a la cola de errores.

## Entidades

| Tabla | Columnas |
|---|---|
| `tiquetes_tiquetes` | `id`, `iempresa`, `tipo`, `estado`, `titulo`, `descripcion`, `datos` (json), `fcha`, `fchaFin`, `prioridad`, `iusuarioCreador`, `iusuarioAsignado`, `ichat`, `iexterno`, `fhcre`, `fhact`, `bactivo` |
| `tiquetes_tipos` | `iempresa` + `tipo` (pk), `nombre`, `descripcion`, `estados` (json), `cierran` (json), `campos` (json), `bactivo`, `fhcre`, `fhact` |
| `tiquetes_eventos` | `id`, `iempresa`, `itiquete`, `clase`, `estadoAnterior`, `estado`, `iusuario`, `texto`, `datos`, `fhcre` |

- `estado`: `nuevo | asignado | en_proceso | esperando | listo | entregado | cerrado | cancelado`.
- `prioridad`: `baja | media | alta | urgente` (la de defecto la fija `cfg.prioridadPorDefecto`).
- `datos`: los campos propios del tipo (restaurante: `direccion` + `platos`; hotel: `habitacion` + fechas). Se validan
  contra el catalogo (requeridos, tipos y opciones).
- `eventos`: el historial. Cada alta, asignacion, adopcion, cambio de estado, comentario, cambio de datos y baja deja
  una fila; `clase` dice que fue (y `comentario` es un evento mas).
- Todo esta aislado por `iempresa`: un tiquete de otra empresa responde 404 (nunca se distingue).

## Catalogo declarativo por empresa

Los tipos de fabrica son `pedido`, `entrega`, `reserva`, `solicitud` y `otro`; cualquier empresa puede declarar los
suyos con `PUT tiquetes/catalogo/{tipo}` o en `cfg.tipos` al montar el plugin. El contrato de un tipo:

```json
{
  "nombre": "Reserva de habitacion",
  "descripcion": "Una reserva con fechas de entrada y salida",
  "estados": ["nuevo", "asignado", "en_proceso", "listo", "entregado", "cerrado", "cancelado"],
  "cierran": ["entregado", "cerrado", "cancelado"],
  "campos": [
    { "clave": "habitacion", "etiqueta": "Habitacion", "tipo": "texto", "requerido": true },
    { "clave": "personas", "etiqueta": "Personas", "tipo": "numero", "requerido": true },
    { "clave": "fechaInicio", "etiqueta": "Entrada", "tipo": "fechaHora", "requerido": true },
    { "clave": "fechaFin", "etiqueta": "Salida", "tipo": "fechaHora" }
  ]
}
```

- `tipo` es texto y se normaliza a minusculas con `_` (`Mi Tipo` = `mi_tipo`).
- Tipos de campo: `texto`, `numero`, `booleano`, `fecha`, `fechaHora`, `lista` y `json`; `requerido` y `opciones` se
  validan en el alta y en el cambio.
- `estados` restringe los estados del tipo (subconjunto de los ocho); `cierran` marca los que cierran (por defecto los de
  fabrica que esten en `estados`).
- Un tipo nuevo se documenta solo: `GET tiquetes/catalogo` ya lo entrega con sus campos y estados.

## Rutas

| Ruta | Seguridad | Que hace |
|---|---|---|
| `GET tiquetes?estado=&tipo=&prioridad=&asignado=mi\|usuario&sinAsignar=&desde=&hasta=&q=&page=&pageSize=` | sesion | pagina filtrada de la empresa (`{ tiquetes, total, page, pageSize }`) |
| `POST tiquetes` | sesion | crea con los defaults del servidor |
| `GET tiquetes/{id}` | sesion | el tiquete y su historial (`{ tiquete, eventos }`) |
| `PUT tiquetes/{id}` | sesion | cambia datos editables (el estado va por su ruta) |
| `DELETE tiquetes/{id}` | sesion | baja logica (archiva) |
| `POST tiquetes/{id}/asignar` | sesion | responsable (WRKR); `nuevo` pasa a `asignado` |
| `POST tiquetes/{id}/adoptar` | sesion | el WRKR de la sesion toma el tiquete |
| `POST tiquetes/{id}/estado` | sesion | cambio de estado validado por la maquina de estados |
| `POST tiquetes/{id}/comentar` | sesion | comentario al historial |
| `GET tiquetes/catalogo` | sesion | tipos de la empresa con estados y campos |
| `PUT tiquetes/catalogo/{tipo}` | sesion | define o cambia un tipo (sin codigo) |
| `POST tiquetes/desde-chat` | sesion | el BOT crea desde una conversacion (idempotente por `iexterno`) |
| `GET tiquetes/chat?ichat=` | sesion | tiquetes de esa conversacion |
| `POST tiquetes/estado-chat` | sesion | el BOT cambia el estado de un tiquete de su conversacion |
| `POST tiquetes/clasificar` | sesion | decide TIQUETE vs ERROR del sistema y crea lo que toque |

## Maquina de estados

`nuevo → asignado | en_proceso | esperando | cancelado`; `asignado → en_proceso | esperando | cancelado`;
`en_proceso → esperando | listo | cancelado`; `esperando → en_proceso | listo | cancelado`;
`listo → entregado | cerrado | en_proceso`; `entregado → cerrado`; `cerrado` y `cancelado` son terminales. El catalogo
del tipo puede restringir los estados disponibles; la maquina es la misma para todos.

## Integracion con el bot

- `POST tiquetes/desde-chat` crea el tiquete desde una conversacion (`ichat`). El bot administra las fechas: manda `fcha`
  y `fchaFin`; si no, el servidor pone `fcha` = ahora. `iexterno` (el id del mensaje o del evento del canal) hace la
  operacion idempotente: el mismo alta dos veces devuelve el mismo tiquete.
- `GET tiquetes/chat?ichat=` le dice al bot que tiquetes tiene abiertos esa conversacion.
- `POST tiquetes/estado-chat` cambia el estado solo si el tiquete pertenece a ese `ichat` (si no, 404).
- `services.alEvento(evento, tiquete)` permite avisar al bot (o a la campana o al websocket) de cada cambio.

## Discriminacion de reportes: TIQUETE vs ERROR del sistema

`POST tiquetes/clasificar` corre la funcion pura y determinista `clasificarReporte` (sin modelo, sin azar, sin red). El
criterio, en orden, es el primero que se cumple:

1. La telemetria trae `codigoHttp >= 500` o una `traza`: **ERROR** del sistema.
2. El texto tiene un fallo tecnico y un sujeto del sistema (app, aplicacion, pagina, web, sistema, formulario, login,
   bot, pantalla, carrito, pasarela...): **ERROR** del sistema.
3. El texto tiene un fallo sobre un sujeto del negocio (pedido, entrega, reserva, habitacion, mesa, plato, producto,
   factura, domicilio...): **TIQUETE**, lo resuelve un humano.
4. El texto pide algo del negocio o atencion (quiero, necesito, reservar, comprar, cotizar, consultar...): **TIQUETE**.
5. Sin senales concluyentes: **TIQUETE** por defecto (un humano lo revisa; si es del sistema, lo escala).

El veredicto devuelve `destino`, `motivo`, `senales` (los terminos que lo decidieron) y `reglas` (el criterio completo,
para que el bot lo pueda explicar). Con `crear` (por defecto true) el plugin crea:

- **TIQUETE**: un tiquete del tipo pedido (`solicitud` si no se indica) con el texto en `descripcion`.
- **ERROR**: una fila `pendiente` en la cola del plugin `errores` si esta instalado en la misma base (misma tabla
  `errores`, con `contexto.origen = "tiquetes"`). Si `errores` no esta instalado, `ierror` queda en `null` (el veredicto
  sigue siendo `error` y el bot decide).

`crear: false` clasifica sin crear nada.

## Montar

```ts
const tiquetes = crearTiquetes({ db, cfg: { prioridadPorDefecto: "media" }, services: { contexto, alEvento } });
const router = createRouter(ctrls, { basePath: "/api", plugins: [tiquetes] });
await router.seed();
```

Cliente:

```ts
const tq = createClient(tiquetesPlugin, { baseUrl: "/api", headers: auth.headers });
const t = await tq.crearTiquete({ tipo: "pedido", titulo: "Domicilio 310", datos: { direccion: "Calle 1", platos: ["Bandeja"] } });
await tq.asignarTiquete(t.id, { iusuarioAsignado: "beto" });
await tq.cambiarEstado(t.id, { estado: "en_proceso", comentario: "En cocina" });
```

## Pruebas

`tests/plugins/tiquetes.test.ts` (caja negra sobre el router real): alta con defaults y catalogo, adoptar/asignar con
sus 409, maquina de estados, aislamiento por empresa (lista, detalle, adopcion y catalogo), catalogo declarativo por
empresa (restaurante vs hotel), bot (desde-chat, chat y estado-chat), discriminacion TIQUETE vs ERROR contra la cola de
`errores`, comentarios, cambios y baja logica.
