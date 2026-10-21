/**
 * Documentación servida por los controllers (`/doc` y `/doc?v=1`).
 *
 * - La base es SIEMPRE el md autogenerado (contrato de la entidad / índice del API).
 * - El controller (o el router) puede definir fuentes `.md` (ruta local, `file:` o URL; indistinto) que se
 *   CONCATENAN como secciones al final (sus encabezados bajan un nivel).
 * - `plural/doc` → ese markdown compuesto, en texto plano.
 * - `plural/doc?v=1` → HTML con `<iswc-md-docs-vault>` (kit is-webcomponents por CDN, pineado por SHA).
 * Mismo patrón de página que `ISS-AyudasCPIA/docs/index.html`.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import type { Entity } from "@Jeff-Aporta/DER/src/01-objects/entity.ts";
import { resolvePojo } from "@Jeff-Aporta/DER/src/01-objects/pojo.ts";
import type { ColumnDef, PropagationSpec } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { diagramPayloads, erDiagramPayload } from "@Jeff-Aporta/DER/src/01-objects/diagram.ts";
import type { DocSheet, DocViewOptions } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";

/** Pin del kit iswc (el mismo que usa ISS en su `docs/index.html`). */
export const ISWC_PIN = "f4356a4191357a927eec7659f8ded07c1186288c";
/** Punto de entrada de la documentación de esta librería. */
export const LIB_DOCS = "https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md";

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Lee una fuente `.md`: http(s) por fetch, `file:` o ruta local por el sistema de archivos. */
export async function readDocSource(source: string, base?: string | URL): Promise<string> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`doc: ${source} respondió ${res.status}`);
    return await res.text();
  }
  // node: se importa en diferido: el core carga en runtimes sin sistema de archivos (Workers) si no hay fuentes locales.
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  if (source.startsWith("file:")) return await readFile(fileURLToPath(source), "utf8");
  if (base instanceof URL || (typeof base === "string" && URL_RE.test(base))) {
    return await readDocSource(new URL(source, base).href);
  }
  const { isAbsolute, resolve } = await import("node:path");
  const { cwd } = await import("node:process");
  const path = isAbsolute(source) ? source : resolve(base ?? cwd(), source);
  return await readFile(path, "utf8");
}

/** Slug legible para el nombre de una hoja (el visor lo usa como título). */
export function slug(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Baja un nivel todos los encabezados (`#` → `##`, hasta `######`), sin tocar bloques de código. */
export function demoteHeadings(md: string): string {
  let fence = false;
  return md.split(/\r?\n/).map((line) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return line;
    return line.replace(/^(#{1,5})(\s)/, "#$1$2");
  }).join("\n");
}

/** Markdown compuesto: el autogenerado como base y cada fuente concatenada como sección. */
export function composeDoc(base: string, sections: string[]): string {
  const parts = [base.trimEnd(), ...sections.map((s) => demoteHeadings(s.trim()))].filter(Boolean);
  return parts.join("\n\n") + "\n";
}

/** Lee las fuentes `.md` (en orden) y las concatena como secciones sobre el md autogenerado. */
export async function composeFromSources(base: string, sources: string[], docBase?: string | URL): Promise<string> {
  const sections = await Promise.all(sources.map((s) => readDocSource(s, docBase)));
  return composeDoc(base, sections);
}

const cell = (v: unknown): string => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function columnNotes(c: ColumnDef): string {
  const notes: string[] = [];
  if (c.autoincrement) notes.push("autoincrement");
  if (c.unique) notes.push("unique");
  if (c.virtual) notes.push("virtual (calculada en el server)");
  if (c.length) notes.push(`máx ${c.length}`);
  if (c.enum) notes.push(`uno de: ${c.enum.join(", ")}`);
  if (c.zod) notes.push("molde Zod");
  if (c.sequence) notes.push(c.sequence === true || !c.sequence.scope ? "secuencia" : `secuencia por ${c.sequence.scope.join(", ")}`);
  return notes.join("; ");
}

/** Markdown del contrato de una entidad, generado desde la definición compartida. */
export function entityContractMd(
  entity: Entity<any>,
  opts: {
    table?: string;
    basePath?: string;
    entities?: Entity<any>[];
    propagations?: PropagationSpec;
    diagram?: boolean;
    /** ¿El server expone `plural/cfg`? (necesita la tabla de cfg). Default: si la entidad define `cfg`. */
    cfg?: boolean;
  } = {},
): string {
  const meta = entity.meta;
  const base = (opts.basePath ?? "").replace(/\/+$/, "");
  const S = `${base}/${entity.singularPath.join("/")}`;
  const L = `${base}/${entity.pluralPath.join("/")}`;
  const P = meta.pks.map((k) => `{${k}}`).join("/");
  const out: string[] = [];
  out.push(`# ${entity.singular} · ${entity.plural}`, "");
  out.push(
    `> Contrato generado por Controllers desde la definición compartida de la entidad.` +
      (opts.table ? ` Tabla: \`${opts.table}\`.` : "") + ` Librería: [docs](${LIB_DOCS}).`,
    "",
  );

  out.push("## Rutas", "", "| acción | método | ruta | parámetro |", "| --- | --- | --- | --- |");
  const rows: [string, string, string, string][] = [
    ["get", "GET", `${S}/${P}`, "pks (`?include=<json>`)"],
    ["post", "POST", S, "pojo (body)"],
    ["put", "PUT", `${S}/${P}`, `pojo parcial (body) · modo \`${meta.schema.put ?? "insert"}\``],
    ["delete", "DELETE", `${S}/${P}`, "pks"],
    ["list", "GET", L, "—"],
    ["query", "POST · GET `?q=`", `${L}/query`, "QuerySpec"],
    ["postList", "POST", L, "pojo[]"],
    ["putList", "PUT", L, "pojo[]"],
    ["deleteList", "DELETE", L, "pojo[] (pks)"],
  ];
  for (const [name, ep] of Object.entries(entity.endpoints)) {
    const seg = ep.path ?? name;
    rows.push([
      name,
      ep.method,
      ep.scope === "one" ? `${S}/${P}/${seg}` : `${L}/${seg}`,
      `${ep.scope === "one" ? "pojo" : "pojo[]"} → ${ep.returns ?? "json"}`,
    ]);
  }
  const conCfg = opts.cfg ?? Boolean(entity.def.cfg);
  if (conCfg) {
    rows.push(["getCfg", "GET", `${L}/cfg`, "→ JSON de la entidad"]);
    rows.push(["putCfg", "PUT", `${L}/cfg`, "JSON parcial (`Obj.update`) → JSON"]);
  }
  rows.push(["doc", "GET", `${L}/doc`, "→ markdown"], ["docView", "GET", `${L}/doc?v=1`, "→ HTML"]);
  for (const r of rows) out.push(`| ${r.map(cell).join(" | ")} |`);
  out.push("", "Cualquier acción admite su variante Server-Sent Events agregando `/sse` (si el server la define).", "");

  out.push("## Columnas", "", "| campo | tipo | pk | nulo | default | notas |", "| --- | --- | --- | --- | --- | --- |");
  for (const [k, c] of Object.entries(meta.columns)) {
    const isPk = meta.pks.includes(k);
    const nullable = !isPk && c.nullable !== false;
    const def = c.default === undefined ? "" : typeof c.default === "object" && c.default !== null
      ? `SQL: ${c.default.sql}`
      : JSON.stringify(c.default);
    out.push(`| ${[k, c.type, isPk ? "sí" : "", nullable ? "sí" : "no", def, columnNotes(c)].map(cell).join(" | ")} |`);
  }
  out.push("");

  const rels = Object.entries(meta.relations);
  const relationTargets = new Set<string>([entity.name]);
  if (rels.length) {
    out.push("## Relaciones", "", "| relación | tipo | destino | on |", "| --- | --- | --- | --- |");
    for (const [k, r] of rels) {
      let target = typeof r.target === "string" ? r.target : "";
      try {
        target ||= resolvePojo(r.target).name;
      } catch { /* sin resolver */ }
      if (target) relationTargets.add(target);
      const on = Object.entries(r.on).map(([a, b]) => `${a} = ${b}`).join(", ");
      out.push(`| ${[k, r.kind === "many" ? "1:N (arreglo)" : "1:1 (objeto)", target, on].map(cell).join(" | ")} |`);
    }
    out.push("", "Se incluyen con `include` (JData): `true`, objeto anidado o `\"*\"` para todas.", "");
  }

  if (opts.diagram !== false) {
    const pool = opts.entities ?? [entity];
    const sub = pool.filter((e) => relationTargets.has(e.name));
    const payload = erDiagramPayload(sub.length ? sub : [entity], {
      title: entity.singular,
      ...(opts.propagations !== undefined ? { propagations: opts.propagations } : {}),
    });
    out.push(
      "## Diagrama",
      "",
      "Payload declarativo para `<iswc-er-diagram>` (JSON dentro de `<script type=\"application/json\">`):",
      "",
      "```json",
      prettyJson(payload),
      "```",
      "",
    );
  }

  out.push("## Consulta", "");
  out.push(`- \`list()\` columnas: ${entity.listColumns.map((c) => `\`${c}\``).join(", ")}.`);
  out.push(`- \`query()\` pageSize ${entity.pageSize} (máx ${entity.maxPageSize}); orden por defecto: pks.`);
  if (entity.def.getInclude) out.push(`- \`get()\` include por defecto: \`${JSON.stringify(entity.def.getInclude)}\`.`);
  out.push(`- \`put\` singular: el cuerpo se aplica sobre el registro actual en modo \`${meta.schema.put ?? "insert"}\` (\`schema.put\`).`);
  if (conCfg) {
    out.push("- `plural/cfg`: configuración de la entidad (valores por defecto), tipada con su molde Zod; el PUT sólo ajusta llaves que el molde define (`Obj.update`). Los singulares no tienen `/cfg`.");
  }
  const hooks = Object.keys(entity.hooks);
  if (hooks.length) out.push(`- Verificaciones compartidas: ${hooks.map((h) => `\`${h}\``).join(", ")}.`);
  out.push("");
  return out.join("\n");
}

const json = (v: unknown): string =>
  JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** JSON indentado y seguro para incrustar en markdown. */
const prettyJson = (v: unknown): string => JSON.stringify(v, null, 2).replace(/</g, "\\u003c");

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/**
 * Página HTML con `<iswc-md-docs-vault>` y las hojas embebidas.
 * El visor se crea por script con sus hojas ya adentro, antes de que el loader defina el tag.
 */
export function vaultHtml(sheets: DocSheet[], title: string, view: DocViewOptions = {}): string {
  const pin = view.pin ?? ISWC_PIN;
  if (!/^[0-9a-f]{40}$/.test(pin)) throw new Error("docView.pin debe ser un SHA de 40 caracteres");
  const cdn = `https://cdn.jsdelivr.net/gh/Jeff-Aporta/is-webcomponents@${pin}/dist/cdn`;
  const theme = view.theme ?? "light";
  const palette = view.palette ?? "contapyme";
  const main = sheets[0]?.path ?? "README.md";
  return [
    "<!DOCTYPE html>",
    `<html lang="es" data-theme="${escapeHtml(theme)}" data-palette="${escapeHtml(palette)}">`,
    "<head>",
    "  <meta charset=\"UTF-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `  <title>${escapeHtml(title)}</title>`,
    "  <meta name=\"robots\" content=\"noindex\">",
    "  <style>",
    "    html[data-theme=\"dark\"] { background: #0f1520; color: #e7eef8; }",
    "    html[data-theme=\"light\"] { background: #f4f7fb; color: #142033; }",
    "  </style>",
    `  <link rel="stylesheet" href="${cdn}/core/is-base.min.css">`,
    `  <link rel="stylesheet" href="${cdn}/core/palettes.min.css">`,
    "  <style>",
    "    html, body { margin: 0; height: 100%; }",
    "    body { background: var(--iswc-bg); color: var(--iswc-text); }",
    "    iswc-md-docs-vault { display: block; height: 100vh; height: 100dvh; }",
    "    .marca { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }",
    "    .marca strong { font: 600 15px system-ui, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    "    .marca span { font: 12px system-ui, sans-serif; color: var(--iswc-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    "    iswc-theme-toggle:not(:defined), iswc-palette-selector:not(:defined) { visibility: hidden; }",
    "  </style>",
    "  <script type=\"module\">",
    `    import { initApp } from '${cdn}/core/app-init.min.js';`,
    `    initApp({ theme: ${json(theme)}, palette: ${json(palette)} });`,
    "  </script>",
    `  <script type="module" src="${cdn}/core/loader.min.js"></script>`,
    "</head>",
    "<body>",
    `  <script type="application/json" id="doc-data">${json({ title, main, sheets })}</script>`,
    "  <script type=\"module\">",
    "    const data = JSON.parse(document.getElementById('doc-data').textContent);",
    "    const vault = document.createElement('iswc-md-docs-vault');",
    "    vault.id = 'vault';",
    "    vault.setAttribute('main', data.main);",
    "    const marca = document.createElement('div');",
    "    marca.slot = 'brand';",
    "    marca.className = 'marca';",
    "    const strong = document.createElement('strong');",
    "    strong.textContent = data.title;",
    "    const hoja = document.createElement('span');",
    "    hoja.textContent = 'Documentación';",
    "    marca.append(strong, hoja);",
    "    const palette = document.createElement('iswc-palette-selector');",
    "    palette.slot = 'actions';",
    "    palette.setAttribute('scope', 'root');",
    "    const theme = document.createElement('iswc-theme-toggle');",
    "    theme.slot = 'actions';",
    "    theme.setAttribute('scope', 'root');",
    "    theme.setAttribute('dark', 'true');",
    "    const list = document.createElement('script');",
    "    list.type = 'application/json';",
    "    list.textContent = JSON.stringify(data.sheets.map((s) => s.path));",
    "    vault.append(marca, palette, theme, list);",
    "    for (const s of data.sheets) {",
    "      const md = document.createElement('script');",
    "      md.type = 'text/markdown';",
    "      md.dataset.path = s.path;",
    "      md.textContent = s.content;",
    "      vault.append(md);",
    "    }",
    "    vault.addEventListener('iswc-md-docs-vault-page', (e) => {",
    "      hoja.textContent = e.detail.titulo;",
    "      document.title = e.detail.titulo + ' · ' + data.title;",
    "    });",
    "    document.body.append(vault);",
    "    for (let i = 0; i < 100 && !globalThis.iswcLoader; i++) await new Promise((r) => setTimeout(r, 30));",
    "    const L = globalThis.iswcLoader;",
    "    if (L) await Promise.all(['iswc-md-docs-vault', 'iswc-theme-toggle', 'iswc-palette-selector'].map((t) => L.ensure(t).catch(() => false)));",
    "  </script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Índice general del API: una línea por entidad con sus rutas de documentación y su contrato. */
export function apiIndexMd(
  entities: Entity<any>[],
  basePath = "",
  opts: { title?: string; propagations?: PropagationSpec; diagram?: boolean } = {},
): string {
  const base = basePath.replace(/\/+$/, "");
  const out: string[] = ["# API · Documentación", ""];
  out.push(
    `> Generado por Controllers. Cada entidad expone \`plural/doc\` (markdown) y \`plural/doc?v=1\` (vista).` +
      ` Librería: [docs](${LIB_DOCS}).`,
    "",
    "| entidad | singular | plural | doc | hoja |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const e of entities) {
    const L = e.pluralPath.join("/");
    out.push(
      `| ${cell(e.name)} | \`${base}/${e.singularPath.join("/")}\` | \`${base}/${L}\` | \`${base}/${L}/doc\` | [${cell(e.plural)}](${entitySheetPath(e)}) |`,
    );
  }
  out.push("");
  if (opts.diagram !== false) {
    const { er, class: cls } = diagramPayloads(entities, {
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.propagations !== undefined ? { propagations: opts.propagations } : {}),
    });
    out.push(
      "## Diagrama ER",
      "",
      "Payload declarativo para `<iswc-er-diagram>`:",
      "",
      "```json",
      prettyJson(er),
      "```",
      "",
      "## Diagrama de clases",
      "",
      "Payload declarativo para `<iswc-class-diagram>`:",
      "",
      "```json",
      prettyJson(cls),
      "```",
      "",
    );
  }
  return out.join("\n");
}

/** Ruta de la hoja de una entidad en el libro (`productos.md`, `pedido-lineas.md`). */
export function entitySheetPath(entity: Entity<any>): string {
  return `${slug(entity.plural) || slug(entity.name) || "entidad"}.md`;
}
