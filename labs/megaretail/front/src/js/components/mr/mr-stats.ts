/**
 * <mr-stats> — fila de indicadores (`<iswc-stat>`) definidos en JSON: cada uno toma su valor del resultado con una
 * consulta `Obj.getValue` (p. ej. `{ "celdas": { "[nivel=total]": { "total": true } } }`) y un formato.
 */
import { crearComponente, define, html } from "../../base/componente.ts";
import type { StatsProps } from "../../consts/schemas/componentes.schemas.ts";
import { valorStat } from "../../core/stats.ts";

const MrStats = crearComponente<StatsProps>(import.meta.url, "mr-stats", { stats: [], datos: null }, (root, props) => {
  if (!props.stats.length) return;
  root.append(html`
    <div class="stats" part="stats">
      ${props.stats.map((s) => html`<iswc-stat label=${s.label} value=${valorStat(s, props.datos)} icon=${s.icon ?? ""} color=${s.color ?? "brand"}></iswc-stat>`)}
    </div>
  `);
});

define("mr-stats", MrStats);
