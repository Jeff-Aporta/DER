/** Objeto del plugin de permisos (DER): POJO `Grupo`, su schema JSON (`GrupoSchema`) y su entidad REST (`GrupoEntity`). */
import { defineEntity, defineSchema, type Entity, pojoOf } from "@Jeff-Aporta/DER/src/01-objects/index.ts";
import type { Rol } from "@Jeff-Aporta/DER/src/03-plugins/permissions/Objetos/rol.ts";

export const GrupoSchema = defineSchema({
  columns: {
    igrupo: { type: "string", pk: true, length: 60 },
    nombre: { type: "string", length: 200 },
  },
  relations: {
    roles: { kind: "many", target: "permisos.rol", on: { igrupo: "igrupo" } },
  },
});

export class Grupo extends pojoOf(GrupoSchema) {
  declare roles: Rol[];
}

export const GrupoEntity: Entity<Grupo> = defineEntity({
  pojo: Grupo,
  name: "permisos.grupo",
  singular: "permisos/grupo",
  plural: "permisos/grupos",
});
