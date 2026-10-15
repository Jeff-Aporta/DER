/** Objeto del plugin de permisos (DER): AccionRol. */
import { defineEntity, defineSchema, type Entity, type Pojo, pojoOf } from "../../../01 objects/mod.ts";
import type { PojoClass, Schema } from "../../../00 common/schemas.ts";
import type { AccionRolFields } from "../schemas.ts";

export const AccionRolSchema: Schema = defineSchema({
  columns: {
    irol: { type: "string", pk: true, length: 60 },
    iaccion: { type: "string", pk: true, length: 300 },
    valor: { type: "json" },
  },
});

const TAccionRolBase = pojoOf(AccionRolSchema) as unknown as PojoClass<Pojo & AccionRolFields>;

export class TAccionRol extends TAccionRolBase {}

export const AccionRol: Entity<TAccionRol> = defineEntity({
  pojo: TAccionRol,
  name: "sec.accion",
  singular: "permisos/accion",
  plural: "permisos/acciones",
});
