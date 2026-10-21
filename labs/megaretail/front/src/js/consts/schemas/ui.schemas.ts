/**
 * ui.schemas.ts — Zod y tipos (uno por línea) de TODO el JSON de UI del lab: `ui/app.json`, `ui/entidades/*.json`,
 * `ui/flujos.json` y `ui/reportes.json`. Todo lo que personaliza la app nace de estos JSON; el código es genérico.
 */
import { type Schema, z } from "@megaretail/vendor";

/** Controles que sabe pintar el generador de formularios. */
export const CONTROLES = ["texto", "numero", "entero", "select", "radio", "fecha", "fechahora", "hora", "bool", "textarea", "json", "relacion", "lista", "oculto"] as const;
export type Control = (typeof CONTROLES)[number];
/** Opción de un select/radio. */
export type Opcion = { value: string; label: string };
/** Cómo se pinta y de dónde elige una relación (modal con el grid de la otra entidad). */
export type RelacionUi = { entidad: string; kind: "one" | "many"; local: string; remoto: string };
/** Un campo del formulario ya resuelto (schema DER + JSON de UI). `extra` = no es columna del schema: viaja igual en el cuerpo. */
export type CampoUi = { nombre: string; label: string; control: Control; requerido: boolean; soloLectura: boolean; oculto: boolean; opciones?: Opcion[] | undefined; relacion?: RelacionUi | undefined; valor?: unknown; hint?: string | undefined; paso?: number | undefined; min?: number | undefined; max?: number | undefined; placeholder?: string | undefined; ancho?: "medio" | "completo" | undefined; schema?: Schema | undefined; extra?: boolean | undefined; orden?: number | undefined };
/** Formulario derivado: campos por nombre y el orden de pintado. */
export type FormModel = { campos: Record<string, CampoUi>; orden: string[] };
/** Lo que el JSON de UI puede cambiar de un campo (se aplica con `Obj.insert` sobre el derivado). */
export const ZCampoOverride = z.object({ label: z.string().optional(), control: z.enum(CONTROLES).optional(), requerido: z.boolean().optional(), soloLectura: z.boolean().optional(), oculto: z.boolean().optional(), opciones: z.array(z.object({ value: z.string(), label: z.string() })).optional(), valor: z.unknown().optional(), hint: z.string().optional(), paso: z.number().optional(), min: z.number().optional(), max: z.number().optional(), placeholder: z.string().optional(), ancho: z.enum(["medio", "completo"]).optional(), orden: z.number().optional(), extra: z.boolean().optional(), schema: z.unknown().optional(), relacion: z.object({ entidad: z.string(), kind: z.enum(["one", "many"]), local: z.string(), remoto: z.string() }).optional() }).strict();
export type CampoOverride = z.infer<typeof ZCampoOverride>;
/** Columna del grid (subconjunto JSON de ag-grid). `field` admite ruta con puntos sobre relaciones incluidas. */
export const ZColumnaUi = z.object({ field: z.string(), header: z.string().optional(), type: z.enum(["string", "number", "boolean", "date", "dateTime", "currency"]).optional(), width: z.number().optional(), flex: z.number().optional(), hide: z.boolean().optional(), align: z.enum(["left", "center", "right"]).optional(), filter: z.boolean().optional(), sortable: z.boolean().optional(), pinned: z.enum(["left", "right"]).optional(), cellClass: z.string().optional(), decimals: z.number().int().min(0).max(6).optional(), aggFunc: z.enum(["sum", "avg", "min", "max", "count"]).optional() }).strict();
export type ColumnaUi = z.infer<typeof ZColumnaUi>;
/** JSON de UI de una entidad (`ui/entidades/<plural>.json`); todo opcional: lo que falta se deriva del schema DER. */
export const ZEntidadUi = z.object({ titulo: z.string().optional(), icon: z.string().optional(), etiqueta: z.string().optional(), permiso: z.string().optional(), pageSize: z.number().int().min(1).max(1000).optional(), orderBy: z.union([z.string(), z.array(z.string())]).optional(), grid: z.object({ columnas: z.record(z.string(), ZColumnaUi.partial()).optional(), ocultar: z.array(z.string()).optional(), orden: z.array(z.string()).optional(), include: z.record(z.string(), z.boolean()).optional() }).strict().optional(), campos: z.record(z.string(), ZCampoOverride).optional(), orden: z.array(z.string()).optional() }).strict();
export type EntidadUi = z.infer<typeof ZEntidadUi>;
/** Sección de la navegación: pestañas secundarias con entidades, flujos o reportes. */
export const ZSeccionUi = z.object({ id: z.string(), label: z.string(), icon: z.string().optional(), entidades: z.array(z.string()).optional(), flujos: z.array(z.string()).optional(), reportes: z.array(z.string()).optional() }).strict();
export type SeccionUi = z.infer<typeof ZSeccionUi>;
/** `ui/app.json`: título, API y navegación. */
export const ZAppUi = z.object({ titulo: z.string(), subtitulo: z.string().optional(), logo: z.string().optional(), api: z.string().default("/api"), usuarioInicial: z.string().default("admin"), nav: z.array(ZSeccionUi).min(1), entidades: z.record(z.string(), z.object({ titulo: z.string(), icon: z.string().optional() }).strict()).default({}) }).strict();
export type AppUi = z.infer<typeof ZAppUi>;
/** Un flujo de negocio: formulario generado desde `schema` (JSON tipo DER) + `campos` de UI, que llama `path` del plugin. */
export const ZFlujoUi = z.object({ titulo: z.string(), icon: z.string().optional(), descripcion: z.string().optional(), path: z.string(), permiso: z.string().optional(), pks: z.record(z.string(), z.string()).optional(), schema: z.object({ columns: z.record(z.string(), z.unknown()), relations: z.record(z.string(), z.unknown()).optional() }).strict(), campos: z.record(z.string(), ZCampoOverride).optional(), orden: z.array(z.string()).optional(), resultado: z.object({ titulo: z.string().optional(), tipo: z.enum(["pojo", "lista", "json"]).optional(), entidad: z.string().optional(), columnas: z.array(ZColumnaUi).optional(), filas: z.string().optional() }).strict().optional(), confirmar: z.string().optional() }).strict();
export type FlujoUi = z.infer<typeof ZFlujoUi>;
/** Un indicador (`<iswc-stat>`) calculado del resultado con una consulta `Obj.getValue`. */
export const ZStatUi = z.object({ label: z.string(), consulta: z.record(z.string(), z.unknown()), formato: z.enum(["moneda", "entero", "porcentaje", "texto"]).optional(), icon: z.string().optional(), color: z.string().optional() }).strict();
export type StatUi = z.infer<typeof ZStatUi>;
/** Un reporte: `path` GET del plugin con parámetros (formulario generado) y la tabla de `filas`. */
export const ZReporteUi = z.object({ titulo: z.string(), icon: z.string().optional(), descripcion: z.string().optional(), path: z.string(), permiso: z.string().optional(), params: z.object({ columns: z.record(z.string(), z.unknown()) }).strict().optional(), campos: z.record(z.string(), ZCampoOverride).optional(), filas: z.string().optional(), columnas: z.array(ZColumnaUi).min(1), stats: z.array(ZStatUi).optional(), resaltar: z.object({ campo: z.string(), clases: z.record(z.string(), z.string()) }).strict().optional(), groupBy: z.string().optional(), filtro: z.record(z.string(), z.unknown()).optional() }).strict();
export type ReporteUi = z.infer<typeof ZReporteUi>;
export const ZFlujosUi = z.record(z.string(), ZFlujoUi);
export const ZReportesUi = z.record(z.string(), ZReporteUi);
/** Perfil de permisos tal como lo entrega `GET permisos`. */
export type Perfil = { usuario: string | null; irol: string; igrupo: string; roles: string[]; perms: Record<string, unknown> };
/** Usuario del selector (`GET lab/usuarios`). */
export const ZUsuarioLab = z.object({ iusuario: z.string(), nombre: z.string().nullable(), bactivo: z.boolean(), roles: z.array(z.string()) });
export type UsuarioLab = z.infer<typeof ZUsuarioLab>;
