/** Objeto del plugin de identidad: Usuario. */
import { defineEntity, defineSchema, type Entity, type Pojo, pojoOf } from "../../../01 objects/mod.ts";
import type { PojoClass, Schema } from "../../../00 common/schemas.ts";
import type { UsuarioFields } from "../schemas.ts";

export const UsuarioSchema: Schema = defineSchema({
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

const TUsuarioBase = pojoOf(UsuarioSchema) as unknown as PojoClass<Pojo & UsuarioFields>;

export class TUsuario extends TUsuarioBase {}

export const Usuario: Entity<TUsuario> = defineEntity({
  pojo: TUsuario,
  name: "sec.usuario",
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
