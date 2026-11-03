/**
 * Plugin de gestión de archivos (server): las filas, las rutas y las URLs firmadas. Los bytes los mueve el almacén que vincula el
 * consumidor (`services.almacen` o `servicios.vincular("almacen", …)`): DER no conoce ningún servicio de almacenamiento.
 *
 * ```ts
 * const archivos = createServer(archivosServer, { db, cfg: { secret: "env:JWT_SECRET" }, services: { almacen: miAlmacen } });
 * const fila = await archivos.guardar({ bytes, nombre: "captura.png", mime: "image/png", origin: "errores", idorigin: "17" }, ctx);
 * await archivos.publico(fila, ctx);          // con URL firmada
 * await archivos.olvidarDe("errores", ["17"]); // borra filas y objetos
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/archivos.md
 */
import type { z } from "zod";
import { HttpError, NotFoundError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { archivosPlugin } from "@Jeff-Aporta/DER/src/03-plugins/archivos/index.ts";
import { type AlmacenArchivos, type ArbolArchivos, type Archivo, type ArchivoPublico, type ArchivosConfig, type Carpeta, type DatosGuardar, EXTENSIONES_BLOQUEADAS, MIMES_BLOQUEADOS, type PoliticaArchivos, ZArchivosConfig, ZMoverInput, ZSubirQuery } from "@Jeff-Aporta/DER/src/03-plugins/archivos/schemas.ts";
import { selloAlta, selloCambio } from "@Jeff-Aporta/DER/src/03-plugins/common/auditoria.ts";
import { firmarHmac, verificarHmac } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { ipReal, servicioDe } from "@Jeff-Aporta/DER/src/03-plugins/common/servicios.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/archivos/index.ts";

const MEGA = 1024 * 1024;
/** Plugin dueño de cada controller, para los hooks. */
const plugins = new WeakMap<object, ServerPlugin>();

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

/** Nombre seguro para la clave (sin rutas ni caracteres raros, máximo 80). */
export function nombreSeguro(nombre: string): string {
  const base = nombre.split(/[\\/]/).pop() ?? "archivo";
  const limpio = base.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return (limpio || "archivo").slice(-80);
}

/** Motivo de rechazo de un archivo (o `null` si se acepta): vacío, muy grande o ejecutable. */
export function motivoRechazo(nombre: string, mime: string, bytes: number, maxBytes: number): string | null {
  if (bytes <= 0) return "El archivo está vacío";
  if (bytes > maxBytes) return `El archivo supera ${Math.round(maxBytes / MEGA)} MB`;
  const ext = nombre.toLowerCase().split(".").pop() ?? "";
  if (nombre.includes(".") && (EXTENSIONES_BLOQUEADAS as readonly string[]).includes(ext)) return `Tipo de archivo bloqueado (.${ext})`;
  if ((MIMES_BLOQUEADOS as readonly string[]).includes(mime.toLowerCase())) return `Tipo de archivo bloqueado (${mime})`;
  return null;
}

/** Lee el binario del request: cuerpo crudo o primer archivo de un multipart. */
export async function leerBinario(req: Request, nombreDado?: string): Promise<{ bytes: Uint8Array; nombre: string; mime: string }> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const archivo = [...form.values()].find((v): v is File => typeof v !== "string");
    if (!archivo) throw new ValidationError("El formulario no trae archivo");
    return { bytes: new Uint8Array(await archivo.arrayBuffer()), nombre: nombreDado ?? archivo.name ?? "archivo", mime: archivo.type || "application/octet-stream" };
  }
  const mime = req.headers.get("x-archivo-mime")?.trim() || ct.split(";")[0]!.trim() || "application/octet-stream";
  return { bytes: new Uint8Array(await req.arrayBuffer()), nombre: nombreDado ?? "archivo", mime };
}

/** El almacén vinculado, o 503. */
function almacenDe(p: ServerPlugin): AlmacenArchivos {
  const a = servicioDe<AlmacenArchivos>(p, "almacen");
  if (!a) throw new HttpError(503, "Almacenamiento de archivos no disponible");
  return a;
}

/** Origen HTTP y basePath del request: de ahí sale la URL de descarga. */
function baseDe(ctx: Partial<ServerCtx>): string {
  const origen = ctx.request ? new URL(ctx.request.url).origin : "";
  return `${origen}${(ctx.state?.["basePath"] as string | undefined) ?? ""}`;
}

/** JSON del server de gestión de archivos: `archivosPlugin` + handlers, hooks y `ops`. */
export const archivosServer: ServerPluginDef = Obj.insert(archivosPlugin, {
  cfg: ZArchivosConfig,
  entities: {
    archivos: {
      hooks: {
        /** Cada fila borrada se lleva su objeto del almacén (también por CRUD). */
        async afterDelete(this: ServerController<any>, fila: Archivo) {
          const p = plugins.get(this);
          if (p && fila?.clave) await almacenDe(p).borrar(String(fila.clave)).catch((e: unknown) => console.error("[archivos] borrar objeto", String(e)));
        },
        /** Igual en el borrado en plural. */
        async afterDeleteList(this: ServerController<any>, filas: Archivo[]) {
          const p = plugins.get(this);
          if (p) await Promise.all(filas.filter((f) => f?.clave).map((f) => almacenDe(p).borrar(String(f.clave)).catch((e: unknown) => console.error("[archivos] borrar objeto", String(e)))));
        },
      },
      indexes: [{ columns: ["origin", "idorigin"], name: "ix_archivos_origen" }],
      paths: {
        subirArchivo: {
          /** Valida tamaño y tipo, deja que la política autorice y guarda objeto + fila. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
            const q = validado(ZSubirQuery, Object.fromEntries(i.query));
            const politica = servicioDe<PoliticaArchivos>(this, "politicaArchivos");
            const decision = await politica?.alSubir?.(q, ctx);
            const maxBytes = await politica?.limiteBytes?.(ctx) ?? (this.cfg as ArchivosConfig).maxMb * MEGA;
            const largo = Number(i.request.headers.get("content-length") ?? 0);
            if (largo > maxBytes + 64 * 1024) throw new HttpError(413, `El archivo supera ${Math.round(maxBytes / MEGA)} MB`);
            const cabecera = i.request.headers.get("x-archivo-nombre");
            const { bytes, nombre, mime } = await leerBinario(i.request, q.nombre ?? (cabecera ? decodeURIComponent(cabecera) : undefined));
            const fila = await this["guardar"]({ bytes, nombre, mime, icarpeta: q.icarpeta ?? null, origin: q.origin ?? null, idorigin: q.idorigin ?? null, ancho: q.ancho ?? null, alto: q.alto ?? null, duracion: q.duracion ?? null, maxBytes, ...(decision ?? {}) }, ctx);
            return await this["publico"](fila, ctx);
          },
        },
        urlArchivo: {
          /** URL firmada, si la política (o ser dueño) lo permite. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
            const fila = await this.controllers["archivos"]!.get({ iarchivo: Number(i.params["iarchivo"]) }, { ...ctx, include: {} }) as Archivo | null;
            if (!fila) throw new NotFoundError(`El archivo ${i.params["iarchivo"]} no existe`);
            if (!(await this["puedeVer"](fila, ctx))) throw new HttpError(403, "No tienes acceso a este archivo");
            return await this["publico"](fila, ctx);
          },
        },
        descargarArchivo: {
          /** `GET archivos/descarga?clave=&exp=&sig=`: pública pero firmada, así sirve en `<img>`/`<audio>`. */
          async handler(this: ServerPlugin, i: ExtraRouteInput) {
            const clave = i.query.get("clave") ?? "";
            const exp = Number(i.query.get("exp"));
            const sig = i.query.get("sig") ?? "";
            if (!clave || !Number.isInteger(exp) || !sig) throw new ValidationError("Falta la firma");
            const ahora = Math.floor(Date.now() / 1000);
            if (exp < ahora) throw new HttpError(403, "El enlace venció");
            if (!(await verificarHmac((this.cfg as ArchivosConfig).secret, `archivo:${clave}:${exp}`, sig))) throw new HttpError(403, "Firma inválida");
            const obj = await almacenDe(this).bajar(clave);
            if (!obj) throw new NotFoundError("No encontrado");
            const nombre = clave.split("/").pop() ?? "archivo";
            const headers = new Headers({ "content-type": obj.mime ?? "application/octet-stream", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`, "cache-control": `private, max-age=${Math.max(0, exp - ahora)}`, "x-content-type-options": "nosniff" });
            if (obj.bytes !== undefined) headers.set("content-length", String(obj.bytes));
            return new Response(i.request.method === "HEAD" ? null : obj.cuerpo, { status: 200, headers });
          },
        },
        moverArchivo: {
          /** Cambia de carpeta. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx) {
            const { icarpeta } = validado(ZMoverInput, i.body);
            const ctrl = this.controllers["archivos"]!;
            const fila = await ctrl.get({ iarchivo: Number(i.params["iarchivo"]) }, { ...ctx, include: {} }) as Archivo | null;
            if (!fila) throw new NotFoundError(`El archivo ${i.params["iarchivo"]} no existe`);
            if (!(await this["puedeVer"](fila, ctx))) throw new HttpError(403, "No tienes acceso a este archivo");
            const nueva = await ctrl.put(ctrl.pojo({ iarchivo: fila.iarchivo, icarpeta, ...selloCambio() }), ctx) as Archivo;
            return await this["publico"](nueva, ctx);
          },
        },
        arbolArchivos: {
          /** Contenido de una carpeta: subcarpetas y archivos visibles, con su URL. */
          async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<ArbolArchivos> {
            const dato = i.query.get("icarpeta");
            const icarpeta = dato ? Number(dato) : null;
            const carpeta = icarpeta ? await this.controllers["carpetas"]!.get({ icarpeta }, { ...ctx, include: {} }) as Carpeta | null : null;
            if (icarpeta && !carpeta) throw new NotFoundError(`La carpeta ${icarpeta} no existe`);
            const [carpetas, filas] = await Promise.all([
              this.controllers["carpetas"]!.query({ where: { ipadre: icarpeta }, orderBy: "nombre", pageSize: 200 }, { ...ctx, include: {} }) as Promise<Carpeta[]>,
              this.controllers["archivos"]!.query({ where: { icarpeta }, orderBy: "nombre", pageSize: 200 }, { ...ctx, include: {} }) as Promise<Archivo[]>,
            ]);
            const visibles = [];
            for (const f of filas) if (await this["puedeVer"](f, ctx)) visibles.push(f);
            return { carpeta, carpetas, archivos: await Promise.all(visibles.map((f) => this["publico"](f, ctx) as Promise<ArchivoPublico>)) };
          },
        },
      },
    },
    carpetas: {
      hooks: {
        /** La ruta se deriva del padre; el consumidor nunca la escribe a mano. */
        async prePost(this: ServerController<any>, c: Carpeta, ctx: ServerCtx) {
          const padre = c.ipadre ? await this.get({ icarpeta: c.ipadre }, { ...ctx, include: {} }) as Carpeta | null : null;
          if (c.ipadre && !padre) return `La carpeta padre ${c.ipadre} no existe`;
          c.ruta = `${padre?.ruta ?? ""}/${c.nombre}`;
          const p = plugins.get(this);
          Object.assign(c, selloAlta(ctx, { ip: p ? ipReal(p, ctx.request) : null }));
          return null;
        },
      },
      indexes: [{ columns: ["ipadre", "nombre"], unique: true, name: "ux_archivos_carpetas_nombre" }],
    },
  },
  setup(this: ServerPlugin) {
    for (const c of this.list) plugins.set(c, this);
    /** Guarda objeto + fila; si la fila falla, borra el objeto (D1 no tiene transacciones). */
    this["guardar"] = async (d: DatosGuardar, ctx: Partial<ServerCtx> = {}): Promise<Archivo> => {
      const cfg = this.cfg as ArchivosConfig;
      const motivo = motivoRechazo(d.nombre, d.mime, d.bytes.length, d.maxBytes ?? cfg.maxMb * MEGA);
      if (motivo) throw new HttpError(d.bytes.length > (d.maxBytes ?? cfg.maxMb * MEGA) ? 413 : 415, motivo);
      const fecha = new Date();
      const prefijo = d.prefijo ?? d.origin ?? "general";
      const clave = `${prefijo}/${fecha.getUTCFullYear()}/${String(fecha.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}-${nombreSeguro(d.nombre)}`;
      const almacen = almacenDe(this);
      await almacen.subir(clave, d.bytes, { mime: d.mime, nombre: d.nombre.slice(0, 200) });
      const ctrl = this.controllers["archivos"]!;
      try {
        return await ctrl.post(ctrl.pojo({ ...selloAlta(ctx, { apporigin: d.apporigin, pagina: d.pagina, ip: d.ip ?? ipReal(this, ctx.request) }), ...d.extras, clave, nombre: d.nombre.slice(0, 200), mime: d.mime.slice(0, 120), bytes: d.bytes.length, icarpeta: d.icarpeta ?? null, origin: d.origin ?? null, idorigin: d.idorigin ?? null, ancho: d.ancho ?? null, alto: d.alto ?? null, duracion: d.duracion ?? null }), ctx) as Archivo;
      } catch (err) {
        await almacen.borrar(clave);
        throw err;
      }
    };
    /** La fila como la ve un cliente, con URL firmada de corta vida. */
    this["publico"] = async (a: Archivo, ctx: Partial<ServerCtx> = {}, base?: string): Promise<ArchivoPublico> => {
      const cfg = this.cfg as ArchivosConfig;
      const clave = String(a.clave);
      const exp = Math.floor(Date.now() / 1000) + cfg.ttlSeg;
      const sig = await firmarHmac(cfg.secret, `archivo:${clave}:${exp}`);
      const q = new URLSearchParams({ clave, exp: String(exp), sig });
      return { iarchivo: Number(a.iarchivo), nombre: String(a.nombre), mime: String(a.mime), bytes: Number(a.bytes), ancho: a.ancho == null ? null : Number(a.ancho), alto: a.alto == null ? null : Number(a.alto), duracion: a.duracion == null ? null : Number(a.duracion), origin: a.origin ?? null, idorigin: a.idorigin ?? null, url: `${base ?? baseDe(ctx)}/archivos/descarga?${q}`, expira: new Date(exp * 1000).toISOString() };
    };
    /** ¿La sesión ve este archivo? La política manda; sin ella, lo propio y lo que no tiene dueño usuario. */
    this["puedeVer"] = async (a: Archivo, ctx: ServerCtx): Promise<boolean> => {
      const politica = servicioDe<PoliticaArchivos>(this, "politicaArchivos");
      if (politica?.puedeVer) return await politica.puedeVer(a, ctx);
      if (a.propietario_tipo !== "usuario") return true;
      return String(ctx.session?.id ?? "") === String(a.propietario);
    };
    /** Archivos relacionados con filas de otra tabla. */
    this["archivosDe"] = (origin: string, ids: (string | number)[]): Promise<Archivo[]> => {
      return this.controllers["archivos"]!.query({ where: { origin, idorigin: { in: ids.map(String) } }, pageSize: this.controllers["archivos"]!.entity.maxPageSize }) as Promise<Archivo[]>;
    };
    /** Borra los archivos de esas filas (objeto + fila); devuelve cuántos. */
    this["olvidarDe"] = async (origin: string, ids: (string | number)[]): Promise<number> => {
      const filas = await this["archivosDe"](origin, ids) as Archivo[];
      await Promise.all(filas.map((f) => this.controllers["archivos"]!.delete({ iarchivo: f.iarchivo })));
      return filas.length;
    };
  },
}) as ServerPluginDef;
