/**
 * DER de permisos (destilado de SEG de ISS, con ids únicos string):
 *
 *   sec_grupos (igrupo, nombre, igrupopadre)            ← jerarquía de grupos
 *   sec_roles (irol, igrupo, nombre, bactivo)           ← cada rol pertenece a un grupo
 *   sec_rolesusuario (iusuario, irol, finicial, ffinal, bprincipal)   ← vigencia y rol principal
 *   sec_accionesrol (irol, iaccion, valor)              ← iaccion = id de ruta (`DELETE:/producto/{iproducto}`) o "*"
 *
 * El rol base (USR) define los valores por defecto de todos: efectivo(R) = (base − ids de R) + R.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/Controllers@main/docs/README.md
 */
export * from "./grupo.ts";
export * from "./rol.ts";
export * from "./rolUsuario.ts";
export * from "./accionRol.ts";
