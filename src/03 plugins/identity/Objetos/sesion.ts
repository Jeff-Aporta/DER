/** Objeto del plugin de identidad: POJO `Sesion`, su schema JSON (`SesionSchema`) y su entidad REST (`SesionEntity`). */
import { defineEntity, defineSchema, type Entity, pojoOf } from "@Jeff-Aporta/DER/src/01 objects/mod.ts";

/** Sesión emitida (una por token): `logout` la revoca y la puerta la exige vigente. */
export const SesionSchema = defineSchema({
  columns: {
    jti: { type: "string", pk: true, length: 64 },
    iusuario: { type: "string", length: 120, nullable: false },
    emitido: { type: "datetime" },
    expira: { type: "datetime" },
    brevocado: { type: "bool", default: false },
  },
});

export class Sesion extends pojoOf(SesionSchema) {}

export const SesionEntity: Entity<Sesion> = defineEntity({
  pojo: Sesion,
  name: "permisos.sesion",
  singular: "sesion",
  plural: "sesiones",
});
