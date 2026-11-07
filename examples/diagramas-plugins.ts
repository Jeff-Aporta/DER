/**
 * Genera `docs/050-Plugins/060-Modelo-de-datos.md` y las fuentes de sus diagramas ER (`docs/999-Adjuntos/010-Diagramas/fuentes/`), con los
 * tipos del kit, derivados de las entidades reales. Los SVG salen de esas fuentes con `deno task diagramas:svg`. `deno task diagramas`, nunca a mano; un guardián comprueba que estén al día.
 */
import { diagramPayloads } from "@Jeff-Aporta/DER/src/01-objects/diagram.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { archivosServer, embeddingsServer, erroresServer, identityServer, penalizacionesServer, permissionsServer } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";

/** Fuentes de los diagramas ER por slug: lo que hay que escribir en `fuentes/`. */
export async function fuentesModelo(): Promise<Record<string, string>> {
  const db = sqliteDatabase();
  const secret = "secreto-solo-para-armar-el-diagrama";
  const entidades = (...planes: ReturnType<typeof createServer>[]) => planes.flatMap((p) => p.list.map((c) => c.entity));
  const er = (slug: string, lista: ReturnType<typeof entidades>): [string, string] => {
    const { er: payload } = diagramPayloads(lista);
    return [slug, `${JSON.stringify({ slug, module: "DER", tag: "iswc-er-diagram", script: "diagrams/er-diagram.min.js", attrs: { "diagram-style": "insoft" }, payload }, null, 1)}\n`];
  };
  const reportes = er("er-reportes", entidades(createServer(archivosServer, { db, cfg: { secret } }), createServer(erroresServer, { db, cfg: { secret } }), createServer(penalizacionesServer, { db, cfg: {} })));
  const seguridad = er("er-seguridad", entidades(createServer(identityServer, { db, cfg: { secret, admin: { usuario: "admin", password: "solo-para-el-diagrama" } } }), createServer(permissionsServer, { db, cfg: { grupo: "API" } })));
  const embeddings = er("er-embeddings", entidades(createServer(embeddingsServer, { db, cfg: { modelos: { m: { id: "x/m", dims: 8, proveedor: "p" } } } })));
  await db.destroy();
  return Object.fromEntries([reportes, seguridad, embeddings]);
}

const imagen = (slug: string, alt: string): string => `[![${alt}](../999-Adjuntos/010-Diagramas/${slug}.svg)](../999-Adjuntos/010-Diagramas/${slug}.svg)`;

/** Texto completo de la hoja. */
export function hojaModelo(): string {
  return [
    "---",
    "Titulo: Modelo de datos de los plugins",
    "Estado: vigente",
    "Autor:",
    "tags: [plugins, diagramas, der, auditoria, seguridad, embeddings]",
    "---",
    "# Modelo de datos de los plugins",
    "",
    "## Relaciones",
    "",
    "- `archivos.icarpeta` → `archivos_carpetas.icarpeta`; `archivos_carpetas.ipadre` → `archivos_carpetas.icarpeta` (árbol).",
    "- **Relación libre:** `archivos.origin` + `archivos.idorigin` apuntan a una fila de cualquier tabla (`errores` / `<ierror>`). No se dibuja como FK porque no lo es.",
    "- **Propiedad:** `propietario_tipo` + `propietario`: un usuario, una página con su ruta o nadie. Tampoco es FK.",
    "- `penalizaciones` no se relaciona con nada: su `id` es el vector (`errores:ip:<ip>`, `errores:global`).",
    "",
    "## Auditoría común",
    "",
    "`archivos`, `archivos_carpetas` y `errores` esparcen `COLUMNAS_AUDITORIA`: `propietario_tipo`, `propietario`, `apporigin`, `iporigin`, `fhcre`, `fhmod`.",
    "",
    "## Archivos, errores y penalizaciones",
    "",
    imagen("er-reportes", "Archivos, errores y penalizaciones"),
    "",
    "## Identidad y permisos",
    "",
    imagen("er-seguridad", "Identidad y permisos"),
    "",
    "## Embeddings",
    "",
    imagen("er-embeddings", "Embeddings"),
    "",
  ].join("\n");
}

if (import.meta.main) {
  await Deno.writeTextFile(new URL("../docs/050-Plugins/060-Modelo-de-datos.md", import.meta.url), hojaModelo());
  for (const [slug, texto] of Object.entries(await fuentesModelo())) await Deno.writeTextFile(new URL(`../docs/999-Adjuntos/010-Diagramas/fuentes/${slug}.json`, import.meta.url), texto);
}
