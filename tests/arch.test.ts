/**
 * Guardianes de arquitectura:
 *  1. Aislamiento de dependencias por dimensión (lo que un consumidor por CDN debe tener instalado).
 *  2. Tipos/interfaces/Zod sólo en archivos `schemas.ts`.
 *  3. Cada entrada consumible (`mod.ts`) referencia el punto de entrada de docs para agentes.
 *  4. Imports relativos con extensión `.ts` (resolubles tal cual desde jsDelivr / raw GitHub).
 */
import { assert, assertEquals } from "@std/assert";

const ROOT = new URL("../", import.meta.url);
const DOCS = "https://cdn.jsdelivr.net/gh/Jeff-Aporta/Controllers@main/docs/README.md";

async function files(dir: URL, out: string[] = []): Promise<string[]> {
  for await (const e of Deno.readDir(dir)) {
    const u = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
    if (e.isDirectory) await files(u, out);
    else if (e.name.endsWith(".ts")) out.push(decodeURIComponent(u.pathname));
  }
  return out;
}

const SRC = (await files(new URL("src/", ROOT))).map((p) => p.slice(p.indexOf("/src/") + 1));
const read = (rel: string) => Deno.readTextFile(new URL(rel.replace(/ /g, "%20"), ROOT));
/** Imports/exports de nivel superior (columna 0): ignora código de navegador dentro de templates HTML. */
const imports = (s: string): string[] => [
  ...[...s.matchAll(/(?:^|\n)(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)].flatMap((m) => (m[1] ? [m[1]] : [])),
  // imports dinámicos (`await import("node:fs/promises")`)
  ...[...s.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].flatMap((m) => (m[1] ? [m[1]] : [])),
];

/** Paquetes externos permitidos por carpeta (el resto de imports deben ser relativos). */
const ALLOWED: [string, string[]][] = [
  ["src/02 controllers/server/pglite/", ["zod", "kysely", "@electric-sql/pglite"]],
  // doc.ts lee fuentes .md locales: sólo módulos node: incluidos en Deno/Node (sin instalar nada).
  ["src/02 controllers/server/doc.ts", ["node:fs/promises", "node:path", "node:process", "node:url"]],
  ["src/02 controllers/server/sqlite/", ["zod", "kysely", "node:sqlite"]],
  ["src/02 controllers/server/", ["zod", "kysely"]],
  ["src/03 plugins/", ["zod", "kysely"]],
  ["src/", ["zod"]],
];

Deno.test("arch: cada dimensión sólo importa sus dependencias", async () => {
  for (const f of SRC) {
    const allowed = ALLOWED.find(([p]) => f.startsWith(p))![1];
    for (const spec of imports(await read(f))) {
      if (spec.startsWith(".")) continue;
      assert(allowed.includes(spec), `${f} importa "${spec}" (permitidos: ${allowed.join(", ")})`);
    }
  }
});

Deno.test("arch: las capas no importan hacia arriba (common ← objects ← controllers; client ⟂ server)", async () => {
  for (const f of SRC) {
    // `import type` se borra al compilar: schemas.ts puede nombrar la clase Pojo sin depender de ella en runtime.
    const src = (await read(f)).replace(/import type [^;]+;/g, "");
    for (const spec of imports(src).filter((s) => s.startsWith("."))) {
      if (f.startsWith("src/00 common/")) assert(!spec.includes("01 objects") && !spec.includes("02 controllers"), `${f} → ${spec}`);
      if (f.startsWith("src/01 objects/")) assert(!spec.includes("03 plugins"), `${f} → ${spec}`);
      if (f.startsWith("src/02 controllers/")) assert(!spec.includes("03 plugins"), `${f} → ${spec}`);
      if (f.startsWith("src/01 objects/")) assert(!spec.includes("02 controllers"), `${f} → ${spec}`);
      if (f.includes("/client/")) assert(!spec.includes("server/"), `${f} → ${spec}`);
      if (f.includes("/server/")) assert(!spec.includes("client/"), `${f} → ${spec}`);
    }
  }
});

Deno.test("arch: imports relativos siempre con extensión .ts", async () => {
  for (const f of SRC) {
    for (const spec of imports(await read(f)).filter((s) => s.startsWith("."))) {
      assert(spec.endsWith(".ts"), `${f}: "${spec}" sin .ts`);
    }
  }
});

Deno.test("arch: types, interfaces y Zod sólo en schemas.ts", async () => {
  const bad: string[] = [];
  for (const f of SRC.filter((f) => !f.endsWith("/schemas.ts"))) {
    const lines = (await read(f)).split("\n");
    lines.forEach((l, i) => {
      if (/^\s*(export\s+)?(declare\s+)?(type|interface)\s+\w+\s*(<|=|\{|extends)/.test(l)) {
        bad.push(`${f}:${i + 1} ${l.trim()}`);
      }
      if (/^\s*(export\s+)?const\s+Z[A-Z]\w*\s*[:=]/.test(l)) bad.push(`${f}:${i + 1} ${l.trim()}`);
    });
  }
  assertEquals(bad, []);
});

Deno.test("arch: toda entrada mod.ts referencia docs/README.md", async () => {
  const entries = ["mod.ts", ...SRC.filter((f) => f.endsWith("/mod.ts"))];
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
  for (const md of all) {
    const text = await Deno.readTextFile(new URL(md.replace(/ /g, "%20"), docsDir));
    assert(/^---\nTitulo: .+\n[\s\S]*?\n---\n/.test(text), `${md} sin frontmatter con Titulo`);
  }
});

/** Cierre transitivo de imports relativos (incluye `import type`: Deno también los descarga al verificar tipos). */
async function closure(entry: string): Promise<Map<string, string[]>> {
  const seen = new Map<string, string[]>();
  const pending = [entry];
  while (pending.length) {
    const rel = pending.pop() ?? "";
    if (seen.has(rel)) continue;
    const text = await read(rel);
    const specs = [...text.matchAll(/(?:^|\n)\s*(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)]
      .flatMap((m) => (m[1] ? [m[1]] : []));
    seen.set(rel, specs.filter((s) => !s.startsWith(".")));
    for (const s of specs.filter((x) => x.startsWith("."))) {
      const parts = [...rel.split("/").slice(0, -1), ...s.split("/")];
      const norm: string[] = [];
      for (const p of parts) p === ".." ? norm.pop() : p !== "." && norm.push(p);
      pending.push(norm.join("/"));
    }
  }
  return seen;
}

Deno.test("arch: las entradas de cliente no alcanzan nada del servidor (ni kysely, pglite o node:)", async () => {
  const entries = [
    "mod.ts",
    "src/02 controllers/client/mod.ts",
    "src/03 plugins/client.ts",
    "src/03 plugins/identity/client.ts",
    "src/03 plugins/permissions/client.ts",
  ];
  for (const entry of entries) {
    for (const [file, externos] of await closure(entry)) {
      assert(!file.includes("02 controllers/server/"), `${entry} alcanza ${file}`);
      assert(!/Controladores\/(server|crypto|rules)\.ts$/.test(file), `${entry} alcanza ${file}`);
      assert(file !== "src/03 plugins/schemas.ts", `${entry} alcanza los contratos de servidor (${file})`);
      for (const ext of externos) assertEquals(ext, "zod", `${entry} → ${file} importa "${ext}"`);
    }
  }
});

Deno.test("arch: cada plugin tiene schemas.ts, Objetos/, Controladores/ (server + client), mod.ts y client.ts", async () => {
  for (const plugin of ["identity", "permissions"]) {
    for (const f of ["schemas.ts", "Objetos/mod.ts", "Controladores/server.ts", "Controladores/client.ts", "mod.ts", "client.ts"]) {
      await Deno.stat(new URL(`src/03 plugins/${plugin}/${f}`.replace(/ /g, "%20"), ROOT));
    }
  }
});
