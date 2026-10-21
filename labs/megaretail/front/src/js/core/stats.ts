/**
 * stats.ts — valor de un indicador (`StatUi`) a partir del resultado de un reporte: consulta `Obj.getValue` + formato.
 * Sin DOM: lo usa `<mr-stats>` y las pruebas.
 */
import { Obj } from "@megaretail/vendor";
import type { StatUi } from "../consts/schemas/ui.schemas.ts";

const moneda = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/** Valor formateado de un stat. */
export function valorStat(stat: StatUi, datos: unknown): string {
  let v: unknown;
  try {
    v = Obj.getValue(datos, stat.consulta as Parameters<typeof Obj.getValue>[1]);
  } catch {
    v = null;
  }
  if (Array.isArray(v)) v = v.length;
  if (v == null || v === "") return "—";
  if (stat.formato === "moneda") return moneda.format(Number(v));
  if (stat.formato === "entero") return entero.format(Number(v));
  if (stat.formato === "porcentaje") return `${Number(v).toFixed(2)} %`;
  return String(v);
}

