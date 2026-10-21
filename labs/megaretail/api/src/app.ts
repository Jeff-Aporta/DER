/**
 * Arma la app completa sobre una base: controllers del dominio, plugins de identidad/permisos, router con basePath `/api`,
 * las rutas del front (`GET /api/app…`) y la ruta pública `GET /api/lab/usuarios` del selector de usuario.
 */
import { createRouter } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import type { Database } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { buildControllers } from "./controllers.ts";
import { frontRoutes } from "./front.ts";
import { buildSecurity, seedSecurity, usuariosLab } from "./security.ts";
import { seedDatos } from "./seed.ts";
import type { App, AppOptions } from "./schemas.ts";

/** basePath del API. */
export const BASE_PATH = "/api";

/** La app lista: `await app.seed()` crea tablas, DER de permisos y usuarios; `await app.seedDatos()` los datos de muestra. */
export function buildApp(db: Database, opts: AppOptions = {}): App {
  const controllers = buildControllers(db);
  const plugins = buildSecurity(db);
  const router = createRouter(Object.values(controllers), {
    basePath: BASE_PATH,
    cors: true,
    exposeErrors: true,
    plugins: [plugins.auth, plugins.permisos],
    routes: [
      ...frontRoutes(opts.front),
      { method: "GET", path: "lab/usuarios", security: "public", handler: () => usuariosLab(plugins) },
    ],
    docView: { title: "MegaRetail · API" },
  });
  return {
    db,
    controllers,
    plugins,
    router,
    async seed() {
      await router.seed();
      await seedSecurity(plugins);
    },
    seedDatos: () => seedDatos(controllers),
  };
}
