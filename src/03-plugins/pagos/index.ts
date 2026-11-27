/**
 * Plugin de pagos: el JSON TRANSVERSAL de los intentos de pago de una APP (aislados por `iapp`). Tres metodos:
 * `transferencia` (instrucciones con la cuenta de la app, el cliente sube el comprobante y un admin lo verifica),
 * `tarjeta` (la resuelve un proveedor: simulado, wompi, stripe o mercadopago) y `efectivo` (se acuerda por el canal
 * configurado, whatsapp por defecto). Todo cambio de estado avisa al consumidor con `alCambiarEstado`.
 *
 *   pagos_intentos  (ipago, iapp, itiquete, monto, moneda, metodo, banco, proveedor, estado, referencia, url_pago, comprobante, jdatos, fhcre, fhact)
 *   pagos_eventos   (id, iapp, ipago, clase, estadoAnterior, estado, datos, fhcre)
 *
 * `referencia` es el token publico del intento: con el, el cliente consulta su pago y sube su comprobante. El webhook de
 * cada proveedor es publico, pero solo con la firma valida de su llave.
 *
 * ```ts
 * const pg = createClient(pagosPlugin, { baseUrl: "/api", headers: auth.headers });
 * const intento = await pg.crearIntento({ metodo: "transferencia", monto: 25000, banco: "nequi" });
 * await pg.subirComprobante({ referencia: intento.referencia, comprobante: "arch_1" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/pagos.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type ComprobanteInput, type DetalleIntento, type IntentoInput, type IntentoPago, type PaginaPagos, type RespuestaWebhook, type SimularInput, type VerificarInput, ZComprobanteInput, ZIntentoInput, ZSimularInput, ZVerificarInput } from "@Jeff-Aporta/DER/src/03-plugins/pagos/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/pagos/schemas.ts";

/** Quita las claves vacias (una query `?x=undefined` romperia el filtro) y vuelve texto el resto. */
function limpio(q: Record<string, string | number | undefined> | undefined): Record<string, string> | undefined {
  if (!q) return undefined;
  const e = Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return e.length ? Object.fromEntries(e.map(([k, v]) => [k, String(v)])) : undefined;
}

/** JSON transversal de pagos: los intentos de una app, su historial y las rutas del flujo de pago. */
export const pagosPlugin: PluginDef = {
  name: "pagos",
  entities: {
    intentos: {
      name: "pagos.intento",
      singular: "pagos_intento",
      plural: "pagos_intentos",
      table: "pagos_intentos",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          ipago: { type: "string", pk: true, length: 40 },
          iapp: { type: "string", length: 40, nullable: false },
          itiquete: { type: "string", length: 40, nullable: true },
          monto: { type: "int", nullable: false },
          moneda: { type: "string", length: 8, nullable: false, default: "COP" },
          metodo: { type: "string", enum: ["transferencia", "tarjeta", "efectivo"], nullable: false },
          banco: { type: "string", enum: ["nequi", "breb", "bancolombia", "daviplata", "otro"], nullable: true },
          proveedor: { type: "string", enum: ["simulado", "wompi", "stripe", "mercadopago", "manual"], nullable: false },
          estado: { type: "string", enum: ["creado", "pendiente", "en_verificacion", "aprobado", "rechazado", "anulado"], nullable: false, default: "creado" },
          referencia: { type: "string", length: 64, nullable: false, unique: true },
          url_pago: { type: "string", length: 500, nullable: true },
          comprobante: { type: "string", length: 200, nullable: true },
          jdatos: { type: "json", nullable: true },
          fhcre: { type: "datetime", nullable: false },
          fhact: { type: "datetime", nullable: true },
        },
      },
      listColumns: ["ipago", "iapp", "itiquete", "monto", "moneda", "metodo", "banco", "proveedor", "estado", "referencia", "fhcre"],
    },
    eventos: {
      name: "pagos.evento",
      singular: "pagos_evento",
      plural: "pagos_eventos",
      table: "pagos_eventos",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iapp: { type: "string", length: 40, nullable: false },
          ipago: { type: "string", length: 40, nullable: false },
          clase: { type: "string", length: 40, nullable: false },
          estadoAnterior: { type: "string", length: 40, nullable: true },
          estado: { type: "string", length: 40, nullable: true },
          datos: { type: "json", nullable: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["id", "iapp", "ipago", "clase", "estado", "fhcre"],
    },
  },
  irregularPaths: {
    crearIntento: {
      method: "POST",
      path: "pagos/intento",
      security: "protected",
      zod: ZIntentoInput,
      returns: "json",
      ops: {
        /** `POST pagos/intento`: crea el intento de pago de la app (la app sale de la cabecera `x-app` o de la sesion). */
        crearIntento(this: ClientPlugin, input: IntentoInput): Promise<IntentoPago> {
          return this.call<IntentoPago>("crearIntento", input);
        },
      },
    },
    consultaIntento: {
      method: "GET",
      path: "pagos/intento/{referencia}",
      security: "public",
      returns: "json",
      ops: {
        /** `GET pagos/intento/{referencia}`: el pago del cliente con su token (estado, instrucciones e historial). */
        consultaIntento(this: ClientPlugin, referencia: string): Promise<DetalleIntento> {
          return this.call<DetalleIntento>("consultaIntento", undefined, { referencia });
        },
      },
    },
    subirComprobante: {
      method: "POST",
      path: "pagos/comprobante",
      security: "public",
      zod: ZComprobanteInput,
      returns: "json",
      ops: {
        /** `POST pagos/comprobante`: el cliente sube el comprobante de su transferencia (pasa a `en_verificacion`). */
        subirComprobante(this: ClientPlugin, input: ComprobanteInput): Promise<IntentoPago> {
          return this.call<IntentoPago>("subirComprobante", input);
        },
      },
    },
    verificarPago: {
      method: "POST",
      path: "pagos/verificar",
      security: { protected: true, permissions: true, action: "pagos.verificar" },
      zod: ZVerificarInput,
      returns: "json",
      ops: {
        /** `POST pagos/verificar`: un admin (permiso `pagos.verificar`) aprueba o rechaza el comprobante recibido. */
        verificarPago(this: ClientPlugin, input: VerificarInput): Promise<IntentoPago> {
          return this.call<IntentoPago>("verificarPago", input);
        },
      },
    },
    webhookPago: {
      method: "POST",
      path: "pagos/webhook/{proveedor}",
      security: "public",
      returns: "json",
      ops: {
        /** `POST pagos/webhook/{proveedor}`: el aviso del proveedor (solo con la firma valida de su llave). */
        webhookPago(this: ClientPlugin, proveedor: string, cuerpo: unknown): Promise<RespuestaWebhook> {
          return this.call<RespuestaWebhook>("webhookPago", cuerpo, { proveedor });
        },
      },
    },
    listarPagos: {
      method: "GET",
      path: "pagos",
      security: { protected: true, permissions: true, action: "pagos.ver" },
      returns: "json",
      ops: {
        /** `GET pagos?estado=&metodo=&proveedor=&itiquete=&page=&pageSize=`: la pagina de pagos de la app. */
        listarPagos(this: ClientPlugin, filtros?: Record<string, string | number | undefined>): Promise<PaginaPagos> {
          return this.call<PaginaPagos>("listarPagos", limpio(filtros));
        },
      },
    },
    simularPago: {
      method: "POST",
      path: "pagos/simular/{ipago}",
      security: "protected",
      zod: ZSimularInput,
      returns: "json",
      ops: {
        /** `POST pagos/simular/{ipago}`: endpoint de pruebas: fuerza el resultado del proveedor simulado. */
        simularPago(this: ClientPlugin, ipago: string, input: SimularInput): Promise<IntentoPago> {
          return this.call<IntentoPago>("simularPago", input, { ipago });
        },
      },
    },
  },
};
