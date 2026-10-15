/**
 * DER de permisos (destilado de SEG de ISS, con ids únicos string):
 *
 *   permisos_grupos (igrupo, nombre)                         ← grupo al que pertenecen los roles
 *   permisos_roles (irol, igrupo, nombre, bactivo)           ← cada rol pertenece a un grupo
 *   permisos_rolesusuario (iusuario, irol, finicial, ffinal, bprincipal)   ← vigencia y rol principal
 *   permisos_accionesrol (irol, iaccion, valor)              ← iaccion = id de ruta (`DELETE:/producto/{iproducto}`) o "*"
 *
 * El rol base (USR) define los valores por defecto de todos: efectivo(R) = (base − ids de R) + R.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/03 plugins/permissions/Objetos/grupo.ts";
export * from "@Jeff-Aporta/DER/src/03 plugins/permissions/Objetos/rol.ts";
export * from "@Jeff-Aporta/DER/src/03 plugins/permissions/Objetos/rolUsuario.ts";
export * from "@Jeff-Aporta/DER/src/03 plugins/permissions/Objetos/accionRol.ts";
