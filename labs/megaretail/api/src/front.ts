/**
 * `GET /app`: el API sirve el front "portable" leyendo POR RUTA RELATIVA la carpeta `../front/` (index.html, `dist/`, `ui/`,
 * `assets/`). Sin lógica de UI en el server: sólo entrega archivos con su content-type. Son rutas irregulares del router
 * (viven bajo el basePath, `/api/app`); `main.ts` publica además el alias `/app`.
 */
import type { ExtraRoute, ExtraRouteInput, Router } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";

const TIPOS: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".map": "application/json", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2" };
/** Carpetas del front que se publican. */
const PUBLICAS = new Set(["dist", "ui", "assets"]);

/** Carpeta del front por defecto: `labs/megaretail/front/`, relativa a este archivo. */
export function frontPorDefecto(): URL {
  return new URL("../../front/", import.meta.url);
}

/** Content-type por extensión (octet-stream si no se conoce). */
export function contentType(nombre: string): string {
  const ext = nombre.slice(nombre.lastIndexOf(".")).toLowerCase();
  return TIPOS[ext] ?? "application/octet-stream";
}

/** Archivo del front como Response (404 si no existe o la ruta no es pública; nunca sale de la carpeta). */
export async function archivoFront(front: URL, segmentos: string[]): Promise<Response> {
  if (!segmentos.length || segmentos.some((s) => !s || s === "." || s === ".." || s.includes("\\"))) return Response.json({ error: "Ruta no encontrada" }, { status: 404 });
  const [carpeta] = segmentos;
  if (segmentos.length > 1 && !PUBLICAS.has(carpeta ?? "")) return Response.json({ error: "Ruta no encontrada" }, { status: 404 });
  if (segmentos.length === 1 && carpeta !== "index.html") return Response.json({ error: "Ruta no encontrada" }, { status: 404 });
  const url = new URL(segmentos.map(encodeURIComponent).join("/"), front);
  try {
    const bytes = await Deno.readFile(url);
    return new Response(bytes, { headers: { "content-type": contentType(segmentos.at(-1) ?? ""), "cache-control": "no-cache" } });
  } catch {
    return Response.json({ error: "Ruta no encontrada" }, { status: 404 });
  }
}

/** Rutas irregulares del router para el front: `app` (index, con redirección a la barra final) y hasta tres niveles de archivos. */
export function frontRoutes(front: URL = frontPorDefecto()): ExtraRoute<Router>[] {
  const index = async ({ request }: ExtraRouteInput): Promise<Response> => {
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 302);
    return await archivoFront(front, ["index.html"]);
  };
  const archivo = ({ params }: ExtraRouteInput): Promise<Response> => archivoFront(front, ["a", "b", "c"].map((k) => params[k]).filter((s): s is string => s !== undefined));
  return [
    { method: "GET", path: "app", security: "public", handler: index },
    { method: "GET", path: "app/{a}", security: "public", handler: archivo },
    { method: "GET", path: "app/{a}/{b}", security: "public", handler: archivo },
    { method: "GET", path: "app/{a}/{b}/{c}", security: "public", handler: archivo },
  ];
}

/** `/app…` → `/api/app…`: alias en la raíz para que el front se abra en `http://host/app`. */
export function aliasApp(req: Request, basePath: string): Request {
  const url = new URL(req.url);
  if (url.pathname !== "/app" && !url.pathname.startsWith("/app/")) return req;
  url.pathname = `${basePath}${url.pathname}`;
  return new Request(url, req);
}
