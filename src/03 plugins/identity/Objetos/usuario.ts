/** Objeto del plugin de identidad: POJO `Usuario`, su schema JSON (`UsuarioSchema`) y su entidad REST (`UsuarioEntity`). */
import { defineEntity, defineSchema, type Entity, pojoOf } from "@Jeff-Aporta/DER/src/01 objects/mod.ts";

export const UsuarioSchema = defineSchema({
  columns: {
    iusuario: { type: "string", pk: true, length: 120 },
    nombre: { type: "string", length: 200 },
    email: { type: "string", length: 200 },
    bactivo: { type: "bool", default: true },
    jdata: { type: "json" },
    creado: { type: "datetime" },
    /** PBKDF2 con pepper; oculta (`hidden`) en el controller. */
    hash: { type: "string", length: 300 },
    /** Contraseña en claro sólo en la entrada de POST/PUT; no se persiste. */
    password: { type: "string", virtual: true },
  },
});

export class Usuario extends pojoOf(UsuarioSchema) {}

export const UsuarioEntity: Entity<Usuario> = defineEntity({
  pojo: Usuario,
  name: "permisos.usuario",
  singular: "usuario",
  plural: "usuarios",
  listColumns: ["iusuario", "nombre", "email", "bactivo"],
  hooks: {
    prePost(u) {
      if (!u.password) return "Falta la contraseña";
      return u.password.length < 8 ? "La contraseña debe tener al menos 8 caracteres" : null;
    },
    prePut(u) {
      return u.password != null && u.password.length < 8 ? "La contraseña debe tener al menos 8 caracteres" : null;
    },
  },
});
