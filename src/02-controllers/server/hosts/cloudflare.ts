/**
 * Host Cloudflare Workers: el Worker exporta `fetch`, y el Router resuelve la ruta con su tabla (la misma que
 * Azure registra función por función). Sin dependencias.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 *
 * ```ts
 * export default defineWorker((env: Env) => {
 *   const db = pgDatabase(new Pool({ connectionString: env.HYPERDRIVE.connectionString }));
 *   return createRouter(buildControllers(db), { basePath: "/api", cors: true });
 * });
 * ```
 * Requiere `compatibility_flags = ["nodejs_compat"]` sólo si se usan fuentes de doc locales (`node:fs`).
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/servidor.md
 */
import type { Router } from "@Jeff-Aporta/DER/src/02-controllers/server/router.ts";
import type { WorkerExecutionContext, WorkerExport } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";

/**
 * Crea el export del Worker. `setup` corre una vez por isolate (con el `env` de los bindings) y su Router
 * se reusa en los requests siguientes; si falla, se reintenta en el próximo request.
 */
export function defineWorker<Env>(setup: (env: Env) => Router | Promise<Router>): WorkerExport<Env> {
  let ready: Promise<Router> | null = null;
  return {
    async fetch(req: Request, env: Env, _ctx: WorkerExecutionContext): Promise<Response> {
      ready ??= Promise.resolve().then(() => setup(env)).catch((err: unknown) => {
        ready = null;
        throw err;
      });
      const router = await ready;
      return await router.fetch(req);
    },
  };
}
