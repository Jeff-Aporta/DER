# Skill: pagos (intentos por app)

[← temario](README.md) · referencia: `docs/050-Plugins/200-Pagos.md`

## Que es

Los **intentos de pago** de una APP (aislados por `iapp`: `riogo24`, un hotel, una tienda). Tres metodos:
`transferencia` (instrucciones con la cuenta de la app + comprobante + verificacion de un admin), `tarjeta` (la resuelve
un proveedor) y `efectivo` (se acuerda por el canal configurado, whatsapp por defecto).

Cada cambio de estado avisa al consumidor: `services.alCambiarEstado(intento, anterior)` (para notificar y mover el
tiquete del CRM).

## Montar

```ts
const pg = crearPagos({ db, cfg: { cuentas: { riogo24: { banco: "nequi", numero: "3001234567" } } }, services: { alCambiarEstado } });
const router = createRouter(ctrls, { basePath: "/api", plugins: [pg] });
await router.seed();
```

Cliente:

```ts
const pg = createClient(pagosPlugin, { baseUrl: "/api", headers: auth.headers });
const intento = await pg.crearIntento({ metodo: "transferencia", monto: 25000, banco: "nequi" });
await pg.subirComprobante({ referencia: intento.referencia, comprobante: "arch_1" });
const mio = await pg.consultaIntento(intento.referencia);
```

## Tablas

| tabla | columnas |
|---|---|
| `pagos_intentos` | `ipago` (pk), `iapp`, `itiquete`, `monto`, `moneda`, `metodo`, `banco`, `proveedor`, `estado`, `referencia` (unica), `url_pago`, `comprobante`, `jdatos` (json), `fhcre`, `fhact` |
| `pagos_eventos` | `id`, `iapp`, `ipago`, `clase`, `estadoAnterior`, `estado`, `datos` (json), `fhcre` |

- `ipago`: id interno (`pg_...`). `referencia`: token publico (el que lleva el cliente).
- `metodo`: `transferencia | tarjeta | efectivo`. `banco`: `nequi | breb | bancolombia | daviplata | otro`.
- `proveedor`: `simulado | wompi | stripe | mercadopago | manual`. `estado`: `creado | pendiente | en_verificacion |
  aprobado | rechazado | anulado`.

## Rutas

| Ruta | Que hace |
|---|---|
| `POST pagos/intento` | crea el intento (la app sale de la cabecera `x-app` o de la sesion) |
| `GET pagos/intento/{referencia}` | el pago del cliente con sus instrucciones y su historial (publica: el token) |
| `POST pagos/comprobante` | el cliente sube el comprobante: pasa a `en_verificacion` (publica: el token) |
| `POST pagos/verificar` | un admin (permiso `pagos.verificar`) aprueba o rechaza |
| `POST pagos/webhook/{proveedor}` | el aviso del proveedor (publica, solo con firma valida) |
| `GET pagos?estado=&metodo=&proveedor=&itiquete=&page=&pageSize=` | la pagina de pagos de la app (permiso `pagos.ver`) |
| `POST pagos/simular/{ipago}` | endpoint de pruebas: fuerza el resultado |

## Maquina de estados

`creado → pendiente | en_verificacion | aprobado | rechazado | anulado`; `pendiente → en_verificacion | aprobado |
rechazado | anulado`; `en_verificacion → aprobado | rechazado | pendiente | anulado`; `aprobado → anulado`; `rechazado →
pendiente | anulado`; `anulado` es terminal.

## Proveedores

El contrato es `ProveedorPago` (`nombre`, `habilitado`, `crearIntento`, `verificar`, `webhook`). **Sin llave en `cfg` el
adaptador queda deshabilitado y lo dice** (el intento no se crea y el webhook se rechaza).

| proveedor | regla (simulado) | firma de su webhook |
|---|---|---|
| `simulado` | `aprueba`, `rechaza`, `monto` (con `montoMaximo`) o `pendiente` | `x-simulado-firma`: HMAC-SHA256 del cuerpo |
| `wompi` | - | `signature.checksum` = `SHA256(timestamp + llave)` |
| `stripe` | - | `stripe-signature`: `v1` = HMAC-SHA256 de `<ts>.<cuerpo>` |
| `mercadopago` | - | `x-signature`: `v1` = HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` |

La llave de MercadoPago se reduce a su parte alfanumerica en minusculas. Las comparaciones son en tiempo constante.

## Reglas

- Todo esta aislado por `iapp`: un pago de otra app es 404 (nunca se distingue).
- La app sale de la cabecera `x-app` o de la claim `iapp` de la sesion; sin app, la lista da 400.
- La transferencia necesita la cuenta de la app en `cfg.cuentas` (o `cfg.cuentaPorDefecto`): si no hay, 400.
- El efectivo queda `pendiente` con el texto `se acuerda por WhatsApp` (o por el canal de `cfg.canalEfectivo`).
- Cada cambio de estado deja evento y llama a `services.alCambiarEstado(intento, anterior)`.

## Errores comunes

- Un proveedor sin llave da 400 al crear el intento y 400 en su webhook: falta configurarla.
- Un comprobante sobre un pago que no esta `pendiente` da 409; sobre un pago que no es transferencia, 400.
- Verificar un pago que no esta `en_verificacion` da 409.
- Un webhook sin firma valida da 401 y el pago no se mueve.
