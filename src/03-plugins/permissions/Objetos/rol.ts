/** Objeto del plugin de permisos (DER): POJO `Rol`, su schema JSON (`RolSchema`) y su entidad REST (`RolEntity`). */
import { defineEntity, defineSchema, type Entity, pojoOf } from "@Jeff-Aporta/DER/src/01-objects/index.ts";
import type { AccionRol } from "@Jeff-Aporta/DER/src/03-plugins/permissions/Objetos/accionRol.ts";
import type { Grupo } from "@Jeff-Aporta/DER/src/03-plugins/permissions/Objetos/grupo.ts";

export const RolSchema = defineSchema({
  columns: {
    irol: { type: "string", pk: true, length: 60 },
    igrupo: { type: "string", length: 60, nullable: false },
    nombre: { type: "string", length: 200 },
    bactivo: { type: "bool", default: true },
  },
  relations: {
    acciones: { kind: "many", target: "permisos.accion", on: { irol: "irol" } },
    grupo: { kind: "one", target: "permisos.grupo", on: { igrupo: "igrupo" } },
  },
});

export class Rol extends pojoOf(RolSchema) {
  declare acciones: AccionRol[];
  declare grupo: Grupo | null;
}

export const RolEntity: Entity<Rol> = defineEntity({
  pojo: Rol,
  name: "permisos.rol",
  singular: "permisos/rol",
  plural: "permisos/roles",
});
