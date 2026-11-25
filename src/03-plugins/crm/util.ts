/**
 * Utilidades propias del plugin CRM: servicios del consumidor y usuario de la sesión. Lo genérico de tablas está en
 * `common/tablas.ts`.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/crm.md
 */
import { HttpError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ServerCtx, ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import type { CrmServicios } from "@Jeff-Aporta/DER/src/03-plugins/crm/schemas.ts";

/** Servicios que vinculó el consumidor. */
export const serviciosDe = (plugin: ServerPlugin): CrmServicios => (plugin.services ?? {}) as CrmServicios;

/** El usuario de la sesión; sin sesión es un 401. */
export function usuarioDe(ctx: ServerCtx): string {
  const u = ctx.session?.id ? String(ctx.session.id) : "";
  if (!u) throw new HttpError(401, "El CRM requiere iniciar sesión");
  return u;
}
