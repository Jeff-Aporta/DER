/**
 * Discriminacion DETERMINISTA de reportes: un reporte del cliente es (a) algo que resuelve un humano -> TIQUETE, o
 * (b) un error del SISTEMA -> cola de errores. Sin modelo, sin azar y sin red: el mismo texto da el mismo veredicto.
 *
 * Criterio (en orden; gana el primero que se cumple):
 *   1. Telemetria con HTTP >= 500 o una traza: ERROR del sistema.
 *   2. Texto con un fallo tecnico y un sujeto del sistema (app, web, formulario, login, bot, pantalla...): ERROR.
 *   3. Texto con un fallo sobre un sujeto del negocio (pedido, entrega, reserva, plato, producto...): TIQUETE.
 *   4. Texto con una peticion de negocio o de atencion (quiero, necesito, reservar, comprar, cotizar...): TIQUETE.
 *   5. Sin senales concluyentes: TIQUETE por defecto (el humano decide y, si es del sistema, lo escala).
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md · https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/tiquetes.md
 */
import type { ClasificacionContexto, VeredictoClasificacion } from "@Jeff-Aporta/DER/src/03-plugins/tiquetes/schemas.ts";

/** El criterio por escrito, en orden; la ruta de clasificacion lo devuelve para que el bot pueda explicarlo. */
export const REGLAS_CLASIFICACION: readonly string[] = [
  "(1) Telemetria con HTTP >= 500 o traza: ERROR del sistema.",
  "(2) Fallo tecnico sobre un sujeto del sistema (app, web, formulario, login, bot, pantalla): ERROR del sistema.",
  "(3) Fallo sobre un sujeto del negocio (pedido, entrega, reserva, plato, producto): TIQUETE (lo resuelve un humano).",
  "(4) Peticion de negocio o de atencion (quiero, necesito, reservar, comprar, cotizar): TIQUETE.",
  "(5) Sin senales concluyentes: TIQUETE por defecto (un humano lo revisa y, si es del sistema, lo escala).",
];

/** Fallos tecnicos (lo que dice el cliente cuando algo no anda). */
const FALLA = /\b(no (?:funciona|sirve|carga|abre|guarda|responde|deja|permite|puedo|me deja|me permite)|se (?:cae|cerro|traba)|se queda (?:cargando|en blanco|pegado)|error|falla|fallo|bug|excepcion|crash|roto|rota|colgado|500|502|503)\b/g;

/** Sujeto tecnico: si el fallo lo menciona, es del SISTEMA. */
const SUJETO_SISTEMA = /\b(app|aplicacion|pagina|web|sitio|sistema|plataforma|software|portal|formulario|login|sesion|pantalla|bot|carrito|pasarela|checkout|interfaz|panel|dashboard|api|usuario y clave|contrasena)\b/g;

/** Sujeto del negocio: si el fallo lo menciona, lo resuelve un HUMANO. */
const SUJETO_NEGOCIO = /\b(pedido|pedidos|pedir|compra|comprar|entrega|entregar|domicilio|reserva|reservas|reservar|habitacion|habitaciones|mesa|mesas|cita|agendar|turno|cotizacion|solicitud|reclamo|devolucion|factura|plato|platos|producto|productos|servicio|servicios|menu|stock|inventario|envio)\b/g;

/** Peticion de atencion humana (aunque no haya un sujeto explicito). */
const PETICION_HUMANO = /\b(quiero|necesito|solicito|deseo|me gustaria|pueden|podrian|ayuda|ayudarme|informacion|precio|precios|disponibilidad|consultar|consulto)\b/g;

/** Minusculas, sin acentos y con los espacios normalizados. */
export function normalizarReporte(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

/** Los terminos del texto que cumplen una expresion (sin repetir). */
function senalesDe(texto: string, re: RegExp): string[] {
  return [...new Set([...texto.matchAll(re)].map((m) => m[0]))];
}

/** El veredicto con su motivo, sus senales y el criterio completo. */
function veredicto(destino: "tiquete" | "error", motivo: string, senales: string[]): VeredictoClasificacion {
  return { destino, motivo, senales, reglas: [...REGLAS_CLASIFICACION] };
}

/**
 * Decide si un reporte del cliente es un TIQUETE (lo resuelve un humano) o un ERROR del sistema (cola de errores).
 * Funcion pura y determinista: no consulta la base, no llama a un modelo y no depende del reloj.
 */
export function clasificarReporte(texto: string, contexto: ClasificacionContexto = {}): VeredictoClasificacion {
  const normalizado = normalizarReporte(texto);
  const fallas = senalesDe(normalizado, FALLA);
  const sistemas = senalesDe(normalizado, SUJETO_SISTEMA);
  const negocios = senalesDe(normalizado, SUJETO_NEGOCIO);
  const peticiones = senalesDe(normalizado, PETICION_HUMANO);
  const http = contexto.codigoHttp ?? 0;
  if (http >= 500) return veredicto("error", "La telemetria trae HTTP " + http + ": es un fallo del sistema.", ["codigoHttp=" + http]);
  if (contexto.traza && contexto.traza.trim()) return veredicto("error", "La telemetria trae una traza de error: es un fallo del sistema.", ["traza"]);
  const tecnico = [...sistemas, ...(contexto.pantalla ? ["pantalla=" + contexto.pantalla] : []), ...(contexto.ruta ? ["ruta=" + contexto.ruta] : [])];
  if (fallas.length && tecnico.length) return veredicto("error", "Fallo tecnico sobre un componente del sistema: va a la cola de errores.", [...fallas, ...tecnico]);
  if (fallas.length && negocios.length) return veredicto("tiquete", "Fallo sobre un pedido, entrega o reserva: lo resuelve un humano.", [...fallas, ...negocios]);
  if (negocios.length) return veredicto("tiquete", "Peticion de negocio: la atiende un humano con un tiquete.", negocios);
  if (peticiones.length) return veredicto("tiquete", "Peticion de atencion humana: se abre un tiquete.", peticiones);
  if (fallas.length) return veredicto("tiquete", "El reporte no alcanza a probar un fallo del sistema: un humano lo revisa.", fallas);
  return veredicto("tiquete", "Sin senales de fallo del sistema: se abre un tiquete para atencion humana.", []);
}
