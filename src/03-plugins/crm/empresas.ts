/**
 * Empresas, miembros, contactos y login por empresa del plugin CRM. La empresa ACTIVA de una petición sale de la
 * cabecera `X-Empresa` (o se deduce si el usuario solo tiene una) y SIEMPRE se comprueba contra `crm_miembros`: el
 * cliente nunca decide a qué empresa entra, solo cuál de las suyas usa. Cada función de aquí es un verbo de servidor
 * que los handlers HTTP también usan (una sola implementación).
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/crm.md
 */
import { HttpError, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ServerPlugin } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { type Contacto, type ContactoInput, type ContextoCrm, type Empresa, type EmpresaInput, type EmpresaResumen, type LoginCrmInput, type LoginCrmResult, type Miembro, type MiembroInput, ROLES_CRM, type RolCrm, ZContacto, ZContactoCambio, ZEmpresa, ZLoginCrm, ZMiembro } from "@Jeff-Aporta/DER/src/03-plugins/crm/schemas.ts";
import { ahora, filas, guardar, idNuevo, porPk, sinIndefinidos, validado } from "@Jeff-Aporta/DER/src/03-plugins/common/tablas.ts";
import { serviciosDe } from "@Jeff-Aporta/DER/src/03-plugins/crm/util.ts";

/** Rango numérico de un rol (mayor = más poder). */
export const rango = (rol: RolCrm): number => ROLES_CRM.indexOf(rol) + 1;

/** Un booleano de la base (algunos motores devuelven 0/1). */
export const activo = (v: unknown): boolean => v !== false && v !== 0 && v != null && v !== "0";

/** Exige que el contexto tenga al menos `minimo` en la empresa activa; si no, 403. */
export function exigir(ctx: ContextoCrm, minimo: RolCrm): void {
  if (rango(ctx.rol) < rango(minimo)) throw new HttpError(403, `Esta acción pide el rol ${minimo} en la empresa (tienes ${ctx.rol})`);
}

const MENSAJE_LOGIN = "Empresa, usuario o contraseña incorrectos";

/** Una empresa por id (o null). */
export async function empresa(plugin: ServerPlugin, iempresa: string): Promise<Empresa | null> {
  return await porPk<Empresa>(plugin, "empresas", { iempresa });
}

/** Una empresa por código o por id (insensible a mayúsculas). */
async function empresaPorClave(plugin: ServerPlugin, clave: string): Promise<Empresa | null> {
  const k = clave.trim().toLowerCase();
  const [porCodigo] = await filas<Empresa>(plugin, "empresas", { where: { codigo: k } });
  return porCodigo ?? await empresa(plugin, k);
}

/** Resumen de las empresas ACTIVAS a las que entra un usuario (donde su membresía está activa). */
export async function empresasDe(plugin: ServerPlugin, iusuario: string): Promise<EmpresaResumen[]> {
  const mias = (await filas<Miembro>(plugin, "miembros", { where: { iusuario } })).filter((m) => activo(m.bactivo));
  const resumen: EmpresaResumen[] = [];
  for (const m of mias) {
    const e = await empresa(plugin, m.iempresa);
    if (e && activo(e.bactivo)) resumen.push({ iempresa: e.iempresa, codigo: e.codigo, nombre: e.nombre, rol: m.rol });
  }
  return resumen.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** El contexto de un usuario en una empresa (o en la única que tiene). 403 si no pertenece o está dada de baja. */
export async function contexto(plugin: ServerPlugin, iusuario: string, iempresa?: string | null): Promise<ContextoCrm> {
  const suyas = await empresasDe(plugin, iusuario);
  const pedida = iempresa?.trim().toLowerCase();
  if (!pedida && suyas.length > 1) throw new ValidationError("Indica la empresa activa (cabecera X-Empresa): el usuario pertenece a varias");
  const elegida = pedida ? suyas.find((s) => s.iempresa === pedida) : suyas[0];
  if (!elegida) throw new HttpError(403, "No perteneces a esa empresa");
  const e = await empresa(plugin, elegida.iempresa);
  if (!e) throw new HttpError(403, "No perteneces a esa empresa");
  return { iusuario, iempresa: e.iempresa, rol: elegida.rol, empresa: e };
}

/** Alta de una empresa; `propietario` (usuario de identidad) queda con el rol `propietario`. El código es único. */
export async function crearEmpresa(plugin: ServerPlugin, input: EmpresaInput): Promise<Empresa> {
  const d = validado<EmpresaInput>(ZEmpresa, input);
  const base = (d.iempresa ?? d.codigo ?? d.nombre).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const iempresa = d.iempresa ?? base;
  const codigo = d.codigo ?? iempresa;
  if (iempresa.length < 2) throw new ValidationError("El id de la empresa debe tener al menos 2 caracteres");
  if (await empresa(plugin, iempresa)) throw new ValidationError(`La empresa "${iempresa}" ya existe`);
  const [repetido] = await filas<Empresa>(plugin, "empresas", { where: { codigo } });
  if (repetido) throw new ValidationError(`El código "${codigo}" ya lo usa otra empresa`);
  const creada = await guardar<Empresa>(plugin, "empresas", { iempresa }, { codigo, nombre: d.nombre, nit: d.nit ?? null, bactivo: true, fhcre: ahora() });
  if (d.propietario) await vincularMiembro(plugin, iempresa, { iusuario: d.propietario, rol: "propietario" });
  return creada;
}

/** Alta o cambio de un miembro (rol y baja). Una empresa nunca se queda sin propietario activo. */
export async function vincularMiembro(plugin: ServerPlugin, iempresa: string, input: MiembroInput): Promise<Miembro> {
  const d = validado<MiembroInput>(ZMiembro, input);
  if (!(await empresa(plugin, iempresa))) throw new ValidationError(`La empresa "${iempresa}" no existe`);
  const previo = await porPk<Miembro>(plugin, "miembros", { iempresa, iusuario: d.iusuario });
  const rol = d.rol ?? previo?.rol ?? "agente";
  const bactivo = d.bactivo ?? (previo ? activo(previo.bactivo) : true);
  if (previo?.rol === "propietario" && activo(previo.bactivo) && (rol !== "propietario" || !bactivo)) {
    const otros = (await filas<Miembro>(plugin, "miembros", { where: { iempresa, rol: "propietario" } })).filter((m) => m.iusuario !== d.iusuario && activo(m.bactivo));
    if (!otros.length) throw new ValidationError("La empresa debe conservar al menos un propietario activo");
  }
  return await guardar<Miembro>(plugin, "miembros", { iempresa, iusuario: d.iusuario }, { rol, bactivo, fhcre: previo?.fhcre ?? ahora() });
}

/** Cambio de un miembro por HTTP: nadie asigna ni toca un rol por encima del suyo; cambiar roles pide `admin`. */
export async function cambiarMiembro(plugin: ServerPlugin, ctx: ContextoCrm, input: MiembroInput): Promise<Miembro> {
  exigir(ctx, "admin");
  const d = validado<MiembroInput>(ZMiembro, input);
  const previo = await porPk<Miembro>(plugin, "miembros", { iempresa: ctx.iempresa, iusuario: d.iusuario });
  if (previo && rango(previo.rol) > rango(ctx.rol)) throw new HttpError(403, "No puedes cambiar a alguien con más rol que tú");
  if (d.rol && rango(d.rol) > rango(ctx.rol)) throw new HttpError(403, "No puedes asignar un rol mayor al tuyo");
  return await vincularMiembro(plugin, ctx.iempresa, d);
}

/** Usuarios de la empresa con su rol. */
export async function miembros(plugin: ServerPlugin, iempresa: string): Promise<Miembro[]> {
  return await filas<Miembro>(plugin, "miembros", { where: { iempresa }, orderBy: ["iusuario"] });
}

/** Login por empresa: verifica la pertenencia, y la contraseña con el servicio `login` (identidad: auditoría y bloqueos). Siempre el mismo 401 si algo falla. */
export async function login(plugin: ServerPlugin, input: LoginCrmInput, req?: Request): Promise<LoginCrmResult> {
  const d = validado<LoginCrmInput>(ZLoginCrm, input);
  const entrar = serviciosDe(plugin).login;
  if (!entrar) throw new Error("El plugin crm necesita el servicio `login` (vincula `auth.login` del plugin de identidad)");
  const e = await empresaPorClave(plugin, d.empresa);
  const miembro = e && activo(e.bactivo) ? await porPk<Miembro>(plugin, "miembros", { iempresa: e.iempresa, iusuario: d.usuario }) : null;
  // La contraseña SIEMPRE se verifica (cuenta el intento fallido y los bloqueos de identidad), exista o no la empresa.
  const sesion = await entrar({ usuario: d.usuario, password: d.password }, req);
  if (!e || !miembro || !activo(miembro.bactivo)) throw new HttpError(401, MENSAJE_LOGIN);
  const empresas = await empresasDe(plugin, d.usuario);
  const activa = empresas.find((x) => x.iempresa === e.iempresa);
  if (!activa) throw new HttpError(401, MENSAJE_LOGIN);
  return { ...sesion, empresa: activa, empresas };
}

/** Alta de un contacto de la empresa (rol `agente` o más lo decide el handler). */
export async function crearContacto(plugin: ServerPlugin, iempresa: string, input: ContactoInput & { id?: string | undefined }): Promise<Contacto> {
  const { id, ...resto } = input;
  const d = validado<ContactoInput>(ZContacto, resto);
  return await guardar<Contacto>(plugin, "contactos", { id: id ?? idNuevo() }, { ...sinIndefinidos(d), iempresa, bactivo: d.bactivo ?? true, fhcre: ahora(), fhmod: null });
}

/** Contactos activos de la empresa; `q` busca en nombre, email y teléfono. */
export async function contactos(plugin: ServerPlugin, iempresa: string, q?: string, limite = 50): Promise<Contacto[]> {
  const where: Record<string, unknown> = { iempresa, bactivo: true };
  const t = q?.trim().slice(0, 80);
  if (t) where["$or"] = [{ nombre: { contains: t } }, { email: { contains: t } }, { telefono: { contains: t } }];
  return await filas<Contacto>(plugin, "contactos", { where, orderBy: ["nombre"], pageSize: Math.min(Math.max(limite, 1), 200) });
}

/** Un contacto de ESA empresa (404 si es de otra: nunca se distingue «no existe» de «no es tuyo»). */
export async function contactoDe(plugin: ServerPlugin, iempresa: string, id: string): Promise<Contacto> {
  const c = await porPk<Contacto>(plugin, "contactos", { id });
  if (!c || c.iempresa !== iempresa) throw new HttpError(404, "Ese contacto no existe");
  return c;
}

/** Cambia un contacto de la empresa (la empresa y el id no se mueven). */
export async function editarContacto(plugin: ServerPlugin, iempresa: string, id: string, cambio: Partial<ContactoInput>): Promise<Contacto> {
  await contactoDe(plugin, iempresa, id);
  const d = validado<Record<string, unknown>>(ZContactoCambio, cambio);
  return await guardar<Contacto>(plugin, "contactos", { id }, { ...sinIndefinidos(d), iempresa, fhmod: ahora() });
}
