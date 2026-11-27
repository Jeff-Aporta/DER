/**
 * Plugin de pagos (server): los intentos de pago de una APP y su historial.
 *
 * - Aislamiento: cada intento lleva `iapp` (la cabecera `x-app` o la claim `iapp` de la sesion) y toda lectura y
 *   escritura filtra por ella: un pago de otra app es 404 (nunca se distingue).
 * - Metodos: `transferencia` (instrucciones con la cuenta configurada por app; el cliente sube el comprobante y el pago
 *   pasa a `en_verificacion`), `tarjeta` (la resuelve un proveedor: simulado, wompi, stripe o mercadopago) y `efectivo`
 *   (queda `pendiente` con el texto de acordarlo por el canal configurado, whatsapp por defecto).
 * - Proveedores: un adaptador por proveedor. Sin llave en la configuracion el adaptador queda DESHABILITADO: el intento
 *   no se crea y el webhook se rechaza diciendo por que.
 * - Firma: el webhook solo se acepta con la firma valida de su llave (Wompi: SHA256 del timestamp; Stripe:
 *   `stripe-signature`; MercadoPago: `x-signature`).
 * - Aviso: `services.alCambiarEstado(intento, anterior)` se llama en cada cambio de estado (para notificar y mover el
 *   tiquete del CRM).
 *
 * ```ts
 * const pg = crearPagos({ db, cfg: { cuentas: { riogo24: { banco: "nequi", numero: "3001234567" } } }, services: { alCambiarEstado } });
 * const router = createRouter(ctrls, { basePath: "/api", plugins: [pg] });
 * await router.seed();
 * ```
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/pagos.md
 */
import { HttpError, NotFoundError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { randomId } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { ahora, ctrl, fila, filas, guardar, idNuevo, porPk, validado } from "@Jeff-Aporta/DER/src/03-plugins/common/tablas.ts";
import { pagosPlugin } from "@Jeff-Aporta/DER/src/03-plugins/pagos/index.ts";
import { adaptadorMercadopago, adaptadorSimulado, adaptadorStripe, adaptadorWompi, objetoDe, textoDe } from "@Jeff-Aporta/DER/src/03-plugins/pagos/proveedores.ts";
import { type ComprobanteInput, type CuentaPago, type DetalleIntento, type EstadoPago, type EstadoVerificacion, type EventoPago, type FiltrosPagos, type IntentoInput, type IntentoPago, type MetodoPago, type NombreProveedor, type PagosConfig, type PagosServicios, type PaginaPagos, type ProveedorPago, type RespuestaWebhook, type SimularInput, type VerificarInput, type VerbosPagos, type VistaIntento, TRANSICIONES_PAGO, ZComprobanteInput, ZIntentoInput, ZPagosConfig, ZSimularInput, ZVerificarInput } from "@Jeff-Aporta/DER/src/03-plugins/pagos/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/pagos/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/pagos/proveedores.ts";

/** La configuracion del plugin (con los defaults del Zod). */
const cfgDe = (p: ServerPlugin): PagosConfig => (p.cfg ?? {}) as PagosConfig;

/** Los servicios del consumidor (el hook de cambio de estado). */
const servicios = (p: ServerPlugin): PagosServicios => (p.services ?? {}) as PagosServicios;

/** La app de la peticion: la cabecera `x-app` o, si no, la claim `iapp` de la sesion (null si no hay ninguna). */
function ambito(ctx: ServerCtx): string | null {
  const cabecera = ctx.request?.headers.get("x-app")?.trim() ?? "";
  if (cabecera) return cabecera.slice(0, 40);
  const claims = (ctx.session?.claims ?? {}) as { iapp?: unknown };
  const claim = textoDe(claims["iapp"]).trim();
  return claim ? claim.slice(0, 40) : null;
}

/** La cuenta que recibe las transferencias de una app (la de la app o la de defecto). */
function cuentaDe(cfg: PagosConfig, iapp: string): CuentaPago | null {
  return cfg.cuentas?.[iapp] ?? cfg.cuentaPorDefecto ?? null;
}

/** Las instrucciones de una transferencia: los datos de la cuenta configurada. */
function instruccionesDe(cuenta: CuentaPago): string {
  if (cuenta.instrucciones) return cuenta.instrucciones;
  const datos = [cuenta.banco ? `banco ${cuenta.banco}` : "", cuenta.tipo ?? "", cuenta.numero ?? "", cuenta.titular ? `a nombre de ${cuenta.titular}` : ""].filter((x) => x !== "");
  if (!datos.length) return "Pide al comercio los datos de la cuenta para transferir";
  return `Transfiere a la cuenta ${datos.join(" ")}`;
}

/** El canal de un pago en efectivo, como se le dice al cliente. */
function canalDe(canal: string): string {
  const c = canal.trim().toLowerCase();
  if (c === "whatsapp") return "WhatsApp";
  if (c === "telegram") return "Telegram";
  if (c === "sms") return "SMS";
  return canal.trim();
}

/** El proveedor de un metodo: el que pidio el consumidor o el de defecto del metodo. */
function proveedorDe(metodo: MetodoPago, pedido: NombreProveedor | undefined, cfg: PagosConfig): NombreProveedor {
  if (pedido) return pedido;
  if (metodo === "tarjeta") return cfg.proveedorTarjeta ?? "wompi";
  return "manual";
}

/** Los adaptadores del plugin (uno por proveedor): se crean una vez y se guardan en su estado. */
function adaptadoresDe(p: ServerPlugin): Record<string, ProveedorPago> {
  const guardados = p.state["adaptadores"];
  if (guardados) return guardados as Record<string, ProveedorPago>;
  const proveedores = cfgDe(p).proveedores ?? {};
  const nuevos: Record<string, ProveedorPago> = {
    simulado: adaptadorSimulado(proveedores["simulado"] ?? {}),
    wompi: adaptadorWompi(proveedores["wompi"] ?? {}),
    stripe: adaptadorStripe(proveedores["stripe"] ?? {}),
    mercadopago: adaptadorMercadopago(proveedores["mercadopago"] ?? {}),
  };
  p.state["adaptadores"] = nuevos;
  return nuevos;
}

/** El intento por su id interno. */
async function porIpago(p: ServerPlugin, ipago: string): Promise<IntentoPago | null> {
  return await porPk<IntentoPago>(p, "intentos", { ipago });
}

/** El intento por su token publico (la `referencia`). */
async function porReferencia(p: ServerPlugin, referencia: string): Promise<IntentoPago | null> {
  const c = ctrl(p, "intentos");
  const r = await c.query({ where: { referencia }, pageSize: 1 } as never);
  return r.length ? (fila(r[0]) as IntentoPago) : null;
}

/** Un evento del historial del pago. */
async function anota(p: ServerPlugin, intento: IntentoPago, clase: string, anterior: EstadoPago | null, estado: EstadoPago | null, datos?: unknown): Promise<EventoPago> {
  const c = ctrl(p, "eventos");
  const creado = await c.post(c.pojo({ id: idNuevo(), iapp: intento.iapp, ipago: intento.ipago, clase, estadoAnterior: anterior, estado, datos: datos ?? null, fhcre: ahora() }));
  return fila(creado) as EventoPago;
}

/** Escribe el estado nuevo del pago y deja su evento en el historial. */
async function fijaEstado(p: ServerPlugin, intento: IntentoPago, nuevo: EstadoPago, clase: string, anterior: EstadoPago | null, datos?: unknown): Promise<IntentoPago> {
  const guardado = await guardar<IntentoPago>(p, "intentos", { ipago: intento.ipago }, { estado: nuevo, fhact: ahora() });
  await anota(p, guardado, clase, anterior, nuevo, datos);
  return guardado;
}

/** Mueve el pago de estado (valida la transicion), deja el evento y avisa al consumidor. */
async function cambiaEstado(p: ServerPlugin, intento: IntentoPago, nuevo: EstadoPago, clase: string, datos?: unknown): Promise<IntentoPago> {
  if (intento.estado === nuevo) return intento;
  const permitidos = TRANSICIONES_PAGO[intento.estado] ?? [];
  if (!permitidos.includes(nuevo)) throw new ValidationError(`No se puede pasar de «${intento.estado}» a «${nuevo}»`);
  const guardado = await fijaEstado(p, intento, nuevo, clase, intento.estado, datos);
  await servicios(p).alCambiarEstado?.(guardado, intento.estado);
  return guardado;
}

/** El intento como lo ve el cliente (sin los datos internos) con las instrucciones del metodo. */
function vistaDe(intento: IntentoPago): VistaIntento {
  const instrucciones = textoDe(objetoDe(intento.jdatos)["instrucciones"]);
  return { ipago: intento.ipago, iapp: intento.iapp, itiquete: intento.itiquete, monto: intento.monto, moneda: intento.moneda, metodo: intento.metodo, banco: intento.banco, proveedor: intento.proveedor, estado: intento.estado, referencia: intento.referencia, url_pago: intento.url_pago, comprobante: intento.comprobante, instrucciones: instrucciones || null, fhcre: intento.fhcre, fhact: intento.fhact };
}

/** Crea el intento de pago de una app: las instrucciones del metodo, el proveedor si toca y el primer estado. */
async function crearIntento(p: ServerPlugin, iapp: string, input: IntentoInput): Promise<IntentoPago> {
  const d = validado(ZIntentoInput, input);
  const cfg = cfgDe(p);
  const metodo = d.metodo;
  const proveedor = proveedorDe(metodo, d.proveedor, cfg);
  const adaptador = adaptadoresDe(p)[proveedor];
  if (adaptador && !adaptador.habilitado) throw new ValidationError(`El proveedor «${proveedor}» no esta habilitado: falta la llave en la configuracion`);
  const datos: Record<string, unknown> = { descripcion: d.descripcion ?? null };
  let instrucciones = "";
  if (metodo === "transferencia") {
    const cuenta = cuentaDe(cfg, iapp);
    if (!cuenta) throw new ValidationError(`La app «${iapp}» no tiene cuenta de transferencia configurada`);
    instrucciones = instruccionesDe(cuenta);
    datos["cuenta"] = cuenta;
  }
  if (metodo === "efectivo") {
    const canal = cfg.canalEfectivo ?? "whatsapp";
    instrucciones = `se acuerda por ${canalDe(canal)}`;
    datos["canal"] = canal;
  }
  if (instrucciones) datos["instrucciones"] = instrucciones;
  const ipago = `pg_${randomId(12)}`;
  const referencia = randomId(16);
  const c = ctrl(p, "intentos");
  const creado = await c.post(c.pojo({ ipago, iapp, itiquete: d.itiquete ?? null, monto: d.monto, moneda: d.moneda ?? cfg.moneda ?? "COP", metodo, banco: d.banco ?? null, proveedor, estado: "creado", referencia, url_pago: null, comprobante: null, jdatos: datos, fhcre: ahora(), fhact: null }));
  let intento = fila(creado) as IntentoPago;
  let destino: EstadoPago = "pendiente";
  if (adaptador) {
    const r = await adaptador.crearIntento(intento);
    const jdatos = { ...datos, ...(r.instrucciones ? { instrucciones: r.instrucciones } : {}) };
    intento = await guardar<IntentoPago>(p, "intentos", { ipago }, { url_pago: r.url_pago ?? null, jdatos, fhact: ahora() });
    const estado = await adaptador.verificar(r.referencia);
    if (estado === "aprobado" || estado === "rechazado") destino = estado;
  }
  const movido = await fijaEstado(p, intento, destino, "creado", null, { metodo, proveedor, monto: intento.monto });
  await servicios(p).alCambiarEstado?.(movido, null);
  return movido;
}

/** El pago del cliente con su token publico y su historial. */
async function consultaIntento(p: ServerPlugin, referencia: string, iapp: string | null): Promise<DetalleIntento> {
  const intento = await porReferencia(p, referencia);
  if (!intento) throw new NotFoundError("Ese pago no existe");
  if (iapp && iapp !== intento.iapp) throw new NotFoundError("Ese pago no existe");
  const eventos = await filas<EventoPago>(p, "eventos", { where: { ipago: intento.ipago }, orderBy: "id", pageSize: 500 });
  return { intento: vistaDe(intento), eventos: eventos.map((e) => ({ id: e.id, clase: e.clase, estadoAnterior: e.estadoAnterior, estado: e.estado, fhcre: e.fhcre })) };
}

/** El comprobante del cliente: el pago pasa a `en_verificacion` (lo verifica un admin). */
async function subirComprobante(p: ServerPlugin, referencia: string, comprobante: string, iapp: string | null): Promise<IntentoPago> {
  const intento = await porReferencia(p, referencia);
  if (!intento) throw new NotFoundError("Ese pago no existe");
  if (iapp && iapp !== intento.iapp) throw new NotFoundError("Ese pago no existe");
  if (intento.metodo !== "transferencia") throw new ValidationError("Solo un pago por transferencia lleva comprobante");
  if (intento.estado !== "pendiente") throw new HttpError(409, "El pago no esta pendiente de comprobante");
  const guardado = await guardar<IntentoPago>(p, "intentos", { ipago: intento.ipago }, { comprobante, fhact: ahora() });
  await anota(p, guardado, "comprobante", null, guardado.estado, { comprobante });
  return await cambiaEstado(p, guardado, "en_verificacion", "estado", { comprobante });
}

/** La verificacion de un admin: aprueba o rechaza el comprobante recibido. */
async function verificarPago(p: ServerPlugin, ipago: string, estado: EstadoVerificacion, nota: string | null, iapp: string | null): Promise<IntentoPago> {
  const intento = await porIpago(p, ipago);
  if (!intento) throw new NotFoundError("Ese pago no existe");
  if (iapp && iapp !== intento.iapp) throw new NotFoundError("Ese pago no existe");
  if (intento.estado !== "en_verificacion") throw new HttpError(409, "El pago no esta en verificacion");
  return await cambiaEstado(p, intento, estado, "verificado", { nota });
}

/** La pagina de pagos de una app (filtrada). */
async function listarPagos(p: ServerPlugin, iapp: string, filtros: FiltrosPagos = {}): Promise<PaginaPagos> {
  const page = Math.max(1, Math.floor(filtros.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(filtros.pageSize ?? 50)));
  const where: Record<string, unknown> = { iapp };
  if (filtros.estado) where["estado"] = filtros.estado;
  if (filtros.metodo) where["metodo"] = filtros.metodo;
  if (filtros.proveedor) where["proveedor"] = filtros.proveedor;
  if (filtros.itiquete) where["itiquete"] = filtros.itiquete;
  const c = ctrl(p, "intentos");
  const todos = await c.query({ select: ["ipago"], where, pageSize: c.entity.maxPageSize } as never);
  const pagina = await c.query({ where, orderBy: ["-fhcre"], page, pageSize } as never);
  return { pagos: pagina.map((x: unknown) => fila(x) as IntentoPago), total: todos.length, page, pageSize };
}

/** El aviso del proveedor: se acepta solo con la firma valida y mueve el pago. */
async function webhookPago(p: ServerPlugin, nombre: string, request: Request): Promise<RespuestaWebhook> {
  const adaptador = adaptadoresDe(p)[nombre];
  if (!adaptador) throw new NotFoundError("Ese proveedor no existe");
  if (!adaptador.habilitado) throw new HttpError(400, `El proveedor «${nombre}» no esta habilitado: falta la llave en la configuracion`);
  const r = await adaptador.webhook(request);
  if (!r) throw new HttpError(401, "Firma invalida");
  const intento = await porReferencia(p, r.referencia);
  if (!intento) throw new NotFoundError("Ese pago no existe");
  if (intento.estado === r.estado) return { referencia: intento.referencia, estado: intento.estado, ipago: intento.ipago };
  const permitidos = TRANSICIONES_PAGO[intento.estado] ?? [];
  if (!permitidos.includes(r.estado)) {
    if (r.estado === "pendiente") return { referencia: intento.referencia, estado: intento.estado, ipago: intento.ipago };
    throw new ValidationError(`No se puede pasar de «${intento.estado}» a «${r.estado}»`);
  }
  const movido = await cambiaEstado(p, intento, r.estado, "webhook", { proveedor: nombre });
  return { referencia: movido.referencia, estado: movido.estado, ipago: movido.ipago };
}

/** El endpoint de pruebas: fuerza el resultado (el del proveedor simulado o el que diga el consumidor). */
async function simular(p: ServerPlugin, ipago: string, resultado: EstadoVerificacion, iapp: string | null): Promise<IntentoPago> {
  const intento = await porIpago(p, ipago);
  if (!intento) throw new NotFoundError("Ese pago no existe");
  if (iapp && iapp !== intento.iapp) throw new NotFoundError("Ese pago no existe");
  adaptadoresDe(p)["simulado"]?.simular?.(intento.referencia, resultado);
  return await cambiaEstado(p, intento, resultado, "simulado", { resultado });
}

/** El historial de un pago. */
async function historial(p: ServerPlugin, ipago: string): Promise<EventoPago[]> {
  return await filas<EventoPago>(p, "eventos", { where: { ipago }, orderBy: "id", pageSize: 500 });
}

/** Un request con el cuerpo canonico (el router ya consumio el original): el adaptador vuelve a leerlo. */
function requestPara(i: ExtraRouteInput): Request {
  const cuerpo = typeof i.body === "string" ? i.body : JSON.stringify(i.body ?? {});
  return new Request(i.request.url, { method: "POST", headers: i.request.headers, body: cuerpo });
}

/** Los filtros de la lista a partir de la query HTTP. */
function filtrosDe(query: URLSearchParams): FiltrosPagos {
  const texto = (k: string): string | undefined => query.get(k) ?? undefined;
  const numero = (k: string): number | undefined => {
    const n = Number(query.get(k));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  return { estado: texto("estado") as EstadoPago | undefined, metodo: texto("metodo") as MetodoPago | undefined, proveedor: texto("proveedor") as NombreProveedor | undefined, itiquete: texto("itiquete"), desde: texto("desde"), hasta: texto("hasta"), page: numero("page"), pageSize: numero("pageSize") };
}

/** JSON del server de pagos: pagosPlugin + handlers + verbos + seed. */
export const pagosServer: ServerPluginDef = Obj.insert(pagosPlugin, {
  cfg: ZPagosConfig,
  entities: {
    intentos: { indexes: [{ columns: ["iapp", "estado", "fhcre"], name: "ix_pagos_estado" }, { columns: ["iapp", "fhcre"], name: "ix_pagos_app" }, { columns: ["itiquete"], name: "ix_pagos_tiquete" }] },
    eventos: { indexes: [{ columns: ["ipago", "id"], name: "ix_pagos_eventos_pago" }] },
  },
  irregularPaths: {
    crearIntento: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<IntentoPago> {
        const iapp = ambito(ctx);
        if (!iapp) throw new ValidationError("Falta la app: envia la cabecera x-app");
        return await crearIntento(this, iapp, i.body as IntentoInput);
      },
    },
    consultaIntento: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<DetalleIntento> {
        return await consultaIntento(this, i.params["referencia"] ?? "", ambito(ctx));
      },
    },
    subirComprobante: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<IntentoPago> {
        const d = validado<ComprobanteInput>(ZComprobanteInput, i.body);
        return await subirComprobante(this, d.referencia, d.comprobante, ambito(ctx));
      },
    },
    verificarPago: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<IntentoPago> {
        const d = validado<VerificarInput>(ZVerificarInput, i.body);
        const intento = d.ipago ? await porIpago(this, d.ipago) : await porReferencia(this, d.referencia ?? "");
        if (!intento) throw new NotFoundError("Ese pago no existe");
        return await verificarPago(this, intento.ipago, d.estado, d.nota ?? null, ambito(ctx));
      },
    },
    webhookPago: {
      async handler(this: ServerPlugin, i: ExtraRouteInput): Promise<RespuestaWebhook> {
        return await webhookPago(this, (i.params["proveedor"] ?? "").trim().toLowerCase(), requestPara(i));
      },
    },
    listarPagos: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<PaginaPagos> {
        const iapp = ambito(ctx);
        if (!iapp) throw new ValidationError("Falta la app: envia la cabecera x-app");
        return await listarPagos(this, iapp, filtrosDe(i.query));
      },
    },
    simularPago: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<IntentoPago> {
        const d = validado<SimularInput>(ZSimularInput, i.body);
        return await simular(this, i.params["ipago"] ?? "", d.resultado, ambito(ctx));
      },
    },
  },
  /** En el server, los verbos son metodos directos (sin HTTP): las mismas funciones que usan los handlers. */
  setup(this: ServerPlugin) {
    const v: VerbosPagos = {
      crearIntento: (iapp, input) => crearIntento(this, iapp, input),
      consultaIntento: (referencia) => consultaIntento(this, referencia, null),
      subirComprobante: (referencia, comprobante, iapp) => subirComprobante(this, referencia, comprobante, iapp ?? null),
      verificarPago: (ipago, estado, nota, iapp) => verificarPago(this, ipago, estado, nota ?? null, iapp ?? null),
      listarPagos: (iapp, filtros) => listarPagos(this, iapp, filtros),
      webhookPago: (proveedor, request) => webhookPago(this, proveedor, request),
      simular: (ipago, resultado, iapp) => simular(this, ipago, resultado, iapp ?? null),
      historial: (ipago) => historial(this, ipago),
    };
    Object.assign(this, v);
  },
  /** Crea sus tablas (y les suma columnas nuevas). Idempotente. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
  },
}) as ServerPluginDef;

/** createServer(pagosServer, runtime) con los verbos tipados (services: alCambiarEstado). */
export function crearPagos(runtime: ServerPluginRuntime): ServerPlugin & VerbosPagos {
  return createServer(pagosServer, runtime) as ServerPlugin & VerbosPagos;
}
