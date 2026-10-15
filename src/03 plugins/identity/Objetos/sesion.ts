/** Objeto del plugin de identidad: Sesion. */
import { defineEntity, defineSchema, type Entity, type Pojo, pojoOf } from "../../../01 objects/mod.ts";
import type { PojoClass, Schema } from "../../../00 common/schemas.ts";
import type { SesionFields } from "../schemas.ts";

/** Sesión emitida (una por token): `logout` la revoca y la puerta la exige vigente. */
export const SesionSchema: Schema = defineSchema({
  columns: {
    jti: { type: "string", pk: true, length: 64 },
    iusuario: { type: "string", length: 120, nullable: false },
    emitido: { type: "datetime" },
    expira: { type: "datetime" },
    brevocado: { type: "bool", default: false },
  },
});

const TSesionBase = pojoOf(SesionSchema) as unknown as PojoClass<Pojo & SesionFields>;

export class TSesion extends TSesionBase {}

export const Sesion: Entity<TSesion> = defineEntity({
  pojo: TSesion,
  name: "sec.sesion",
  singular: "sesion",
  plural: "sesiones",
});
