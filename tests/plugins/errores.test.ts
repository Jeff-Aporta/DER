/**
 * Errores, archivos y penalizaciones juntos sobre el router real: reporte con código y penalización por vectores, sesión confiable,
 * adjuntos según el proveedor de LLM del consumidor, toma atómica entre agentes, bitácora y borrado en plural.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { createClient, erroresPlugin, identity } from "@Jeff-Aporta/DER/src/03-plugins/client.ts";
import { createRouter, createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { type AlmacenArchivos, archivosServer, COLUMNAS_AUDITORIA, dataUrl, entradaConImagenes, erroresServer, identityServer, minutosDe, penalizacionesServer, propietarioDe, proveedorLlm, servicios, type Veredicto, vectorActivo, veredicto, ZPenalizacionesConfig } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import { identityCfg, SECRET } from "@Jeff-Aporta/DER/tests/_util.ts";
import { hojaModelo } from "@Jeff-Aporta/DER/examples/diagramas-plugins.ts";

const CODIGO = "codigo-de-prueba";
const CFG_MULTAS = ZPenalizacionesConfig.parse({});

/** Almacén en memoria (en una API real lo implementa el consumidor). */
function almacenMemoria() {
  const objetos = new Map<string, { bytes: Uint8Array; mime: string }>();
  const almacen: AlmacenArchivos = {
    subir(clave, bytes, meta) {
      objetos.set(clave, { bytes, mime: meta.mime });
      return Promise.resolve();
    },
    bajar(clave) {
      const o = objetos.get(clave);
      return Promise.resolve(o ? { cuerpo: o.bytes as unknown as BodyInit, mime: o.mime, bytes: o.bytes.length } : null);
    },
    borrar(clave) {
      objetos.delete(clave);
      return Promise.resolve();
    },
  };
  return { almacen, objetos };
}

/** API con los cuatro plugins; `ip` simula la IP real que da el consumidor. */
async function montar(opciones: { confiable?: boolean } = {}) {
  registry.secure(null);
  servicios.limpiar();
  const db = sqliteDatabase();
  const { almacen, objetos } = almacenMemoria();
  const avisos: number[] = [];
  const auth = createServer(identityServer, { db, cfg: identityCfg() });
  const multas = createServer(penalizacionesServer, { db, cfg: {} });
  const archivos = createServer(archivosServer, { db, cfg: { secret: SECRET }, services: { almacen } });
  const llm = proveedorLlm({ acciones: { transcribir: () => Promise.resolve("dice que no guarda") }, reglas: [{ mime: "audio/*", accion: "transcribir", conservar: false }, { mime: "image/*", conservar: true }] });
  const enlaces = {
    alReportar: (e: { ierror: number }) => void avisos.push(Number(e.ierror)),
    ...(opciones.confiable === false ? { reportanteConfiable: () => false } : {}),
  };
  const errores = createServer(erroresServer, { db, cfg: { secret: SECRET, codigo: CODIGO }, services: { archivos, penalizaciones: multas, llm, enlaces, ipDe: (r: Request) => r.headers.get("x-ip-prueba") } });
  const router = createRouter([], { basePath: "/api", plugins: [auth, multas, archivos, errores] });
  await router.seed();
  const cerrar = async () => {
    registry.secure(null);
    servicios.limpiar();
    await db.destroy();
  };
  const cliente = (ip: string | null, base?: () => HeadersInit | Promise<HeadersInit>) => createClient(erroresPlugin, { baseUrl: "http://t/api", headers: async () => {
    const h = new Headers(base ? await base() : {});
    if (ip) h.set("x-ip-prueba", ip);
    return h;
  }, fetch: (input, init) => router.fetch(new Request(input, init)) });
  const sesion = createClient(identity, { baseUrl: "http://t/api", fetch: (input, init) => router.fetch(new Request(input, init)) });
  await sesion["login"]({ usuario: "admin", password: "admin-12345" });
  const atiende = cliente(null, sesion.headers);
  return { router, cliente, atiende, sesion, objetos, avisos, multas, cerrar };
}

Deno.test("penalizaciones: escala 0, 0, 5, 10… con tope de 30 minutos", () => {
  assertEquals([1, 2, 3, 4, 5, 6, 7, 8, 9, 20].map((n) => minutosDe(n, CFG_MULTAS.escalaMin)), [0, 0, 5, 10, 15, 20, 25, 30, 30, 30]);
});

Deno.test("penalizaciones: decide la IP; sin IP o con 10 fallos en una hora decide el global", () => {
  const ahora = 10_000_000_000;
  const hace = (min: number) => ahora - min * 60_000;
  assertEquals(vectorActivo(null, [], CFG_MULTAS, ahora), "global");
  assertEquals(vectorActivo("1.1.1.1", Array(9).fill(hace(1)), CFG_MULTAS, ahora), "ip");
  assertEquals(vectorActivo("1.1.1.1", Array(10).fill(hace(1)), CFG_MULTAS, ahora), "global");
  assertEquals(vectorActivo("1.1.1.1", Array(10).fill(hace(61)), CFG_MULTAS, ahora), "ip");
  const v: Veredicto = veredicto("ip", [hace(2), hace(2), hace(2)], CFG_MULTAS, ahora);
  assertEquals([v.penalizado, v.restanteMs], [true, 3 * 60_000]);
  assertEquals(veredicto("ip", [hace(6), hace(6), hace(6)], CFG_MULTAS, ahora).penalizado, false);
});

Deno.test("errores: sin sesión exige código; el tercer fallo penaliza por IP y otra IP sigue libre", async () => {
  const { cliente, multas, cerrar } = await montar();
  try {
    const a = cliente("1.1.1.1");
    await assertRejects(() => a["reportarError"]({ descripcion: "x", codigo: "malo-malo-1" }), Error, "incorrecto");
    await assertRejects(() => a["reportarError"]({ descripcion: "x", codigo: "malo-malo-2" }), Error, "incorrecto");
    await assertRejects(() => a["reportarError"]({ descripcion: "x", codigo: "malo-malo-3" }), Error, "incorrecto");
    // penalizado: ni con el código bueno pasa, y el rechazo no cuenta como fallo
    await assertRejects(() => a["reportarError"]({ descripcion: "x", codigo: CODIGO }), Error, "Demasiados intentos");
    assertEquals((await multas["verificar"]({ ambito: "errores", ip: "1.1.1.1" }) as Veredicto).fallidos, 3);
    const b = await cliente("2.2.2.2")["reportarError"]({ descripcion: "No guarda\nsegunda línea", ruta: "/crm", codigo: CODIGO });
    assertEquals(b.estado, "pendiente");
  } finally {
    await cerrar();
  }
});

Deno.test("errores: 10 fallos entre varias IP activan el vector global para todos", async () => {
  const { cliente, multas, cerrar } = await montar();
  try {
    for (let n = 0; n < 10; n++) await multas["fallo"]({ ambito: "errores", ip: `9.9.9.${n}` });
    await assertRejects(() => cliente("3.3.3.3")["reportarError"]({ descripcion: "x", codigo: CODIGO }), Error, "Demasiados intentos");
  } finally {
    await cerrar();
  }
});

Deno.test("errores: la sesión confiable no pide código; el consumidor decide quién lo es", async () => {
  const conSesion = await montar();
  try {
    const r = await conSesion.atiende["reportarError"]({ descripcion: "desde el panel" });
    assertEquals(r.estado, "pendiente");
    assertEquals(conSesion.avisos, [r.ierror]);
  } finally {
    await conSesion.cerrar();
  }
  const sinConfianza = await montar({ confiable: false });
  try {
    await assertRejects(() => sinConfianza.atiende["reportarError"]({ descripcion: "perfil de prueba" }), Error, "incorrecto");
  } finally {
    await sinConfianza.cerrar();
  }
});

Deno.test("errores: el audio se transcribe y no se guarda; la imagen se guarda; atendido borra fila y objetos", async () => {
  const { cliente, atiende, objetos, avisos, router, cerrar } = await montar();
  try {
    const c = cliente("4.4.4.4");
    const { ierror, token, estado } = await c["reportarError"]({ descripcion: "", ruta: "/crm", html: "<p>hola</p>", contexto: { ancho: 390 }, apporigin: "demo", codigo: CODIGO, adjuntos: 2 });
    assertEquals(estado, "recibiendo");
    assertEquals(avisos, []); // aún no está en la cola
    assertEquals(await atiende["colaErrores"](), []);
    const audio = await c["adjuntarError"](ierror, token, new Blob([new Uint8Array([1, 2])], { type: "audio/webm" }), "nota.webm");
    assertEquals([audio.texto, audio.archivo], ["dice que no guarda", null]);
    assertEquals(objetos.size, 0);
    const imagen = await c["adjuntarError"](ierror, token, new Blob([new Uint8Array([3, 4, 5])], { type: "image/png" }), "captura.png");
    assertEquals(imagen.archivo?.mime, "image/png");
    assertEquals(objetos.size, 1);
    const baja = await router.fetch(new Request(imagen.archivo!.url));
    assertEquals(new Uint8Array(await baja.arrayBuffer()), new Uint8Array([3, 4, 5]));
    await assertRejects(() => c["adjuntarError"](ierror, "1.falso", new Blob(["x"], { type: "image/png" })), Error, "Token");
    assertEquals((await c["errorListo"](ierror, token)).estado, "pendiente");
    assertEquals(avisos, [ierror]);

    const cola = await atiende["colaErrores"]();
    assertEquals(cola.map((e: { ierror: number }) => e.ierror), [ierror]);
    assertEquals("html" in cola[0], false);
    const detalle = await atiende["detalleError"](ierror);
    assertEquals([detalle.html, detalle.apporigin, detalle.iporigin, detalle.propietario_tipo, detalle.propietario], ["<p>hola</p>", "demo", "4.4.4.4", "pagina", "/crm"]);
    assert(detalle.transcripcion.includes("dice que no guarda"));
    assertEquals(detalle.archivos.length, 1);

    // dos agentes: solo uno gana
    const [uno, dos] = await Promise.allSettled([atiende["tomarError"](ierror, { agente: "uno" }), atiende["tomarError"](ierror, { agente: "dos" })]);
    assertEquals([uno.status, dos.status].sort(), ["fulfilled", "rejected"]);
    const dueno = uno.status === "fulfilled" ? "uno" : "dos";
    assertEquals(await atiende["colaErrores"](), []);
    await assertRejects(() => atiende["avanceError"](ierror, { agente: "intruso", texto: "x" }), Error, "no está tomado");
    await atiende["avanceError"](ierror, { agente: dueno, texto: "Reproducido" });
    const seguimiento = await c["seguimientoError"](ierror, token);
    assertEquals([seguimiento.estado, seguimiento.avance[0].texto], ["en_proceso", "Reproducido"]);

    // atendido: DELETE en plural; se van fila y objetos
    await atiende.controllers["errores"]!.deleteList([{ ierror }]);
    assertEquals(objetos.size, 0);
    assertEquals((await c["seguimientoError"](ierror, token)).estado, "atendido");
  } finally {
    await cerrar();
  }
});

Deno.test("errores: soltar devuelve a la cola con la nota en la bitácora", async () => {
  const { atiende, cerrar } = await montar();
  try {
    const { ierror } = await atiende["reportarError"]({ descripcion: "no se pudo" });
    await atiende["tomarError"](ierror, { agente: "uno" });
    await atiende["soltarError"](ierror, { agente: "uno", texto: "falta contexto" });
    const [fila] = await atiende["colaErrores"]();
    assertEquals(fila.estado, "pendiente");
    const detalle = await atiende["detalleError"](ierror);
    assert(detalle.avance[0].texto.includes("falta contexto"));
  } finally {
    await cerrar();
  }
});

Deno.test("comunes: auditoría, singleton de credenciales y helpers de entrada para modelos", () => {
  assertEquals(propietarioDe({ id: "ana" }), { propietario_tipo: "usuario", propietario: "ana" });
  assertEquals(propietarioDe(null, "/crm"), { propietario_tipo: "pagina", propietario: "/crm" });
  assertEquals(propietarioDe(null), { propietario_tipo: "ninguno", propietario: null });
  assert("fhcre" in COLUMNAS_AUDITORIA && "iporigin" in COLUMNAS_AUDITORIA);
  servicios.configurar({ credenciales: { llm: { apiKey: "env:CLAVE_X", url: "https://x" }, otro: { apiKey: "env:NO_EXISTE" } } }, { CLAVE_X: "secreta" });
  assertEquals(servicios.credencial("llm"), { apiKey: "secreta", url: "https://x" });
  assertEquals(servicios.credencial("otro"), {});
  assertEquals(servicios.credencial("nada"), null);
  servicios.limpiar();
  const llm = proveedorLlm({ credencial: "llm", acciones: { t: () => Promise.resolve("") }, reglas: [{ mime: "audio/*", accion: "t", conservar: false }] });
  assertEquals(llm.planPara("audio/webm;codecs=opus")?.accion, "t");
  assertEquals(llm.planPara("image/png"), null);
  assertEquals(llm.disponible("t"), false); // sin credencial no se llama
  assertEquals(dataUrl(new Uint8Array([104, 105]), "image/png"), "data:image/png;base64,aGk=");
  assertEquals(entradaConImagenes("mira", [{ url: "u" }])[0]!.content.map((c) => c.type), ["input_text", "input_image"]);
});

Deno.test("docs: el diagrama del modelo de datos está al día con las entidades", async () => {
  registry.secure(null);
  const hoja = await Deno.readTextFile(new URL("../../docs/050-Plugins/060-Modelo-de-datos.md", import.meta.url));
  assertEquals(hoja, await hojaModelo());
});
