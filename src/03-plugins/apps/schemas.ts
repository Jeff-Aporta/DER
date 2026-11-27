/**
 * Tipos y Zod del plugin de apps: la INSTANCIA DE NEGOCIO (el `iapp`). Una app es un clon aislable: su `iapp` viaja en
 * la cabecera `X-App` (o en la sesion) y TODA entidad de su ambito lo filtra. La app guarda su marca (lo que pinta el
 * front), su modo (que decide plantilla, textos y flujo) y si es demo (para poder purgar sus datos).
 *
 *   apps_apps  (iapp, nombre, modo, iempresa, bdemo, servidor, marca, soporte_wa, contacto_wa, fhcre)
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/apps.md
 */
import { z } from "zod";
import type { SessionInfo } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";

/** Modos de app: el modo decide plantilla, textos y flujo (`restaurante` y `tienda` = productos con carrito; `hotel`, `barberia` y `salon` = servicios con reserva). */
export const MODOS_APP = ["restaurante", "tienda", "hotel", "barberia", "salon"] as const;

/** Modo de la app. */
export type ModoApp = (typeof MODOS_APP)[number];

/** Marca de la app: lo que pinta el front (colores, logo y favicon). */
export type MarcaApp = { colores?: string[] | undefined; logo?: string | null | undefined; favicon?: string | null | undefined };

/** Una app: la instancia de negocio con su modo, su marca y su empresa (la del CRM que la administra). */
export type App = { iapp: string; nombre: string; modo: ModoApp; iempresa: string | null; bdemo: boolean; servidor: string | null; marca: MarcaApp | null; soporte_wa: boolean; contacto_wa: string | null; fhcre: string };

/** La app PUBLICA: lo que el front puede ver (nada de datos internos: ni `iempresa`, ni `bdemo`, ni `fhcre`). */
export type AppPublica = { nombre: string; modo: ModoApp; marca: MarcaApp | null; servidor: string | null; contacto_wa: string | null };

/** Alta de una app (el `iapp` es opcional: si no viene, el servidor lo deduce del nombre). */
export type AppInput = { iapp?: string | undefined; nombre: string; modo: ModoApp; iempresa?: string | null | undefined; bdemo?: boolean | undefined; servidor?: string | null | undefined; marca?: MarcaApp | null | undefined; soporte_wa?: boolean | undefined; contacto_wa?: string | null | undefined };

/** Cambio de una app (lo editable: el `iapp` NO cambia). */
export type AppCambio = { nombre?: string | undefined; modo?: ModoApp | undefined; iempresa?: string | null | undefined; bdemo?: boolean | undefined; servidor?: string | null | undefined; marca?: MarcaApp | null | undefined; soporte_wa?: boolean | undefined; contacto_wa?: string | null | undefined };

/** Contexto que resuelve el ambito de la app: la peticion (cabecera `X-App`) o la sesion. */
export type ContextoApp = { request?: Request | undefined; session?: SessionInfo | null | undefined };

/** Filtros de la lista de apps. */
export type ListaAppsFiltros = { modo?: ModoApp | undefined; iempresa?: string | undefined; q?: string | undefined };

/** Opciones de la purga: `forzar` permite borrar los datos de una app que NO es demo. */
export type PurgaOpciones = { forzar?: boolean | undefined };

/** Resultado de la purga: cuantas filas borro cada tabla. */
export type PurgaResultado = { iapp: string; tablas: { tabla: string; borrados: number }[]; total: number };

/** Configuracion del plugin: `cabecera` es la cabecera que lleva el ambito de la app (por defecto `x-app`). */
export type AppsConfig = { cabecera?: string | undefined };

/** Verbos del server (sin HTTP): los mismos metodos que usan los handlers. */
export type VerbosApps = { exigirApp(iapp: string): Promise<App>; purgarApp(iapp: string, tablas: string[], opciones?: PurgaOpciones): Promise<PurgaResultado> };

/** Zod de la marca de la app. */
export const ZMarcaApp = z.strictObject({ colores: z.array(z.string().trim().max(32)).max(12).optional(), logo: z.string().trim().max(500).nullish(), favicon: z.string().trim().max(500).nullish() });

/** Zod del alta de una app. */
export const ZAppInput = z.strictObject({ iapp: z.string().trim().min(1).max(40).optional(), nombre: z.string().trim().min(1).max(160), modo: z.enum(MODOS_APP), iempresa: z.string().trim().max(40).nullish(), bdemo: z.boolean().optional(), servidor: z.string().trim().max(300).nullish(), marca: ZMarcaApp.nullish(), soporte_wa: z.boolean().optional(), contacto_wa: z.string().trim().max(60).nullish() });

/** Zod del cambio de una app. */
export const ZAppCambio = z.strictObject({ nombre: z.string().trim().min(1).max(160).optional(), modo: z.enum(MODOS_APP).optional(), iempresa: z.string().trim().max(40).nullish(), bdemo: z.boolean().optional(), servidor: z.string().trim().max(300).nullish(), marca: ZMarcaApp.nullish(), soporte_wa: z.boolean().optional(), contacto_wa: z.string().trim().max(60).nullish() });

/** Zod de la configuracion del plugin. */
export const ZAppsConfig = z.strictObject({ cabecera: z.string().trim().min(1).max(40).default("x-app") });
