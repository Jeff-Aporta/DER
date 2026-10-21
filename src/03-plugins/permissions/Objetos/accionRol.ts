/** Objeto del plugin de permisos (DER): POJO `AccionRol`, su schema JSON (`AccionRolSchema`) y su entidad REST (`AccionRolEntity`). */
import { defineEntity, defineSchema, type Entity, pojoOf } from "@Jeff-Aporta/DER/src/01-objects/index.ts";

export const AccionRolSchema = defineSchema({
  columns: {
    irol: { type: "string", pk: true, length: 60 },
    iaccion: { type: "string", pk: true, length: 300 },
    valor: { type: "json" },
  },
});

export class AccionRol extends pojoOf(AccionRolSchema) {}

export const AccionRolEntity: Entity<AccionRol> = defineEntity({
  pojo: AccionRol,
  name: "permisos.accion",
  singular: "permisos/accion",
  plural: "permisos/acciones",
});
