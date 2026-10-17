/** Objeto del plugin de identidad: evento de auditoría (quién hizo qué, desde dónde). */
import { defineEntity, defineSchema, type Entity, pojoOf } from "@Jeff-Aporta/DER/src/01 objects/mod.ts";

/** Auditoría genérica: login, logout, cambio de contraseña, bloqueos y detecciones. */
export const EventoSchema = defineSchema({
  columns: {
    ievento: { type: "string", pk: true, length: 64 },
    iusuario: { type: "string", length: 120 },
    /** `login`, `logout`, `logout_all`, `password`, `bloqueo`, `dispositivo_nuevo`, `viaje_imposible`. */
    accion: { type: "string", length: 80, nullable: false },
    entidad: { type: "string", length: 80 },
    entidad_id: { type: "string", length: 120 },
    ip: { type: "string", length: 64 },
    user_agent: { type: "string", length: 400 },
    dispositivo: { type: "string", length: 40 },
    /** Detalle libre (antes/después, motivo, contadores...). */
    jdata: { type: "json" },
    creado: { type: "datetime" },
  },
});

export class Evento extends pojoOf(EventoSchema) {}

export const EventoEntity: Entity<Evento> = defineEntity({
  pojo: Evento,
  name: "permisos.evento",
  singular: "evento",
  plural: "eventos",
});
