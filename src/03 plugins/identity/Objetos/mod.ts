/**
 * Espacio de usuarios: id único string (no pares itercero/icontacto). La contraseña llega en `password`
 * (virtual, nunca se guarda) y se persiste sólo su hash en `hash` (columna oculta: nunca sale por la API).
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/Controllers@main/docs/README.md
 */
export * from "./usuario.ts";
export * from "./sesion.ts";
