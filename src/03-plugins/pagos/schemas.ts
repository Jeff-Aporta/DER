/**
 * Tipos y Zod del plugin de pagos: los intentos de pago de una APP (aislados por `iapp`), su historial y el contrato de
 * los adaptadores de proveedor. Metodos: `transferencia` (instrucciones con la cuenta de la app + comprobante + verificacion
 * de un admin), `tarjeta` (la resuelve un proveedor: simulado, wompi, stripe o mercadopago) y `efectivo` (se acuerda por el
 * canal configurado, whatsapp por defecto).
 *
 *   pagos_intentos  (ipago, iapp, itiquete, monto, moneda, metodo, banco, proveedor, estado, referencia, url_pago, comprobante, jdatos, fhcre, fhact)
 *   pagos_eventos   (id, iapp, ipago, clase, estadoAnterior, estado, datos, fhcre)
 *
 * `referencia` es el token publico del intento (el que lleva el cliente); `ipago` es su id interno. Un adaptador sin llave
 * en la configuracion queda DESHABILITADO y lo dice.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/pagos.md
 */
import { z } from "zod";

/** Metodos de pago que admite un intento. */
export const METODOS_PAGO = ["transferencia", "tarjeta", "efectivo"] as const;

/** Bancos y billeteras que el cliente puede marcar en una transferencia. */
export const BANCOS_PAGO = ["nequi", "breb", "bancolombia", "daviplata", "otro"] as const;

/** Proveedores de pago (adaptadores). `manual` es el interno de la transferencia y del efectivo. */
export const PROVEEDORES_PAGO = ["simulado", "wompi", "stripe", "mercadopago", "manual"] as const;

/** Estados de un intento de pago. */
export const ESTADOS_PAGO = ["creado", "pendiente", "en_verificacion", "aprobado", "rechazado", "anulado"] as const;

/** Los dos resultados de una verificacion (la de un admin o la de un webhook). */
export const ESTADOS_VERIFICACION = ["aprobado", "rechazado"] as const;

/** Reglas del proveedor simulado: que decide al crear el intento. */
export const REGLAS_SIMULADO = ["pendiente", "aprueba", "rechaza", "monto"] as const;

/** Transiciones permitidas del estado de un pago (la misma para todos los metodos). */
export const TRANSICIONES_PAGO: Record<string, readonly string[]> = {
  creado: ["pendiente", "en_verificacion", "aprobado", "rechazado", "anulado"],
  pendiente: ["en_verificacion", "aprobado", "rechazado", "anulado"],
  en_verificacion: ["aprobado", "rechazado", "pendiente", "anulado"],
  aprobado: ["anulado"],
  rechazado: ["pendiente", "anulado"],
  anulado: [],
};

/** Metodo de pago. */
export type MetodoPago = (typeof METODOS_PAGO)[number];

/** Banco o billetera de una transferencia. */
export type BancoPago = (typeof BANCOS_PAGO)[number];

/** Nombre de un proveedor de pagos (adaptador). */
export type NombreProveedor = (typeof PROVEEDORES_PAGO)[number];

/** Estado de un intento de pago. */
export type EstadoPago = (typeof ESTADOS_PAGO)[number];

/** Resultado de una verificacion: aprobado o rechazado. */
export type EstadoVerificacion = (typeof ESTADOS_VERIFICACION)[number];

/** Regla del proveedor simulado. */
export type ReglaSimulado = (typeof REGLAS_SIMULADO)[number];

/** Un intento de pago (fila de `pagos_intentos`): `ipago` es su id y `referencia` su token publico. */
export type IntentoPago = { ipago: string; iapp: string; itiquete: string | null; monto: number; moneda: string; metodo: MetodoPago; banco: BancoPago | null; proveedor: NombreProveedor; estado: EstadoPago; referencia: string; url_pago: string | null; comprobante: string | null; jdatos: unknown; fhcre: string; fhact: string | null };

/** Un evento del historial de un pago. */
export type EventoPago = { id: string; iapp: string; ipago: string; clase: string; estadoAnterior: EstadoPago | null; estado: EstadoPago | null; datos: unknown; fhcre: string };

/** Lo que ve el cliente con su token: el intento sin los datos internos y las instrucciones del metodo. */
export type VistaIntento = { ipago: string; iapp: string; itiquete: string | null; monto: number; moneda: string; metodo: MetodoPago; banco: BancoPago | null; proveedor: NombreProveedor; estado: EstadoPago; referencia: string; url_pago: string | null; comprobante: string | null; instrucciones: string | null; fhcre: string; fhact: string | null };

/** Un evento del historial visto por el cliente (sin los datos internos). */
export type EventoVista = { id: string; clase: string; estadoAnterior: EstadoPago | null; estado: EstadoPago | null; fhcre: string };

/** Detalle de un pago: el intento y su historial (en orden de llegada). */
export type DetalleIntento = { intento: VistaIntento; eventos: EventoVista[] };

/** Lo que devuelve `crearIntento` de un adaptador. */
export type ResultadoCrearIntento = { referencia: string; url_pago?: string | undefined; instrucciones?: string | undefined };

/** Lo que devuelve `webhook` de un adaptador (null = la peticion no venia firmada por el proveedor). */
export type ResultadoWebhook = { referencia: string; estado: EstadoPago };

/** El adaptador de un proveedor: crea el intento, consulta el estado y lee su webhook (con firma verificada). */
export type ProveedorPago = { nombre: NombreProveedor; habilitado: boolean; crearIntento(intento: IntentoPago): Promise<ResultadoCrearIntento>; verificar(referencia: string): Promise<EstadoPago>; webhook(request: Request): Promise<ResultadoWebhook | null>; simular?(referencia: string, estado: EstadoPago): boolean };

/** Los datos de la cuenta que recibe las transferencias (se configuran por app). */
export type CuentaPago = { banco?: string | undefined; numero?: string | undefined; tipo?: string | undefined; titular?: string | undefined; instrucciones?: string | undefined };

/** Configuracion de un proveedor: su llave (sin llave no hay firma y el adaptador queda deshabilitado) y su URL. */
export type ConfigProveedor = { llave?: string | undefined; publica?: string | undefined; url?: string | undefined; regla?: ReglaSimulado | undefined; montoMaximo?: number | undefined };

/** Configuracion del plugin: moneda, cuentas por app, canal del efectivo y proveedores. */
export type PagosConfig = { moneda?: string | undefined; cuentas?: Record<string, CuentaPago> | undefined; cuentaPorDefecto?: CuentaPago | undefined; canalEfectivo?: string | undefined; proveedores?: Partial<Record<NombreProveedor, ConfigProveedor>> | undefined; proveedorTarjeta?: NombreProveedor | undefined };

/** Servicios del consumidor: `alCambiarEstado` avisa cada cambio (para notificar y mover el tiquete). */
export type PagosServicios = { alCambiarEstado?: ((intento: IntentoPago, anterior: EstadoPago | null) => Promise<void> | void) | undefined };

/** Alta de un intento de pago. `iapp` no viaja en el cuerpo: sale de la cabecera `x-app` o de la sesion. */
export type IntentoInput = { itiquete?: string | null | undefined; monto: number; moneda?: string | undefined; metodo: MetodoPago; banco?: BancoPago | null | undefined; proveedor?: NombreProveedor | undefined; descripcion?: string | undefined };

/** Subida del comprobante de una transferencia (`comprobante` es el id del archivo). */
export type ComprobanteInput = { referencia: string; comprobante: string };

/** Verificacion de un admin: aprueba o rechaza el pago que esta en verificacion. */
export type VerificarInput = { ipago?: string | undefined; referencia?: string | undefined; estado: EstadoVerificacion; nota?: string | null | undefined };

/** Forzado del resultado en el proveedor simulado (endpoint de pruebas). */
export type SimularInput = { resultado: EstadoVerificacion };

/** Filtros de la lista de pagos de una app. */
export type FiltrosPagos = { estado?: EstadoPago | undefined; metodo?: MetodoPago | undefined; proveedor?: NombreProveedor | undefined; itiquete?: string | undefined; desde?: string | undefined; hasta?: string | undefined; page?: number | undefined; pageSize?: number | undefined };

/** Pagina de pagos (el total es de lo que cumple los filtros, no de la pagina). */
export type PaginaPagos = { pagos: IntentoPago[]; total: number; page: number; pageSize: number };

/** Lo que responde el webhook de un proveedor. */
export type RespuestaWebhook = { referencia: string; estado: EstadoPago; ipago: string };

/** Verbos de servidor del plugin armado (sin HTTP: las mismas funciones que usan los handlers). */
export type VerbosPagos = { crearIntento(iapp: string, input: IntentoInput): Promise<IntentoPago>; consultaIntento(referencia: string): Promise<DetalleIntento>; subirComprobante(referencia: string, comprobante: string, iapp?: string | null): Promise<IntentoPago>; verificarPago(ipago: string, estado: EstadoVerificacion, nota?: string | null, iapp?: string | null): Promise<IntentoPago>; listarPagos(iapp: string, filtros?: FiltrosPagos): Promise<PaginaPagos>; webhookPago(proveedor: string, request: Request): Promise<RespuestaWebhook>; simular(ipago: string, resultado: EstadoVerificacion, iapp?: string | null): Promise<IntentoPago>; historial(ipago: string): Promise<EventoPago[]> };

/** Zod de los datos de la cuenta que recibe las transferencias. */
export const ZCuentaPago = z.strictObject({ banco: z.string().trim().min(1).max(60).optional(), numero: z.string().trim().min(1).max(60).optional(), tipo: z.string().trim().min(1).max(40).optional(), titular: z.string().trim().min(1).max(160).optional(), instrucciones: z.string().trim().min(1).max(1000).optional() });

/** Zod de la configuracion de un proveedor. */
export const ZConfigProveedor = z.strictObject({ llave: z.string().trim().min(1).max(400).optional(), publica: z.string().trim().min(1).max(200).optional(), url: z.string().trim().min(1).max(500).optional(), regla: z.enum(REGLAS_SIMULADO).optional(), montoMaximo: z.number().int().min(0).optional() });

/** Zod de la configuracion del plugin. */
export const ZPagosConfig = z.strictObject({ moneda: z.string().trim().min(1).max(8).default("COP"), cuentas: z.record(z.string(), ZCuentaPago).default({}), cuentaPorDefecto: ZCuentaPago.optional(), canalEfectivo: z.string().trim().min(1).max(40).default("whatsapp"), proveedores: z.strictObject({ simulado: ZConfigProveedor.optional(), wompi: ZConfigProveedor.optional(), stripe: ZConfigProveedor.optional(), mercadopago: ZConfigProveedor.optional(), manual: ZConfigProveedor.optional() }).default({}), proveedorTarjeta: z.enum(PROVEEDORES_PAGO).default("wompi") });

/** Zod del alta de un intento de pago. */
export const ZIntentoInput = z.strictObject({ itiquete: z.string().trim().min(1).max(40).nullish(), monto: z.number().int().min(0).max(1000000000), moneda: z.string().trim().min(1).max(8).optional(), metodo: z.enum(METODOS_PAGO), banco: z.enum(BANCOS_PAGO).nullish(), proveedor: z.enum(PROVEEDORES_PAGO).optional(), descripcion: z.string().trim().max(500).optional() });

/** Zod de la subida del comprobante. */
export const ZComprobanteInput = z.strictObject({ referencia: z.string().trim().min(1).max(64), comprobante: z.string().trim().min(1).max(200) });

/** Zod de la verificacion de un admin. */
export const ZVerificarInput = z.strictObject({ ipago: z.string().trim().min(1).max(40).optional(), referencia: z.string().trim().min(1).max(64).optional(), estado: z.enum(ESTADOS_VERIFICACION), nota: z.string().trim().max(1000).nullish() });

/** Zod del forzado del resultado del proveedor simulado. */
export const ZSimularInput = z.strictObject({ resultado: z.enum(ESTADOS_VERIFICACION) });
