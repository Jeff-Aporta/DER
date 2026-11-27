/**
 * Pruebas de caja negra del plugin de pagos sobre el router real: los tres metodos (transferencia, efectivo y tarjeta), el
 * proveedor simulado (aprueba y rechaza segun la regla), la firma del webhook de los tres proveedores (valida e invalida),
 * el aislamiento por app y el hook de cambio de estado.
 */
import { assert, assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { pagosServer } from "@Jeff-Aporta/DER/src/03-plugins/pagos/server.ts";
import type { DetalleIntento, EstadoPago, IntentoPago, PaginaPagos, RespuestaWebhook } from "@Jeff-Aporta/DER/src/03-plugins/pagos/schemas.ts";
import { call } from "@Jeff-Aporta/DER/tests/_util.ts";

/** Configuracion de la prueba: la cuenta que recibe las transferencias y las llaves de los tres proveedores. */
const CFG = {
  cuentas: { riogo24: { banco: "nequi", numero: "3001234567", tipo: "ahorro", titular: "Rio Go 24" } },
  proveedores: {
    simulado: { regla: "pendiente" },
    wompi: { llave: "wompi-secreto-de-pruebas", publica: "pub_wompi_pruebas" },
    stripe: { llave: "sk_test_1234567890" },
    mercadopago: { llave: "TEST-111111111-aabbccddeeff00112233" },
  },
};

/** La llave de MercadoPago: la parte alfanumerica en minusculas (la que firma el webhook). */
const SECRETO_MP = "TEST-111111111-aabbccddeeff00112233".split("-").slice(1).join("-").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Sesion sin JWT: `x-usuario` dice quien es y `x-app` en que app actua. */
function sesionDe(req: Request): { id: string; claims: Record<string, unknown> } | null {
  const usuario = req.headers.get("x-usuario");
  if (!usuario) return null;
  return { id: usuario, claims: { iapp: req.headers.get("x-app") ?? "" } };
}

/** La cabecera de una peticion: quien es y en que app. */
const como = (usuario: string, iapp: string) => ({ "x-usuario": usuario, "x-app": iapp });

/** HMAC-SHA256 en hexadecimal (las firmas de Stripe y de MercadoPago). */
async function hmacHex(secreto: string, texto: string): Promise<string> {
  const enc = new TextEncoder();
  const clave = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", clave, enc.encode(texto)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 en hexadecimal (el checksum de Wompi). */
async function sha256Hex(texto: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** API de pagos sobre SQLite en memoria, con la puerta de permisos del consumidor (`carla` no verifica) y el hook de estado. */
async function montar(cfg: Record<string, unknown> = CFG) {
  registry.secure(null);
  const db = sqliteDatabase();
  const cambios: { ipago: string; anterior: EstadoPago | null; estado: EstadoPago }[] = [];
  const acciones: string[] = [];
  const pagos = createServer(pagosServer, {
    db,
    cfg,
    services: {
      alCambiarEstado: (intento: IntentoPago, anterior: EstadoPago | null) => {
        cambios.push({ ipago: intento.ipago, anterior, estado: intento.estado });
      },
    },
  });
  const router = createRouter([], { basePath: "/api", plugins: [pagos] });
  registry.secure({
    extract: sesionDe,
    permissions: (info, action) => {
      acciones.push(`${info?.id ?? "-"}:${action}`);
      if (info?.id === "carla") return { allowed: false, value: false, reason: `Sin permiso: ${action}` };
      return { allowed: true, value: true };
    },
  });
  await router.seed();
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  return { router, cerrar, cambios, acciones };
}

/** Crea un intento de pago y falla el test si la respuesta no es 200. */
async function crear(router: Awaited<ReturnType<typeof montar>>["router"], cuerpo: Record<string, unknown>, iapp = "riogo24"): Promise<IntentoPago> {
  const r = await call(router, "POST", "pagos/intento", { body: cuerpo, headers: como("ana", iapp) });
  assertEquals(r.status, 200, JSON.stringify(r.data));
  return r.data as IntentoPago;
}

Deno.test("pagos: transferencia con las instrucciones de la cuenta, el comprobante y la verificacion del admin", async () => {
  const { router, cerrar, cambios, acciones } = await montar();
  const intento = await crear(router, { metodo: "transferencia", monto: 25000, banco: "nequi", itiquete: "tk_1" });
  assertEquals(intento.estado, "pendiente");
  assertEquals(intento.banco, "nequi");
  assertEquals(intento.proveedor, "manual");
  assertEquals(intento.moneda, "COP");
  assertEquals(intento.itiquete, "tk_1");
  assert(intento.referencia, "el intento tiene su token publico");
  const datos = intento.jdatos as { instrucciones?: string; cuenta?: { numero?: string } };
  assert((datos.instrucciones ?? "").includes("3001234567"), "las instrucciones traen la cuenta de la app");
  assertEquals(datos.cuenta?.numero, "3001234567");
  // el cliente sube el comprobante con su token (ruta publica)
  const comp = await call(router, "POST", "pagos/comprobante", { body: { referencia: intento.referencia, comprobante: "arch_1" } });
  assertEquals(comp.status, 200, JSON.stringify(comp.data));
  assertEquals((comp.data as IntentoPago).estado, "en_verificacion");
  assertEquals((comp.data as IntentoPago).comprobante, "arch_1");
  // el admin verifica (permiso pagos.verificar)
  const verifica = await call(router, "POST", "pagos/verificar", { body: { ipago: intento.ipago, estado: "aprobado" }, headers: como("beto", "riogo24") });
  assertEquals(verifica.status, 200, JSON.stringify(verifica.data));
  assertEquals((verifica.data as IntentoPago).estado, "aprobado");
  // quien no tiene el permiso no puede verificar
  const sinPermiso = await call(router, "POST", "pagos/verificar", { body: { ipago: intento.ipago, estado: "rechazado" }, headers: como("carla", "riogo24") });
  assertEquals(sinPermiso.status, 403, JSON.stringify(sinPermiso.data));
  assertEquals(acciones.includes("beto:pagos.verificar"), true, "la ruta pide el permiso pagos.verificar");
  // el hook se llamo en cada cambio de estado
  assertEquals(cambios.map((c) => c.estado), ["pendiente", "en_verificacion", "aprobado"]);
  assertEquals(cambios[0]?.anterior, null);
  await cerrar();
});

Deno.test("pagos: efectivo queda pendiente con el texto del canal configurado (WhatsApp por defecto)", async () => {
  const { router, cerrar } = await montar();
  const intento = await crear(router, { metodo: "efectivo", monto: 8000 });
  assertEquals(intento.estado, "pendiente");
  assertEquals(intento.proveedor, "manual");
  const datos = intento.jdatos as { instrucciones?: string; canal?: string };
  assertEquals(datos.instrucciones, "se acuerda por WhatsApp");
  assertEquals(datos.canal, "whatsapp");
  await cerrar();
  const otro = await montar({ ...CFG, canalEfectivo: "telegram" });
  const porTelegram = await crear(otro.router, { metodo: "efectivo", monto: 8000 });
  const datos2 = porTelegram.jdatos as { instrucciones?: string; canal?: string };
  assertEquals(datos2.instrucciones, "se acuerda por Telegram");
  assertEquals(datos2.canal, "telegram");
  await otro.cerrar();
});

Deno.test("pagos: tarjeta con el proveedor simulado (aprueba, rechaza y el endpoint de pruebas)", async () => {
  const aprueba = await montar({ ...CFG, proveedores: { ...CFG.proveedores, simulado: { regla: "aprueba" } } });
  const intento = await crear(aprueba.router, { metodo: "tarjeta", monto: 42000, proveedor: "simulado" });
  assertEquals(intento.proveedor, "simulado");
  assertEquals(intento.estado, "aprobado", "la regla del simulado aprueba al crear");
  assert(intento.url_pago, "el proveedor deja la url de pago");
  await aprueba.cerrar();
  const rechaza = await montar({ ...CFG, proveedores: { ...CFG.proveedores, simulado: { regla: "rechaza" } } });
  const no = await crear(rechaza.router, { metodo: "tarjeta", monto: 42000, proveedor: "simulado" });
  assertEquals(no.estado, "rechazado", "la regla del simulado rechaza al crear");
  await rechaza.cerrar();
  // el endpoint de pruebas fuerza el resultado
  const prueba = await montar();
  const pendiente = await crear(prueba.router, { metodo: "tarjeta", monto: 42000, proveedor: "simulado" });
  assertEquals(pendiente.estado, "pendiente");
  const forzado = await call(prueba.router, "POST", `pagos/simular/${pendiente.ipago}`, { body: { resultado: "aprobado" }, headers: como("beto", "riogo24") });
  assertEquals(forzado.status, 200, JSON.stringify(forzado.data));
  assertEquals((forzado.data as IntentoPago).estado, "aprobado");
  await prueba.cerrar();
});

Deno.test("pagos: un proveedor sin llave en la configuracion queda deshabilitado y lo dice", async () => {
  const { router, cerrar } = await montar({ ...CFG, proveedores: { ...CFG.proveedores, wompi: {} } });
  const r = await call(router, "POST", "pagos/intento", { body: { metodo: "tarjeta", monto: 1000 }, headers: como("ana", "riogo24") });
  assertEquals(r.status, 400, JSON.stringify(r.data));
  const error = (r.data as { error?: string }).error ?? "";
  assert(error.includes("wompi") && error.includes("habilitado"), `el error dice que esta deshabilitado: ${error}`);
  const webhook = await call(router, "POST", "pagos/webhook/wompi", { body: { data: {} } });
  assertEquals(webhook.status, 400, JSON.stringify(webhook.data));
  await cerrar();
});

Deno.test("pagos: la firma del webhook (wompi, stripe y mercadopago): la valida mueve el pago y la invalida no", async () => {
  const { router, cerrar } = await montar();
  const ts = String(Math.floor(Date.now() / 1000));
  // stripe: `t=<ts>,v1=<HMAC-SHA256>` de `<ts>.<cuerpo>`
  const stripe = await crear(router, { metodo: "transferencia", monto: 15000 });
  const cuerpoStripe = { id: "evt_1", type: "checkout.session.completed", data: { object: { client_reference_id: stripe.referencia, payment_status: "paid" } } };
  const firmaStripe = await hmacHex("sk_test_1234567890", `${ts}.${JSON.stringify(cuerpoStripe)}`);
  const okStripe = await call(router, "POST", "pagos/webhook/stripe", { body: cuerpoStripe, headers: { "stripe-signature": `t=${ts},v1=${firmaStripe}` } });
  assertEquals(okStripe.status, 200, JSON.stringify(okStripe.data));
  assertEquals((okStripe.data as RespuestaWebhook).estado, "aprobado");
  const trasStripe = await call(router, "GET", `pagos/intento/${stripe.referencia}`);
  assertEquals((trasStripe.data as DetalleIntento).intento.estado, "aprobado");
  const malaStripe = await call(router, "POST", "pagos/webhook/stripe", { body: cuerpoStripe, headers: { "stripe-signature": `t=${ts},v1=${"0".repeat(64)}` } });
  assertEquals(malaStripe.status, 401, "una firma invalida no se acepta");
  // wompi: el checksum es SHA256 del timestamp con el secreto de integridad
  const wompi = await crear(router, { metodo: "transferencia", monto: 15000 });
  const cuerpoWompi = { data: { event: "transaction.status.updated", data: { transaction: { id: "tx_1", status: "APPROVED", reference: wompi.referencia } } }, signature: { timestamp: ts, checksum: await sha256Hex(ts + "wompi-secreto-de-pruebas") } };
  const okWompi = await call(router, "POST", "pagos/webhook/wompi", { body: cuerpoWompi });
  assertEquals(okWompi.status, 200, JSON.stringify(okWompi.data));
  assertEquals((okWompi.data as RespuestaWebhook).estado, "aprobado");
  const malaWompi = await call(router, "POST", "pagos/webhook/wompi", { body: { ...cuerpoWompi, signature: { timestamp: ts, checksum: await sha256Hex(ts + "otro-secreto") } } });
  assertEquals(malaWompi.status, 401, "un checksum invalido no se acepta");
  // mercadopago: `x-signature` firma el manifiesto `id;request-id;ts`
  const mp = await crear(router, { metodo: "transferencia", monto: 15000 });
  const cuerpoMp = { id: 123456, type: "payment", data: { id: "mp_1", status: "approved", external_reference: mp.referencia } };
  const manifiesto = `id:mp_1;request-id:req-1;ts:${ts};`;
  const okMp = await call(router, "POST", "pagos/webhook/mercadopago", { body: cuerpoMp, headers: { "x-signature": `ts=${ts},v1=${await hmacHex(SECRETO_MP, manifiesto)}`, "x-request-id": "req-1" } });
  assertEquals(okMp.status, 200, JSON.stringify(okMp.data));
  assertEquals((okMp.data as RespuestaWebhook).estado, "aprobado");
  const malaMp = await call(router, "POST", "pagos/webhook/mercadopago", { body: cuerpoMp, headers: { "x-signature": `ts=${ts},v1=${"a".repeat(64)}`, "x-request-id": "req-1" } });
  assertEquals(malaMp.status, 401, "una firma invalida no se acepta");
  // un proveedor que no existe
  const otro = await call(router, "POST", "pagos/webhook/otro", { body: {} });
  assertEquals(otro.status, 404);
  await cerrar();
});

Deno.test("pagos: aislamiento por app (la lista, el detalle y el comprobante)", async () => {
  const { router, cerrar } = await montar();
  const intento = await crear(router, { metodo: "efectivo", monto: 5000 });
  const lista = await call(router, "GET", "pagos", { headers: como("ana", "riogo24") });
  assertEquals((lista.data as PaginaPagos).total, 1);
  const listaAjena = await call(router, "GET", "pagos", { headers: como("ana", "otra") });
  assertEquals((listaAjena.data as PaginaPagos).total, 0, "otra app no ve los pagos de riogo24");
  const detalleAjeno = await call(router, "GET", `pagos/intento/${intento.referencia}`, { headers: como("ana", "otra") });
  assertEquals(detalleAjeno.status, 404, "el pago de otra app no existe");
  const detalle = await call(router, "GET", `pagos/intento/${intento.referencia}`);
  assertEquals(detalle.status, 200, JSON.stringify(detalle.data));
  assertEquals((detalle.data as DetalleIntento).intento.estado, "pendiente");
  assertEquals((detalle.data as DetalleIntento).eventos.length, 1);
  const comprobanteAjeno = await call(router, "POST", "pagos/comprobante", { body: { referencia: intento.referencia, comprobante: "arch_9" }, headers: como("ana", "otra") });
  assertEquals(comprobanteAjeno.status, 404, "otra app no puede subir el comprobante");
  const verificarAjeno = await call(router, "POST", "pagos/verificar", { body: { ipago: intento.ipago, estado: "aprobado" }, headers: como("beto", "otra") });
  assertEquals(verificarAjeno.status, 404, "otra app no puede verificar el pago");
  await cerrar();
});

Deno.test("pagos: la lista pide el permiso pagos.ver y el pago necesita la app", async () => {
  const { router, cerrar, acciones } = await montar();
  const sinApp = await call(router, "GET", "pagos", { headers: como("ana", "") });
  assertEquals(sinApp.status, 400, "sin app no hay lista");
  const denegada = await call(router, "GET", "pagos", { headers: como("carla", "riogo24") });
  assertEquals(denegada.status, 403, JSON.stringify(denegada.data));
  assertEquals(acciones.includes("carla:pagos.ver"), true, "la ruta pide el permiso pagos.ver");
  const permitida = await call(router, "GET", "pagos?estado=pendiente", { headers: como("ana", "riogo24") });
  assertEquals(permitida.status, 200, JSON.stringify(permitida.data));
  assertEquals((permitida.data as PaginaPagos).total, 0);
  await cerrar();
});
