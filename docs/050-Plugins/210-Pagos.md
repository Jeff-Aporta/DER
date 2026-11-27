---
Titulo: "Pagos: intentos de pago por app (transferencia, tarjeta y efectivo)"
Estado: vigente
Autor:
tags: [plugins, pagos, iapp, transferencia, tarjeta, efectivo, proveedores, webhook]
---
# Pagos

Los **intentos de pago** de una app: cuanto se debe, como se paga y en que estado queda. Todo esta **aislado por `iapp`**
(la instancia de negocio: `riogo24`, un hotel, una tienda): una app nunca ve los pagos de otra.

Tres metodos:

| Metodo | Como funciona | Quien lo resuelve |
|---|---|---|
| `transferencia` | el cliente recibe las instrucciones (los datos de la cuenta de la app) y sube el comprobante; el pago pasa a `en_verificacion` | un admin con el permiso `pagos.verificar` |
| `tarjeta` | el pago lo resuelve un proveedor (por defecto `wompi`): el cliente paga en el `url_pago` | el proveedor (su webhook) |
| `efectivo` | el pago queda `pendiente` con el texto de acordarlo por el canal configurado (`whatsapp` por defecto) | el comercio, por ese canal |

## Entidades

| Tabla | Columnas |
|---|---|
| `pagos_intentos` | `ipago` (pk), `iapp`, `itiquete`, `monto`, `moneda`, `metodo`, `banco`, `proveedor`, `estado`, `referencia` (unica), `url_pago`, `comprobante`, `jdatos` (json), `fhcre`, `fhact` |
| `pagos_eventos` | `id`, `iapp`, `ipago`, `clase`, `estadoAnterior`, `estado`, `datos` (json), `fhcre` |

- `ipago` es el id interno del intento (`pg_...`); `referencia` es su **token publico**: lo que lleva el cliente para
  consultar su pago y subir su comprobante (no se adivina).
- `metodo`: `transferencia | tarjeta | efectivo`. `banco`: `nequi | breb | bancolombia | daviplata | otro`.
- `proveedor`: `simulado | wompi | stripe | mercadopago | manual` (`manual` es el interno de la transferencia y del
  efectivo: no hay pasarela, hay una cuenta y un comprobante).
- `estado`: `creado | pendiente | en_verificacion | aprobado | rechazado | anulado`.
- `comprobante` es el id del archivo subido (el del plugin de archivos).
- `jdatos` guarda lo del metodo: las instrucciones, los datos de la cuenta, el canal y la descripcion.
- `pagos_eventos` es el historial: alta, comprobante, cambio de estado, webhook y verificacion.

## Rutas

| Ruta | Seguridad | Que hace |
|---|---|---|
| `POST pagos/intento` | sesion | crea el intento (la app sale de la cabecera `x-app` o de la sesion) |
| `GET pagos/intento/{referencia}` | publica (el token) | el pago del cliente con sus instrucciones y su historial |
| `POST pagos/comprobante` | publica (el token) | el cliente sube el comprobante: el pago pasa a `en_verificacion` |
| `POST pagos/verificar` | permiso `pagos.verificar` | un admin aprueba o rechaza el comprobante recibido |
| `POST pagos/webhook/{proveedor}` | publica (solo con firma valida) | el aviso del proveedor: mueve el pago |
| `GET pagos?estado=&metodo=&proveedor=&itiquete=&page=&pageSize=` | permiso `pagos.ver` | la pagina de pagos de la app |
| `POST pagos/simular/{ipago}` | sesion | endpoint de pruebas: fuerza el resultado (el del proveedor simulado) |

`POST pagos/intento` acepta `{ metodo, monto, moneda?, banco?, itiquete?, proveedor?, descripcion? }` y devuelve el intento
con su `referencia`.

## Maquina de estados

`creado → pendiente | en_verificacion | aprobado | rechazado | anulado`; `pendiente → en_verificacion | aprobado |
rechazado | anulado`; `en_verificacion → aprobado | rechazado | pendiente | anulado`; `aprobado → anulado`; `rechazado →
pendiente | anulado`; `anulado` es terminal.

El cambio de estado valida la transicion, deja el evento en `pagos_eventos` y avisa al consumidor con
`services.alCambiarEstado(intento, anterior)` (para notificar por WhatsApp y mover el tiquete del CRM). En el alta el
anterior es `null`.

## Proveedores (adaptadores)

El contrato es `ProveedorPago`:

```ts
type ProveedorPago = {
  nombre: "simulado" | "wompi" | "stripe" | "mercadopago" | "manual";
  habilitado: boolean;
  crearIntento(intento: IntentoPago): Promise<{ referencia: string; url_pago?: string; instrucciones?: string }>;
  verificar(referencia: string): Promise<EstadoPago>;
  webhook(request: Request): Promise<{ referencia: string; estado: EstadoPago } | null>;
};
```

- **Sin llave en la configuracion el adaptador queda DESHABILITADO y lo dice**: el intento no se crea ("El proveedor
  «wompi» no esta habilitado: falta la llave en la configuracion") y el webhook se rechaza con el mismo motivo.
- `simulado` (siempre activo): aprueba o rechaza segun la regla de `cfg.proveedores.simulado.regla`
  (`aprueba`, `rechaza`, `monto` con `montoMaximo`, o `pendiente`); su webhook se firma con HMAC-SHA256 en la cabecera
  `x-simulado-firma`.
- `wompi`, `stripe` y `mercadopago` siguen el esquema real de cada uno: el `url_pago` es el checkout del proveedor y el
  webhook llega con su firma.

### Firmas de los webhooks

| Proveedor | Como firma | Como se verifica |
|---|---|---|
| Wompi | `signature.checksum` del evento | `SHA256(timestamp + llave)` |
| Stripe | cabecera `stripe-signature: t=<ts>,v1=<firma>` | `HMAC-SHA256(<llave>, "<ts>.<cuerpo>")` (tolerancia de 5 minutos) |
| MercadoPago | cabeceras `x-signature: ts=<ts>,v1=<firma>` y `x-request-id` | `HMAC-SHA256(<llave>, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;")` con la parte alfanumerica de la llave en minusculas |

La comparacion es en tiempo constante. Sin firma valida la ruta responde 401 y el pago no se mueve.

## Configuracion

```ts
const pg = crearPagos({
  db,
  cfg: {
    moneda: "COP",
    cuentas: { riogo24: { banco: "nequi", numero: "3001234567", tipo: "ahorro", titular: "Rio Go 24" } },
    cuentaPorDefecto: { banco: "bancolombia", numero: "1234567890" },
    canalEfectivo: "whatsapp",
    proveedorTarjeta: "wompi",
    proveedores: {
      simulado: { regla: "pendiente" },
      wompi: { llave: "env:WOMPI_LLAVE", publica: "env:WOMPI_PUBLICA" },
      stripe: { llave: "env:STRIPE_LLAVE" },
      mercadopago: { llave: "env:MP_LLAVE" },
    },
  },
  services: { alCambiarEstado: (intento, anterior) => { ... } },
});
```

- `cuentas` es **por app**: las instrucciones de una transferencia se arman con los datos de esa app (si no hay cuenta
  para la app, se usa `cuentaPorDefecto`; si no hay ninguna, el intento da 400).
- `canalEfectivo` es el canal por el que se acuerda el pago en efectivo (`whatsapp` por defecto); el texto del pago es
  `se acuerda por WhatsApp`.
- Las llaves admiten `"env:NOMBRE"`.

## Montar

```ts
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

## Pruebas

`tests/plugins/pagos.test.ts` (caja negra sobre el router real): los tres metodos (transferencia con instrucciones,
comprobante y verificacion; efectivo con su texto de WhatsApp; tarjeta con el proveedor simulado que aprueba y que
rechaza), el proveedor sin llave (deshabilitado y lo dice), la firma del webhook de los tres proveedores (valida mueve el
pago, invalida responde 401), el aislamiento por app (lista, detalle, comprobante y verificacion) y el hook de cambio de
estado.
