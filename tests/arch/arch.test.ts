/**
 * Guardianes de arquitectura:
 *  1. Aislamiento de dependencias por dimensión (lo que un consumidor por CDN debe tener instalado).
 *  2. Tipos y Zod sólo en archivos `schemas.ts`; `type` (nunca `interface`) y cada tipo en una línea.
 *  3. Cada entrada consumible (`index.ts`) referencia el punto de entrada de docs para agentes.
 *  4. Imports internos por alias `@Jeff-Aporta/DER/` con `.ts`, uno por línea; lo de iswc por alias `@Jeff-Aporta/wc-*` fijado a SHA.
 *  5. Capas, cliente ⟂ servidor, estructura de plugins y carpetas con al menos dos elementos.
 */
import { assert, assertEquals } from "@std/assert";

const ROOT = new URL("../../", import.meta.url);
const DOCS = "https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md";

async function files(dir: URL, out: string[] = []): Promise<string[]> {
  for await (const e of Deno.readDir(dir)) {
    const u = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
    if (e.isDirectory) await files(u, out);
    else if (e.name.endsWith(".ts")) out.push(decodeURIComponent(u.pathname));
  }
  return out;
}

const SRC = (await files(new URL("src/", ROOT))).map((p) => p.slice(p.indexOf("/src/") + 1));
const read = (rel: string) => Deno.readTextFile(new URL(rel, ROOT));
/** Alias de los imports internos de la librería (lo mapea el import map: el propio y el del consumidor). */
const ALIAS = "@Jeff-Aporta/DER/";
/** Lo de is-webcomponents (Obj, contratos, tipos de diagramas) viene por CDN con estos alias. */
const ISWC = "@Jeff-Aporta/wc-";
const isInternal = (spec: string): boolean => spec.startsWith(ALIAS) || spec.startsWith(".");

const imports = (s: string): string[] => [
  ...[...s.matchAll(/(?:^|\n)(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)].flatMap((m) => (m[1] ? [m[1]] : [])),
  ...[...s.matchAll(/(?:^|\n)import\s+["']([^"']+)["']/g)].flatMap((m) => (m[1] ? [m[1]] : [])),
  ...[...s.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].flatMap((m) => (m[1] ? [m[1]] : [])),
];

/** Paquetes externos permitidos por carpeta/archivo (el resto de imports deben ser internos). */
const ALLOWED: [string, string[]][] = [
  ["src/02-controllers/server/pglite.ts", ["zod", "kysely", "@electric-sql/pglite"]],
  ["src/02-controllers/server/doc.ts", ["node:fs/promises", "node:path", "node:process", "node:url"]],
  ["src/02-controllers/server/sqlite.ts", ["zod", "kysely", "node:sqlite"]],
  ["src/02-controllers/server/", ["zod", "kysely"]],
  ["src/03-plugins/", ["zod", "kysely"]],
  ["src/", ["zod"]],
];

Deno.test("arch: cada dimensión sólo importa sus dependencias", async () => {
  for (const f of SRC) {
    const allowed = ALLOWED.find(([p]) => f.startsWith(p))![1];
    for (const spec of imports(await read(f))) {
      if (isInternal(spec) || spec.startsWith(ISWC)) continue;
      assert(allowed.includes(spec), `${f} importa "${spec}" (permitidos: ${allowed.join(", ")})`);
    }
  }
});

Deno.test("arch: las capas no importan hacia arriba (common ← objects ← controllers ← plugins; client ⟂ server)", async () => {
  for (const f of SRC) {
    // `import type` se borra al compilar: schemas.ts puede nombrar clases de arriba sin depender de ellas en runtime.
    const src = (await read(f)).replace(/import type [^;]+;/g, "");
    for (const spec of imports(src).filter(isInternal)) {
      if (f.startsWith("src/00-common/")) assert(!/01-objects|02-controllers|03-plugins/.test(spec), `${f} → ${spec}`);
      if (f.startsWith("src/01-objects/")) assert(!/02-controllers|03-plugins/.test(spec), `${f} → ${spec}`);
      if (f.startsWith("src/02-controllers/")) assert(!spec.includes("03-plugins"), `${f} → ${spec}`);
      if (f.includes("/client/")) assert(!spec.includes("server/"), `${f} → ${spec}`);
      if (f.includes("/server/")) assert(!spec.includes("client/"), `${f} → ${spec}`);
    }
  }
});

Deno.test("arch: imports internos por alias @Jeff-Aporta/DER/ (nunca relativos), con .ts y uno por línea", async () => {
  for (const f of [...SRC, "index.ts"]) {
    const text = await read(f);
    for (const spec of imports(text).filter(isInternal)) {
      assert(spec.startsWith(ALIAS), `${f}: "${spec}" es relativo; use ${ALIAS}<ruta>`);
      assert(spec.endsWith(".ts"), `${f}: "${spec}" sin .ts`);
    }
    for (const [i, line] of text.split("\n").entries()) {
      assert(!/^(import|export)\s+(type\s+)?\{[^}]*$/.test(line), `${f}:${i + 1} import de varias líneas (1 import = 1 línea)`);
    }
  }
});

Deno.test("arch: lo de iswc viene por alias @Jeff-Aporta/wc-* fijado a un SHA (hermético)", async () => {
  const cfg = JSON.parse(await read("deno.json")) as { imports: Record<string, string> };
  const aliases = Object.entries(cfg.imports).filter(([k]) => k.startsWith(ISWC));
  assert(aliases.length >= 2, "faltan los alias wc-base y wc-diagrams");
  for (const [k, v] of aliases) assert(/is-webcomponents\/[0-9a-f]{40}\//.test(v), `${k} debe fijar un SHA de 40: ${v}`);
  for (const f of SRC) {
    for (const spec of imports(await read(f))) assert(!spec.includes("raw.githubusercontent.com") && !spec.includes("jsdelivr"), `${f} importa por URL directa: use el alias`);
  }
});

Deno.test("arch: types (nunca interface) y Zod sólo en schemas.ts, cada tipo en una línea", async () => {
  const bad: string[] = [];
  for (const f of SRC) {
    const lines = (await read(f)).split("\n");
    const isSchemas = f.endsWith("/schemas.ts");
    lines.forEach((l, i) => {
      if (/^\s*(export\s+)?(declare\s+)?interface\s+\w+/.test(l)) bad.push(`${f}:${i + 1} interface → type: ${l.trim()}`);
      if (!isSchemas && /^\s*(export\s+)?(declare\s+)?type\s+\w+\s*(<|=)/.test(l)) bad.push(`${f}:${i + 1} ${l.trim()}`);
      if (!isSchemas && /^\s*(export\s+)?const\s+Z[A-Z]\w*\s*[:=]/.test(l)) bad.push(`${f}:${i + 1} ${l.trim()}`);
      if (isSchemas && /^(export\s+)?type\s+\w+(<[^>]*>)?\s*=/.test(l) && !/;\s*$/.test(l)) bad.push(`${f}:${i + 1} tipo en varias líneas`);
    });
  }
  assertEquals(bad, []);
});

Deno.test("arch: toda entrada index.ts referencia docs/README.md", async () => {
  const entries = ["index.ts", ...SRC.filter((f) => f.endsWith("/index.ts"))];
  for (const f of entries) assert((await read(f)).includes(DOCS), `${f} no referencia ${DOCS}`);
  await Deno.stat(new URL("docs/README.md", ROOT));
});

Deno.test("arch: docs/index.html lista TODAS las hojas .md y cada una tiene Titulo en su frontmatter", async () => {
  const docsDir = new URL("docs/", ROOT);
  const all: string[] = [];
  const walk = async (dir: URL, prefix: string) => {
    for await (const e of Deno.readDir(dir)) {
      if (e.isDirectory) await walk(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`);
      else if (e.name.endsWith(".md")) all.push(`${prefix}${e.name}`);
    }
  };
  await walk(docsDir, "");
  const html = await Deno.readTextFile(new URL("index.html", docsDir));
  const listed = JSON.parse(/<script type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "[]") as string[];
  assertEquals([...listed].sort(), [...all].sort());
  assertEquals(listed[0], "README.md");
  for (const md of all) assert(/^---\nTitulo: .+\n[\s\S]*?\n---\n/.test(await Deno.readTextFile(new URL(md, docsDir))), `${md} sin frontmatter con Titulo`);
});

/** Cierre transitivo de imports (incluye `import type`: Deno también los descarga al verificar tipos). */
async function closure(entry: string): Promise<Map<string, string[]>> {
  const seen = new Map<string, string[]>();
  const pending = [entry];
  while (pending.length) {
    const rel = pending.pop() ?? "";
    if (seen.has(rel)) continue;
    const text = await read(rel);
    const specs = [...[...text.matchAll(/(?:^|\n)\s*(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)], ...[...text.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)]].flatMap((m) => (m[1] ? [m[1]] : []));
    seen.set(rel, specs.filter((s) => !isInternal(s)));
    for (const s of specs.filter(isInternal)) pending.push(s.slice(ALIAS.length));
  }
  return seen;
}

Deno.test("arch: las entradas de cliente no alcanzan nada del servidor (ni kysely, pglite o node:)", async () => {
  const entries = ["index.ts", "src/02-controllers/client/index.ts", "src/03-plugins/client.ts", "src/03-plugins/identity/index.ts", "src/03-plugins/permissions/index.ts"];
  for (const entry of entries) {
    for (const [file, externos] of await closure(entry)) {
      assert(!file.includes("02-controllers/server/"), `${entry} alcanza ${file}`);
      assert(!/03-plugins\/(common\/crypto|.*\/server|.*\/rules)\.ts$/.test(file), `${entry} alcanza ${file}`);
      for (const ext of externos) if (!ext.startsWith(ISWC)) assertEquals(ext, "zod", `${entry} → ${file} importa "${ext}"`);
    }
  }
});

Deno.test("arch: cada plugin es JSON: schemas.ts, index.ts (transversal) y server.ts (push de particularidades); common/ con crypto y device", async () => {
  for (const plugin of ["identity", "permissions"]) {
    for (const f of ["schemas.ts", "index.ts", "server.ts"]) await Deno.stat(new URL(`src/03-plugins/${plugin}/${f}`, ROOT));
    const index = await read(`src/03-plugins/${plugin}/index.ts`);
    assert(/export const \w+: PluginDef = \{/.test(index), `${plugin}/index.ts debe exportar el JSON transversal (PluginDef)`);
    assert(!/\bclass\b/.test(index.replace(/\/\*[\s\S]*?\*\//g, "")), `${plugin}/index.ts no debe definir clases`);
    const server = await read(`src/03-plugins/${plugin}/server.ts`);
    assert(/export const \w+Server: ServerPluginDef = Obj\.insert\(/.test(server), `${plugin}/server.ts debe ser el transversal con push (Obj.insert)`);
  }
  for (const f of ["crypto.ts", "device.ts"]) await Deno.stat(new URL(`src/03-plugins/common/${f}`, ROOT));
});

Deno.test("arch: ninguna carpeta de src/, tests/ ni specs/ tiene menos de dos elementos (estructura plana)", async () => {
  const pocos: string[] = [];
  const walk = async (dir: URL, rel: string) => {
    const names: string[] = [];
    for await (const e of Deno.readDir(dir)) {
      names.push(e.name);
      if (e.isDirectory) await walk(new URL(`${e.name}/`, dir), `${rel}${e.name}/`);
    }
    if (names.length < 2) pocos.push(`${rel} (${names.length})`);
  };
  for (const top of ["src/", "tests/", "specs/"]) await walk(new URL(top, ROOT), top);
  assertEquals(pocos, []);
});

Deno.test("specs: cada spec del mapa de FOUNDATION existe, tiene IDs [W-*] y ningún ID se repite", async () => {
  const foundation = await read("specs/FOUNDATION.md");
  const mapa = [...foundation.matchAll(/\]\((foundation\/[^)]+\.md)\)/g)].map((m) => m[1]!).filter((p) => !p.includes("_BRIEF"));
  assert(mapa.length >= 6, "el mapa de FOUNDATION.md debe listar las specs");
  const vistos = new Map<string, string>();
  const dup: string[] = [];
  for (const rel of ["specs/FOUNDATION.md", ...mapa.map((p) => `specs/${p}`)]) {
    const text = await read(rel);
    const ids = [...text.matchAll(/\[(W|HW|HS)-[A-Z]+-\d+\]/g)].map((m) => m[0]);
    assert(ids.some((id) => id.startsWith("[W-")), `${rel} sin requisitos [W-*]`);
    for (const id of ids) {
      const previo = vistos.get(id);
      if (previo && previo !== rel) dup.push(`${id} en ${previo} y ${rel}`);
      vistos.set(id, rel);
    }
    const propios = new Set<string>();
    for (const m of text.matchAll(/- \*\*(\[(?:W|HW|HS)-[A-Z]+-\d+\])\*\*/g)) {
      if (propios.has(m[1]!)) dup.push(`${m[1]} repetido en ${rel}`);
      propios.add(m[1]!);
    }
  }
  assertEquals(dup, []);
  await Deno.stat(new URL("specs/W2H.md", ROOT));
});

Deno.test("arch: sin private/protected con nombre (los miembros privados usan #) salvo los abstractos del contrato", async () => {
  const bad: string[] = [];
  for (const f of SRC) {
    (await read(f)).split("\n").forEach((l, i) => {
      if (/^\s+private\s+\w/.test(l)) bad.push(`${f}:${i + 1} ${l.trim()}`);
      if (/^\s+protected\s+(?!abstract|declare|async\s+\*?\w+\(|\*?\w+\()/.test(l)) bad.push(`${f}:${i + 1} ${l.trim()}`);
    });
  }
  assertEquals(bad, []);
});
