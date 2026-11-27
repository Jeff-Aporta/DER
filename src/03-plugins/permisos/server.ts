/**
 * Plugin de permisos RBAC (server): resuelve usuario + empresa -> roles -> matriz, y ofrece las rutas de
 * administracion y los verbos reutilizables por cualquier API.
 *
 * La comprobacion que usan las rutas es `exigirPermiso(ctx, "usuarios.rol")` (ver `setup`), que lanza 403. El
 * consumidor puede pasar `services.contexto(req, sesion)` para resolver/validar la empresa activa (en el CRM es
 * `crm.contexto`, que revalida la cabecera X-Empresa contra crm_miembros); sin ese servicio se usa la cabecera.
 *
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/permisos.md
 */
import { HttpError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { SessionInfo } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/controller.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef, ServerPluginRuntime } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/plugin.ts";
import { ahora, ctrl, fila, filas, porPk, validado } from "@Jeff-Aporta/DER/src/03-plugins/common/tablas.ts";
import { ACCIONES_SEMILLA, ROLES_SEMILLA } from "@Jeff-Aporta/DER/src/03-plugins/permisos/seed.ts";
import type { RolSemilla } from "@Jeff-Aporta/DER/src/03-plugins/permisos/schemas.ts";
import { aplicaEnEmpresa, aplicarMatrizSemilla, COMODIN, permisosEfectivos, rolesVigentes } from "@Jeff-Aporta/DER/src/03-plugins/permisos/rules.ts";
import { permisosPlugin } from "@Jeff-Aporta/DER/src/03-plugins/permisos/index.ts";
import { type AccionFila, type AccionInput, type AsignarRolesInput, CABECERA_EMPRESA_PERMISOS, type CrearRolInput, type DecisionPermiso, type EditarRolInput, EMPRESA_GLOBAL, type MatrizRol, type MisPermisos, type PermisosConfig, type PermisosResolved, type PonerMatrizInput, type RolFila, type RolResumen, type UsuarioRolFila, ZAccionInput, ZAsignarRoles, ZCrearRol, ZEditarRol, ZPonerMatriz, ZPermisosConfig } from "@Jeff-Aporta/DER/src/03-plugins/permisos/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/permisos/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/permisos/rules.ts";

/** Configuracion con los defaults aplicados. */
function cfg(p: ServerPlugin): PermisosResolved {
  const c = p.cfg as PermisosConfig;
  return { cabeceraEmpresa: c.cabeceraEmpresa ?? CABECERA_EMPRESA_PERMISOS, empresaGlobal: c.empresaGlobal ?? EMPRESA_GLOBAL, accionesExtra: c.accionesExtra ?? [] };
}

/** Id del usuario de la sesion (el router lo deja en `ctx.state.session` y `ctx.session`). */
function usuarioDe(ctx: Partial<ServerCtx>): string {
  const s = (ctx.session ?? ctx.state?.["session"]) as SessionInfo | null | undefined;
  const id = s?.id ?? ctx.state?.["iusuario"];
  return id == null ? "" : String(id);
}

/** Normaliza el ambito: vacio/todas/all -> global; el resto en minusculas. */
function normalizarAmbito(v: string | null | undefined, global: string): string {
  const t = String(v ?? "").trim().toLowerCase();
  if (!t || t === "todas" || t === "all") return global;
  return t;
}

/** Empresa activa: la que resuelve el consumidor (`services.contexto`) o la cabecera; vacia = global. */
async function empresaDe(p: ServerPlugin, ctx: Partial<ServerCtx>, explicita?: string | null): Promise<string> {
  const { cabeceraEmpresa, empresaGlobal } = cfg(p);
  const directa = String(explicita ?? "").trim();
  if (directa) return normalizarAmbito(directa, empresaGlobal);
  const svc = p.services?.["contexto"] as ((req: Request, sesion: SessionInfo | null) => Promise<{ iempresa?: string | null }>) | undefined;
  if (svc && ctx.request) {
    const r = await svc(ctx.request, (ctx.session ?? ctx.state?.["session"]) as SessionInfo | null);
    if (r && r.iempresa) return normalizarAmbito(r.iempresa, empresaGlobal);
  }
  const cabecera = ctx.request?.headers?.get(cabeceraEmpresa) ?? null;
  return normalizarAmbito(cabecera, empresaGlobal);
}

/** Todas las acciones del catalogo, en orden de pantalla. */
async function catalogo(p: ServerPlugin): Promise<AccionFila[]> {
  const filasP = await ctrl(p, "acciones").query({ orderBy: ["orden", "clave"], pageSize: 1000 } as never);
  return filasP.map((f) => fila(f) as AccionFila);
}

/** Claves del catalogo (para expandir el comodin `*`). */
async function clavesCatalogo(p: ServerPlugin): Promise<string[]> {
  return (await catalogo(p)).map((a) => a.clave);
}

/** Roles del usuario que aplican en la empresa (asignados a esa empresa o globales). */
async function rolesDeUsuario(p: ServerPlugin, usuario: string, empresa: string): Promise<RolResumen[]> {
  const { empresaGlobal } = cfg(p);
  if (!usuario) return [];
  const asignados = await filas<UsuarioRolFila>(p, "usuariosRoles", { where: { iusuario: usuario, iempresa: [empresa, empresaGlobal] }, pageSize: 1000 });
  let iroles = [...new Set(asignados.map((a) => String(a.irol)))];
  if (!iroles.length) {
    // UNICO alias de compatibilidad: el consumidor puede derivar claves de rol de su propia tabla (p.ej. crm_miembros.rol)
    const derivar = p.services?.["rolesDerivados"] as ((usuario: string, empresa: string) => Promise<string[] | null | undefined>) | undefined;
    const derivadas = derivar ? await derivar(usuario, empresa) : null;
    if (derivadas && derivadas.length) {
      const filasClave = await filas<RolFila>(p, "roles", { where: { clave: derivadas, bactivo: true }, pageSize: 1000 });
      iroles = [...new Set(filasClave.filter((r) => aplicaEnEmpresa(r, empresa, empresaGlobal)).map((r) => String(r.irol)))];
    }
  }
  if (!iroles.length) return [];
  const filasRol = await filas<RolFila>(p, "roles", { where: { irol: iroles, bactivo: true }, pageSize: 1000 });
  const porIrol = new Map(filasRol.map((r) => [String(r.irol), r]));
  return rolesVigentes(iroles.map((irol) => porIrol.get(irol)).filter((r): r is RolFila => !!r), empresa, empresaGlobal);
}

/**
 * Matriz de un rol como mapa accion -> permitido (incluye la fila comodin `*`).
 * Lee TODAS sus celdas (paginado): si la matriz es mas grande que una pagina, ningun permiso se queda fuera
 * (un rol con parte de su matriz sin leer concede menos permisos de los que tiene).
 */
async function mapaDeRol(p: ServerPlugin, irol: string): Promise<Map<string, boolean>> {
  const celdas: { clave: string; permitido: boolean }[] = [];
  const pageSize = 500;
  for (let page = 1; ; page++) {
    const lote = await filas<{ clave: string; permitido: boolean }>(p, "rolAccion", { where: { irol }, pageSize, page });
    celdas.push(...lote);
    if (lote.length < pageSize) break;
  }
  return new Map(celdas.map((c) => [String(c.clave), c.permitido === true]));
}

/** Permisos efectivos del usuario en la empresa: mapa COMPLETO accion -> permitido. */
async function permisosEfectivosDe(p: ServerPlugin, usuario: string, empresa: string): Promise<Record<string, boolean>> {
  const claves = await clavesCatalogo(p);
  const roles = await rolesDeUsuario(p, usuario, empresa);
  const matrices = await Promise.all(roles.map(async (r) => ({ irol: String(r.irol), celdas: await mapaDeRol(p, String(r.irol)) })));
  return permisosEfectivos(matrices, claves);
}

/** Decision con motivo (para `puede`, `exigir` y las pruebas). */
async function decidir(p: ServerPlugin, usuario: string | null | undefined, empresa: string | null | undefined, clave: string): Promise<DecisionPermiso> {
  const u = String(usuario ?? "").trim();
  if (!u) return { permitido: false, motivo: "Sin sesion" };
  const mapa = await permisosEfectivosDe(p, u, normalizarAmbito(empresa, cfg(p).empresaGlobal));
  const permitido = mapa[clave] === true;
  return { permitido, motivo: permitido ? "Permitido" : "El rol del usuario no tiene la accion: " + clave };
}

/** El rol de MAYOR nivel entre los vigentes (para el badge y el endpoint de mis permisos). */
function rolPrincipal(roles: RolResumen[]): RolResumen | null {
  return roles[0] ?? null;
}

/** Fila de rol -> resumen publico. */
function resumenDe(r: RolFila): RolResumen {
  return { irol: String(r.irol), iempresa: r.iempresa == null ? null : String(r.iempresa), clave: String(r.clave), nombre: String(r.nombre), descripcion: r.descripcion == null ? null : String(r.descripcion), etiqueta: r.etiqueta == null ? null : String(r.etiqueta), nivel: Number(r.nivel ?? 0), sistema: r.sistema === true };
}

/** `irol` de un rol del ambito (la clave si es global, "empresa:clave" si es de empresa). */
function irolPara(empresa: string, clave: string, global: string): string {
  return empresa === global ? clave : empresa + ":" + clave;
}

/** Rol por `irol` o por clave (en el ambito de la empresa). */
async function buscarRol(p: ServerPlugin, empresa: string, irolOCLave: string): Promise<RolFila> {
  const { empresaGlobal } = cfg(p);
  const directo = await porPk<RolFila>(p, "roles", { irol: irolOCLave });
  if (directo) return directo;
  const filasRol = await filas<RolFila>(p, "roles", { where: { clave: irolOCLave, $or: [{ iempresa: null }, { iempresa: empresa }, { iempresa: empresaGlobal }] }, pageSize: 20 });
  const propio = filasRol.find((r) => (r.iempresa == null ? empresa === empresaGlobal : String(r.iempresa) === empresa));
  const cualquiera = propio ?? filasRol[0];
  if (!cualquiera) throw new HttpError(404, "No existe el rol: " + irolOCLave);
  return cualquiera;
}


/** Nivel maximo del actor (para impedir que se asigne o edite un rol igual o superior). */
async function nivelActor(p: ServerPlugin, actor: string, empresa: string): Promise<{ nivel: number; comodin: boolean }> {
  const roles = await rolesDeUsuario(p, actor, empresa);
  let nivel = 0;
  let comodin = false;
  for (const r of roles) {
    nivel = Math.max(nivel, Number(r.nivel ?? 0));
    const celdas = await mapaDeRol(p, String(r.irol));
    if (celdas.get("*") === true) comodin = true;
  }
  return { nivel, comodin };
}

/** Un rol global solo lo toca quien tiene comodin; no se toca el de otra empresa ni uno de nivel igual o superior. */
function exigirEditable(plugin: ServerPlugin, actor: { nivel: number; comodin: boolean }, empresa: string, rol: RolFila): void {
  const { empresaGlobal } = cfg(plugin);
  const ambito = rol.iempresa == null ? empresaGlobal : String(rol.iempresa);
  if (ambito === empresaGlobal && !actor.comodin) throw new HttpError(403, "Solo un rol con permiso total edita los roles globales");
  if (ambito !== empresaGlobal && ambito !== empresa) throw new HttpError(403, "Ese rol es de otra empresa");
  if (!actor.comodin && Number(rol.nivel ?? 0) >= actor.nivel) throw new HttpError(403, "No puedes editar un rol de nivel igual o superior al tuyo");
}

/** Valida que las acciones existan en el catalogo. */
async function exigirAcciones(p: ServerPlugin, claves: string[]): Promise<void> {
  if (!claves.length) return;
  const conocidas = new Set(await clavesCatalogo(p));
  const faltan = [...new Set(claves)].filter((c) => !conocidas.has(c));
  if (faltan.length) throw new ValidationError("Acciones que no estan en el catalogo: " + faltan.join(", "));
}

/** Inserta o cambia una fila por llave. */
async function guardarFila(c: ServerController<any>, datos: Record<string, unknown>): Promise<void> {
  const pojo = c.pojo(datos);
  const existe = await c.get(pojo.pkOnly() as never, { include: {} } as never);
  if (existe) await c.put(pojo);
  else await c.post(pojo);
}

/**
 * Escribe las celdas de la matriz de un rol (true/false). Toda celda que se ENCIENDE tiene que existir en el
 * catalogo: una celda con una clave desconocida se guardaria pero no concederia nada (el permiso se resuelve
 * por ACCION del catalogo), asi que se avisa en vez de dejar al rol con menos permisos de los que cree.
 */
async function escribirMatriz(p: ServerPlugin, irol: string, celdas: { clave: string; permitido: boolean }[]): Promise<void> {
  if (!celdas.length) return;
  const c = ctrl(p, "rolAccion");
  const encendidas = [...new Set(celdas.filter((celda) => celda.permitido === true).map((celda) => celda.clave))].filter((clave) => clave !== COMODIN);
  if (encendidas.length) {
    const conocidas = new Set(await clavesCatalogo(p));
    const desconocidas = encendidas.filter((clave) => !conocidas.has(clave));
    if (desconocidas.length) throw new ValidationError("Acciones que no estan en el catalogo: " + desconocidas.join(", "));
  }
  for (const celda of celdas) await guardarFila(c, { irol, clave: celda.clave, permitido: celda.permitido === true });
}

/** Roles visibles en una empresa: los globales + los de esa empresa. */
async function rolesVisibles(p: ServerPlugin, empresa: string): Promise<RolResumen[]> {
  const { empresaGlobal } = cfg(p);
  const donde = empresa === empresaGlobal ? { bactivo: true } : { bactivo: true, $or: [{ iempresa: null }, { iempresa: empresa }, { iempresa: empresaGlobal }] };
  const filasRol = await filas<RolFila>(p, "roles", { where: donde, orderBy: [{ field: "nivel", dir: "desc" }, "clave"], pageSize: 1000 });
  return filasRol.map(resumenDe);
}

/** La matriz de un rol contra todo el catalogo. */
async function matrizDe(p: ServerPlugin, rol: RolFila): Promise<MatrizRol> {
  const celdas = await mapaDeRol(p, String(rol.irol));
  const acciones = await catalogo(p);
  return { rol: resumenDe(rol), acciones: acciones.map((a) => ({ clave: a.clave, grupo: a.grupo, descripcion: a.descripcion, orden: a.orden, permitido: celdas.get(a.clave) ?? (celdas.get("*") === true) })) };
}

/** Crea un rol (y su matriz inicial) en el ambito pedido. */
async function crearRol(p: ServerPlugin, actor: string, empresaCtx: string, input: CrearRolInput): Promise<RolResumen> {
  const { empresaGlobal } = cfg(p);
  const actorNivel = await nivelActor(p, actor, empresaCtx);
  const ambito = normalizarAmbito(input.iempresa ?? empresaCtx, empresaGlobal);
  if (ambito === empresaGlobal && !actorNivel.comodin) throw new HttpError(403, "Solo un rol con permiso total crea roles globales");
  if (ambito !== empresaGlobal && ambito !== empresaCtx) throw new HttpError(403, "No puedes crear roles en otra empresa");
  const irol = irolPara(ambito, input.clave, empresaGlobal);
  const existente = await porPk<RolFila>(p, "roles", { irol });
  if (existente) throw new ValidationError("Ya existe el rol: " + irol);
  const permisos = input.permisos ?? [];
  await exigirAcciones(p, permisos);
  const datos: Record<string, unknown> = { irol, iempresa: ambito === empresaGlobal ? null : ambito, clave: input.clave, nombre: input.nombre, descripcion: input.descripcion ?? null, etiqueta: input.etiqueta ?? null, nivel: input.nivel ?? 10, sistema: false, bactivo: true, fhcre: ahora() };
  await ctrl(p, "roles").post(ctrl(p, "roles").pojo(datos));
  if (permisos.length) await escribirMatriz(p, irol, permisos.map((clave) => ({ clave, permitido: true })));
  return resumenDe(datos as unknown as RolFila);
}

/** Edita los datos de un rol (no su matriz). */
async function editarRol(p: ServerPlugin, actor: string, empresaCtx: string, irolOCLave: string, input: EditarRolInput): Promise<RolResumen> {
  const rol = await buscarRol(p, empresaCtx, irolOCLave);
  exigirEditable(p, await nivelActor(p, actor, empresaCtx), empresaCtx, rol);
  const cambios = Object.fromEntries(Object.entries({ nombre: input.nombre, descripcion: input.descripcion, etiqueta: input.etiqueta, nivel: input.nivel, bactivo: input.bactivo }).filter(([, v]) => v !== undefined));
  const datos = { ...fila(rol), ...cambios, irol: String(rol.irol) };
  await ctrl(p, "roles").put(ctrl(p, "roles").pojo(datos));
  return resumenDe(datos as unknown as RolFila);
}

/** Borra un rol de empresa (los de sistema no se borran) y sus asignaciones/matriz. */
async function borrarRol(p: ServerPlugin, actor: string, empresaCtx: string, irolOCLave: string): Promise<{ borrado: boolean }> {
  const rol = await buscarRol(p, empresaCtx, irolOCLave);
  exigirEditable(p, await nivelActor(p, actor, empresaCtx), empresaCtx, rol);
  if (rol.sistema === true) throw new ValidationError("Los roles de sistema no se borran: cambiales la matriz");
  const irol = String(rol.irol);
  const cRolAccion = ctrl(p, "rolAccion");
  const celdas = await cRolAccion.query({ where: { irol }, pageSize: 1000 });
  if (celdas.length) await cRolAccion.deleteList(celdas as never);
  const cUsu = ctrl(p, "usuariosRoles");
  const asignaciones = await cUsu.query({ where: { irol }, pageSize: 1000 });
  if (asignaciones.length) await cUsu.deleteList(asignaciones as never);
  await ctrl(p, "roles").delete(ctrl(p, "roles").pojo({ irol }));
  return { borrado: true };
}

/** Cambia celdas de la matriz de un rol. */
async function ponerMatriz(p: ServerPlugin, actor: string, empresaCtx: string, irolOCLave: string, input: PonerMatrizInput): Promise<MatrizRol> {
  const rol = await buscarRol(p, empresaCtx, irolOCLave);
  exigirEditable(p, await nivelActor(p, actor, empresaCtx), empresaCtx, rol);
  const claves = input.acciones.map((a) => a.clave);
  await exigirAcciones(p, claves.filter((c) => c !== "*"));
  const irol = String(rol.irol);
  if (input.reemplazar) {
    const actuales = await mapaDeRol(p, irol);
    const pedidas = new Set(claves);
    const apagar = [...actuales.keys()].filter((c) => !pedidas.has(c)).map((clave) => ({ clave, permitido: false }));
    await escribirMatriz(p, irol, [...input.acciones, ...apagar]);
  } else {
    await escribirMatriz(p, irol, input.acciones);
  }
  return matrizDe(p, rol);
}

/** Alta/edicion de una accion del catalogo (sin desplegar). */
async function crearAccion(p: ServerPlugin, actor: string, empresaCtx: string, input: AccionInput): Promise<AccionFila> {
  const actorNivel = await nivelActor(p, actor, empresaCtx);
  if (!actorNivel.comodin) throw new HttpError(403, "Solo un rol con permiso total edita el catalogo de acciones");
  const datos: Record<string, unknown> = { clave: input.clave, grupo: input.grupo, descripcion: input.descripcion ?? null, orden: input.orden ?? 900, sistema: false };
  await guardarFila(ctrl(p, "acciones"), datos);
  return datos as unknown as AccionFila;
}

/** Roles asignados a un usuario en una empresa (sin expandir globales). */
function rolesUsuarioDe(p: ServerPlugin, usuario: string, empresa: string): Promise<UsuarioRolFila[]> {
  const { empresaGlobal } = cfg(p);
  return filas<UsuarioRolFila>(p, "usuariosRoles", { where: { iusuario: usuario, iempresa: [empresa, empresaGlobal] }, orderBy: ["iempresa", "irol"], pageSize: 1000 });
}

/** Reemplaza los roles del usuario en la empresa. */
async function asignarRoles(p: ServerPlugin, actor: string, empresaCtx: string, iusuario: string, input: AsignarRolesInput): Promise<{ roles: string[] }> {
  const { empresaGlobal } = cfg(p);
  const ambito = normalizarAmbito(input.iempresa ?? empresaCtx, empresaGlobal);
  if (ambito !== empresaCtx && ambito !== empresaGlobal) throw new HttpError(403, "No puedes asignar roles en otra empresa");
  const actorNivel = await nivelActor(p, actor, empresaCtx);
  const iroles: string[] = [];
  for (const pedido of input.roles) {
    const rol = await buscarRol(p, ambito, pedido);
    const ambitoRol = rol.iempresa == null ? empresaGlobal : String(rol.iempresa);
    if (ambitoRol === empresaGlobal && ambito !== empresaGlobal) throw new HttpError(403, "Los roles globales se asignan en ambito global");
    if (ambitoRol !== empresaGlobal && ambitoRol !== ambito) throw new HttpError(403, "Ese rol es de otra empresa");
    if (!actorNivel.comodin && Number(rol.nivel ?? 0) >= actorNivel.nivel) throw new HttpError(403, "No puedes asignar un rol de nivel igual o superior al tuyo");
    iroles.push(String(rol.irol));
  }
  const c = ctrl(p, "usuariosRoles");
  const actuales = await c.query({ where: { iusuario, iempresa: ambito }, pageSize: 1000 });
  if (actuales.length) await c.deleteList(actuales as never);
  for (const irol of iroles) await c.post(c.pojo({ iusuario, iempresa: ambito, irol, fhcre: ahora(), fhasigno: ahora() }));
  return { roles: iroles };
}

/** Pone los roles de un usuario SIN comprobar actor (semilla de la app o migracion de datos). */
async function ponerRoles(p: ServerPlugin, iusuario: string, empresa: string, claves: string[]): Promise<void> {
  const { empresaGlobal } = cfg(p);
  const ambito = normalizarAmbito(empresa, empresaGlobal);
  const iroles: string[] = [];
  for (const clave of claves) {
    const rol = await buscarRol(p, ambito, clave);
    iroles.push(String(rol.irol));
  }
  const c = ctrl(p, "usuariosRoles");
  const previos = await c.query({ where: { iusuario, iempresa: ambito }, pageSize: 1000 });
  if (previos.length) await c.deleteList(previos as never);
  for (const irol of iroles) await c.post(c.pojo({ iusuario, iempresa: ambito, irol, fhcre: ahora(), fhasigno: ahora() }));
}

/** Quita un rol concreto de un usuario. */
async function quitarRol(p: ServerPlugin, actor: string, empresaCtx: string, iusuario: string, irolOCLave: string): Promise<{ roles: string[] }> {
  const { empresaGlobal } = cfg(p);
  const rol = await buscarRol(p, empresaCtx, irolOCLave);
  const actorNivel = await nivelActor(p, actor, empresaCtx);
  if (!actorNivel.comodin && Number(rol.nivel ?? 0) >= actorNivel.nivel) throw new HttpError(403, "No puedes quitar un rol de nivel igual o superior al tuyo");
  const c = ctrl(p, "usuariosRoles");
  for (const ambito of [empresaCtx, empresaGlobal]) {
    const filasP = await c.query({ where: { iusuario, iempresa: ambito, irol: String(rol.irol) }, pageSize: 10 });
    if (filasP.length) await c.deleteList(filasP as never);
  }
  return { roles: (await rolesUsuarioDe(p, iusuario, empresaCtx)).map((r) => String(r.irol)) };
}


/** Semilla: catalogo, roles base con su matriz y (si se configuro) asignaciones. Solo crea lo que falta. */
async function sembrar(p: ServerPlugin): Promise<void> {
  const { accionesExtra } = cfg(p);
  const existentes = await catalogo(p);
  const conocidas = new Set(existentes.map((a) => a.clave));
  const orden = existentes.reduce((max, a) => Math.max(max, Number(a.orden ?? 0)), 0);
  let ordenSiguiente = orden + 10;
  const cAcc = ctrl(p, "acciones");
  const semilla = [...ACCIONES_SEMILLA.map((a) => ({ ...a, sistema: true })), ...accionesExtra.map((a) => ({ clave: a.clave, grupo: a.grupo, descripcion: a.descripcion ?? "", sistema: false }))];
  for (const a of semilla) {
    if (conocidas.has(a.clave)) continue;
    await cAcc.post(cAcc.pojo({ clave: a.clave, grupo: a.grupo, descripcion: a.descripcion || null, orden: ordenSiguiente, sistema: a.sistema }));
    ordenSiguiente += 10;
  }
  const cRoles = ctrl(p, "roles");
  const clavesCatalogoActuales = new Set((await catalogo(p)).map((a) => a.clave));
  for (const rol of ROLES_SEMILLA as readonly RolSemilla[]) {
    const existe = await porPk<RolFila>(p, "roles", { irol: rol.clave });
    if (existe) continue;
    await cRoles.post(cRoles.pojo({ irol: rol.clave, iempresa: null, clave: rol.clave, nombre: rol.nombre, descripcion: rol.descripcion, etiqueta: rol.etiqueta, nivel: rol.nivel, sistema: true, bactivo: true, fhcre: ahora() }));
    const celdas = aplicarMatrizSemilla(rol, [...clavesCatalogoActuales]);
    await escribirMatriz(p, rol.clave, celdas);
  }
  const asignaciones = (p.cfg["asignaciones"] ?? []) as { iusuario: string; iempresa?: string | null; roles: string[] }[];
  for (const a of asignaciones) await ponerRoles(p, a.iusuario, a.iempresa ?? cfg(p).empresaGlobal, a.roles);
}

/** JSON del server de permisos: el transversal con handlers, verbos y semilla. */
export const permisosServer: ServerPluginDef = Obj.insert(permisosPlugin, {
  cfg: ZPermisosConfig,
  entities: {
    roles: { indexes: [{ columns: ["iempresa", "clave"], unique: true }] },
  },
  irregularPaths: {
    mios: {
      async handler(this: ServerPlugin, _i: ExtraRouteInput, ctx: ServerCtx): Promise<MisPermisos> {
        const usuario = usuarioDe(ctx);
        if (!usuario) throw new HttpError(401, "Requiere autenticacion");
        return this["misPermisos"](usuario, await empresaDe(this, ctx));
      },
    },
    puede: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<{ permitido: boolean }> {
        const usuario = usuarioDe(ctx);
        if (!usuario) throw new HttpError(401, "Requiere autenticacion");
        const clave = String(i.query.get("clave") ?? "").trim();
        if (!clave) throw new ValidationError("Falta la accion (clave)");
        return { permitido: await this["puede"](usuario, await empresaDe(this, ctx), clave) };
      },
    },
    roles: {
      async handler(this: ServerPlugin, _i: ExtraRouteInput, ctx: ServerCtx): Promise<RolResumen[]> {
        const empresa = await empresaDe(this, ctx);
        await this["exigir"](usuarioDe(ctx), empresa, "permisos.ver");
        return this["roles"](empresa);
      },
    },
    crearRol: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<RolResumen> {
        const empresa = await empresaDe(this, ctx);
        const actor = usuarioDe(ctx);
        await this["exigir"](actor, empresa, "permisos.editar");
        return this["crearRol"](actor, empresa, validado<CrearRolInput>(ZCrearRol, i.body));
      },
    },
    editarRol: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<RolResumen> {
        const empresa = await empresaDe(this, ctx);
        const actor = usuarioDe(ctx);
        await this["exigir"](actor, empresa, "permisos.editar");
        return this["editarRol"](actor, empresa, i.params["irol"] ?? "", validado<EditarRolInput>(ZEditarRol, i.body));
      },
    },
    borrarRol: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<{ borrado: boolean }> {
        const empresa = await empresaDe(this, ctx);
        const actor = usuarioDe(ctx);
        await this["exigir"](actor, empresa, "permisos.editar");
        return this["borrarRol"](actor, empresa, i.params["irol"] ?? "");
      },
    },
    matriz: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<MatrizRol> {
        const empresa = await empresaDe(this, ctx);
        await this["exigir"](usuarioDe(ctx), empresa, "permisos.ver");
        return this["matriz"](i.params["irol"] ?? "");
      },
    },
    ponerMatriz: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<MatrizRol> {
        const empresa = await empresaDe(this, ctx);
        const actor = usuarioDe(ctx);
        await this["exigir"](actor, empresa, "permisos.editar");
        return this["ponerMatriz"](actor, empresa, i.params["irol"] ?? "", validado<PonerMatrizInput>(ZPonerMatriz, i.body));
      },
    },
    acciones: {
      async handler(this: ServerPlugin, _i: ExtraRouteInput, ctx: ServerCtx): Promise<AccionFila[]> {
        const empresa = await empresaDe(this, ctx);
        await this["exigir"](usuarioDe(ctx), empresa, "permisos.ver");
        return this["catalogo"]();
      },
    },
    crearAccion: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<AccionFila> {
        const empresa = await empresaDe(this, ctx);
        const actor = usuarioDe(ctx);
        await this["exigir"](actor, empresa, "permisos.editar");
        return this["crearAccion"](actor, empresa, validado<AccionInput>(ZAccionInput, i.body));
      },
    },
    rolesUsuario: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<UsuarioRolFila[]> {
        const empresa = await empresaDe(this, ctx);
        await this["exigir"](usuarioDe(ctx), empresa, "permisos.ver");
        return this["rolesUsuario"](i.params["iusuario"] ?? "", empresa);
      },
    },
    asignarRoles: {
      async handler(this: ServerPlugin, i: ExtraRouteInput, ctx: ServerCtx): Promise<{ roles: string[] }> {
        const empresa = await empresaDe(this, ctx);
        const actor = usuarioDe(ctx);
        await this["exigir"](actor, empresa, "permisos.asignar");
        return this["asignarRoles"](actor, empresa, i.params["iusuario"] ?? "", validado<AsignarRolesInput>(ZAsignarRoles, i.body));
      },
    },
  },
  setup(this: ServerPlugin) {
    this["puede"] = (usuario: string | null | undefined, empresa: string | null | undefined, clave: string) => decidir(this, usuario, empresa, clave).then((d) => d.permitido);
    this["exigir"] = async (usuario: string | null | undefined, empresa: string | null | undefined, clave: string) => {
      const d = await decidir(this, usuario, empresa, clave);
      if (!d.permitido) throw new HttpError(403, d.motivo);
    };
    this["permisosDe"] = (usuario: string, empresa: string) => permisosEfectivosDe(this, usuario, normalizarAmbito(empresa, cfg(this).empresaGlobal));
    this["rolesDe"] = (usuario: string, empresa: string) => rolesDeUsuario(this, usuario, normalizarAmbito(empresa, cfg(this).empresaGlobal));
    this["misPermisos"] = async (usuario: string, empresa: string): Promise<MisPermisos> => {
      const ambito = normalizarAmbito(empresa, cfg(this).empresaGlobal);
      const roles = await rolesDeUsuario(this, usuario, ambito);
      const permisos = await permisosEfectivosDe(this, usuario, ambito);
      const permitidas = Object.entries(permisos).filter(([, v]) => v).map(([k]) => k);
      return { iusuario: usuario, iempresa: ambito, rol: rolPrincipal(roles), roles, permisos, permitidas };
    };
    this["catalogo"] = () => catalogo(this);
    this["roles"] = (empresa?: string | null) => rolesVisibles(this, normalizarAmbito(empresa, cfg(this).empresaGlobal));
    this["matriz"] = async (irolOCLave: string): Promise<MatrizRol> => {
      const rol = await buscarRol(this, cfg(this).empresaGlobal, irolOCLave);
      return matrizDe(this, rol);
    };
    this["crearRol"] = (actor: string, empresa: string, input: CrearRolInput) => crearRol(this, actor, empresa, input);
    this["editarRol"] = (actor: string, empresa: string, irol: string, input: EditarRolInput) => editarRol(this, actor, empresa, irol, input);
    this["borrarRol"] = (actor: string, empresa: string, irol: string) => borrarRol(this, actor, empresa, irol);
    this["ponerMatriz"] = (actor: string, empresa: string, irol: string, input: PonerMatrizInput) => ponerMatriz(this, actor, empresa, irol, input);
    this["crearAccion"] = (actor: string, empresa: string, input: AccionInput) => crearAccion(this, actor, empresa, input);
    this["rolesUsuario"] = (iusuario: string, empresa: string) => rolesUsuarioDe(this, iusuario, empresa);
    this["asignarRoles"] = (actor: string, empresa: string, iusuario: string, input: AsignarRolesInput) => asignarRoles(this, actor, empresa, iusuario, input);
    this["quitarRol"] = (actor: string, empresa: string, iusuario: string, irol: string) => quitarRol(this, actor, empresa, iusuario, irol);
    this["ponerRoles"] = (iusuario: string, empresa: string, claves: string[]) => ponerRoles(this, iusuario, empresa, claves);
    /**
     * La comprobacion que usan las rutas del consumidor: `await permisos.exigirPermiso(ctx, "usuarios.rol")`.
     * Lanza 403 con el motivo si la sesion no tiene la accion en la empresa activa.
     */
    this["exigirPermiso"] = async (ctx: Partial<ServerCtx>, clave: string, empresa?: string | null): Promise<void> => {
      const usuario = usuarioDe(ctx);
      if (!usuario) throw new HttpError(401, "Requiere autenticacion");
      const ambito = await empresaDe(this, ctx, empresa);
      await this["exigir"](usuario, ambito, clave);
    };
    /** Igual que `exigirPermiso` pero devuelve true/false (para decidir contenido, no para negar la ruta). */
    this["tienePermiso"] = async (ctx: Partial<ServerCtx>, clave: string, empresa?: string | null): Promise<boolean> => {
      const usuario = usuarioDe(ctx);
      if (!usuario) return false;
      return this["puede"](usuario, await empresaDe(this, ctx, empresa), clave);
    };
  },
  /** Crea tablas (y columnas nuevas) y siembra catalogo, roles base y sus matrices. Idempotente. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
    await sembrar(this);
  },
}) as ServerPluginDef;

/** Plugin armado en el server con los verbos tipados. */
export function crearPermisos(runtime: ServerPluginRuntime): ServerPlugin {
  return createServer(permisosServer, runtime);
}
