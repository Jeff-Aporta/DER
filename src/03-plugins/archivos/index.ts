/**
 * Plugin de gestión de archivos: el JSON TRANSVERSAL. Carpetas y archivos como en un sistema de ficheros; `origin` + `idorigin`
 * relacionan un archivo con una fila de cualquier otra tabla (p. ej. `errores` / `17`). El almacén lo pone el consumidor.
 *
 *   archivos_carpetas (icarpeta, ipadre, nombre, ruta, + auditoría)
 *   archivos (iarchivo, icarpeta, nombre, clave, mime, bytes, ancho, alto, duracion, origin, idorigin, + auditoría)
 *
 * ```ts
 * const archivos = createClient(archivosPlugin, { baseUrl: "/api", headers: auth.headers });
 * const a = await archivos.subirArchivo(blob, { origin: "errores", idorigin: "17" });
 * await archivos.arbolArchivos();  await archivos.moverArchivo(a.iarchivo, { icarpeta: 3 });
 * await archivos.controllers.archivos.query({ where: { origin: "errores", idorigin: "17" } });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/archivos.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { ArbolArchivos, ArchivoPublico, MoverInput, SubirOpciones } from "@Jeff-Aporta/DER/src/03-plugins/archivos/schemas.ts";
import { COLUMNAS_AUDITORIA } from "@Jeff-Aporta/DER/src/03-plugins/common/auditoria.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/archivos/schemas.ts";

/** Query de texto a partir de las opciones (sin los vacíos). */
function aQuery(opciones: Record<string, unknown>): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(opciones)) if (v !== undefined && v !== null) q.set(k, String(v));
  return q;
}

/** JSON transversal de gestión de archivos: carpetas y archivos, con sus paths de operación. */
export const archivosPlugin: PluginDef = {
  name: "archivos",
  entities: {
    carpetas: {
      name: "archivos.carpeta",
      singular: "archivos/carpeta",
      plural: "archivos/carpetas",
      table: "archivos_carpetas",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          icarpeta: { type: "int", pk: true, autoincrement: true },
          ipadre: { type: "int" },
          nombre: { type: "string", length: 200, nullable: false },
          ruta: { type: "string", length: 1000, nullable: false },
          ...COLUMNAS_AUDITORIA,
        },
        relations: {
          padre: { kind: "one", target: "archivos.carpeta", on: { ipadre: "icarpeta" } },
        },
      },
    },
    archivos: {
      name: "archivos.archivo",
      singular: "archivo",
      plural: "archivos",
      table: "archivos",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          iarchivo: { type: "int", pk: true, autoincrement: true },
          icarpeta: { type: "int" },
          nombre: { type: "string", length: 200, nullable: false },
          clave: { type: "string", length: 400, nullable: false, unique: true },
          mime: { type: "string", length: 120, nullable: false },
          bytes: { type: "int", nullable: false },
          ancho: { type: "int" },
          alto: { type: "int" },
          duracion: { type: "decimal", precision: 10, scale: 2 },
          origin: { type: "string", length: 60 },
          idorigin: { type: "string", length: 120 },
          ...COLUMNAS_AUDITORIA,
        },
        relations: {
          carpeta: { kind: "one", target: "archivos.carpeta", on: { icarpeta: "icarpeta" } },
        },
      },
      paths: {
        subirArchivo: {
          method: "POST",
          path: "subir",
          prefix: "plural",
          security: true,
          returns: "json",
          ops: {
            /** `POST archivos/subir?...`: cuerpo binario con el mime en `x-archivo-mime`; devuelve el archivo con su URL firmada. */
            async subirArchivo(this: ClientPlugin, archivo: Blob, opciones: SubirOpciones = {}): Promise<ArchivoPublico> {
              const nombre = opciones.nombre ?? (archivo as Blob & { name?: string }).name ?? "archivo";
              const headers = new Headers(await this.headers());
              headers.set("content-type", "application/octet-stream");
              headers.set("x-archivo-mime", archivo.type || "application/octet-stream");
              const base = String(this.config.baseUrl).replace(/\/+$/, "");
              const hacer = (this.config.fetch ?? fetch) as typeof fetch;
              const res = await hacer(`${base}/archivos/subir?${aQuery({ ...opciones, nombre })}`, { method: "POST", headers, body: archivo });
              const data = await res.json().catch(() => null) as (ArchivoPublico & { error?: string }) | null;
              if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
              return data as ArchivoPublico;
            },
          },
        },
        urlArchivo: {
          method: "GET",
          path: "url",
          prefix: "singular",
          pks: true,
          security: true,
          returns: "json",
          ops: {
            /** `GET archivo/{iarchivo}/url`: el archivo con una URL firmada de corta vida (sirve en `<img>`/`<audio>`). */
            urlArchivo(this: ClientPlugin, iarchivo: number): Promise<ArchivoPublico> {
              return this.call<ArchivoPublico>("urlArchivo", undefined, { iarchivo: String(iarchivo) });
            },
          },
        },
        descargarArchivo: {
          method: "GET",
          path: "descarga",
          prefix: "plural",
          security: false,
          returns: "void",
        },
        moverArchivo: {
          method: "POST",
          path: "mover",
          prefix: "singular",
          pks: true,
          security: true,
          returns: "json",
          ops: {
            /** `POST archivo/{iarchivo}/mover`: cambia de carpeta (`null` = raíz). */
            moverArchivo(this: ClientPlugin, iarchivo: number, input: MoverInput): Promise<ArchivoPublico> {
              return this.call<ArchivoPublico>("moverArchivo", input, { iarchivo: String(iarchivo) });
            },
          },
        },
        arbolArchivos: {
          method: "GET",
          path: "arbol",
          prefix: "plural",
          security: true,
          returns: "json",
          ops: {
            /** `GET archivos/arbol[?icarpeta=]`: contenido de una carpeta (o de la raíz). */
            arbolArchivos(this: ClientPlugin, icarpeta?: number): Promise<ArbolArchivos> {
              return this.call<ArbolArchivos>("arbolArchivos", icarpeta ? { icarpeta: String(icarpeta) } : undefined);
            },
          },
        },
      },
    },
  },
};
