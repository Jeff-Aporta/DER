/**
 * El plugin CRM por dentro, en DOS motores (SQLite y PGlite) con el mismo seed y con la identidad real: login por
 * empresa + usuario + contraseña, un usuario en varias empresas con rol por empresa, aislamiento total entre
 * empresas (contactos, conversaciones, adjuntos), roles, y el chat de peon (hilos, historial paginado, búsqueda,
 * no leídas, adjuntos, bot por canal, directas y grupos).
 */
import { assert, assertEquals } from "@std/assert";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { createRouter, createServer, type ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { pgliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/pglite.ts";
import { b64urlEncode } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { type ChatEnviado, type ChatPagina, type Contacto, CABECERA_EMPRESA, crearCrm, type EmpresaResumen, type HiloChat, identityServer, type LineaChat, type LoginCrmResult, type Miembro, type PaqueteCanal, type Participante, type PerfilCrm } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { call, identityCfg } from "@Jeff-Aporta/DER/tests/_util.ts";

const CLAVE = "clave-segura-123";
const TOKEN_CANAL = "token-del-canal-con-mas-de-16";

const CFG = {
  canalToken: TOKEN_CANAL,
  superadmins: ["root"],
  empresas: [
    { iempresa: "acme", nombre: "Acme SAS", miembros: [{ iusuario: "ana", rol: "propietario" as const }, { iusuario: "beto", rol: "agente" as const }, { iusuario: "lia", rol: "lector" as const }], contactos: [{ id: "c-acme-1", nombre: "Cliente Acme" }] },
    { iempresa: "zeta", codigo: "zeta-co", nombre: "Zeta Ltda", miembros: [{ iusuario: "ana", rol: "admin" as const }, { iusuario: "caro", rol: "propietario" as const }], contactos: [{ id: "c-zeta-1", nombre: "Cliente Zeta" }] },
  ],
};

const MOTORES = [["sqlite", () => sqliteDatabase()], ["pglite", () => pgliteDatabase()]] as const;

async function montar(fabrica: () => ReturnType<typeof sqliteDatabase>, conCanal = true) {
  registry.secure(null);
  const db = fabrica();
  const bytes = new Map<string, { cuerpo: Uint8Array; mime: string }>();
  const avisos: { l: LineaChat; para: string[] }[] = [];
  const paquetes: PaqueteCanal[] = [];
  const auth = createServer(identityServer, { db, cfg: identityCfg() });
  const crm = crearCrm({
    db,
    cfg: CFG,
    services: {
      login: (i: { usuario: string; password: string }, req?: Request) => (auth as unknown as { login(i: unknown, r?: Request): Promise<never> }).login(i, req),
      almacen: { subir: (k: string, b: Uint8Array, m: { mime: string }) => { bytes.set(k, { cuerpo: b, mime: m.mime }); return Promise.resolve(); }, bajar: (k: string) => Promise.resolve(bytes.has(k) ? { cuerpo: bytes.get(k)!.cuerpo as unknown as BodyInit } : null), borrar: (k: string) => { bytes.delete(k); return Promise.resolve(); } },
      ...(conCanal ? { canal: (p: PaqueteCanal) => { paquetes.push(p); return true; } } : {}),
      alMensaje: (l: LineaChat, para: string[]) => { avisos.push({ l, para }); },
    },
  });
  const router = createRouter([], { basePath: "/api", plugins: [auth, crm as ServerPlugin] });
  await router.seed();
  const usuarios = auth.controllers["usuarios"]!;
  for (const u of ["ana", "beto", "lia", "caro", "root"]) await usuarios.post(usuarios.pojo({ iusuario: u, nombre: u.toUpperCase(), password: CLAVE }));
  const cerrar = async () => {
    registry.secure(null);
    await db.destroy();
  };
  const entrar = async (usuario: string, empresa: string) => {
    const r = await call(router, "POST", "crm/login", { body: { empresa, usuario, password: CLAVE } });
    assertEquals(r.status, 200, JSON.stringify(r.data));
    return (r.data as LoginCrmResult).token;
  };
  return { db, router, crm, bytes, avisos, paquetes, entrar, cerrar };
}

const en = (token: string, empresa?: string) => ({ token, headers: empresa ? { [CABECERA_EMPRESA]: empresa } : {} });

for (const [motor, fabrica] of MOTORES) {
  Deno.test(`crm (${motor}): el seed crea las tablas, las empresas, los miembros y los contactos, y es idempotente`, async () => {
    const { crm, cerrar } = await montar(fabrica);
    try {
      assertEquals((await crm.empresasDe("ana")).map((e) => [e.iempresa, e.rol]), [["acme", "propietario"], ["zeta", "admin"]]);
      assertEquals((await crm.miembros("acme")).map((m) => [m.iusuario, m.rol]), [["ana", "propietario"], ["beto", "agente"], ["lia", "lector"]]);
      assertEquals((await crm.contactos("zeta")).map((c) => c.nombre), ["Cliente Zeta"]);
      assertEquals((await crm.empresa("zeta"))?.codigo, "zeta-co");
      await crm.seed?.();
      assertEquals((await crm.contactos("acme")).length, 1, "el seed no duplica contactos con id");
      assertEquals((await crm.miembros("acme")).length, 3);
    } finally {
      await cerrar();
    }
  });

  Deno.test(`crm (${motor}): login por empresa + usuario + contraseña; mismo 401 si no pertenece o la contraseña falla`, async () => {
    const { router, cerrar } = await montar(fabrica);
    try {
      const ok = await call(router, "POST", "crm/login", { body: { empresa: "ACME", usuario: "ana", password: CLAVE } });
      assertEquals(ok.status, 200, JSON.stringify(ok.data));
      const r = ok.data as LoginCrmResult;
      assertEquals(r.empresa, { iempresa: "acme", codigo: "acme", nombre: "Acme SAS", rol: "propietario" });
      assertEquals(r.empresas.map((e: EmpresaResumen) => e.iempresa), ["acme", "zeta"]);
      assert(r.token.length > 20);
      const porCodigo = await call(router, "POST", "crm/login", { body: { empresa: "zeta-co", usuario: "caro", password: CLAVE } });
      assertEquals((porCodigo.data as LoginCrmResult).empresa.rol, "propietario");
      const ajeno = await call(router, "POST", "crm/login", { body: { empresa: "zeta", usuario: "beto", password: CLAVE } });
      assertEquals(ajeno.status, 401, "beto es de acme, no de zeta");
      const noExiste = await call(router, "POST", "crm/login", { body: { empresa: "nadie", usuario: "ana", password: CLAVE } });
      assertEquals(noExiste.status, 401);
      assertEquals((noExiste.data as { error?: string }).error ?? (noExiste.data as { message?: string }).message, (ajeno.data as { error?: string }).error ?? (ajeno.data as { message?: string }).message, "no distingue entre empresa inexistente y no pertenecer");
      const mala = await call(router, "POST", "crm/login", { body: { empresa: "acme", usuario: "ana", password: "otra-clave-123" } });
      assertEquals(mala.status, 401);
    } finally {
      await cerrar();
    }
  });

  Deno.test(`crm (${motor}): la empresa activa sale de X-Empresa, se valida contra la pertenencia y aísla los datos`, async () => {
    const { router, entrar, cerrar } = await montar(fabrica);
    try {
      const ana = await entrar("ana", "acme");
      const yo = await call(router, "GET", "crm/yo", en(ana, "zeta"));
      assertEquals((yo.data as PerfilCrm).activa?.iempresa, "zeta");
      const sinCabecera = await call(router, "GET", "crm/contactos", en(ana));
      assertEquals(sinCabecera.status, 400, "ana tiene dos empresas: debe indicar cuál");
      const acme = await call(router, "GET", "crm/contactos", en(ana, "acme"));
      assertEquals((acme.data as Contacto[]).map((c) => c.id), ["c-acme-1"]);
      const zeta = await call(router, "GET", "crm/contactos", en(ana, "zeta"));
      assertEquals((zeta.data as Contacto[]).map((c) => c.id), ["c-zeta-1"]);
      const beto = await entrar("beto", "acme");
      assertEquals((await call(router, "GET", "crm/contactos", en(beto, "zeta"))).status, 403, "beto no pertenece a zeta");
      assertEquals((await call(router, "GET", "crm/contactos", en(beto))).status, 200, "con una sola empresa se deduce");
      const robo = await call(router, "PUT", "crm/contactos/c-zeta-1", { ...en(beto, "acme"), body: { nombre: "Hackeado" } });
      assertEquals(robo.status, 404, "un contacto de otra empresa no existe para esta");
      assertEquals((await call(router, "GET", "crm/contactos")).status, 401, "sin sesión no entra");
    } finally {
      await cerrar();
    }
  });

  Deno.test(`crm (${motor}): roles por empresa, miembros y propietario protegido`, async () => {
    const { router, entrar, crm, cerrar } = await montar(fabrica);
    try {
      const lia = await entrar("lia", "acme");
      assertEquals((await call(router, "GET", "crm/contactos", en(lia))).status, 200, "el lector lee");
      assertEquals((await call(router, "POST", "crm/contactos", { ...en(lia), body: { nombre: "X" } })).status, 403, "el lector no escribe");
      const beto = await entrar("beto", "acme");
      const nuevo = await call(router, "POST", "crm/contactos", { ...en(beto), body: { nombre: "Nuevo", email: "n@x.co", jetiquetas: ["vip"] } });
      assertEquals(nuevo.status, 200, JSON.stringify(nuevo.data));
      const id = (nuevo.data as Contacto).id;
      assertEquals((await call(router, "PUT", `crm/contactos/${id}`, { ...en(beto), body: { cargo: "CEO" } })).status, 200);
      assertEquals((await call(router, "PUT", `crm/contactos/${id}`, { ...en(beto), body: { bactivo: false } })).status, 403, "dar de baja pide admin");
      const buscado = await call(router, "GET", "crm/contactos?q=n%40x", en(beto));
      assertEquals((buscado.data as Contacto[]).map((c) => c.id), [id]);
      assertEquals((await call(router, "POST", "crm/miembros", { ...en(beto), body: { iusuario: "caro", rol: "agente" } })).status, 403, "el agente no administra miembros");
      const ana = await entrar("ana", "acme");
      assertEquals((await call(router, "PUT", `crm/contactos/${id}`, { ...en(ana, "acme"), body: { bactivo: false } })).status, 200);
      assertEquals(((await call(router, "GET", "crm/contactos", en(ana, "acme"))).data as Contacto[]).some((c) => c.id === id), false, "el dado de baja no se lista");
      const alta = await call(router, "POST", "crm/miembros", { ...en(ana, "acme"), body: { iusuario: "caro", rol: "agente" } });
      assertEquals(alta.status, 200, JSON.stringify(alta.data));
      assertEquals(((await call(router, "GET", "crm/miembros", en(ana, "acme"))).data as Miembro[]).length, 4);
      const caro = await entrar("caro", "acme");
      assertEquals((await call(router, "GET", "crm/contactos", en(caro, "acme"))).status, 200, "caro ya entra a acme");
      // En zeta, ana es admin: no puede asignar propietario ni tocar al propietario.
      const anaZ = await call(router, "POST", "crm/miembros", { ...en(ana, "zeta"), body: { iusuario: "lia", rol: "propietario" } });
      assertEquals(anaZ.status, 403);
      assertEquals((await call(router, "POST", "crm/miembros", { ...en(ana, "zeta"), body: { iusuario: "caro", rol: "agente" } })).status, 403);
      await crm.vincularMiembro("acme", { iusuario: "lia", rol: "lector", bactivo: false });
      assertEquals((await call(router, "GET", "crm/contactos", en(lia))).status, 403, "dado de baja en la empresa ya no entra con su token");
      let falla = "";
      try {
        await crm.vincularMiembro("acme", { iusuario: "ana", bactivo: false });
      } catch (e) {
        falla = (e as Error).message;
      }
      assert(falla.includes("propietario"), "una empresa no se queda sin propietario");
      const crear = await call(router, "POST", "crm/empresas", { ...en(ana, "acme"), body: { nombre: "Nueva" } });
      assertEquals(crear.status, 403, "solo superadmins crean empresas");
      const root = await entrar("root", "acme").catch(() => "");
      assertEquals(root, "", "root no es miembro de ninguna empresa: no entra por el login del CRM");
    } finally {
      await cerrar();
    }
  });

  Deno.test(`crm (${motor}): chat con el bot como el de peon: hilo, historial paginado, búsqueda, no leídas y aviso en vivo`, async () => {
    const { router, entrar, avisos, paquetes, cerrar } = await montar(fabrica);
    try {
      const beto = await entrar("beto", "acme");
      const vacio = await call(router, "GET", "crm/chat?hilo=general", en(beto));
      assertEquals((vacio.data as ChatPagina).lineas, []);
      const primero = await call(router, "POST", "crm/chat", { ...en(beto), body: { hilo: "general", texto: "Hola bot", contexto: { tipo: "contacto", id: "c-acme-1", titulo: "Cliente Acme", fragmento: "linea uno\nlinea dos", visibles: [{ pagina: "p", indice: "1", texto: "t" }] } } });
      assertEquals(primero.status, 200, JSON.stringify(primero.data));
      const env = primero.data as ChatEnviado;
      assertEquals(env.enviado, true);
      assertEquals(env.lineas[0]?.texto, "> linea uno\n> linea dos\n\nHola bot", "cita + texto, como peon");
      assertEquals(paquetes.length, 1);
      assertEquals(paquetes[0]?.texto, "Hola bot");
      assertEquals(paquetes[0]?.empresa.iempresa, "acme");
      assertEquals(paquetes[0]?.usuario, { iusuario: "beto", rol: "agente" });
      assertEquals(paquetes[0]?.contexto?.visibles?.length, 1, "lo visible viaja al canal, no se guarda");
      for (let i = 2; i <= 5; i++) await call(router, "POST", "crm/chat", { ...en(beto), body: { hilo: "general", texto: `mensaje ${i}` } });
      const pag1 = (await call(router, "GET", "crm/chat?hilo=general&limite=3", en(beto))).data as ChatPagina;
      assertEquals(pag1.lineas.map((l) => l.texto), ["mensaje 3", "mensaje 4", "mensaje 5"]);
      assertEquals(pag1.hayMas, true);
      const pag2 = (await call(router, "GET", `crm/chat?hilo=general&limite=3&antes=${pag1.lineas[0]!.id}`, en(beto))).data as ChatPagina;
      assertEquals(pag2.lineas.map((l) => l.texto.replace(/^[\s\S]*\n\n/, "")), ["Hola bot", "mensaje 2"]);
      assertEquals(pag2.hayMas, false);
      const buscado = (await call(router, "GET", "crm/chat?hilo=general&q=MENSAJE%204", en(beto))).data as ChatPagina;
      assertEquals(buscado.lineas.map((l) => l.texto), ["mensaje 4"]);
      const vacioTexto = await call(router, "POST", "crm/chat", { ...en(beto), body: { hilo: "general", texto: "  " } });
      assertEquals(vacioTexto.status, 400);
      const malHilo = await call(router, "POST", "crm/chat", { ...en(beto), body: { hilo: "Mal Hilo!", texto: "x" } });
      assertEquals(malHilo.status, 400);
      // El bot responde por el canal (token): llega a beto con su hilo, avisa en vivo y cuenta como no leída.
      const sinToken = await call(router, "POST", "crm/chat/respuesta", { body: { empresa: "acme", para: "beto", hilo: "general", texto: "x" } });
      assertEquals(sinToken.status, 401);
      const malToken = await call(router, "POST", "crm/chat/respuesta", { headers: { authorization: "Bearer otro-token-cualquiera" }, body: { empresa: "acme", para: "beto", texto: "x" } });
      assertEquals(malToken.status, 401);
      const antes = avisos.length;
      const resp = await call(router, "POST", "crm/chat/respuesta", { headers: { authorization: `Bearer ${TOKEN_CANAL}` }, body: { empresa: "acme", para: "beto", hilo: "general", texto: "**Hola** Beto", widget: { tipo: "grilling" } } });
      assertEquals(resp.status, 200, JSON.stringify(resp.data));
      assertEquals((resp.data as LineaChat).autor, "bot");
      assertEquals(avisos.length, antes + 1);
      assertEquals(avisos[antes]?.para, ["beto"]);
      const hilos = (await call(router, "GET", "crm/chat/hilos", en(beto))).data as HiloChat[];
      assertEquals(hilos.length, 1);
      assertEquals([hilos[0]?.clave, hilos[0]?.titulo, hilos[0]?.mensajes, hilos[0]?.noLeidas, hilos[0]?.ultimo], ["general", "Cliente Acme", 6, 1, "**Hola** Beto"]);
      const leida = await call(router, "POST", "crm/chat/leer", { ...en(beto), body: { iconversacion: hilos[0]!.id } });
      assertEquals((leida.data as { leidas: number }).leidas, 1);
      assertEquals(((await call(router, "GET", "crm/chat/hilos", en(beto))).data as HiloChat[])[0]?.noLeidas, 0);
      const conWidget = (await call(router, "GET", "crm/chat?hilo=general&limite=1", en(beto))).data as ChatPagina;
      assertEquals(conWidget.lineas[0]?.widget, { tipo: "grilling" });
      assertEquals(((await call(router, "GET", "crm/chat/hilos?q=cliente", en(beto))).data as HiloChat[]).length, 1);
      assertEquals(((await call(router, "GET", "crm/chat/hilos?q=zzz", en(beto))).data as HiloChat[]).length, 0);
    } finally {
      await cerrar();
    }
  });

  Deno.test(`crm (${motor}): sin canal el bot avisa que no está configurado, y el mensaje queda guardado`, async () => {
    const { router, entrar, cerrar } = await montar(fabrica, false);
    try {
      const beto = await entrar("beto", "acme");
      const r = (await call(router, "POST", "crm/chat", { ...en(beto), body: { texto: "¿hay alguien?" } })).data as ChatEnviado;
      assertEquals(r.enviado, false);
      assertEquals(r.lineas.map((l) => l.autor), ["usuario", "bot"]);
      assert(r.lineas[1]!.texto.includes("canal"));
    } finally {
      await cerrar();
    }
  });

  Deno.test(`crm (${motor}): adjuntos al almacén (máx. 4 × 8 MB), solo los ve quien es parte, nunca otra empresa`, async () => {
    const { router, entrar, bytes, cerrar } = await montar(fabrica);
    try {
      const beto = await entrar("beto", "acme");
      const datos = b64urlEncode(new TextEncoder().encode("hola archivo"));
      const r = await call(router, "POST", "crm/chat", { ...en(beto), body: { texto: "mira", adjuntos: [{ nombre: "nota.txt", tipo: "text/plain", datos }] } });
      assertEquals(r.status, 200, JSON.stringify(r.data));
      const adj = (r.data as ChatEnviado).lineas[0]!.adjuntos;
      assertEquals(adj.length, 1);
      assertEquals([adj[0]?.nombre, adj[0]?.tamano], ["nota.txt", 12]);
      assertEquals(bytes.size, 1);
      const bajado = await (await router.fetch(new Request(`http://t/api/crm/chat/adjuntos/${adj[0]!.id}`, { headers: { authorization: `Bearer ${beto}` } }))).text();
      assertEquals(bajado, "hola archivo");
      const lia = await entrar("lia", "acme");
      assertEquals((await call(router, "GET", `crm/chat/adjuntos/${adj[0]!.id}`, en(lia))).status, 404, "lia no es parte de la conversación de beto");
      const ana = await entrar("ana", "zeta");
      assertEquals((await call(router, "GET", `crm/chat/adjuntos/${adj[0]!.id}`, en(ana, "zeta"))).status, 404, "otra empresa tampoco");
      const cinco = Array.from({ length: 5 }, (_, i) => ({ nombre: `a${i}.txt`, datos }));
      assertEquals((await call(router, "POST", "crm/chat", { ...en(beto), body: { texto: "muchos", adjuntos: cinco } })).status, 400);
      const solo = await call(router, "POST", "crm/chat", { ...en(beto), body: { adjuntos: [{ nombre: "solo.txt", datos }] } });
      assertEquals((solo.data as ChatEnviado).lineas[0]?.texto, "(archivo adjunto)");
    } finally {
      await cerrar();
    }
  });

  Deno.test(`crm (${motor}): conversaciones directas y de grupo con participantes; nadie lee lo que no es suyo`, async () => {
    const { router, entrar, avisos, cerrar } = await montar(fabrica);
    try {
      const ana = await entrar("ana", "acme");
      const beto = await entrar("beto", "acme");
      const lia = await entrar("lia", "acme");
      const d = await call(router, "POST", "crm/chat", { ...en(ana, "acme"), body: { tipo: "directa", participantes: ["beto"], texto: "hola beto" } });
      assertEquals(d.status, 200, JSON.stringify(d.data));
      const conv = (d.data as ChatEnviado).iconversacion;
      assertEquals(avisos.at(-1)?.para, ["beto"], "el aviso va a los demás, no a quien escribe");
      const deBeto = (await call(router, "GET", "crm/chat/hilos", en(beto))).data as HiloChat[];
      assertEquals([deBeto[0]?.tipo, deBeto[0]?.titulo, deBeto[0]?.noLeidas], ["directa", "ana", 1]);
      const resp = await call(router, "POST", "crm/chat", { ...en(beto), body: { iconversacion: conv, texto: "hola ana" } });
      assertEquals((resp.data as ChatEnviado).iconversacion, conv, "la directa se reusa");
      assertEquals((await call(router, "GET", `crm/chat?iconversacion=${conv}`, en(lia))).status, 404, "lia no es parte");
      assertEquals((await call(router, "POST", "crm/chat", { ...en(lia), body: { iconversacion: conv, texto: "me cuelo" } })).status, 404);
      assertEquals((await call(router, "POST", "crm/chat", { ...en(ana, "acme"), body: { tipo: "directa", participantes: ["zzz"], texto: "x" } })).status, 400, "solo miembros de la empresa");
      assertEquals((await call(router, "POST", "crm/chat", { ...en(ana, "acme"), body: { tipo: "directa", participantes: ["caro"], texto: "x" } })).status, 400, "caro es de zeta, no de acme");
      const g = await call(router, "POST", "crm/conversaciones", { ...en(ana, "acme"), body: { tipo: "grupo", hiloTitulo: "Ventas", participantes: ["beto"] } });
      assertEquals(g.status, 200, JSON.stringify(g.data));
      const gid = (g.data as { id: string }).id;
      assertEquals(((await call(router, "GET", `crm/conversaciones/participantes?iconversacion=${gid}`, en(ana, "acme"))).data as Participante[]).map((p) => p.iparticipante), ["ana", "beto"]);
      assertEquals((await call(router, "POST", "crm/conversaciones/participantes", { ...en(beto), body: { iconversacion: gid, iparticipante: "lia" } })).status, 403, "beto no creó el grupo ni es admin");
      assertEquals((await call(router, "POST", "crm/conversaciones/participantes", { ...en(ana, "acme"), body: { iconversacion: gid, iparticipante: "lia" } })).status, 200);
      assertEquals((await call(router, "POST", "crm/conversaciones/participantes", { ...en(ana, "acme"), body: { iconversacion: gid, iparticipante: "caro" } })).status, 400);
      assertEquals((await call(router, "POST", "crm/chat", { ...en(lia), body: { iconversacion: gid, texto: "soy lector" } })).status, 403, "el lector no escribe en grupos");
      assertEquals((await call(router, "POST", "crm/chat", { ...en(beto), body: { iconversacion: gid, texto: "equipo" } })).status, 200);
      assertEquals((await call(router, "POST", "crm/conversaciones/participantes/quitar", { ...en(lia), body: { iconversacion: gid, iparticipante: "lia" } })).status, 200, "uno sale solo");
      assertEquals((await call(router, "GET", `crm/chat?iconversacion=${gid}`, en(lia))).status, 404);
      const anaZ = await entrar("ana", "zeta");
      assertEquals((await call(router, "GET", `crm/chat?iconversacion=${gid}`, en(anaZ, "zeta"))).status, 404, "la misma persona en otra empresa tampoco ve el grupo");
      assertEquals(((await call(router, "GET", "crm/chat/hilos", en(anaZ, "zeta"))).data as HiloChat[]).length, 0);
    } finally {
      await cerrar();
    }
  });

  Deno.test(`crm (${motor}): un superadmin crea empresas y el propietario entra por el login`, async () => {
    const { router, crm, entrar, cerrar } = await montar(fabrica);
    try {
      await crm.vincularMiembro("acme", { iusuario: "root", rol: "agente" });
      const root = await entrar("root", "acme");
      const creada = await call(router, "POST", "crm/empresas", { ...en(root, "acme"), body: { nombre: "Más Ñandú S.A.", propietario: "root" } });
      assertEquals(creada.status, 200, JSON.stringify(creada.data));
      assertEquals((creada.data as { iempresa: string }).iempresa, "mas-nandu-s-a");
      const dup = await call(router, "POST", "crm/empresas", { ...en(root, "acme"), body: { nombre: "Otra", iempresa: "mas-nandu-s-a" } });
      assertEquals(dup.status, 400);
      const lista = (await call(router, "GET", "crm/empresas", en(root))).data as EmpresaResumen[];
      assertEquals(lista.map((e) => e.iempresa), ["acme", "mas-nandu-s-a"]);
      assertEquals((await entrar("root", "mas-nandu-s-a")).length > 20, true);
    } finally {
      await cerrar();
    }
  });
}
