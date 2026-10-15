/** Objeto del plugin de permisos (DER): POJO `RolUsuario`, su schema JSON (`RolUsuarioSchema`) y su entidad REST (`RolUsuarioEntity`). */
import { defineEntity, defineSchema, type Entity, pojoOf } from "@Jeff-Aporta/DER/src/01 objects/mod.ts";
import type { Rol } from "@Jeff-Aporta/DER/src/03 plugins/permissions/Objetos/rol.ts";
// reusa la clase de usuario del plugin de identidad (y la registra para resolver `target: "permisos.usuario"`)
import "@Jeff-Aporta/DER/src/03 plugins/identity/Objetos/usuario.ts";
import type { Usuario } from "@Jeff-Aporta/DER/src/03 plugins/identity/Objetos/usuario.ts";

export const RolUsuarioSchema = defineSchema({
  columns: {
    iusuario: { type: "string", pk: true, length: 120 },
    irol: { type: "string", pk: true, length: 60 },
    finicial: { type: "datetime" },
    ffinal: { type: "datetime" },
    bprincipal: { type: "bool", default: false },
  },
  relations: {
    rol: { kind: "one", target: "permisos.rol", on: { irol: "irol" } },
    usuario: { kind: "one", target: "permisos.usuario", on: { iusuario: "iusuario" } },
  },
});

export class RolUsuario extends pojoOf(RolUsuarioSchema) {
  declare rol: Rol | null;
  declare usuario: Usuario | null;
}

export const RolUsuarioEntity: Entity<RolUsuario> = defineEntity({
  pojo: RolUsuario,
  name: "permisos.rolusuario",
  singular: "permisos/rolusuario",
  plural: "permisos/rolesusuario",
});
