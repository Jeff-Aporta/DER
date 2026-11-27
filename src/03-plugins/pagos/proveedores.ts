/**
 * Adaptadores de proveedor de pagos: el contrato `ProveedorPago` y los cuatro adaptadores (simulado, wompi, stripe y
 * mercadopago). Cada adapter verifica la FIRMA de su webhook; sin llave en la configuracion el adaptador queda
 * DESHABILITADO y lo dice (el plugin no lo usa y la ruta del webhook lo rechaza).
 *
 * - `simulado`: aprueba o rechaza segun la regla configurada (`aprueba`, `rechaza`, `monto` o `pendiente`) y su webhook
 *   se firma con HMAC-SHA256 en la cabecera `x-simulado-firma`.
 * - `wompi`: el checksum del webhook es SHA256 del timestamp con el secreto de integridad; el evento trae la referencia
 *   que el comercio mando en la transaccion.
 * - `stripe`: la cabecera `stripe-signature` trae `t=<ts>,v1=<HMAC-SHA256>` de `<ts>.<cuerpo>`.
 * - `mercadopago`: la cabecera `x-signature` trae `ts=<ts>,v1=<HMAC-SHA256>` del manifiesto
 *   `id:<id>;request-id:<x-request-id>;ts:<ts>;` y el secreto es la parte alfanumerica de la llave en minusculas.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/pagos.md
 */
import { HttpError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ConfigProveedor, EstadoPago, IntentoPago, ProveedorPago, ResultadoCrearIntento, ResultadoWebhook } from "@Jeff-Aporta/DER/src/03-plugins/pagos/schemas.ts";

const enc = new TextEncoder();

/** Bytes en hexadecimal en minusculas. */
function aHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256 en hexadecimal (las firmas de Stripe y de MercadoPago). */
export async function hmacHex(secreto: string, texto: string): Promise<string> {
  const clave = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return aHex(new Uint8Array(await crypto.subtle.sign("HMAC", clave, enc.encode(texto))));
}

/** SHA-256 en hexadecimal (el checksum de Wompi). */
export async function sha256Hex(texto: string): Promise<string> {
  return aHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(texto))));
}

/** Compara dos firmas en tiempo constante (no filtra por tiempos). */
export function mismaFirma(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Un objeto JSON de un valor cualquiera (vacio si no es un objeto). */
export function objetoDe(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Texto de un valor JSON (vacio si no es texto). */
export function textoDe(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Parsea un cuerpo JSON (vacio si no es JSON). */
function parsea(cuerpo: string): Record<string, unknown> {
  try {
    return objetoDe(JSON.parse(cuerpo));
  } catch {
    return {};
  }
}

/** Las partes de una cabecera de firma (`t=1,v1=abc`): cada clave con sus valores. */
function partesDe(cabecera: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const parte of cabecera.split(",")) {
    const trozos = parte.split("=");
    const clave = trozos[0]?.trim() ?? "";
    const valor = trozos.slice(1).join("=").trim();
    if (!clave || !valor) continue;
    out[clave] = [...(out[clave] ?? []), valor];
  }
  return out;
}

/** La descripcion del intento (lo que el consumidor puso al crearlo). */
function descripcionDe(intento: IntentoPago): string {
  const datos = objetoDe(intento.jdatos);
  return textoDe(datos["descripcion"]) || `Pago ${intento.referencia}`;
}

/** El estado de un pago que devuelve un proveedor (`""` si no se puede mapear). */
function estadoDe(texto: string): EstadoPago | null {
  const t = texto.trim().toLowerCase();
  if (t === "aprobado" || t === "approved" || t === "pagado" || t === "paid") return "aprobado";
  if (t === "rechazado" || t === "rejected" || t === "declined" || t === "failed" || t === "cancelled" || t === "canceled") return "rechazado";
  if (t === "pendiente" || t === "pending" || t === "in_process" || t === "procesando") return "pendiente";
  return null;
}

/** Adaptador de pruebas: aprueba o rechaza segun la regla configurada y deja forzar el resultado. */
export function adaptadorSimulado(cfg: ConfigProveedor): ProveedorPago {
  const secreto = cfg.llave ?? "simulado";
  const regla = cfg.regla ?? "pendiente";
  const tope = cfg.montoMaximo ?? 0;
  const memoria = new Map<string, { monto: number; estado: EstadoPago }>();
  return {
    nombre: "simulado",
    habilitado: true,
    async crearIntento(intento: IntentoPago): Promise<ResultadoCrearIntento> {
      memoria.set(intento.referencia, { monto: intento.monto, estado: "pendiente" });
      return { referencia: intento.referencia, url_pago: `https://simulado.local/pago/${intento.referencia}`, instrucciones: `Paga ${intento.monto} ${intento.moneda} en el enlace de prueba` };
    },
    async verificar(referencia: string): Promise<EstadoPago> {
      const e = memoria.get(referencia);
      if (!e) return "pendiente";
      if (regla === "aprueba") return "aprobado";
      if (regla === "rechaza") return "rechazado";
      if (regla === "monto") return e.monto <= tope ? "aprobado" : "rechazado";
      return e.estado;
    },
    async webhook(request: Request): Promise<ResultadoWebhook | null> {
      const cuerpo = await request.text();
      const firma = request.headers.get("x-simulado-firma") ?? "";
      if (!mismaFirma(await hmacHex(secreto, cuerpo), firma)) return null;
      const datos = parsea(cuerpo);
      const referencia = textoDe(datos["referencia"]);
      const estado = estadoDe(textoDe(datos["estado"]));
      if (!referencia || !estado) return null;
      const previo = memoria.get(referencia);
      memoria.set(referencia, { monto: previo?.monto ?? 0, estado });
      return { referencia, estado };
    },
    simular(referencia: string, estado: EstadoPago): boolean {
      const previo = memoria.get(referencia);
      memoria.set(referencia, { monto: previo?.monto ?? 0, estado });
      return true;
    },
  };
}

/** Adaptador de Wompi (Colombia): el checksum del evento es SHA256 del timestamp con el secreto de integridad. */
export function adaptadorWompi(cfg: ConfigProveedor): ProveedorPago {
  const secreto = cfg.llave ?? "";
  const publica = cfg.publica ?? "";
  const url = cfg.url ?? "https://api.wompi.co/v1/transactions";
  return {
    nombre: "wompi",
    habilitado: secreto !== "",
    async crearIntento(intento: IntentoPago): Promise<ResultadoCrearIntento> {
      const cuerpo = { amount: intento.monto, currency: intento.moneda, reference: intento.referencia, description: descripcionDe(intento), public_key: publica };
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secreto}` }, body: JSON.stringify(cuerpo) });
      if (!r.ok) throw new HttpError(502, `Wompi respondio ${r.status}: no se pudo crear la transaccion`);
      const datos = objetoDe(await r.json());
      const id = textoDe(objetoDe(datos["data"])["id"]);
      return { referencia: intento.referencia, url_pago: `https://checkout.wompi.co/l/${id || intento.referencia}` };
    },
    async verificar(referencia: string): Promise<EstadoPago> {
      try {
        const r = await fetch(`${url}/${encodeURIComponent(referencia)}`, { headers: { authorization: `Bearer ${secreto}` } });
        if (!r.ok) return "pendiente";
        const datos = objetoDe(await r.json());
        const data = objetoDe(datos["data"]);
        const transaccion = objetoDe(data["transaction"]);
        return estadoDe(textoDe(transaccion["status"]) || textoDe(data["status"])) ?? "pendiente";
      } catch {
        return "pendiente";
      }
    },
    async webhook(request: Request): Promise<ResultadoWebhook | null> {
      const cuerpo = await request.text();
      const datos = parsea(cuerpo);
      const firma = objetoDe(datos["signature"]);
      const timestamp = textoDe(firma["timestamp"]) || (request.headers.get("x-wompi-timestamp") ?? "");
      const checksum = textoDe(firma["checksum"]) || (request.headers.get("x-wompi-checksum") ?? "");
      if (!timestamp || !checksum) return null;
      if (!mismaFirma(await sha256Hex(timestamp + secreto), checksum)) return null;
      const evento = objetoDe(datos["data"]);
      const transaccion = objetoDe(objetoDe(evento["data"])["transaction"]);
      const referencia = textoDe(transaccion["reference"]);
      const estado = estadoDe(textoDe(transaccion["status"]));
      if (!referencia || !estado) return null;
      return { referencia, estado };
    },
  };
}

/** Adaptador de Stripe: la firma viaja en `stripe-signature` (`t=<ts>,v1=<HMAC-SHA256>` de `<ts>.<cuerpo>`). */
export function adaptadorStripe(cfg: ConfigProveedor): ProveedorPago {
  const secreto = cfg.llave ?? "";
  const url = cfg.url ?? "https://api.stripe.com/v1/checkout/sessions";
  return {
    nombre: "stripe",
    habilitado: secreto !== "",
    async crearIntento(intento: IntentoPago): Promise<ResultadoCrearIntento> {
      const cuerpo = new URLSearchParams({
        mode: "payment",
        client_reference_id: intento.referencia,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": intento.moneda.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(intento.monto),
        "line_items[0][price_data][product_data][name]": descripcionDe(intento),
      });
      const r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secreto}`, "content-type": "application/x-www-form-urlencoded" }, body: cuerpo });
      if (!r.ok) throw new HttpError(502, `Stripe respondio ${r.status}: no se pudo crear la sesion de pago`);
      const datos = objetoDe(await r.json());
      return { referencia: intento.referencia, url_pago: textoDe(datos["url"]) || undefined };
    },
    async verificar(referencia: string): Promise<EstadoPago> {
      try {
        const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(referencia)}`, { headers: { authorization: `Bearer ${secreto}` } });
        if (!r.ok) return "pendiente";
        const datos = objetoDe(await r.json());
        return estadoDe(textoDe(datos["payment_status"])) ?? "pendiente";
      } catch {
        return "pendiente";
      }
    },
    async webhook(request: Request): Promise<ResultadoWebhook | null> {
      const cuerpo = await request.text();
      const partes = partesDe(request.headers.get("stripe-signature") ?? "");
      const timestamp = partes["t"]?.[0] ?? "";
      const firmas = partes["v1"] ?? [];
      if (!timestamp || !firmas.length) return null;
      const laSegundos = Number(timestamp);
      if (!Number.isFinite(laSegundos) || Math.abs(Math.floor(Date.now() / 1000) - laSegundos) > 300) return null;
      const esperado = await hmacHex(secreto, `${timestamp}.${cuerpo}`);
      if (!firmas.some((f) => mismaFirma(esperado, f))) return null;
      const evento = parsea(cuerpo);
      const objeto = objetoDe(objetoDe(evento["data"])["object"]);
      const referencia = textoDe(objeto["client_reference_id"]) || textoDe(objetoDe(objeto["metadata"])["referencia"]);
      const estado = estadoDe(textoDe(objeto["payment_status"]));
      if (!referencia || !estado) return null;
      return { referencia, estado };
    },
  };
}

/** Adaptador de MercadoPago: la firma viaja en `x-signature` (`ts=<ts>,v1=<HMAC-SHA256>` del manifiesto). */
export function adaptadorMercadopago(cfg: ConfigProveedor): ProveedorPago {
  const llave = cfg.llave ?? "";
  const url = cfg.url ?? "https://api.mercadopago.com/checkout/preferences";
  const secreto = secretoMercadopago(llave);
  return {
    nombre: "mercadopago",
    habilitado: secreto !== "",
    async crearIntento(intento: IntentoPago): Promise<ResultadoCrearIntento> {
      const cuerpo = { items: [{ title: descripcionDe(intento), quantity: 1, unit_price: intento.monto, currency_id: intento.moneda }], external_reference: intento.referencia, back_urls: { success: "", failure: "", pending: "" } };
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${llave}`, "x-idempotency-key": intento.referencia }, body: JSON.stringify(cuerpo) });
      if (!r.ok) throw new HttpError(502, `MercadoPago respondio ${r.status}: no se pudo crear la preferencia de pago`);
      const datos = objetoDe(await r.json());
      return { referencia: intento.referencia, url_pago: textoDe(datos["init_point"]) || textoDe(datos["sandbox_init_point"]) || undefined };
    },
    async verificar(referencia: string): Promise<EstadoPago> {
      try {
        const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(referencia)}`, { headers: { authorization: `Bearer ${llave}` } });
        if (!r.ok) return "pendiente";
        const datos = objetoDe(await r.json());
        return estadoDe(textoDe(datos["status"])) ?? "pendiente";
      } catch {
        return "pendiente";
      }
    },
    async webhook(request: Request): Promise<ResultadoWebhook | null> {
      const cuerpo = await request.text();
      const partes = partesDe(request.headers.get("x-signature") ?? "");
      const timestamp = partes["ts"]?.[0] ?? "";
      const firmas = partes["v1"] ?? [];
      if (!timestamp || !firmas.length) return null;
      const datos = parsea(cuerpo);
      const data = objetoDe(datos["data"]);
      const id = textoDe(data["id"]);
      const requestId = request.headers.get("x-request-id") ?? "";
      const manifiesto = `id:${id};request-id:${requestId};ts:${timestamp};`;
      const esperado = await hmacHex(secreto, manifiesto);
      if (!firmas.some((f) => mismaFirma(esperado, f))) return null;
      const referencia = textoDe(data["external_reference"]);
      const estado = estadoDe(textoDe(data["status"]));
      if (!referencia || !estado) return null;
      return { referencia, estado };
    },
  };
}

/** El secreto de la firma de MercadoPago: la parte alfanumerica de la llave, en minusculas. */
export function secretoMercadopago(llave: string): string {
  const guion = llave.indexOf("-");
  const parte = guion >= 0 ? llave.slice(guion + 1) : llave;
  return parte.toLowerCase().replace(/[^a-z0-9]/g, "");
}
