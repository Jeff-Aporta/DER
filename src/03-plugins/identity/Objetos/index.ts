/**
 * Espacio de usuarios: id único string (no pares itercero/icontacto). La contraseña llega en `password`
 * (virtual, nunca se guarda) y se persiste sólo su hash en `hash` (columna oculta: nunca sale por la API).
 * Incluye sesiones (con auditoría de equipo/red) e intentos/eventos de auditoría del login.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/Objetos/usuario.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/Objetos/sesion.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/Objetos/intento.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/Objetos/evento.ts";
