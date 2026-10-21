/** Los JSON de UI son válidos (Zod) y coherentes con el DER: entidades, paths de flujos/reportes y relaciones existen. */
import { assert, assertEquals } from "@std/assert";
import { createClient, identity, megaretail, permissions, registry } from "@megaretail/vendor";
import { ZAppUi, ZEntidadUi, ZFlujosUi, ZReportesUi } from "../src/js/consts/schemas/ui.schemas.ts";
import { archivoEntidad } from "../src/js/core/ui-config.ts";
import { APP_TAGS, esTagApp, KIT_TAGS } from "../src/js/kit-tags.ts";

const ui = new URL("../ui/", import.meta.url);
const leer = async (ruta: string) => JSON.parse(await Deno.readTextFile(new URL(ruta, ui)));

// registra las entidades de los tres plugins (igual que el front)
createClient(megaretail, { baseUrl: "/api" });
createClient(identity, { baseUrl: "/api" });
createClient(permissions, { baseUrl: "/api" });

Deno.test("app.json: navegación válida; cada entidad de la nav existe en el DER y cada flujo/reporte en su JSON", async () => {
  const app = ZAppUi.parse(await leer("app.json"));
  const flujos = ZFlujosUi.parse(await leer("flujos.json"));
  const reportes = ZReportesUi.parse(await leer("reportes.json"));
  for (const s of app.nav) {
    for (const e of s.entidades ?? []) assert(registry.has(e), `entidad ${e}`);
    for (const f of s.flujos ?? []) assert(flujos[f], `flujo ${f}`);
    for (const r of s.reportes ?? []) assert(reportes[r], `reporte ${r}`);
  }
  for (const plural of Object.keys(app.entidades)) assert(registry.has(plural), `título de ${plural}`);
});

Deno.test("entidades/*.json: validan y sus campos/columnas existen en el schema (o son extra declarados)", async () => {
  for await (const f of Deno.readDir(new URL("entidades/", ui))) {
    const json = ZEntidadUi.parse(await leer(`entidades/${f.name}`));
    const plural = [...registry.entities()].find(({ key }) => archivoEntidad(key) === `entidades/${f.name}`)?.key;
    assert(plural, `${f.name} no corresponde a una entidad registrada`);
    const meta = registry.entity(plural).meta;
    for (const [campo, def] of Object.entries(json.campos ?? {})) assert(meta.isColumn(campo) || meta.isRelation(campo) || def.extra, `${f.name}: campo ${campo}`);
    for (const col of Object.keys(json.grid?.columnas ?? {})) assert(meta.isColumn(col) || meta.isRelation(col), `${f.name}: columna ${col}`);
  }
});

Deno.test("flujos.json y reportes.json: cada path existe en el plugin del dominio y las relaciones apuntan a entidades", async () => {
  const flujos = ZFlujosUi.parse(await leer("flujos.json"));
  const reportes = ZReportesUi.parse(await leer("reportes.json"));
  const paths = new Set(Object.values(megaretail.entities ?? {}).flatMap((e) => Object.keys(e.paths ?? {})));
  for (const [id, f] of Object.entries(flujos)) {
    assert(paths.has(f.path), `flujo ${id}: path ${f.path}`);
    for (const rel of Object.values(f.schema.relations ?? {}) as { target: string }[]) assert(registry.byName(rel.target), `flujo ${id}: relación → ${rel.target}`);
    for (const [k, c] of Object.entries(f.campos ?? {})) if (c.schema) assert(k === "items", `flujo ${id}: lista ${k}`);
  }
  for (const [id, r] of Object.entries(reportes)) assert(paths.has(r.path), `reporte ${id}: path ${r.path}`);
  assertEquals(Object.keys(flujos).sort(), ["ajustePrecios", "anulacion", "compra", "limpieza", "transferencia", "venta"]);
});

Deno.test("kit-tags: los tags propios llevan el prefijo y no se repiten; los del kit tienen prefijo iswc-", () => {
  for (const t of APP_TAGS) assert(esTagApp(t), t);
  assertEquals(new Set(APP_TAGS).size, APP_TAGS.length);
  for (const t of KIT_TAGS) assert(t.startsWith("iswc-"), t);
});
