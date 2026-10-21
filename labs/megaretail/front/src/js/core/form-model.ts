/**
 * form-model.ts — GENERADOR DE FORMULARIOS (sin DOM): del schema JSON de DER de una entidad (o de un flujo) sale un
 * `FormModel` base (tipo de columna → control; enum → select; fechas ISO; relaciones `one` → selector modal; pks
 * autoincrement y secuencias ocultas/sólo lectura), y encima se aplica el JSON de UI con `Obj.insert` (upsert profundo:
 * convierte un campo en radio, lo oculta, le pone un valor por defecto, agrega campos extra…).
 * También convierte valores formulario ↔ API (fechas locales ↔ ISO 8601 UTC, números) y valida con el Zod de DER.
 */
import { ISO_DATETIME, Obj, type ColumnDef, type Schema, type SchemaZod, zodMessage } from "@Jeff-Aporta/DER/index.ts";
import type { CampoOverride, CampoUi, Control, FormModel, Opcion } from "../consts/schemas/ui.schemas.ts";

/** `id_sede` → `Id sede`, `razon_social` → `Razon social`, `fecha_venta` → `Fecha venta`. */
export function etiquetaDe(nombre: string): string {
  const limpio = nombre.replace(/^id_/, "").replace(/_/g, " ").trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/** Control base según el tipo de columna DER. */
export function controlDe(c: ColumnDef): Control {
  if (c.enum) return "select";
  switch (c.type) {
    case "int":
    case "bigint":
      return "entero";
    case "float":
    case "decimal":
      return "numero";
    case "bool":
      return "bool";
    case "date":
      return "fecha";
    case "datetime":
      return "fechahora";
    case "time":
      return "hora";
    case "text":
      return "textarea";
    case "json":
      return "json";
    default:
      return "texto";
  }
}

/** Opciones de un enum. */
function opcionesDe(c: ColumnDef): Opcion[] | undefined {
  return c.enum?.map((v) => ({ value: String(v), label: String(v) }));
}

/**
 * Modelo base de un schema. `modo` cambia pks/secuencias: al crear se ocultan (las pone el server), al editar quedan
 * de sólo lectura. Las relaciones `one` con una sola columna local convierten esa columna en control `relacion`.
 */
export function modeloDeSchema(schema: Schema, modo: "crear" | "editar" = "crear"): FormModel {
  const pks = schema.primaryKey ? [...schema.primaryKey] : Object.entries(schema.columns).filter(([, c]) => c.pk).map(([k]) => k);
  const campos: Record<string, CampoUi> = {};
  const orden: string[] = [];
  for (const [nombre, c] of Object.entries(schema.columns)) {
    const esPk = pks.includes(nombre);
    const generada = !!c.autoincrement || c.sequence !== undefined;
    const virtual = !!c.virtual;
    const campo: CampoUi = {
      nombre,
      label: etiquetaDe(nombre),
      control: controlDe(c),
      requerido: !virtual && !generada && c.default === undefined && (esPk || c.nullable === false),
      soloLectura: (esPk && modo === "editar") || (generada && modo === "editar"),
      oculto: virtual || (generada && modo === "crear"),
      orden: orden.length,
    };
    const opciones = opcionesDe(c);
    if (opciones) campo.opciones = opciones;
    if (c.default !== undefined && c.default !== null && typeof c.default !== "object") campo.valor = c.default;
    if (c.type === "decimal" || c.type === "float") campo.paso = 0.01;
    if (c.length) campo.max = c.length;
    campos[nombre] = campo;
    orden.push(nombre);
  }
  for (const [nombre, rel] of Object.entries(schema.relations ?? {})) {
    const target = typeof rel.target === "string" ? rel.target : "";
    const pares = Object.entries(rel.on);
    if (rel.kind === "one" && pares.length === 1 && pares[0] && campos[pares[0][0]] && !pks.includes(pares[0][0])) {
      const [local, remoto] = pares[0];
      const campo = campos[local]!;
      campo.control = "relacion";
      campo.label = etiquetaDe(nombre);
      campo.relacion = { entidad: target, kind: "one", local, remoto };
      continue;
    }
    if (rel.kind === "one" && pares.length === 1 && pares[0] && pks.includes(pares[0][0])) {
      // pk que además es FK (tablas puente): selector modal, obligatorio al crear
      const [local, remoto] = pares[0];
      const campo = campos[local]!;
      campo.control = "relacion";
      campo.label = etiquetaDe(nombre);
      campo.relacion = { entidad: target, kind: "one", local, remoto };
      continue;
    }
    if (rel.kind === "many" && pares.length === 1 && pares[0]) {
      const [local, remoto] = pares[0];
      campos[nombre] = { nombre, label: etiquetaDe(nombre), control: "relacion", requerido: false, soloLectura: false, oculto: true, relacion: { entidad: target, kind: "many", local, remoto }, extra: true, orden: orden.length };
      orden.push(nombre);
    }
  }
  return { campos, orden };
}

/**
 * Aplica el JSON de UI sobre el modelo derivado: `Obj.insert` por campo (upsert profundo, lo no mencionado se
 * conserva); un campo del JSON que no existe en el schema se agrega como `extra` (viaja igual en el cuerpo).
 * `orden` del JSON manda sobre el orden derivado; lo que no nombre va después.
 */
export function aplicarUi(base: FormModel, ui: { campos?: Record<string, CampoOverride> | undefined; orden?: string[] | undefined }): FormModel {
  const campos: Record<string, CampoUi> = {};
  for (const [nombre, campo] of Object.entries(base.campos)) campos[nombre] = { ...campo };
  for (const [nombre, cambios] of Object.entries(ui.campos ?? {})) {
    const actual = campos[nombre] ?? { nombre, label: etiquetaDe(nombre), control: "texto", requerido: false, soloLectura: false, oculto: false, extra: true, orden: Object.keys(campos).length };
    campos[nombre] = Obj.insert(actual, cambios) as CampoUi;
    campos[nombre].nombre = nombre;
  }
  const nombrados = ui.orden ?? [];
  const resto = Object.values(campos).filter((c) => !nombrados.includes(c.nombre)).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).map((c) => c.nombre);
  const orden = [...nombrados.filter((n) => campos[n]), ...resto];
  return { campos, orden };
}

/** Campos visibles en el orden de pintado. */
export function camposVisibles(m: FormModel): CampoUi[] {
  return m.orden.map((n) => m.campos[n]!).filter((c) => c && !c.oculto && c.control !== "oculto");
}

// ===================================================================================== valores

/** `2024-02-29T10:00:00.000Z` → `2024-02-29T05:00` (hora local del navegador) para `<iswc-date-time-field>`. */
export function isoALocal(iso: unknown): string {
  if (iso == null || iso === "") return "";
  const d = iso instanceof Date ? iso : new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** `2024-02-29T05:00` (local) → ISO 8601 UTC; vacío → `null`. */
export function localAIso(local: unknown): string | null {
  if (local == null || local === "") return null;
  const s = String(local);
  if (ISO_DATETIME.test(s) && /Z|[+-]\d{2}:?\d{2}$/i.test(s)) return new Date(s).toISOString();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Valor de la API → valor del control. */
export function aControl(campo: CampoUi, v: unknown): unknown {
  if (campo.control === "fechahora") return isoALocal(v);
  if (campo.control === "fecha") return v == null ? "" : String(v).slice(0, 10);
  if (campo.control === "json") return v == null ? "" : JSON.stringify(v, null, 2);
  if (campo.control === "bool") return !!v;
  if (campo.control === "relacion" && campo.relacion?.kind === "many") return Array.isArray(v) ? v : [];
  return v ?? "";
}

/** Valor del control → valor para la API (vacío → `undefined` al crear, `null` al editar un campo no requerido). */
export function aApi(campo: CampoUi, v: unknown, modo: "crear" | "editar"): unknown {
  const vacio = v === "" || v === undefined || v === null;
  if (campo.control === "bool") return !!v;
  if (campo.control === "relacion" && campo.relacion?.kind === "many") return Array.isArray(v) ? v : [];
  if (campo.control === "lista") return Array.isArray(v) ? v : [];
  if (vacio) return modo === "editar" && !campo.requerido ? null : undefined;
  if (campo.control === "entero") return Number.parseInt(String(v), 10);
  if (campo.control === "numero" || campo.control === "relacion") {
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }
  if (campo.control === "fechahora") return localAIso(v);
  if (campo.control === "json") {
    try {
      return JSON.parse(String(v));
    } catch {
      throw new Error(`"${campo.label}" no es JSON válido`);
    }
  }
  return v;
}

/** Cuerpo para la API a partir de los valores de los controles (sólo campos visibles y editables + valores por defecto de los ocultos). */
export function cuerpoDe(m: FormModel, valores: Record<string, unknown>, modo: "crear" | "editar"): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const nombre of m.orden) {
    const campo = m.campos[nombre]!;
    if (campo.oculto || campo.control === "oculto") {
      if (campo.valor !== undefined) out[nombre] = campo.valor;
      else if (valores[nombre] !== undefined && campo.soloLectura) out[nombre] = valores[nombre];
      continue;
    }
    const v = aApi(campo, valores[nombre] ?? campo.valor, modo);
    if (v !== undefined) out[nombre] = v;
  }
  return out;
}

/** Valida el cuerpo con el Zod de DER de la entidad (`insert` al crear, `update` al editar); mensaje o `null`. */
export function validarConZod(zod: SchemaZod, cuerpo: Record<string, unknown>, modo: "crear" | "editar"): string | null {
  const r = (modo === "crear" ? zod.insert : zod.update).safeParse(cuerpo);
  return r.success ? null : zodMessage(r.error);
}

/** Campo al que apunta un mensaje de error de Zod/DER (`"precio_base" debe ser…` → `precio_base`), o `null`. */
export function campoDelError(m: FormModel, mensaje: string): string | null {
  const m1 = /"([A-Za-z_][A-Za-z0-9_]*)"/.exec(mensaje);
  if (m1 && m.campos[m1[1]!]) return m1[1]!;
  const m2 = /^([A-Za-z_][A-Za-z0-9_]*)(?:\.|:)/.exec(mensaje);
  if (m2 && m.campos[m2[1]!]) return m2[1]!;
  return null;
}

/** Texto de una fila según una plantilla `{sku} · {nombre}` (campos faltantes → vacío). */
export function plantilla(texto: string, fila: Record<string, unknown>): string {
  return texto.replace(/\{([A-Za-z_][A-Za-z0-9_.]*)\}/g, (_m, ruta: string) => {
    const v = ruta.split(".").reduce<unknown>((acc, k) => (acc != null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), fila);
    return v == null ? "" : String(v);
  });
}
