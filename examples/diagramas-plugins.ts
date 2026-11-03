/**
 * Genera `docs/050-Plugins/060-Modelo-de-datos.md`: el diagrama ER de los plugins de archivos, errores y penalizaciones con los tipos
 * del kit, derivado de las entidades reales. `deno task diagramas`; un guardián comprueba que la hoja esté al día.
 */
import { diagramPayloads } from "@Jeff-Aporta/DER/src/01-objects/diagram.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { archivosServer, erroresServer, penalizacionesServer } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";

/** Texto completo de la hoja. */
export async function hojaModelo(): Promise<string> {
  const db = sqliteDatabase();
  const secret = "secreto-solo-para-armar-el-diagrama";
  const planes = [createServer(archivosServer, { db, cfg: { secret } }), createServer(erroresServer, { db, cfg: { secret } }), createServer(penalizacionesServer, { db, cfg: {} })];
  const { er } = diagramPayloads(planes.flatMap((p) => p.list.map((c) => c.entity)));
  await db.destroy();
  return [
    "---",
    "Titulo: Modelo de datos de archivos, errores y penalizaciones",
    "Estado: vigente",
    "Autor:",
    "tags: [plugins, diagramas, der, auditoria]",
    "---",
    "# Modelo de datos de archivos, errores y penalizaciones",
    "",
    "[← índice](../README.md) · hoja generada: `deno task diagramas` (no editar a mano)",
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
    "`archivos`, `archivos_carpetas` y `errores` esparcen `COLUMNAS_AUDITORIA` (`src/03-plugins/common/auditoria.ts`): `propietario_tipo`, `propietario`, `apporigin`, `iporigin`, `fhcre`, `fhmod`.",
    "",
    "## Diagrama ER",
    "",
    "Payload declarativo para `<iswc-er-diagram>`:",
    "",
    "```json",
    JSON.stringify(er, null, 2),
    "```",
    "",
  ].join("\n");
}

if (import.meta.main) {
  await Deno.writeTextFile(new URL("../docs/050-Plugins/060-Modelo-de-datos.md", import.meta.url), await hojaModelo());
}
