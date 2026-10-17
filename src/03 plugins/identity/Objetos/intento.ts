/** Objeto del plugin de identidad: intento de login (auditoría de fuerza bruta y decisiones). */
import { defineEntity, defineSchema, type Entity, pojoOf } from "@Jeff-Aporta/DER/src/01 objects/mod.ts";

/** Cada intento de login, con su resultado y motivo: alimenta el bloqueo y la auditoría. */
export const IntentoSchema = defineSchema({
  columns: {
    iintento: { type: "int", pk: true, autoincrement: true },
    iusuario: { type: "string", length: 120 },
    ip: { type: "string", length: 64 },
    user_agent: { type: "string", length: 400 },
    dispositivo: { type: "string", length: 40 },
    so: { type: "string", length: 60 },
    navegador: { type: "string", length: 60 },
    /** `ok` | `fallo` | `bloqueado`. */
    resultado: { type: "string", length: 20, nullable: false },
    motivo: { type: "string", length: 60 },
    creado: { type: "datetime" },
  },
});

export class Intento extends pojoOf(IntentoSchema) {}

export const IntentoEntity: Entity<Intento> = defineEntity({
  pojo: Intento,
  name: "permisos.intento",
  singular: "intento",
  plural: "intentos",
});
