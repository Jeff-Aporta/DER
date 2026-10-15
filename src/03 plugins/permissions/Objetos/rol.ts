/** Objeto del plugin de permisos (DER): Rol. */
import { defineEntity, defineSchema, type Entity, type Pojo, pojoOf } from "../../../01 objects/mod.ts";
import type { PojoClass, Schema } from "../../../00 common/schemas.ts";
import type { RolFields } from "../schemas.ts";
import type { TAccionRol } from "./accionRol.ts";
import type { TGrupo } from "./grupo.ts";

export const RolSchema: Schema = defineSchema({
  columns: {
    irol: { type: "string", pk: true, length: 60 },
    igrupo: { type: "string", length: 60, nullable: false },
    nombre: { type: "string", length: 200 },
    bactivo: { type: "bool", default: true },
  },
  relations: {
    acciones: { kind: "many", target: "sec.accion", on: { irol: "irol" } },
    grupo: { kind: "one", target: "sec.grupo", on: { igrupo: "igrupo" } },
  },
});

const TRolBase = pojoOf(RolSchema) as unknown as PojoClass<Pojo & RolFields>;

export class TRol extends TRolBase {
  declare acciones: TAccionRol[];
  declare grupo: TGrupo | null;
}

export const Rol: Entity<TRol> = defineEntity({
  pojo: TRol,
  name: "sec.rol",
  singular: "permisos/rol",
  plural: "permisos/roles",
});
