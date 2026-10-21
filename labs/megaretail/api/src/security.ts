/**
 * Seguridad del lab: los plugins de identidad (entidad `usuarios`) y permisos (grupos, roles, acciones) de DER tal cual,
 * pero SIN contraseñas: la puerta `extract` la define el consumidor (este archivo) y lee la cabecera `x-usuario` que pone
 * el selector de usuario del front. Así el sistema de permisos de DER se evalúa de verdad en cada request y se puede
 * comparar qué deja hacer cada rol. Las tablas de usuarios y permisos son administrables por CRUD como cualquier otra.
 */
import { createServer, HttpError, type Database } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { identityServer, permissionsServer } from "@Jeff-Aporta/DER/src/03-plugins/index.ts";
import type { SessionInfo } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { ENTIDADES } from "./domain/index.ts";
import type { SecurityPlugins, UsuarioLab, UsuarioSemilla } from "./schemas.ts";

/** Cabecera con la que el front "inicia sesión" (sin contraseña: es un laboratorio). */
export const CABECERA_USUARIO = "x-usuario";
/** Contraseña ficticia de todos los usuarios del lab: la exige el hook de `usuarios` de DER, nunca se usa para entrar. */
export const PASSWORD_LAB = "sin-clave-laboratorio";
/** Grupo de roles del lab. */
export const GRUPO = "MEGARETAIL";
/** Usuarios de muestra y sus roles. `dario` no tiene rol: representa el rol base (sólo lectura). */
export const USUARIOS_SEMILLA: UsuarioSemilla[] = [
  { iusuario: "admin", nombre: "Administrador", email: "admin@megaretail.test", roles: ["ADMIN"] },
  { iusuario: "ana", nombre: "Ana Vendedora", email: "ana@megaretail.test", roles: ["VENDEDOR"] },
  { iusuario: "beto", nombre: "Beto Bodega", email: "beto@megaretail.test", roles: ["BODEGA"] },
  { iusuario: "carla", nombre: "Carla Gerente", email: "carla@megaretail.test", roles: ["GERENTE"] },
  { iusuario: "dario", nombre: "Darío Consulta", email: "dario@megaretail.test", roles: [] },
];

/** Alias legibles de las acciones de seguridad (lo que se quema en `permisos_accionesrol` y muestra el front). */
export function aliases(): Record<string, string> {
  const out: Record<string, string> = {
    "POST:/ventas/registrar": "ventas.registrar",
    "POST:/venta/{id_venta}/anular": "ventas.anular",
    "POST:/inventarios/compra": "inventario.comprar",
    "POST:/inventarios/transferencia": "inventario.transferir",
    "GET:/inventarios/alertas": "reportes.alertas",
    "GET:/vendedores/ranking": "reportes.ranking",
    "GET:/clientes/fieles": "reportes.fieles",
    "GET:/ventas/cubo": "reportes.cubo",
    "POST:/productos/ajuste-precios": "productos.ajustar-precios",
    "POST:/productos/limpieza": "productos.limpiar",
    "PUT:/permisos": "seguridad.administrar",
  };
  const escrituras = (singular: string, plural: string, pks: string[], alias: string) => {
    const P = pks.map((k) => `{${k}}`).join("/");
    for (const id of [`POST:/${singular}`, `PUT:/${singular}/${P}`, `DELETE:/${singular}/${P}`, `POST:/${plural}`, `PUT:/${plural}`, `DELETE:/${plural}`]) out[id] = alias;
  };
  for (const e of Object.values(ENTIDADES)) {
    if (e.def.administrable === false) continue;
    escrituras(e.singularPath.join("/"), e.pluralPath.join("/"), e.meta.pks, "catalogo.escribir");
  }
  escrituras("usuario", "usuarios", ["iusuario"], "seguridad.administrar");
  escrituras("permisos/grupo", "permisos/grupos", ["igrupo"], "seguridad.administrar");
  escrituras("permisos/rol", "permisos/roles", ["irol"], "seguridad.administrar");
  escrituras("permisos/rolusuario", "permisos/rolesusuario", ["iusuario", "irol"], "seguridad.administrar");
  escrituras("permisos/accion", "permisos/acciones", ["irol", "iaccion"], "seguridad.administrar");
  return out;
}

/** DER de permisos del lab: el rol base sólo lee; cada rol habilita lo suyo; ADMIN lo puede todo (`"*": true`, lo siembra el plugin). */
export function derPermisos() {
  return {
    roles: [
      { irol: "VENDEDOR", igrupo: GRUPO, nombre: "Vendedor: registra y anula ventas" },
      { irol: "BODEGA", igrupo: GRUPO, nombre: "Bodega: compras y transferencias de inventario" },
      { irol: "GERENTE", igrupo: GRUPO, nombre: "Gerente: catálogo, precios y limpieza" },
    ],
    acciones: [
      { irol: "USR", iaccion: "*", valor: { GET: true, POST: false, PUT: false, DELETE: false } },
      { irol: "VENDEDOR", iaccion: "ventas.registrar", valor: true },
      { irol: "VENDEDOR", iaccion: "ventas.anular", valor: true },
      { irol: "BODEGA", iaccion: "inventario.comprar", valor: true },
      { irol: "BODEGA", iaccion: "inventario.transferir", valor: true },
      { irol: "GERENTE", iaccion: "catalogo.escribir", valor: true },
      { irol: "GERENTE", iaccion: "productos.ajustar-precios", valor: true },
      { irol: "GERENTE", iaccion: "productos.limpiar", valor: true },
    ],
    rolesusuario: USUARIOS_SEMILLA.flatMap((u) => u.roles.filter((r) => r !== "ADMIN").map((irol) => ({ iusuario: u.iusuario, irol, bprincipal: true }))),
  };
}

/** Arma identidad + permisos sobre la base y conecta la puerta `extract` del lab (gana sobre la del plugin de identidad). */
export function buildSecurity(db: Database): SecurityPlugins {
  const secret = Deno.env.get("JWT_SECRET") ?? "megaretail-lab-sin-seguridad-0000000000000000";
  const auth = createServer(identityServer, { db, cfg: { secret, admin: { usuario: "admin", password: PASSWORD_LAB, nombre: "Administrador" } } });
  const permisos = createServer(permissionsServer, { db, cfg: { grupo: GRUPO, rolBase: "USR", rolAdmin: "ADMIN", admins: ["admin"], aliases: aliases() } });
  // las puertas son un singleton por proceso: se limpian para que no quede la de una app anterior (pruebas)
  registry.secure(null);
  registry.secure({
    extract: async (req: Request): Promise<SessionInfo | null> => {
      const iusuario = req.headers.get(CABECERA_USUARIO)?.trim();
      if (!iusuario) return null;
      const u = await auth.controllers["usuarios"]!.get({ iusuario }, { include: {} });
      if (!u) throw new HttpError(401, `Usuario desconocido: ${iusuario}`);
      if (u.bactivo === false) throw new HttpError(401, `Usuario inactivo: ${iusuario}`);
      return { id: iusuario, nombre: u.nombre ?? iusuario };
    },
  });
  return { auth, permisos };
}

/** Siembra el DER de permisos y los usuarios de muestra (idempotente). Correr después de `router.seed()`. */
export async function seedSecurity(p: SecurityPlugins): Promise<void> {
  const usuarios = p.auth.controllers["usuarios"]!;
  for (const u of USUARIOS_SEMILLA) {
    if (await usuarios.get({ iusuario: u.iusuario }, { include: {} })) continue;
    await usuarios.post({ iusuario: u.iusuario, nombre: u.nombre, email: u.email, password: PASSWORD_LAB });
  }
  await p.permisos["load"](derPermisos());
}

/** Usuarios con sus roles, para el selector del front (ruta pública `GET lab/usuarios`). */
export async function usuariosLab(p: SecurityPlugins): Promise<UsuarioLab[]> {
  const usuarios = await p.auth.controllers["usuarios"]!.list();
  const asignaciones = await p.permisos.controllers["rolesUsuario"]!.list();
  return usuarios.map((u) => ({ iusuario: String(u.iusuario), nombre: u.nombre ?? null, bactivo: u.bactivo !== false, roles: asignaciones.filter((a) => a.iusuario === u.iusuario).map((a) => String(a.irol)) }));
}
