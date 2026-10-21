/**
 * MegaRetail API — `deno task dev` → http://localhost:8787/app (front) y http://localhost:8787/api (REST + doc en /api/doc?v=1).
 * Variables: `PORT` (default 8787), `DB` (archivo SQLite, default `megaretail.db`; `:memory:` para efímero).
 */
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { BASE_PATH, buildApp } from "./src/app.ts";
import { aliasApp } from "./src/front.ts";

const db = sqliteDatabase(Deno.env.get("DB") ?? "megaretail.db");
const app = buildApp(db);
await app.seed();
await app.seedDatos();
const port = Number(Deno.env.get("PORT") ?? 8787);

Deno.serve({ port, onListen: () => console.log(`MegaRetail → front http://localhost:${port}/app · API http://localhost:${port}${BASE_PATH} · doc http://localhost:${port}${BASE_PATH}/doc?v=1`) }, (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/" || url.pathname === "/app") return Response.redirect(`${url.origin}/app/${url.search}`, 302);
  return app.router.fetch(aliasApp(req, BASE_PATH));
});
