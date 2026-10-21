/** Objeto del plugin de identidad: POJO `Sesion`, su schema JSON (`SesionSchema`) y su entidad REST (`SesionEntity`). */
import { defineEntity, defineSchema, type Entity, pojoOf } from "@Jeff-Aporta/DER/src/01-objects/index.ts";

/** Sesión emitida (una por token): `logout` la revoca y la puerta la exige vigente. */
export const SesionSchema = defineSchema({
  columns: {
    jti: { type: "string", pk: true, length: 64 },
    iusuario: { type: "string", length: 120, nullable: false },
    emitido: { type: "datetime" },
    expira: { type: "datetime" },
    brevocado: { type: "bool", default: false },
    /** Auditoría del equipo y la red desde donde se emitió y se usó la sesión. */
    ip: { type: "string", length: 64 },
    user_agent: { type: "string", length: 400 },
    dispositivo: { type: "string", length: 40 },
    so: { type: "string", length: 60 },
    navegador: { type: "string", length: 60 },
    /** Huella estable del equipo (hash del user-agent): detecta dispositivos nuevos. */
    huella: { type: "string", length: 40 },
    /** Último request autenticado con esta sesión (se actualiza con throttle). */
    ultimo_acceso: { type: "datetime" },
  },
});

export class Sesion extends pojoOf(SesionSchema) {}

export const SesionEntity: Entity<Sesion> = defineEntity({
  pojo: Sesion,
  name: "permisos.sesion",
  singular: "sesion",
  plural: "sesiones",
});