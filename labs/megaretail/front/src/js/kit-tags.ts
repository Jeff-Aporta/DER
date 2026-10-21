/**
 * kit-tags.ts — REGISTRO ÚNICO de tags de la app (estándar iswc-foundation).
 *   KIT_TAGS → tags `iswc-*` del kit que la app pide al loader antes de montar.
 *   APP_TAGS → componentes propios `mr-*` (todos viven en el bundle `dist/app.js`; su hoja es `dist/<tag>.css`).
 */
export const KIT_TAGS = [
  "iswc-app-shell",
  "iswc-app-nav",
  "iswc-ag-grid",
  "iswc-button",
  "iswc-input",
  "iswc-select",
  "iswc-option",
  "iswc-radio-group",
  "iswc-radio",
  "iswc-date-field",
  "iswc-date-time-field",
  "iswc-switch",
  "iswc-textarea",
  "iswc-dialog",
  "iswc-callout",
  "iswc-card",
  "iswc-badge",
  "iswc-tag",
  "iswc-stat",
  "iswc-icon",
  "iswc-theme-toggle",
  "iswc-spinner",
  "iswc-divider",
] as const;

export const PREFIJO = "mr";

export const APP_TAGS = [
  "mr-app",
  "mr-session",
  "mr-entity-view",
  "mr-entity-grid",
  "mr-pager",
  "mr-form",
  "mr-form-lista",
  "mr-relation-field",
  "mr-relation-picker",
  "mr-flow",
  "mr-report",
  "mr-stats",
] as const;

export type AppTag = (typeof APP_TAGS)[number];

/** Comprueba que un tag lleve el prefijo de la app (guardián en pruebas). */
export function esTagApp(tag: string): tag is AppTag {
  return (APP_TAGS as readonly string[]).includes(tag) && tag.startsWith(`${PREFIJO}-`);
}
