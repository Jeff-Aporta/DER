/**
 * server.ts — el lado SERVIDOR del canal propio: los handlers del protocolo (publicar, listar, editar, dar de baja,
 * reaccionar, canales, presencia, latido y ficheros), la puerta de JWT y la purga de lo caducado.
 *
 * La API es la MISMA que servia el Worker `estudio-canal` (mismas rutas, mismos codigos y mismos cuerpos), con la
 * memoria en la SQLite del VPS en vez de D1. Por eso los bots (y sus clientes) no cambian ni una linea.
 *
 * ```ts
 * const canal = createServer(canalVpsServer, { db, cfg: { secreto: "env:CANAL_JWT", almacen, urlBase, difundir } });
 * const router = createRouter([], { basePath: "/api", plugins: [canal] });
 * await router.seed();
 * ```
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/canal.md
 */
import { HttpError, NotFoundError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type {
  ExtraRouteInput,
  ServerCtx,
  ServerPlugin,
  ServerPluginDef,
} from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { jwtSession, verifyJwtHs256 } from "@Jeff-Aporta/DER/src/03-plugins/common/jwt.ts";
import { canalVpsPlugin } from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/index.ts";
import {
  type AlmacenFicheros,
  claveDe,
  firmarDescarga,
  verificarDescarga,
} from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/almacen.ts";
import {
  AVISO_CADUCIDAD,
  caducaDesde,
  CANAL_GENERAL,
  catalogoProtocolo,
  SERVICIO,
  VENTANA_PRESENCIA_MS,
  VERSION_PROTOCOLO,
  VIDA_FIRMA_MIN,
  VIDA_HORAS,
} from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/protocolo.ts";
import {
  type Adjunto,
  type Canal,
  type Mensaje,
  type Presencia,
  type Reaccion,
  type Tunel,
  ZCanal,
  ZEditar,
  ZLatido,
  ZPublicar,
  ZReaccionar,
  ZTunel,
} from "@Jeff-Aporta/DER/src/03-plugins/canal-vps/schemas.ts";

/** Margen de reloj (segundos): un token que acaba de caducar se acepta estos segundos. */
export const MARGEN_RELOJ_SEG = 30;

/** Tamano maximo de un fichero entre bots (bytes). */
export const LIMITE_BYTES = 20 * 1024 * 1024;

/** Cuantos mensajes devuelve de golpe el listado como maximo. */
export const LIMITE_MENSAJES = 500;

/** La configuracion del plugin (la resuelve `createServer`: el secreto llega por `"env:CANAL_JWT"`). */
export type CanalVpsConfig = {
  /** El secreto HS256 con el que se firman y verifican los tokens (`CANAL_JWT`): nunca se imprime. */
  secreto: string;
  /** El almacen de ficheros (el disco del VPS). */
  almacen?: AlmacenFicheros | undefined;
  /** La URL publica del servicio (para firmar las descargas). Si no, se usa la del request. */
  urlBase?: string | undefined;
  /** Difunde un evento en la sala (lo pone el servicio: el realtime). */
  difundir?: ((evento: Record<string, unknown>, canal: string) => void) | undefined;
};

/** Valida con un Zod y lanza 400 con el detalle en espanol. */
function valido<T>(
  zod: { safeParse(v: unknown): { success: boolean; data?: T; error?: unknown } },
  v: unknown,
): T {
  const r = zod.safeParse(v ?? {});
  if (!r.success) throw new ValidationError(zodMessage(r.error as never));
  return r.data as T;
}

/** Quien es el bot de este request (del token). */
export function botDe(ctx: ServerCtx): string {
  const id = ctx.session?.id;
  if (!id) throw new HttpError(401, "Este endpoint exige el token del bot (Authorization: Bearer)");
  return String(id);
}

/** El rol del bot (del token). */
export function rolDe(ctx: ServerCtx): string {
  const rol = ctx.session?.role ?? ctx.session?.claims?.["rol"];
  return typeof rol === "string" ? rol : "";
}

/** ¿Puede este bot tocar el mensaje de otro? (el autor del mensaje, el autor del estudio o un admin). */
export function puedeEditar(ctx: ServerCtx, autor: string): boolean {
  const bot = botDe(ctx);
  if (bot === autor) return true;
  const rol = rolDe(ctx).toLowerCase();
  return rol === "autor" || rol === "admin" || rol === "administrador";
}

/**
 * Los canales a los que el token tiene acceso (la claim `canales`): `null` = todos (vacia o ausente).
 * El Worker solo usaba esa claim para el realtime; aqui tambien protege la API.
 */
export function canalesPermitidos(ctx: ServerCtx): string[] | null {
  const permitidos = ctx.session?.claims?.["canales"];
  if (!Array.isArray(permitidos)) return null;
  const lista = permitidos.filter((x): x is string => typeof x === "string");
  return lista.length ? lista : null;
}

/** ¿El token tiene acceso a ese canal? (si no, 403). */
export function puedeCanal(ctx: ServerCtx, canal: string): void {
  const permitidos = canalesPermitidos(ctx);
  if (!permitidos) return;
  if (!permitidos.includes(canal)) throw new HttpError(403, `El token no tiene acceso al canal ${canal}`);
}

/** El token del request: `Authorization: Bearer <token>` (o la cabecera `x-canal-token`). */
export function tokenDeRequest(req: Request): string | null {
  const cabecera = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(cabecera);
  if (m && m[1]) return m[1].trim();
  const alterno = req.headers.get("x-canal-token");
  return alterno ? alterno.trim() : null;
}

/**
 * La base publica del servicio: la del request (con `X-Forwarded-Proto`, que es lo que pone el tunel de Cloudflare),
 * o la de la configuracion si el request no trae Host.
 */
export function baseDe(req: Request, configurada?: unknown): URL {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  if (!host) {
    const fija = String(configurada ?? "");
    if (fija) return new URL(fija);
  }
  return new URL(`${proto}://${host}`);
}

/** Una respuesta 201 con lo creado (JSON, como el resto de la API). */
function creado(datos: unknown): Response {
  return new Response(JSON.stringify(datos), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Crea el canal si no existe (los canales se crean al vuelo: nada cableado). */
export async function asegurarCanal(
  ctrl: ServerController<any>,
  canal: string,
  bot: string,
  ahora: Date,
): Promise<void> {
  const existe = await ctrl.get(ctrl.pojo({ canal }), { include: {} }) as Canal | null;
  if (existe) return;
  await ctrl.post(
    ctrl.pojo({
      canal,
      nombre: canal,
      descripcion: `Canal creado al vuelo por ${bot}`,
      ambito: canal.includes(":") ? canal.split(":")[1] ?? null : null,
      activo: true,
      creado: ahora,
      creadoPor: bot,
    }),
    { include: {} },
  );
}

/** Sube o baja la presencia de un bot en un canal (idempotente). */
export async function marcarPresencia(
  ctrl: ServerController<any>,
  bot: string,
  canal: string,
  estado: "conectado" | "desconectado",
  nodo?: string | null,
  ahora: Date = new Date(),
): Promise<void> {
  const claves = { bot, canal };
  const actual = await ctrl.get(ctrl.pojo(claves), { include: {} }) as Presencia | null;
  if (actual) {
    await ctrl.put(
      ctrl.pojo({
        ...claves,
        estado,
        nodo: nodo ?? actual.nodo ?? null,
        fhultimo: ahora,
        fhconexion: estado === "conectado" ? ahora : actual.fhconexion ?? ahora,
      }),
      { include: {} },
    );
    return;
  }
  await ctrl.post(
    ctrl.pojo({ ...claves, estado, nodo: nodo ?? null, fhultimo: ahora, fhconexion: ahora }),
    { include: {} },
  );
}

/** El latido del bot: renueva su ultimo contacto (en los canales indicados o en todos los suyos). */
export async function latidoPresencia(
  ctrl: ServerController<any>,
  bot: string,
  canales: string[] | null,
  ahora: Date = new Date(),
): Promise<number> {
  const filas = await ctrl.query({ where: { bot }, pageSize: 100 }, { include: {} }) as Presencia[];
  const mias = canales?.length ? filas.filter((f) => canales.includes(f.canal)) : filas;
  for (const f of mias) {
    await ctrl.put(ctrl.pojo({ bot: f.bot, canal: f.canal, fhultimo: ahora, estado: "conectado" }), {
      include: {},
    });
  }
  return mias.length;
}

/** La presencia vista por la API (con `en_linea` calculado: el ultimo latido es reciente). */
export async function listarPresencia(
  ctrl: ServerController<any>,
  ahora: Date = new Date(),
): Promise<unknown[]> {
  const filas = await ctrl.query({ pageSize: 200 }, { include: {} }) as Presencia[];
  const limite = ahora.getTime() - VENTANA_PRESENCIA_MS;
  return filas.map((f) => ({
    bot: f.bot,
    canal: f.canal,
    estado: f.estado,
    nodo: f.nodo ?? null,
    fhconexion: f.fhconexion instanceof Date ? f.fhconexion.toISOString() : null,
    fhultimo: f.fhultimo instanceof Date ? f.fhultimo.toISOString() : null,
    en_linea: f.fhultimo instanceof Date && f.fhultimo.getTime() >= limite && f.estado === "conectado",
  }));
}

/**
 * La purga: lo que caducó se va. Los mensajes caducados se marcan como borrados (baja logica) y los ficheros
 * vencidos se borran del almacen.
 */
export async function purgar(
  plugin: ServerPlugin,
  ahora: Date = new Date(),
): Promise<{ ficheros: number; mensajes: number; hora: string }> {
  const ctrl = plugin.controllers["mensajes"]!;
  const filas = await ctrl.query({ where: { caduca: { lt: ahora } }, pageSize: 200 }, {
    include: {},
  }) as Mensaje[];
  let caducados = 0;
  for (const f of filas) {
    if (f.borrado) continue;
    await ctrl.put(ctrl.pojo({ idmensaje: f.idmensaje, borrado: true, fhmod: ahora }), { include: {} });
    caducados++;
  }
  const almacen = plugin.cfg["almacen"] as AlmacenFicheros | undefined;
  let borrados = 0;
  if (almacen) {
    const adj = plugin.controllers["adjuntos"]!;
    const fichas = await adj.query({ where: { caduca: { lt: ahora } }, pageSize: 200 }, {
      include: {},
    }) as Adjunto[];
    for (const f of fichas) {
      if (f.estado !== "vivo") continue;
      if (f.clave) {
        try {
          await almacen.borrar(f.clave);
        } catch {
          // da igual: la ficha ya esta caducada
        }
      }
      await adj.put(adj.pojo({ idadjunto: f.idadjunto, estado: "caducado" }), { include: {} });
      borrados++;
    }
  }
  return { ficheros: borrados, mensajes: caducados, hora: ahora.toISOString() };
}

/** El plugin del canal propio, con sus handlers: `createServer(canalVpsServer, { db, cfg })`. */
export const canalVpsServer: ServerPluginDef = Obj.insert(canalVpsPlugin, {
  security: {
    /** La puerta: el token HS256 del bot. Sin token o con token invalido, 401. */
    async extract(this: ServerPlugin, req: Request) {
      const secreto = String(this.cfg["secreto"] ?? "");
      if (!secreto) throw new HttpError(500, "El servicio no tiene el secreto del canal (CANAL_JWT)");
      const token = tokenDeRequest(req);
      if (!token) return null;
      const claims = await verifyJwtHs256(token, secreto, { clockToleranceSec: MARGEN_RELOJ_SEG });
      return jwtSession(claims);
    },
    protected(info: { id?: string | null } | null) {
      return !!info?.id;
    },
    permissions() {
      return { allowed: true, value: true };
    },
  },
  irregularPaths: {
    /** `GET /api/salud`: el estado del servicio (publico, no lleva datos): es el watchdog. */
    salud: {
      async handler(this: ServerPlugin) {
        let db = true;
        try {
          await this.controllers["mensajes"]!.query({ pageSize: 1 }, { include: {} });
        } catch {
          db = false;
        }
        return {
          ok: true,
          servicio: SERVICIO,
          version: VERSION_PROTOCOLO,
          hora: new Date().toISOString(),
          db,
          d1: db,
          sqlite: db,
          archivos: !!this.cfg["almacen"],
          rt: !!this.cfg["difundir"],
          vida_horas: VIDA_HORAS,
          aviso: AVISO_CADUCIDAD,
        };
      },
    },
    /** `GET /api/protocolo`: el catalogo del protocolo. */
    protocolo: {
      handler() {
        return catalogoProtocolo();
      },
    },
    /** `POST /api/instalar`: crea las tablas que falten (si el esquema esta al dia, no hace nada). */
    instalar: {
      async handler(this: ServerPlugin) {
        await this.router?.seed();
        return {
          ok: true,
          instalado: [
            "canal_canales",
            "canal_mensajes",
            "canal_reacciones",
            "canal_presencia",
            "canal_adjuntos",
          ],
        };
      },
    },
    /** `GET /api/canales`: los canales que hay. */
    canales: {
      async handler(this: ServerPlugin) {
        return await this.controllers["canales"]!.query({ orderBy: "canal", pageSize: 200 }, {
          include: {},
        }) as Canal[];
      },
    },
    /** `POST /api/canales`: crear un canal (si ya existe, se devuelve el mismo). */
    crearCanal: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
        const bot = botDe(ctx);
        const entrada = valido(ZCanal, i.body);
        const ahora = new Date();
        const ctrl = this.controllers["canales"]!;
        const existe = await ctrl.get(ctrl.pojo({ canal: entrada.canal }), { include: {} }) as Canal | null;
        if (existe) return existe;
        const canal = await ctrl.post(
          ctrl.pojo({
            canal: entrada.canal,
            nombre: entrada.nombre ?? entrada.canal,
            descripcion: entrada.descripcion ?? null,
            ambito: entrada.ambito ??
              (entrada.canal.includes(":") ? entrada.canal.split(":")[1] ?? null : null),
            activo: true,
            creado: ahora,
            creadoPor: bot,
          }),
          ctx,
        ) as Canal;
        return creado(canal);
      },
    },
    /** `GET /api/mensajes?canal=&desde=&limite=&para=&tipo=`: la memoria (los mensajes desde una marca). */
    mensajes: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
        const canal = i.query.get("canal")?.trim() ?? "";
        const desde = i.query.get("desde")?.trim() ?? "";
        const incluirBorrados = (i.query.get("incluir") ?? "").includes("borrados");
        const limite = Math.min(Math.max(Number(i.query.get("limite") ?? 100) || 100, 1), LIMITE_MENSAJES);
        const para = i.query.getAll("para").flatMap((p) => p.split(",")).map((p) => p.trim()).filter(Boolean);
        const tipos = i.query.getAll("tipo").flatMap((t) => t.split(",")).map((t) => t.trim()).filter(
          Boolean,
        );
        const where: Record<string, unknown> = {};
        if (canal) where["canal"] = canal;
        // un token acotado a unos canales no lee los demas (ni siquiera "todos")
        const permitidos = canalesPermitidos(ctx);
        if (permitidos && (!canal || !permitidos.includes(canal))) {
          throw new HttpError(403, `El token no tiene acceso al canal ${canal || "(todos)"}`);
        }
        if (!incluirBorrados) where["borrado"] = false;
        if (desde) {
          const fecha = Date.parse(desde);
          if (Number.isFinite(fecha)) {
            where["fhcre"] = { gt: new Date(fecha) };
          } else {
            const previo = await this.controllers["mensajes"]!.get(
              this.controllers["mensajes"]!.pojo({ idmensaje: desde }),
              { include: {} },
            ) as Mensaje | null;
            if (previo?.fhcre instanceof Date) where["fhcre"] = { gt: previo.fhcre };
          }
        }
        const pedir = Math.min(limite * 3, LIMITE_MENSAJES);
        let filas = await this.controllers["mensajes"]!.query(
          { where, orderBy: ["fhcre", "idmensaje"], pageSize: pedir },
          { include: {} },
        ) as Mensaje[];
        if (para.length) {
          filas = filas.filter((f) =>
            Array.isArray(f.para) && para.some((p) => (f.para as unknown[]).map(String).includes(p))
          );
        }
        if (tipos.length) filas = filas.filter((f) => tipos.includes(String(f.tipo)));
        return filas.slice(0, limite);
      },
    },
    /** `POST /api/mensajes`: publicar un mensaje en un canal. */
    publicarMensaje: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
        const bot = botDe(ctx);
        const entrada = valido(ZPublicar, i.body);
        if (!entrada.texto && !(entrada.adjuntos?.length)) {
          throw new ValidationError("El mensaje va vacio: pon texto o un adjunto");
        }
        puedeCanal(ctx, entrada.canal);
        const ahora = new Date();
        await asegurarCanal(this.controllers["canales"]!, entrada.canal, bot, ahora);
        const ctrl = this.controllers["mensajes"]!;
        const mensaje = await ctrl.post(
          ctrl.pojo({
            idmensaje: crypto.randomUUID(),
            canal: entrada.canal,
            autor: bot,
            tipo: entrada.tipo ?? "texto",
            texto: entrada.texto ?? "",
            adjuntos: entrada.adjuntos ?? [],
            para: entrada.para ?? [],
            jmeta: entrada.meta ?? null,
            fhcre: ahora,
            fhmod: ahora,
            borrado: false,
            caduca: caducaDesde(ahora),
          }),
          ctx,
        ) as Mensaje;
        const datos = (mensaje as unknown as { toJSON(): Mensaje }).toJSON();
        (this.cfg["difundir"] as ((e: Record<string, unknown>, c: string) => void) | undefined)?.(
          { tipo: "mensaje.nuevo", de: bot, mensaje: datos },
          entrada.canal,
        );
        return creado(mensaje);
      },
    },
    /** `GET /api/mensajes/{idmensaje}`: un mensaje. */
    verMensaje: {
      async handler(this: ServerPlugin, i: ExtraRouteInput) {
        const id = i.params["idmensaje"] ?? "";
        const mensaje = await this.controllers["mensajes"]!.get(
          this.controllers["mensajes"]!.pojo({ idmensaje: id }),
          { include: {} },
        ) as Mensaje | null;
        if (!mensaje) throw new NotFoundError("El mensaje no existe");
        return mensaje;
      },
    },
    /** `PATCH /api/mensajes/{idmensaje}`: editar (solo el autor del mensaje, el autor del estudio o un admin). */
    editarMensaje: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
        const id = i.params["idmensaje"] ?? "";
        const entrada = valido(ZEditar, i.body);
        const ctrl = this.controllers["mensajes"]!;
        const actual = await ctrl.get(ctrl.pojo({ idmensaje: id }), { include: {} }) as Mensaje | null;
        if (!actual) throw new NotFoundError("El mensaje no existe");
        if (!puedeEditar(ctx, String(actual.autor))) {
          throw new HttpError(403, "Solo el autor del mensaje puede editarlo");
        }
        if (entrada.texto === undefined && entrada.tipo === undefined) {
          throw new ValidationError("No hay nada que editar");
        }
        const ahora = new Date();
        const mensaje = await ctrl.put(
          ctrl.pojo({
            idmensaje: id,
            texto: entrada.texto ?? actual.texto ?? "",
            tipo: entrada.tipo ?? actual.tipo,
            fhmod: ahora,
          }),
          ctx,
        ) as Mensaje;
        const datos = (mensaje as unknown as { toJSON(): Mensaje }).toJSON();
        (this.cfg["difundir"] as ((e: Record<string, unknown>, c: string) => void) | undefined)?.(
          { tipo: "mensaje.editado", de: botDe(ctx), mensaje: datos },
          String(actual.canal),
        );
        return mensaje;
      },
    },
    /** `DELETE /api/mensajes/{idmensaje}`: baja logica (el mensaje se conserva, marcado como borrado). */
    bajaMensaje: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
        const id = i.params["idmensaje"] ?? "";
        const ctrl = this.controllers["mensajes"]!;
        const actual = await ctrl.get(ctrl.pojo({ idmensaje: id }), { include: {} }) as Mensaje | null;
        if (!actual) throw new NotFoundError("El mensaje no existe");
        if (!puedeEditar(ctx, String(actual.autor))) {
          throw new HttpError(403, "Solo el autor del mensaje puede darlo de baja");
        }
        const mensaje = await ctrl.put(
          ctrl.pojo({ idmensaje: id, borrado: true, fhmod: new Date() }),
          ctx,
        ) as Mensaje;
        const datos = (mensaje as unknown as { toJSON(): Mensaje }).toJSON();
        (this.cfg["difundir"] as ((e: Record<string, unknown>, c: string) => void) | undefined)?.(
          { tipo: "mensaje.baja", de: botDe(ctx), mensaje: datos },
          String(actual.canal),
        );
        return mensaje;
      },
    },
    /** `POST /api/reacciones`: reaccionar a un mensaje. */
    reaccionar: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
        const bot = botDe(ctx);
        const entrada = valido(ZReaccionar, i.body);
        const ctrl = this.controllers["mensajes"]!;
        const mensaje = await ctrl.get(ctrl.pojo({ idmensaje: entrada.idmensaje }), { include: {} }) as
          | Mensaje
          | null;
        if (!mensaje) throw new NotFoundError("El mensaje no existe");
        puedeCanal(ctx, String(mensaje.canal));
        const ahora = new Date();
        const ctrlReaccion = this.controllers["reacciones"]!;
        const reaccion = await ctrlReaccion.post(
          ctrlReaccion.pojo({
            idreaccion: crypto.randomUUID(),
            idmensaje: entrada.idmensaje,
            bot,
            emoji: entrada.emoji,
            fhcre: ahora,
          }),
          ctx,
        ) as Reaccion;
        (this.cfg["difundir"] as ((e: Record<string, unknown>, c: string) => void) | undefined)?.(
          { tipo: "reaccion", de: bot, idmensaje: entrada.idmensaje, emoji: entrada.emoji },
          String(mensaje.canal),
        );
        return creado(reaccion);
      },
    },
    /** `GET /api/reacciones?idmensaje=`: las reacciones de un mensaje. */
    reacciones: {
      async handler(this: ServerPlugin, i: ExtraRouteInput) {
        const id = i.query.get("idmensaje")?.trim();
        const where = id ? { idmensaje: id } : {};
        return await this.controllers["reacciones"]!.query({ where, orderBy: "fhcre", pageSize: 200 }, {
          include: {},
        }) as Reaccion[];
      },
    },
    /** `GET /api/presencia`: que bot esta conectado. */
    presencia: {
      async handler(this: ServerPlugin) {
        return await listarPresencia(this.controllers["presencias"]!);
      },
    },
    /** `POST /api/presencia/latido`: el bot dice que sigue ahi. */
    latido: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
        const bot = botDe(ctx);
        const entrada = valido(ZLatido, i.body);
        const ahora = new Date();
        const n = await latidoPresencia(this.controllers["presencias"]!, bot, entrada.canales ?? null, ahora);
        return { ok: true, bot, canales: n, hora: ahora.toISOString() };
      },
    },
    /** `POST /api/archivos`: subir un fichero efimero entre bots (72 h). */
    subirArchivo: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
        const bot = botDe(ctx);
        const req = i.request;
        const url = new URL(req.url);
        const nombre = req.headers.get("x-archivo-nombre") ?? url.searchParams.get("nombre") ?? "fichero";
        const mime = req.headers.get("x-archivo-mime") ?? url.searchParams.get("mime") ??
          "application/octet-stream";
        const canal = req.headers.get("x-archivo-canal") ?? url.searchParams.get("canal") ?? CANAL_GENERAL;
        puedeCanal(ctx, canal);
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (!bytes.length) throw new ValidationError("El fichero va vacio");
        if (bytes.length > LIMITE_BYTES) {
          throw new ValidationError(`El fichero es demasiado grande (tope: ${LIMITE_BYTES} bytes)`);
        }
        const almacen = this.cfg["almacen"] as AlmacenFicheros | undefined;
        if (!almacen) throw new HttpError(503, "El almacenamiento de ficheros no esta disponible");
        const ahora = new Date();
        const caduca = caducaDesde(ahora);
        const id = crypto.randomUUID();
        const clave = claveDe(canal, id, nombre);
        await almacen.subir(clave, bytes, {
          propietario: bot,
          canal,
          nombre,
          mime,
          bytes: bytes.length,
          caduca: caduca.toISOString(),
        });
        const ctrl = this.controllers["adjuntos"]!;
        const adjunto = await ctrl.post(
          ctrl.pojo({
            idadjunto: id,
            nombre,
            mime,
            bytes: bytes.length,
            clave,
            canal,
            propietario: bot,
            fhcre: ahora,
            caduca,
            estado: "vivo",
          }),
          ctx,
        ) as Adjunto;
        return creado(adjunto);
      },
    },
    /** `GET /api/archivos?canal=`: las fichas de los ficheros compartidos. */
    archivos: {
      async handler(this: ServerPlugin, i: ExtraRouteInput) {
        const canal = i.query.get("canal")?.trim();
        const where = canal ? { canal } : {};
        return await this.controllers["adjuntos"]!.query({ where, orderBy: "-fhcre", pageSize: 200 }, {
          include: {},
        }) as Adjunto[];
      },
    },
    /** `GET /api/archivos/{idadjunto}`: descargar el fichero (con JWT). */
    descargarArchivo: {
      async handler(this: ServerPlugin, i: ExtraRouteInput) {
        const id = i.params["idadjunto"] ?? "";
        const ctrl = this.controllers["adjuntos"]!;
        const adjunto = await ctrl.get(ctrl.pojo({ idadjunto: id }), { include: {} }) as Adjunto | null;
        if (!adjunto) throw new NotFoundError("El fichero no existe");
        if (!adjunto.clave) throw new NotFoundError("El fichero no tiene clave de almacen");
        const almacen = this.cfg["almacen"] as AlmacenFicheros | undefined;
        if (!almacen) throw new HttpError(503, "El almacenamiento de ficheros no esta disponible");
        const objeto = await almacen.leer(adjunto.clave);
        if (!objeto) throw new NotFoundError("El fichero ya no esta (caduca a las 72 horas)");
        return new Response(objeto.cuerpo, {
          headers: {
            "content-type": objeto.mime ?? adjunto.mime ?? "application/octet-stream",
            "content-disposition": `attachment; filename="${adjunto.nombre}"`,
            "x-canal-caduca": adjunto.caduca instanceof Date ? adjunto.caduca.toISOString() : "",
            "cache-control": "private, max-age=0, no-store",
          },
        });
      },
    },
    /** `GET /api/archivos/{idadjunto}/firma`: la URL firmada de descarga (vive 15 minutos). */
    firmaArchivo: {
      async handler(this: ServerPlugin, i: ExtraRouteInput) {
        const id = i.params["idadjunto"] ?? "";
        const ctrl = this.controllers["adjuntos"]!;
        const adjunto = await ctrl.get(ctrl.pojo({ idadjunto: id }), { include: {} }) as Adjunto | null;
        if (!adjunto) throw new NotFoundError("El fichero no existe");
        const exp = Math.floor(Date.now() / 1000) + VIDA_FIRMA_MIN * 60;
        const firma = await firmarDescarga(String(this.cfg["secreto"] ?? ""), id, exp);
        const url = new URL(`/api/archivos/${id}/descarga`, baseDe(i.request, this.cfg["urlBase"]));
        url.searchParams.set("exp", String(exp));
        url.searchParams.set("sig", firma);
        return {
          url: url.toString(),
          expira: new Date(exp * 1000).toISOString(),
          caduca: adjunto.caduca instanceof Date ? adjunto.caduca.toISOString() : "",
          vida_horas: VIDA_HORAS,
        };
      },
    },
    /** `GET /api/tunel`: el hostname publico por el que se entra al servicio (lo escribe el conector del tunel). */
    tunel: {
      async handler(this: ServerPlugin) {
        const filas = await this.controllers["tuneles"]!.query({ orderBy: "-actualizado", pageSize: 10 }, {
          include: {},
        }) as Tunel[];
        return { tunel: filas[0] ?? null, tuneles: filas };
      },
    },
    /** `POST /api/tunel`: publica el hostname del tunel (lo hace el conector al arrancar). */
    publicarTunel: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
        const entrada = valido(ZTunel, i.body);
        const ctrl = this.controllers["tuneles"]!;
        const ahora = new Date();
        const idtunel = entrada.idtunel ?? "canal";
        const existe = await ctrl.get(ctrl.pojo({ idtunel }), { include: {} }) as Tunel | null;
        if (existe) {
          return await ctrl.put(
            ctrl.pojo({ idtunel, hostname: entrada.hostname, actualizado: ahora }),
            ctx,
          ) as Tunel;
        }
        return await ctrl.post(
          ctrl.pojo({ idtunel, hostname: entrada.hostname, actualizado: ahora }),
          ctx,
        ) as Tunel;
      },
    },
    /** `GET /api/archivos/{idadjunto}/descarga?exp=&sig=`: la descarga por URL firmada (sin JWT: la firma es el permiso). */
    descargarFirmado: {
      async handler(this: ServerPlugin, i: ExtraRouteInput) {
        const id = i.params["idadjunto"] ?? "";
        const exp = Number(i.query.get("exp") ?? 0);
        const sig = i.query.get("sig") ?? "";
        if (!exp || !sig) throw new HttpError(401, "Falta la firma de la descarga");
        if (exp < Math.floor(Date.now() / 1000)) {
          throw new HttpError(401, "La firma de la descarga ha caducado");
        }
        const ok = await verificarDescarga(String(this.cfg["secreto"] ?? ""), id, exp, sig);
        if (!ok) throw new HttpError(401, "La firma de la descarga no es valida");
        const ctrl = this.controllers["adjuntos"]!;
        const adjunto = await ctrl.get(ctrl.pojo({ idadjunto: id }), { include: {} }) as Adjunto | null;
        if (!adjunto) throw new NotFoundError("El fichero no existe");
        const almacen = this.cfg["almacen"] as AlmacenFicheros | undefined;
        if (!almacen) throw new HttpError(503, "El almacenamiento de ficheros no esta disponible");
        const objeto = await almacen.leer(adjunto.clave ?? "");
        if (!objeto) throw new NotFoundError("El fichero ya no esta (caduca a las 72 horas)");
        return new Response(objeto.cuerpo, {
          headers: {
            "content-type": objeto.mime ?? adjunto.mime ?? "application/octet-stream",
            "content-disposition": `attachment; filename="${adjunto.nombre}"`,
            "x-canal-caduca": adjunto.caduca instanceof Date ? adjunto.caduca.toISOString() : "",
          },
        });
      },
    },
  },
}) as ServerPluginDef;
