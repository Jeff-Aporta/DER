/**
 * componentes.schemas.ts — props de cada componente `mr-*` y tipos estructurales de los elementos del kit que la app toca
 * (uno por línea). Los elementos del kit se tipan por lo que se usa de ellos: nada de `as any`.
 */
import type { QuerySpec } from "@Jeff-Aporta/DER/index.ts";
import type { CampoUi, ColumnaUi, FlujoUi, FormModel, ReporteUi, SeccionUi, StatUi } from "./ui.schemas.ts";

export type ValorEl = HTMLElement & { value: string };
export type CheckedEl = HTMLElement & { checked: boolean };
export type DialogEl = HTMLElement & { open: boolean; show(): void; hide(): void };
export type SelectEl = HTMLElement & { value: string; values: string[] };
export type NavEl = HTMLElement & { rows: NavRow[]; getValue(rowId?: string): string };
export type ShellEl = HTMLElement & { toast(message: string, options?: object): unknown };
export type GridApi = { getSelectedRows(): Record<string, unknown>[]; clearSelection(): void; selectAll(): void; setRows(rows: Record<string, unknown>[]): void; setColumns(defs: ColumnaUi[]): void };
export type GridEl = HTMLElement & { readonly rows: Record<string, unknown>[]; readonly columns: ColumnaUi[]; api: GridApi };
export type NavTab = { id: string; label: string; icon?: string | undefined };
export type NavRow = { id: string; value?: string | undefined; parent?: string | undefined; tabs: NavTab[] };
/** Vista activa: sección + pestaña (entidad, flujo o reporte). */
export type Vista = { seccion: string; tab: string };
export type AppProps = { vista: Vista | null; listo: boolean; error: string | null };
export type SessionProps = { usuarios: { iusuario: string; nombre: string | null; bactivo: boolean; roles: string[] }[]; usuario: string | null; irol: string | null; roles: string[]; perms: Record<string, unknown>; cargando: boolean };
export type EntityViewProps = { entidad: string; seleccion: Record<string, unknown> | null; modo: "lista" | "crear" | "editar"; version: number };
export type EntityGridProps = { entidad: string; seleccion: "none" | "single" | "multiple"; pageSize: number; page: number; where: QuerySpec["where"] | undefined; version: number; alto: string; seleccionados: unknown[] };
export type PagerProps = { page: number; pageSize: number; cantidad: number; opciones: number[] };
export type FormProps = { modelo: FormModel | null; valor: Record<string, unknown>; modo: "crear" | "editar"; validar: ((valor: Record<string, unknown>) => string | null) | null; enviando: boolean; error: string | null; errores: Record<string, string>; textoEnviar: string; textoCancelar: string | null; compacto: boolean };
export type FormListaProps = { campo: CampoUi | null; filas: Record<string, unknown>[] };
export type RelationFieldProps = { campo: CampoUi | null; valor: unknown; etiquetas: string[]; disabled: boolean; error: string | null };
export type RelationPickerProps = { entidad: string; kind: "one" | "many"; abierto: boolean; valor: unknown[]; titulo: string };
export type FlowProps = { id: string; flujo: FlujoUi | null; resultado: unknown; error: string | null; permitido: boolean; version: number };
export type ReportProps = { id: string; reporte: ReporteUi | null; datos: unknown; filas: Record<string, unknown>[]; error: string | null; cargando: boolean; permitido: boolean };
export type StatsProps = { stats: StatUi[]; datos: unknown };
export type SeccionActiva = { seccion: SeccionUi; tabs: NavTab[] };
