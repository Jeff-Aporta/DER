/**
 * seed.ts (plugin de permisos RBAC) — la SEMILLA: catalogo de acciones y roles base con su matriz por defecto.
 *
 * Esto es DATO de arranque, no logica: `seed()` lo inserta SOLO la primera vez (si el rol o la accion ya existe
 * no se toca), de modo que el dueno puede cambiar cualquier permiso por API/base y seguir sin perder sus cambios
 * al reiniciar. Para anadir una accion nueva sin desplegar se usa `PUT permisos/acciones` (o se toca la base);
 * para alinear la matriz de un rol nuevo con el catalogo se usa `PUT permisos/roles/{irol}/matriz`.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/permisos.md
 */

import type { AccionSemilla, RolSemilla } from "@Jeff-Aporta/DER/src/03-plugins/permisos/schemas.ts";

/**
 * CATALOGO DE ACCIONES: la lista completa de lo que el sistema sabe hacer. Cada accion es una capacidad
 * verificable (`exigirPermiso(ctx, "usuarios.rol")`) y el front pinta los botones con `puede("usuarios.rol")`.
 * El grupo ordena la pantalla de permisos.
 */
export const ACCIONES_SEMILLA: readonly AccionSemilla[] = [
  // permisos: administrar el propio sistema de permisos
  { clave: "permisos.ver", grupo: "permisos", descripcion: "Ver el catalogo de acciones, los roles y sus matrices" },
  { clave: "permisos.editar", grupo: "permisos", descripcion: "Crear y editar roles, matrices y acciones del catalogo" },
  { clave: "permisos.asignar", grupo: "permisos", descripcion: "Asignar y quitar roles a los usuarios de la empresa" },
  // bandeja y chat
  { clave: "inbox.ver", grupo: "inbox", descripcion: "Ver la bandeja de atencion (conversaciones y clientes)" },
  { clave: "inbox.responder", grupo: "inbox", descripcion: "Responder, resolver borradores y calificar en la bandeja" },
  { clave: "chat.ver", grupo: "chat", descripcion: "Leer el chat interno y sus adjuntos" },
  { clave: "chat.enviar", grupo: "chat", descripcion: "Escribir mensajes y adjuntar archivos en el chat" },
  { clave: "chat.modo", grupo: "chat", descripcion: "Cambiar el modo del chat (auto, manual, entrenamiento)" },
  { clave: "chat.crear", grupo: "chat", descripcion: "Abrir conversaciones y hilos nuevos" },
  { clave: "chat.grupos", grupo: "chat", descripcion: "Agregar y quitar participantes de una conversacion" },
  // contactos y prospectos
  { clave: "contactos.ver", grupo: "contactos", descripcion: "Ver los contactos de la empresa" },
  { clave: "contactos.crear", grupo: "contactos", descripcion: "Crear contactos" },
  { clave: "contactos.editar", grupo: "contactos", descripcion: "Editar y dar de baja contactos" },
  { clave: "prospectos.ver", grupo: "prospectos", descripcion: "Ver la agenda privada de prospectos" },
  { clave: "prospectos.editar", grupo: "prospectos", descripcion: "Crear, editar y borrar prospectos" },
  // metricas
  { clave: "metricas.ver", grupo: "metricas", descripcion: "Ver el panel de metricas de la empresa" },
  // usuarios y empresa
  { clave: "usuarios.ver", grupo: "usuarios", descripcion: "Ver los usuarios y miembros de la empresa" },
  { clave: "usuarios.rol", grupo: "usuarios", descripcion: "Cambiar el rol de un usuario de la empresa" },
  { clave: "empresa.ver", grupo: "empresa", descripcion: "Entrar al panel de la empresa" },
  { clave: "empresa.perfil", grupo: "empresa", descripcion: "Editar el perfil publico del negocio" },
  { clave: "empresa.numeros", grupo: "empresa", descripcion: "Administrar los numeros (canales) y el principal" },
  { clave: "empresa.canales", grupo: "empresa", descripcion: "Ver la configuracion de canales y el token enmascarado" },
  { clave: "empresa.legal", grupo: "empresa", descripcion: "Editar enlaces legales y condiciones" },
  { clave: "notificaciones.prefs", grupo: "notificaciones", descripcion: "Configurar a quien se le avisa de cada tipo de notificacion" },
  { clave: "retencion.ver", grupo: "retencion", descripcion: "Ver la politica de retencion de datos" },
  { clave: "retencion.editar", grupo: "retencion", descripcion: "Cambiar la politica de retencion de datos" },
  // tiquetes
  { clave: "tiquetes.ver", grupo: "tiquetes", descripcion: "Ver los tiquetes de la empresa" },
  { clave: "tiquetes.crear", grupo: "tiquetes", descripcion: "Crear tiquetes" },
  { clave: "tiquetes.adoptar", grupo: "tiquetes", descripcion: "Adoptar un tiquete (tomarlo para si)" },
  { clave: "tiquetes.asignar", grupo: "tiquetes", descripcion: "Asignar tiquetes a otros usuarios" },
  { clave: "tiquetes.estado", grupo: "tiquetes", descripcion: "Cambiar el estado de un tiquete" },
  { clave: "tiquetes.cerrar", grupo: "tiquetes", descripcion: "Cerrar y resolver tiquetes" },
  { clave: "tiquetes.comentar", grupo: "tiquetes", descripcion: "Comentar en un tiquete" },
  // sistema
  { clave: "errores.ver", grupo: "errores", descripcion: "Ver la cola de errores reportados por las apps" },
  { clave: "errores.gestionar", grupo: "errores", descripcion: "Tomar, avanzar y atender los errores reportados" },
  { clave: "errores.solicitar", grupo: "errores", descripcion: "Pedir que un agente resuelva un error" },
  { clave: "salud.ver", grupo: "salud", descripcion: "Ver la salud del sistema y las sondas de rutas" },
  // calidad y formacion
  { clave: "csat.ver", grupo: "csat", descripcion: "Ver las encuestas de calidad (CSAT)" },
  { clave: "csat.destinatarios", grupo: "csat", descripcion: "Elegir a quien se le envian las encuestas" },
  { clave: "entrenamientos.ver", grupo: "entrenamientos", descripcion: "Ver los entrenamientos y materiales del equipo" },
  // adjuntos
  { clave: "adjuntos.subir", grupo: "adjuntos", descripcion: "Subir adjuntos (archivos, audios, imagenes)" },
  // CRM: acciones finas del barrido RBAC
  { clave: "usuarios.telefono", grupo: "usuarios", descripcion: "Dar acceso a un usuario por su telefono" },
  { clave: "notas.editar", grupo: "notas", descripcion: "Crear, editar y borrar notas de un chat" },
  { clave: "marcas.editar", grupo: "marcas", descripcion: "Poner y quitar marcas en mensajes" },
  { clave: "ia.usar", grupo: "ia", descripcion: "Usar las herramientas de IA del chat" },
  { clave: "enlaces.crear", grupo: "enlaces", descripcion: "Crear enlaces cortos" },
  { clave: "csat.enviar", grupo: "csat", descripcion: "Enviar una encuesta de calidad a un cliente" },
  { clave: "csat.forzar", grupo: "csat", descripcion: "Reenviar una encuesta aunque ya se haya enviado" },
  { clave: "resumenes.generar", grupo: "resumenes", descripcion: "Generar resumenes de conversaciones" },
  { clave: "reportes.ver", grupo: "reportes", descripcion: "Ver reportes y observaciones del auditor" },
  { clave: "apps.administrar", grupo: "apps", descripcion: "Crear y editar apps (negocios) y su ficha publica" },
  { clave: "catalogo.editar", grupo: "catalogo", descripcion: "Editar el catalogo de productos y servicios" },
  { clave: "pagos.ver", grupo: "pagos", descripcion: "Ver los pagos de la app" },
  { clave: "pagos.verificar", grupo: "pagos", descripcion: "Verificar pagos por transferencia y efectivo" },
  { clave: "grupos.globales", grupo: "grupos", descripcion: "Administrar grupos globales de chats" },
];

/** Grupo al que pertenece cada accion. */
const GRUPO: Record<string, string> = Object.fromEntries(ACCIONES_SEMILLA.map((a) => [a.clave, a.grupo]));

/** Las acciones de un grupo (azucar para escribir la matriz sin repetir el prefijo a mano). */
function grupo(nombre: string): string[] {
  return ACCIONES_SEMILLA.filter((a) => GRUPO[a.clave] === nombre).map((a) => a.clave);
}

/** TODAS las acciones del catalogo (lo que trae "*"). */
const TODAS: readonly string[] = ACCIONES_SEMILLA.map((a) => a.clave);

/**
 * MATRIZ POR DEFECTO. Propietario (ROOT) lo puede todo; gerente (ADMN_MAIN) administra la empresa pero no
 * edita matrices de permisos; admin (ADMN) administra sin tocar permisos ni ver tokens; auditor vigila;
 * agente atiende la operacion; wrkr (trabajador) SOLO tiquetes (adopta, cambia estado, comenta y resuelve);
 * lector solo lee; cliente no tiene permisos (es el cliente final).
 */
export const ROLES_SEMILLA: readonly RolSemilla[] = [
  { clave: "propietario", nombre: "Propietario", etiqueta: "ROOT", nivel: 100, descripcion: "El dueno de la empresa: todo, incluidos los permisos y los canales.", permisos: "*" },
  {
    clave: "gerente",
    nombre: "Gerente",
    etiqueta: "GERENTE",
    nivel: 90,
    descripcion: "Administra la empresa y su equipo; no edita las matrices de permisos.",
    permisos: TODAS.filter((a) => a !== "permisos.editar"),
  },
  {
    clave: "admin",
    nombre: "Administrador",
    etiqueta: "ADMN",
    nivel: 80,
    descripcion: "Administra la operacion de la empresa sin tocar permisos ni ver tokens de canal.",
    permisos: TODAS.filter((a) => !a.startsWith("permisos.") && a !== "empresa.canales" && a !== "errores.gestionar"),
  },
  { clave: "auditor", nombre: "Auditor", etiqueta: "AUDITOR", nivel: 70, descripcion: "Revisa errores, salud y metricas; no administra.", permisos: ["empresa.ver", "usuarios.ver", "metricas.ver", "errores.ver", "errores.solicitar", "reportes.ver", "salud.ver", "retencion.ver", "tiquetes.ver"] },
  {
    clave: "agente",
    nombre: "Agente",
    etiqueta: "AGENTE",
    nivel: 50,
    descripcion: "Atiende la bandeja, el chat y los tiquetes de la empresa.",
    permisos: [...grupo("inbox"), ...grupo("chat"), ...grupo("contactos"), ...grupo("prospectos"), "metricas.ver", "empresa.ver", "usuarios.ver", "notificaciones.prefs", "retencion.ver", ...grupo("tiquetes"), "csat.ver", "csat.enviar", "pagos.ver", "entrenamientos.ver", "adjuntos.subir", "notas.editar", "marcas.editar", "ia.usar", "resumenes.generar", "salud.ver"],
  },
  { clave: "wrkr", nombre: "Trabajador", etiqueta: "WRKR", nivel: 30, descripcion: "Trabajador de tiquetes: SOLO tiquetes (adopta, cambia estado, comenta y resuelve); sin conversaciones, errores ni estadisticas.", permisos: ["tiquetes.ver", "tiquetes.adoptar", "tiquetes.estado", "tiquetes.comentar", "tiquetes.cerrar"] },
  { clave: "lector", nombre: "Lector", etiqueta: "LECTURA", nivel: 20, descripcion: "Solo lectura de la bandeja y la empresa.", permisos: ["inbox.ver", "chat.ver", "contactos.ver", "empresa.ver", "tiquetes.ver"] },
  { clave: "cliente", nombre: "Cliente", etiqueta: "CLIENTE", nivel: 10, descripcion: "Cliente final: sin permisos administrativos.", permisos: [] },
];
