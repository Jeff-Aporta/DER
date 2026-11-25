/**
 * El plugin de reportes en DOS motores (SQLite y PGlite) con identidad y CRM reales: cualquiera reporta sobre cualquier
 * origen, solo el rol auditor atiende, la toma es atómica (carrera de dos agentes), bitácora, soltar, cerrar conserva la
 * fila con quién la cerró, y nada cruza empresas ni ámbitos.
 */
import { assert, assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { pgliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/pglite.ts";
import { CABECERA_EMPRESA, crearCrm, crearReportes, identityServer, type LoginCrmResult, type Reporte } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { call, identityCfg } from "@Jeff-Aporta/DER/tests/_util.ts";

const MOTORES = [["sqlite", () => sqliteDatabase()], ["pglite", () => pgliteDatabase()]] as const;
const CLAVE = "clave-segura-123";

async function montar(fabrica: () => ReturnType<typeof sqliteDatabase>) {
  registry.secure(null);
  const db = fabrica();
  const avisos: Reporte[] = [];
  const auth = createServer(identityServer, { db, cfg: identityCfg() });
  const crm = crearCrm({ db, cfg: { empresas: [{ iempresa: "acme", nombre: "Acme", miembros: [{ iusuario: "ana", rol: "agente" }, { iusuario: "aud", rol: "auditor" }, { iusuario: "aud2", rol: "auditor" }] }, { iempresa: "zeta", nombre: "Zeta", miembros: [{ iusuario: "zed", rol: "auditor" }] }] }, services: { login: (i: { usuario: string; password: string }, req?: Request) => (auth as unknown as { login(i: unknown, r?: Request): Promise<never> }).login(i, req) } });
  const rep = crearReportes({
    db,
    cfg: { tomaMin: 60 },
    services: {
      contexto: async (req: Request, sesion: { id?: string } | null | undefined) => {
        const c = await crm.contexto(String(sesion?.id), req.headers.get(CABECERA_EMPRESA));
        return { iusuario: c.iusuario, iempresa: c.iempresa, rol: c.rol };
      },
      alReportar: (r: Reporte) => {
        avisos.push(r);
      },
    },
  });
  const router = createRouter([], { basePath: "/api", plugins: [auth, crm, rep] });
  await router.seed();
  const usuarios = auth.controllers["usuarios"]!;
  for (const u of ["ana", "aud", "aud2", "zed"]) await usuarios.post(usuarios.pojo({ iusuario: u, password: CLAVE }));
  const entrar = async (usuario: string, empresa: string) => ((await call(router, "POST", "crm/login", { body: { empresa, usuario, password: CLAVE } })).data as LoginCrmResult).token;
  return { router, rep, avisos, entrar, cerrar: async () => { registry.secure(null); await db.destroy(); } };
}

const base = { origin: "atencion.mensaje", idorigin: "m1", ambito: "bot-ventas", motivo: "Tono muy formal", correccion: "Más cercano", contexto: { texto: "Estimado cliente…" } };

for (const [motor, fabrica] of MOTORES) {
  Deno.test(`reportes (${motor}): cualquiera reporta sobre cualquier origen; solo el auditor ve la cola y atiende`, async () => {
    const { router, avisos, entrar, cerrar } = await montar(fabrica);
    try {
      const ana = await entrar("ana", "acme");
      const aud = await entrar("aud", "acme");
      const r = await call(router, "POST", "reportes/reportar", { token: ana, body: base });
      assertEquals(r.status, 200, JSON.stringify(r.data));
      const rep = r.data as Reporte;
      assertEquals([rep.estado, rep.autor, rep.iempresa, rep.origin], ["pendiente", "ana", "acme", "atencion.mensaje"]);
      assertEquals(avisos.length, 1, "el aviso al agente se dispara");
      await call(router, "POST", "reportes/reportar", { token: ana, body: { origin: "crm.contacto", idorigin: "c1", tipo: "dato", motivo: "Teléfono errado" } });
      assertEquals((await call(router, "POST", "reportes/reportar", { token: ana, body: { origin: "", idorigin: "x", motivo: "m" } })).status, 400);
      assertEquals((await call(router, "GET", "reportes/cola", { token: ana })).status, 403, "ana no audita");
      assertEquals((await call(router, "POST", "reportes/tomar", { token: ana, body: { id: rep.id } })).status, 403);
      assertEquals((await call(router, "GET", "reportes/cola")).status, 401);
      const cola = (await call(router, "GET", "reportes/cola?estado=pendiente", { token: aud })).data as Reporte[];
      assertEquals(cola.length, 2);
      assertEquals(((await call(router, "GET", "reportes/cola?ambito=bot-ventas", { token: aud })).data as Reporte[]).map((x) => x.id), [rep.id]);
      assertEquals(((await call(router, "GET", "reportes/de?origin=crm.contacto&idorigin=c1", { token: ana })).data as Reporte[]).length, 1, "ana ve lo suyo");
      assertEquals(((await call(router, "GET", "reportes/de?origin=crm.contacto&idorigin=c1", { token: aud })).data as Reporte[]).length, 1);
    } finally {
      await cerrar();
    }
  });

  Deno.test(`reportes (${motor}): toma atómica, bitácora, soltar y cierre que conserva quién lo aplicó`, async () => {
    const { router, entrar, cerrar } = await montar(fabrica);
    try {
      const ana = await entrar("ana", "acme");
      const aud = await entrar("aud", "acme");
      const aud2 = await entrar("aud2", "acme");
      const id = ((await call(router, "POST", "reportes/reportar", { token: ana, body: base })).data as Reporte).id;
      // Carrera: dos auditores toman a la vez; solo uno gana.
      const [a, b] = await Promise.all([call(router, "POST", "reportes/tomar", { token: aud, body: { id } }), call(router, "POST", "reportes/tomar", { token: aud2, body: { id } })]);
      assertEquals([a.status, b.status].sort(), [200, 409]);
      const ganador = a.status === 200 ? aud : aud2;
      const perdedor = a.status === 200 ? aud2 : aud;
      assertEquals((await call(router, "POST", "reportes/avance", { token: perdedor, body: { id, texto: "intruso" } })).status, 409);
      assertEquals((await call(router, "POST", "reportes/cerrar", { token: perdedor, body: { id, resultado: "aplicada" } })).status, 409);
      const av = await call(router, "POST", "reportes/avance", { token: ganador, body: { id, texto: "Revisando el contrato del bot" } });
      assertEquals(av.status, 200, JSON.stringify(av.data));
      assertEquals((av.data as Reporte).javance?.length, 1);
      const suelto = (await call(router, "POST", "reportes/soltar", { token: ganador, body: { id, texto: "Falta el contrato" } })).data as Reporte;
      assertEquals([suelto.estado, suelto.atendido_por, suelto.javance?.length], ["pendiente", null, 2]);
      assertEquals((await call(router, "POST", "reportes/tomar", { token: perdedor, body: { id } })).status, 200, "tras soltar lo toma el otro");
      const cerrado = await call(router, "POST", "reportes/cerrar", { token: perdedor, body: { id, resultado: "aplicada", nota: "Contrato ajustado" } });
      assertEquals(cerrado.status, 200, JSON.stringify(cerrado.data));
      const c = cerrado.data as Reporte;
      assertEquals([c.estado, c.resultado, c.fhcierre != null], ["aplicada", "Contrato ajustado", true]);
      assert(c.iaplicador === "aud" || c.iaplicador === "aud2");
      assertEquals((await call(router, "POST", "reportes/tomar", { token: ganador, body: { id } })).status, 409, "un cerrado no se retoma");
      const todos = (await call(router, "GET", "reportes/cola?estado=aplicada", { token: aud })).data as Reporte[];
      assertEquals(todos.map((x) => x.id), [id], "cerrar conserva la fila");
    } finally {
      await cerrar();
    }
  });

  Deno.test(`reportes (${motor}): aislamiento por empresa y verbos de agente en proceso con toma vencida`, async () => {
    const { router, rep, entrar, cerrar } = await montar(fabrica);
    try {
      const ana = await entrar("ana", "acme");
      const zed = await entrar("zed", "zeta");
      const id = ((await call(router, "POST", "reportes/reportar", { token: ana, body: base })).data as Reporte).id;
      assertEquals(((await call(router, "GET", "reportes/cola", { token: zed })).data as Reporte[]).length, 0, "zeta no ve lo de acme");
      assertEquals((await call(router, "POST", "reportes/tomar", { token: zed, body: { id } })).status, 404);
      assertEquals((await call(router, "POST", "reportes/cerrar", { token: zed, body: { id, resultado: "descartada" } })).status, 404);
      // Agente en proceso (IA): verbos directos, y una toma vencida la retoma otro.
      const t = await rep.tomar("acme", id, "agente-ia");
      assertEquals(t.atendido_por, "agente-ia");
      await rep.controllers["reportes"]!.put(rep.controllers["reportes"]!.pojo({ id, ftoma: new Date(Date.now() - 2 * 3600_000).toISOString() }));
      assertEquals((await rep.tomar("acme", id, "otro-agente")).atendido_por, "otro-agente", "toma vencida: se retoma");
      assertEquals((await rep.cerrar("acme", "otro-agente", { id, resultado: "descartada", nota: "no aplica" })).estado, "descartada");
      assertEquals((await rep.de("acme", "atencion.mensaje", "m1")).length, 1);
      assertEquals((await rep.de("zeta", "atencion.mensaje", "m1")).length, 0);
    } finally {
      await cerrar();
    }
  });
}
