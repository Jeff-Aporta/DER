/** Objeto del plugin de permisos (DER): Grupo. */
import { defineEntity, defineSchema, type Entity, type Pojo, pojoOf } from "../../../01 objects/mod.ts";
import type { PojoClass, Schema } from "../../../00 common/schemas.ts";
import type { GrupoFields } from "../schemas.ts";
import type { TRol } from "./rol.ts";

export const GrupoSchema: Schema = defineSchema({
  columns: {
    igrupo: { type: "string", pk: true, length: 60 },
    nombre: { type: "string", length: 200 },
    igrupopadre: { type: "string", length: 60 },
  },
  relations: {
    roles: { kind: "many", target: "sec.rol", on: { igrupo: "igrupo" } },
  },
});

const TGrupoBase = pojoOf(GrupoSchema) as unknown as PojoClass<Pojo & GrupoFields>;

export class TGrupo extends TGrupoBase {
  declare roles: TRol[];
}

export const Grupo: Entity<TGrupo> = defineEntity({
  pojo: TGrupo,
  name: "sec.grupo",
  singular: "permisos/grupo",
  plural: "permisos/grupos",
});
