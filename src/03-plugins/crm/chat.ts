/**
 * El chat del plugin CRM: conversaciones por hilo (`clave`), participantes con lectura, mensajes con widget y contexto
 * citado, adjuntos (máx. 4 × 8 MB) y respuesta del bot por canal. Replica el comportamiento del chat de peon: historial
 * paginado (la página más reciente primero, `antes` = id más viejo, `q` busca), lista de chats con no leídas, texto
 * guardado = cita + texto + transcripción, y el aviso del bot si no hay canal. TODO se filtra por la empresa activa y
 * por la participación del usuario: nadie lee una conversación de la que no es parte, ni de otra empresa.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/crm.md
 */
import { HttpError, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { b64urlDecode } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { activo, contactoDe, contexto, exigir, rango } from "@Jeff-Aporta/DER/src/03-plugins/crm/empresas.ts";
import { type AdjuntoCrm, BOT_POR_DEFECTO, type ChatConsulta, type ChatEnviado, type ChatPagina, type ContextoChat, type ContextoCrm, type Conversacion, type CrmConfig, type EnviarChatInput, type HiloChat, type LineaChat, MAX_ADJUNTOS, MAX_BYTES_ADJUNTO, type MensajeCrm, type Miembro, type PaqueteCanal, type Participante, type ParticipanteInput, type RespuestaBotInput, type TipoParticipante, ZEnviarChat, ZParticipante, ZRespuestaBot } from "@Jeff-Aporta/DER/src/03-plugins/crm/schemas.ts";
import { acotado, ahora, ctrl, filas, guardar, idNuevo, isoDe, porPk, validado } from "@Jeff-Aporta/DER/src/03-plugins/common/tablas.ts";
import { serviciosDe } from "@Jeff-Aporta/DER/src/03-plugins/crm/util.ts";

const botDe = (plugin: ServerPlugin): string => ((plugin.cfg ?? {}) as CrmConfig).bot ?? BOT_POR_DEFECTO;

const nombreSeguro = (n: string): string => n.replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, "_").slice(0, 120) || "archivo";

/** Clave de hilo: `general`, `contacto:12`, `pagina:inicio`… (minúsculas, sin espacios). */
export function validarHilo(v: unknown): string {
  const h = String(v ?? "general").trim().toLowerCase().slice(0, 80);
  if (!/^[a-z][a-z0-9_-]*(:[a-z0-9_.-]+)*$/.test(h)) throw new ValidationError("Hilo inválido (ej.: general, contacto:12, pagina:inicio)");
  return h;
}

/** Participación de un usuario en una conversación (o null). */
async function participacion(plugin: ServerPlugin, iconversacion: string, iparticipante: string): Promise<Participante | null> {
  return await porPk<Participante>(plugin, "participantes", { iconversacion, iparticipante });
}

/** Las conversaciones de la empresa de las que el usuario es parte (activas). */
async function conversacionesDe(plugin: ServerPlugin, ctx: ContextoCrm): Promise<{ c: Conversacion; p: Participante }[]> {
  const partes = await filas<Participante>(plugin, "participantes", { where: { iparticipante: ctx.iusuario, iempresa: ctx.iempresa, tipo: "usuario" } });
  if (!partes.length) return [];
  const convs = await filas<Conversacion>(plugin, "conversaciones", { where: { id: partes.map((p) => p.iconversacion), iempresa: ctx.iempresa, bactivo: true } });
  const porId = new Map(partes.map((p) => [p.iconversacion, p]));
  return convs.map((c) => ({ c, p: porId.get(c.id)! }));
}

/** Una conversación a la que el usuario tiene acceso (parte de ella, en esta empresa); si no, 404 sin distinguir el motivo. */
async function acceso(plugin: ServerPlugin, ctx: ContextoCrm, iconversacion: string): Promise<Conversacion> {
  const c = await porPk<Conversacion>(plugin, "conversaciones", { id: iconversacion });
  if (!c || c.iempresa !== ctx.iempresa || !activo(c.bactivo) || !(await participacion(plugin, c.id, ctx.iusuario))) throw new HttpError(404, "Esa conversación no existe");
  return c;
}

/** Comprueba que cada usuario sea miembro activo de la empresa. */
async function exigirMiembros(plugin: ServerPlugin, iempresa: string, usuarios: string[]): Promise<void> {
  for (const u of usuarios) {
    const m = await porPk<Miembro>(plugin, "miembros", { iempresa, iusuario: u });
    if (!m || !activo(m.bactivo)) throw new ValidationError(`«${u}» no pertenece a la empresa`);
  }
}

/** Alta de un participante (idempotente). */
async function sumar(plugin: ServerPlugin, iempresa: string, iconversacion: string, iparticipante: string, tipo: TipoParticipante): Promise<Participante> {
  const previo = await participacion(plugin, iconversacion, iparticipante);
  return previo ?? await guardar<Participante>(plugin, "participantes", { iconversacion, iparticipante }, { tipo, iempresa, fhlectura: tipo === "usuario" ? null : ahora(), fhcre: ahora() });
}

/** Clave estable de una conversación directa entre usuarios (legible si cabe, con huella si no). */
async function claveDirecta(usuarios: string[]): Promise<string> {
  const clave = `directa:${usuarios.sort().join(":")}`;
  if (clave.length <= 80) return clave;
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clave));
  return `directa:${[...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40)}`;
}

/** Abre (o reusa) la conversación pedida por id o por clave de hilo; las nuevas llevan a su creador, al bot y a los participantes. */
export async function abrirConversacion(plugin: ServerPlugin, ctx: ContextoCrm, input: EnviarChatInput): Promise<Conversacion> {
  if (input.iconversacion) return await acceso(plugin, ctx, input.iconversacion);
  const tipo = input.tipo ?? "bot";
  const otros = [...new Set((input.participantes ?? []).filter((u) => u !== ctx.iusuario))];
  if (tipo === "directa" && otros.length !== 1) throw new ValidationError("Una conversación directa tiene exactamente otro participante");
  if (tipo === "grupo" && !otros.length) throw new ValidationError("Un grupo necesita al menos otro participante");
  if (tipo !== "bot") exigir(ctx, "agente");
  const clave = tipo === "directa" ? await claveDirecta([ctx.iusuario, ...otros]) : validarHilo(input.hilo ?? (tipo === "grupo" ? `grupo:${idNuevo()}` : "general"));
  const previa = (await conversacionesDe(plugin, ctx)).find(({ c }) => c.clave === clave);
  if (previa) return previa.c;
  await exigirMiembros(plugin, ctx.iempresa, otros);
  if (input.icontacto) await contactoDe(plugin, ctx.iempresa, input.icontacto);
  const titulo = (acotado(input.hiloTitulo, 160) ?? (tipo === "directa" ? otros[0]! : clave === "general" ? "Asistente" : clave)).slice(0, 160);
  const ahoraIso = ahora();
  const nueva = await guardar<Conversacion>(plugin, "conversaciones", { id: idNuevo() }, { iempresa: ctx.iempresa, clave, titulo, tipo, icontacto: input.icontacto ?? null, creador: ctx.iusuario, ultimo: null, qmensajes: 0, bactivo: true, fhcre: ahoraIso, factualizado: ahoraIso });
  await sumar(plugin, ctx.iempresa, nueva.id, ctx.iusuario, "usuario");
  for (const u of otros) await sumar(plugin, ctx.iempresa, nueva.id, u, "usuario");
  if (tipo === "bot") await sumar(plugin, ctx.iempresa, nueva.id, botDe(plugin), "bot");
  return nueva;
}

/** Línea de chat (como la pinta el front) con sus adjuntos ya consultados. */
function linea(m: MensajeCrm, hilo: string, adjuntos: AdjuntoCrm[]): LineaChat {
  return { id: m.id, autor: m.autor, iautor: m.iautor, texto: m.texto, hilo, iconversacion: m.iconversacion, widget: m.jwidget ?? null, contexto: m.jcontexto ?? null, creado: isoDe(m.fhcre), adjuntos: adjuntos.filter((a) => a.imensaje === m.id).map((a) => ({ id: a.id, nombre: a.nombre, tipo: a.tipo, tamano: a.tamano })) };
}

/** Adjuntos de varios mensajes en una sola consulta. */
async function adjuntosDe(plugin: ServerPlugin, ids: string[]): Promise<AdjuntoCrm[]> {
  return ids.length ? await filas<AdjuntoCrm>(plugin, "adjuntos", { where: { imensaje: ids } }) : [];
}

/** Anota la actividad en la conversación: último texto, contador, hora (y título si llega uno). */
async function tocar(plugin: ServerPlugin, c: Conversacion, ultimo: string, titulo?: string | null): Promise<void> {
  const cambio: Record<string, unknown> = { ultimo: ultimo.slice(0, 200), qmensajes: Number(c.qmensajes ?? 0) + 1, factualizado: ahora() };
  if (titulo) cambio["titulo"] = titulo.slice(0, 160);
  await guardar(plugin, "conversaciones", { id: c.id }, cambio);
}

/** Guarda un mensaje y devuelve su línea (sin adjuntos aún). */
async function insertar(plugin: ServerPlugin, c: Conversacion, autor: TipoParticipante, iautor: string, texto: string, extra: { widget?: unknown; contexto?: unknown } = {}): Promise<MensajeCrm> {
  return await guardar<MensajeCrm>(plugin, "mensajes", { id: idNuevo() }, { iempresa: c.iempresa, iconversacion: c.id, autor, iautor, texto, jwidget: extra.widget ?? null, jcontexto: extra.contexto ?? null, bactivo: true, fhcre: ahora() });
}

/** Valida y decodifica los adjuntos antes de guardar nada: cantidad, tamaño y que haya almacén. */
function prepararAdjuntos(plugin: ServerPlugin, lista: EnviarChatInput["adjuntos"]): { nombre: string; tipo: string; bytes: Uint8Array }[] {
  if (!lista?.length) return [];
  if (lista.length > MAX_ADJUNTOS) throw new ValidationError(`Máximo ${MAX_ADJUNTOS} archivos por mensaje`);
  if (!serviciosDe(plugin).almacen) throw new ValidationError("Esta API no tiene almacén de adjuntos configurado");
  const listos = [];
  for (const a of lista) {
    const datos = a.datos.replace(/^data:[^,]*,/, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const bytes = b64urlDecode(datos);
    if (!bytes.length) continue;
    if (bytes.length > MAX_BYTES_ADJUNTO) throw new HttpError(413, `«${a.nombre}» pasa de 8 MB`);
    listos.push({ nombre: nombreSeguro(a.nombre), tipo: (a.tipo ?? "application/octet-stream").slice(0, 120), bytes });
  }
  return listos;
}

/** Sube los bytes al almacén y deja la ficha de cada adjunto. */
async function guardarAdjuntos(plugin: ServerPlugin, m: MensajeCrm, listos: { nombre: string; tipo: string; bytes: Uint8Array }[]): Promise<AdjuntoCrm[]> {
  const almacen = serviciosDe(plugin).almacen;
  const fichas: AdjuntoCrm[] = [];
  for (const a of listos) {
    const id = idNuevo();
    const clave = `crm/${m.iempresa}/${id}`;
    await almacen!.subir(clave, a.bytes, { mime: a.tipo, nombre: a.nombre });
    fichas.push(await guardar<AdjuntoCrm>(plugin, "adjuntos", { id }, { iempresa: m.iempresa, imensaje: m.id, nombre: a.nombre, tipo: a.tipo, tamano: a.bytes.length, clave, fhcre: ahora() }));
  }
  return fichas;
}

/** Avisa al consumidor (SSE, push…) de una línea nueva para los demás usuarios de la conversación. */
async function avisar(plugin: ServerPlugin, c: Conversacion, l: LineaChat, excepto: string | null): Promise<void> {
  const destinatarios = (await filas<Participante>(plugin, "participantes", { where: { iconversacion: c.id, tipo: "usuario" } })).map((p) => p.iparticipante).filter((u) => u !== excepto);
  const s = serviciosDe(plugin);
  if (destinatarios.length && s.alMensaje) await s.alMensaje(l, destinatarios);
  if (destinatarios.length && s.notificar && l.autor !== "usuario") await s.notificar(destinatarios, c.titulo, l.texto.slice(0, 140), c.clave === "general" ? "chat" : `chat:${c.clave}`);
}

/** Escribe un mensaje (peon: «enviar»): guarda la línea con cita y transcripción, sube adjuntos, marca leído y, en chats con bot, avisa al canal. */
export async function enviarChat(plugin: ServerPlugin, ctx: ContextoCrm, input: EnviarChatInput): Promise<ChatEnviado> {
  const d = validado<EnviarChatInput>(ZEnviarChat, input);
  const texto = (d.texto ?? "").trim();
  const transcripcion = acotado(d.transcripcion, 4000);
  const hayAdjuntos = (d.adjuntos?.length ?? 0) > 0;
  if (!texto && !hayAdjuntos && !transcripcion) throw new ValidationError("Escribe un mensaje o adjunta un archivo");
  const listos = prepararAdjuntos(plugin, d.adjuntos);
  const c = await abrirConversacion(plugin, ctx, d);
  if (c.tipo !== "bot") exigir(ctx, "agente");
  const cx = d.contexto ?? null;
  const cita = cx?.fragmento ? cx.fragmento.split("\n").map((l) => `> ${l}`).join("\n") : "";
  const guardado = [cita, texto, transcripcion ? `🎙 ${transcripcion}` : ""].filter(Boolean).join("\n\n") || "(archivo adjunto)";
  const citado = cx ? { tipo: cx.tipo, id: cx.id ?? null, titulo: cx.titulo ?? null, fragmento: cx.fragmento ?? null, pantalla: cx.pantalla ?? null } : null;
  const m = await insertar(plugin, c, "usuario", ctx.iusuario, guardado, { contexto: citado });
  const fichas = await guardarAdjuntos(plugin, m, listos);
  await tocar(plugin, c, guardado, d.hiloTitulo ?? cx?.titulo ?? null);
  await guardar(plugin, "participantes", { iconversacion: c.id, iparticipante: ctx.iusuario }, { fhlectura: ahora() });
  const propia = linea(m, c.clave, fichas);
  await avisar(plugin, c, propia, ctx.iusuario);
  if (c.tipo !== "bot") return { enviado: true, iconversacion: c.id, lineas: [propia] };
  const canal = serviciosDe(plugin).canal;
  if (!canal) {
    const aviso = await insertar(plugin, c, "bot", botDe(plugin), "El canal con el bot todavía no está configurado (falta vincular el servicio `canal` en la API). Tu mensaje quedó guardado.");
    await tocar(plugin, c, aviso.texto);
    return { enviado: false, iconversacion: c.id, lineas: [propia, linea(aviso, c.clave, [])] };
  }
  const paquete: PaqueteCanal = { empresa: ctx.empresa, usuario: { iusuario: ctx.iusuario, rol: ctx.rol }, conversacion: c, mensaje: propia, texto, transcripcion, contexto: cx as ContextoChat | null };
  let enviado = false;
  try {
    enviado = !!(await canal(paquete));
  } catch { /* el canal caído no pierde el mensaje: queda guardado y `enviado` es false */ }
  return { enviado, iconversacion: c.id, lineas: [propia] };
}

/** Respuesta del bot a un usuario de una empresa: crea el hilo si no existe, guarda la línea y avisa en vivo y por notificación. */
export async function responderBot(plugin: ServerPlugin, input: RespuestaBotInput): Promise<LineaChat> {
  const d = validado<RespuestaBotInput>(ZRespuestaBot, input);
  const ctx = await contexto(plugin, d.para, d.empresa);
  const c = await abrirConversacion(plugin, ctx, { hilo: validarHilo(d.hilo ?? "general") });
  const m = await insertar(plugin, c, "bot", d.bot ?? botDe(plugin), d.texto.slice(0, 8000), { widget: d.widget && typeof d.widget === "object" ? d.widget : null });
  await tocar(plugin, c, d.texto);
  const l = linea(m, c.clave, []);
  await avisar(plugin, c, l, null);
  return l;
}

/** Historial paginado de una conversación (por id o por hilo): la página más reciente en orden cronológico; un hilo nuevo viene vacío. */
export async function historial(plugin: ServerPlugin, ctx: ContextoCrm, q: ChatConsulta): Promise<ChatPagina> {
  const limite = Math.min(Math.max(Number(q.limite ?? 30) || 30, 1), 100);
  const base = { maxAdjuntos: MAX_ADJUNTOS, maxBytes: MAX_BYTES_ADJUNTO };
  let c: Conversacion | undefined;
  if (q.iconversacion) c = await acceso(plugin, ctx, q.iconversacion);
  else {
    const hilo = validarHilo(q.hilo ?? "general");
    c = (await conversacionesDe(plugin, ctx)).find((x) => x.c.clave === hilo)?.c;
    if (!c) return { iconversacion: "", hilo, hayMas: false, ...base, lineas: [] };
  }
  const where: Record<string, unknown> = { iconversacion: c.id, iempresa: ctx.iempresa, bactivo: true };
  if (q.antes) where["id"] = { lt: q.antes };
  const buscado = acotado(q.q, 80);
  if (buscado) where["texto"] = { contains: buscado };
  const pagina = await filas<MensajeCrm>(plugin, "mensajes", { where, orderBy: ["-id"], page: 1, pageSize: limite + 1 });
  const visibles = pagina.slice(0, limite).reverse();
  const adjuntos = await adjuntosDe(plugin, visibles.map((m) => m.id));
  return { iconversacion: c.id, hilo: c.clave, hayMas: pagina.length > limite, ...base, lineas: visibles.map((m) => linea(m, c!.clave, adjuntos)) };
}

/** Cuántas líneas ajenas hay sin leer (hasta 100) en una conversación desde `desde`. */
async function sinLeer(plugin: ServerPlugin, c: Conversacion, usuario: string, desde: string | null): Promise<number> {
  const where: Record<string, unknown> = { iconversacion: c.id, bactivo: true, iautor: { ne: usuario } };
  if (desde) where["fhcre"] = { gt: isoDe(desde) };
  return (await ctrl(plugin, "mensajes").query({ where, select: ["id"], pageSize: 100 } as never)).length;
}

/** En una conversación directa el título es la otra persona (cada quien ve el nombre del otro). */
async function otroDe(plugin: ServerPlugin, c: Conversacion, usuario: string): Promise<string> {
  const otros = await filas<Participante>(plugin, "participantes", { where: { iconversacion: c.id, tipo: "usuario", iparticipante: { ne: usuario } } });
  return otros[0]?.iparticipante ?? c.titulo;
}

/** Los chats del usuario en la empresa activa (lo más reciente primero), con no leídas; `q` busca en título, clave y último texto. */
export async function hilos(plugin: ServerPlugin, ctx: ContextoCrm, q?: string): Promise<HiloChat[]> {
  const t = acotado(q, 80)?.toLowerCase();
  const propias = (await conversacionesDe(plugin, ctx)).filter(({ c }) => !t || [c.titulo, c.clave, c.ultimo ?? ""].some((x) => x.toLowerCase().includes(t)));
  propias.sort((a, b) => Date.parse(isoDe(b.c.factualizado)) - Date.parse(isoDe(a.c.factualizado)));
  const salida: HiloChat[] = [];
  for (const { c, p } of propias.slice(0, 100)) salida.push({ id: c.id, clave: c.clave, titulo: c.tipo === "directa" ? await otroDe(plugin, c, ctx.iusuario) : c.titulo, tipo: c.tipo, ultimo: c.ultimo, mensajes: Number(c.qmensajes ?? 0), actualizado: isoDe(c.factualizado), noLeidas: await sinLeer(plugin, c, ctx.iusuario, p.fhlectura) });
  return salida;
}

/** Marca la conversación como leída hasta ahora y dice cuántas había sin leer. */
export async function leerChat(plugin: ServerPlugin, ctx: ContextoCrm, iconversacion: string): Promise<{ leidas: number }> {
  const c = await acceso(plugin, ctx, iconversacion);
  const p = (await participacion(plugin, c.id, ctx.iusuario))!;
  const leidas = await sinLeer(plugin, c, ctx.iusuario, p.fhlectura);
  await guardar(plugin, "participantes", { iconversacion: c.id, iparticipante: ctx.iusuario }, { fhlectura: ahora() });
  return { leidas };
}

/** Quiénes están en la conversación (solo si el usuario es parte). */
export async function participantes(plugin: ServerPlugin, ctx: ContextoCrm, iconversacion: string): Promise<Participante[]> {
  const c = await acceso(plugin, ctx, iconversacion);
  return await filas<Participante>(plugin, "participantes", { where: { iconversacion: c.id }, orderBy: ["iparticipante"] });
}

/** ¿Puede administrar a los participantes? Quien creó la conversación o un `admin` de la empresa. */
function puedeAdministrar(ctx: ContextoCrm, c: Conversacion): boolean {
  return c.creador === ctx.iusuario || rango(ctx.rol) >= rango("admin");
}

/** Agrega un usuario de la empresa, un bot o un contacto a un grupo. */
export async function agregarParticipante(plugin: ServerPlugin, ctx: ContextoCrm, input: ParticipanteInput): Promise<Participante> {
  const d = validado<ParticipanteInput>(ZParticipante, input);
  const c = await acceso(plugin, ctx, d.iconversacion);
  if (c.tipo !== "grupo") throw new ValidationError("Solo los grupos admiten agregar participantes");
  if (!puedeAdministrar(ctx, c)) throw new HttpError(403, "Solo quien creó el grupo o un admin puede agregar participantes");
  const tipo = d.tipo ?? "usuario";
  if (tipo === "usuario") await exigirMiembros(plugin, ctx.iempresa, [d.iparticipante]);
  if (tipo === "contacto") await contactoDe(plugin, ctx.iempresa, d.iparticipante);
  return await sumar(plugin, ctx.iempresa, c.id, d.iparticipante, tipo);
}

/** Saca a un participante de un grupo (uno puede salir solo); el creador no puede irse dejando el grupo sin usuarios. */
export async function quitarParticipante(plugin: ServerPlugin, ctx: ContextoCrm, input: ParticipanteInput): Promise<{ quitados: number }> {
  const d = validado<ParticipanteInput>(ZParticipante, input);
  const c = await acceso(plugin, ctx, d.iconversacion);
  if (c.tipo !== "grupo") throw new ValidationError("Solo los grupos admiten quitar participantes");
  if (d.iparticipante !== ctx.iusuario && !puedeAdministrar(ctx, c)) throw new HttpError(403, "Solo quien creó el grupo o un admin puede quitar a otros");
  const previo = await participacion(plugin, c.id, d.iparticipante);
  if (!previo) return { quitados: 0 };
  const usuarios = (await filas<Participante>(plugin, "participantes", { where: { iconversacion: c.id, tipo: "usuario" } })).filter((p) => p.iparticipante !== d.iparticipante);
  if (previo.tipo === "usuario" && !usuarios.length) throw new ValidationError("El grupo no puede quedarse sin usuarios");
  const c2 = ctrl(plugin, "participantes");
  await c2.delete(c2.pojo({ iconversacion: c.id, iparticipante: d.iparticipante }));
  return { quitados: 1 };
}

/** Bytes de un adjunto como respuesta HTTP (solo para quien es parte de la conversación del mensaje). */
export async function adjunto(plugin: ServerPlugin, ctx: ContextoCrm, id: string): Promise<Response> {
  const a = await porPk<AdjuntoCrm>(plugin, "adjuntos", { id });
  if (!a || a.iempresa !== ctx.iempresa) throw new HttpError(404, "Ese archivo no existe");
  const m = await porPk<MensajeCrm>(plugin, "mensajes", { id: a.imensaje });
  if (!m) throw new HttpError(404, "Ese archivo no existe");
  await acceso(plugin, ctx, m.iconversacion);
  const objeto = await serviciosDe(plugin).almacen?.bajar(a.clave);
  if (!objeto) throw new HttpError(404, "Ese archivo no existe");
  return new Response(objeto.cuerpo, { headers: { "content-type": a.tipo, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.nombre)}`, "cache-control": "private, no-store" } });
}
