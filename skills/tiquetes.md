# Skill: tiquetes (entidad abstracta)

[← temario](README.md) · referencia: `docs/050-Plugins/170-Tiquetes.md`

## Que es

La entidad ABSTRACTA del sistema: un TIQUETE sirve para pedidos, entregas, reservas y solicitudes segun el **tipo de
empresa**. Un restaurante trabaja pedidos con direccion y platos; un hotel, reservas con habitacion y fechas; sin tocar
codigo: el catalogo de tipos y de campos es JSON por empresa.

No confundir con [tks](tks.md): `tks` es el tablero kanban interno de trabajo; `tiquetes` es la entidad de negocio
(lo que el cliente pide o espera) con su ciclo de vida, su historial y su integracion con el bot.

## Montar

```ts
const tq = crearTiquetes({ db, cfg: { tipos: [{ iempresa: "hotel", tipo: "reserva", nombre: "Reserva", campos: [{ clave: "habitacion", etiqueta: "Habitacion", tipo: "texto", requerido: true }] }] }, services: { contexto } });
const router = createRouter(ctrls, { basePath: "/api", plugins: [tq] });
await router.seed();
```

Cliente:

```ts
const tq = createClient(tiquetesPlugin, { baseUrl: "/api", headers: auth.headers });
const pedido = await tq.crearTiquete({ tipo: "pedido", titulo: "Domicilio 310", datos: { direccion: "Calle 1", platos: ["Bandeja"] } });
await tq.adoptarTiquete(pedido.id);          // el WRKR toma el tiquete
await tq.cambiarEstado(pedido.id, { estado: "en_proceso" });
const detalle = await tq.detalleTiquete(pedido.id);
```

## Tablas

| tabla | columnas |
|---|---|
| `tiquetes_tiquetes` | `id`, `iempresa`, `tipo`, `estado`, `titulo`, `descripcion`, `datos` (json), `fcha`, `fchaFin`, `prioridad`, `iusuarioCreador`, `iusuarioAsignado` (WRKR), `ichat`, `iexterno`, `fhcre`, `fhact`, `bactivo` |
| `tiquetes_tipos` | `iempresa` + `tipo` (pk), `nombre`, `descripcion`, `estados` (json), `cierran` (json), `campos` (json), `bactivo`, `fhcre`, `fhact` |
| `tiquetes_eventos` | `id`, `iempresa`, `itiquete`, `clase`, `estadoAnterior`, `estado`, `iusuario`, `texto`, `datos`, `fhcre` |

## El contrato de tipos por empresa

Un tipo se declara con `PUT tiquetes/catalogo/{tipo}` (o en `cfg.tipos`) y queda en `tiquetes_tipos`:

```json
{
  "nombre": "Reserva de habitacion",
  "descripcion": "Una reserva con fechas",
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

- `tipo`: texto en minusculas (se normaliza: `Mi Tipo` = `mi_tipo`); los de fabrica son `pedido`, `entrega`, `reserva`,
  `solicitud` y `otro`, y cualquier empresa puede declarar los suyos.
- `campos`: lo que va en `datos`. Tipos: `texto`, `numero`, `booleano`, `fecha`, `fechaHora`, `lista`, `json`;
  `requerido` y `opciones` se validan en el alta y en el cambio.
- `estados`: subconjunto de `nuevo | asignado | en_proceso | esperando | listo | entregado | cerrado | cancelado`.
- `cierran`: los estados que se consideran cierre (por defecto los de fabrica que esten en `estados`).

## Rutas

| Ruta | Que hace |
|---|---|
| `GET tiquetes?estado=&tipo=&prioridad=&asignado=mi|usuario&sinAsignar=&desde=&hasta=&q=&page=&pageSize=` | pagina filtrada de la empresa |
| `POST tiquetes` | crea (defaults del servidor: estado `nuevo`, prioridad `media`, fecha ahora, autor = sesion) |
| `GET tiquetes/{id}` | el tiquete y su historial (`{ tiquete, eventos }`) |
| `PUT tiquetes/{id}` | cambia titulo, descripcion, datos, fechas, prioridad o responsable |
| `DELETE tiquetes/{id}` | baja logica (archiva; la fila y el historial se conservan) |
| `POST tiquetes/{id}/asignar` | le pone responsable (WRKR) y lo pasa a `asignado` si estaba `nuevo` |
| `POST tiquetes/{id}/adoptar` | el WRKR de la sesion lo toma (409 si ya lo tiene otro) |
| `POST tiquetes/{id}/estado` | mueve por la maquina de estados (400 si el salto no existe) |
| `POST tiquetes/{id}/comentar` | agrega un comentario al historial |
| `GET tiquetes/catalogo` | los tipos de la empresa con estados y campos |
| `PUT tiquetes/catalogo/{tipo}` | define o cambia un tipo (sin codigo) |
| `POST tiquetes/desde-chat` | el BOT crea un tiquete desde una conversacion (`ichat`; idempotente por `iexterno`) |
| `GET tiquetes/chat?ichat=` | los tiquetes de esa conversacion |
| `POST tiquetes/estado-chat` | el BOT consulta/actualiza el estado (el tiquete debe ser de ese `ichat`) |
| `POST tiquetes/clasificar` | decide TIQUETE vs ERROR del sistema y crea lo que toque |

## Maquina de estados

`nuevo → asignado | en_proceso | esperando | cancelado`; `asignado → en_proceso | esperando | cancelado`;
`en_proceso → esperando | listo | cancelado`; `esperando → en_proceso | listo | cancelado`;
`listo → entregado | cerrado | en_proceso`; `entregado → cerrado`; `cerrado` y `cancelado` son terminales.
El tipo puede restringir los estados (su catalogo), no la maquina.

## Discriminacion de reportes (TIQUETE vs ERROR del sistema)

`POST tiquetes/clasificar` usa la funcion pura `clasificarReporte` (sin modelo y sin azar). El criterio, en orden:

1. Telemetria con HTTP >= 500 o una traza: **ERROR** del sistema.
2. Fallo tecnico sobre un sujeto del sistema (app, web, formulario, login, bot, pantalla): **ERROR**.
3. Fallo sobre un sujeto del negocio (pedido, entrega, reserva, plato, producto): **TIQUETE** (lo resuelve un humano).
4. Peticion de negocio o de atencion (`quiero`, `necesito`, reservar, comprar, cotizar): **TIQUETE**.
5. Sin senales concluyentes: **TIQUETE** por defecto.

Si el destino es `error` y el plugin `errores` esta instalado en la misma base, el reporte entra a esa cola (misma tabla
`errores`, `estado: pendiente`). `crear: false` clasifica sin crear nada (para que el bot decida).

## Reglas

- Todo esta aislado por `iempresa`: un tiquete de otra empresa es 404 (nunca se distingue).
- `services.contexto` resuelve `{ iusuario, iempresa }`; sin el, la sesion + la cabecera `X-Empresa`.
- El tipo NO cambia en el `PUT` (define la forma de `datos`); el estado va por su propia ruta.
- Todo deja evento: alta, asignacion, adopcion, estado, comentario, cambios y baja.
- `services.alEvento(evento, tiquete)` permite avisar (campana, websocket, bot) sin acoplar el plugin.

## Errores comunes

- Un tipo desconocido en la empresa da 400: declara el tipo en el catalogo antes de usarlo.
- Un campo requerido de `datos` sin valor da 400; el error dice la clave y la etiqueta.
- Un salto de estado invalido da 400: mira la maquina de estados.
- Adoptar dos veces con el mismo usuario es idempotente; con otro, 409.
