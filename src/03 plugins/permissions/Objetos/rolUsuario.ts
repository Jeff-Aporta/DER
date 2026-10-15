/** Objeto del plugin de permisos (DER): RolUsuario. */
import { defineEntity, defineSchema, type Entity, type Pojo, pojoOf } from "../../../01 objects/mod.ts";
import type { PojoClass, Schema } from "../../../00 common/schemas.ts";
import type { RolUsuarioFields } from "../schemas.ts";
import type { TRol } from "./rol.ts";

export const RolUsuarioSchema: Schema = defineSchema({
  columns: {
    iusuario: { type: "string", pk: true, length: 120 },
    irol: { type: "string", pk: true, length: 60 },
    finicial: { type: "datetime" },
    ffinal: { type: "datetime" },
    bprincipal: { type: "bool", default: false },
  },
  relations: {
    rol: { kind: "one", target: "sec.rol", on: { irol: "irol" } },
  },
});

const TRolUsuarioBase = pojoOf(RolUsuarioSchema) as unknown as PojoClass<Pojo & RolUsuarioFields>;

export class TRolUsuario extends TRolUsuarioBase {
  declare rol: TRol | null;
}

export const RolUsuario: Entity<TRolUsuario> = defineEntity({
  pojo: TRolUsuario,
  name: "sec.rolusuario",
  singular: "permisos/rolusuario",
  plural: "permisos/rolesusuario",
});
