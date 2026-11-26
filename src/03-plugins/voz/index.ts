/**
 * Plugin de voz: el JSON TRANSVERSAL con la voz de cada app y la sintesis de notas de voz.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/voz.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type GuardarVoz, type Sintetizar, type VozApp, ZGuardarVoz, ZSintetizar } from "@Jeff-Aporta/DER/src/03-plugins/voz/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/voz/schemas.ts";

/**
 * Plugin de voz: el JSON TRANSVERSAL. La configuracion de como habla cada app y
 * la sintesis de las notas de voz.
 *
 * La voz no es un parametro suelto: es parte de la CONFIGURACION de la app
 * (`voz_app`), asi que se puede cambiar en cualquier momento desde el panel de
 * administracion y todos los bots usan la misma. El motor de sintesis lo pone el
 * consumidor (DER no conoce ningun TTS).
 *
 *   voz_app (iapp, motor, voz, perfil, idioma, tono, activa)
 *
 * ```ts
 * const voz = createClient(vozPlugin, { baseUrl: "/api", headers: auth.headers });
 * await voz.controllers.voz_app.post({ iapp: "chat-assistant", voz: "serena", perfil: "rapido" });
 * const a = await voz.sintetizar({ texto: "Hola", iapp: "chat-assistant" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/voz.md
 */
export const vozPlugin: PluginDef = {
  name: "voz",
  entities: {
    voz_app: {
      name: "voz.app",
      singular: "voz/app",
      plural: "voz/apps",
      table: "voz_app",
      exposed: true,
      administrable: true,
      security: true,
      schema: {
        columns: {
          iapp: { type: "string", pk: true, length: 60 },
          motor: { type: "string", nullable: false, length: 20 },
          voz: { type: "string", nullable: false, length: 60 },
          perfil: { type: "string", nullable: false, length: 20 },
          idioma: { type: "string", nullable: false, length: 10 },
          tono: { type: "string", nullable: true, length: 40 },
          activa: { type: "bool", nullable: false },
        },
      },
    },
  },
  irregularPaths: {
    config: {
      method: "GET",
      path: "voz/config",
      security: "protected",
      returns: "json",
      ops: {
        /** §GET voz/config?iapp=§: la voz de esa app (o la de por defecto). */
        config(this: ClientPlugin, query: { iapp: string }): Promise<{ iapp: string; config: VozApp }> {
          return this.call<{ iapp: string; config: VozApp }>("config", query);
        },
      },
    },
    guardarConfig: {
      method: "POST",
      path: "voz/config",
      security: "protected",
      zod: ZGuardarVoz,
      returns: "json",
      ops: {
        /** §POST voz/config§: cambia la voz de una app (motor, voz, perfil, idioma, tono, activa). */
        guardarConfig(this: ClientPlugin, input: GuardarVoz): Promise<{ iapp: string; config: VozApp }> {
          return this.call<{ iapp: string; config: VozApp }>("guardarConfig", input);
        },
      },
    },
    sintetizar: {
      method: "POST",
      path: "voz/sintetizar",
      security: "protected",
      zod: ZSintetizar,
      ops: {
        /** §POST voz/sintetizar§: sintetiza el texto; devuelve el audio binario (OGG/Opus). */
        sintetizar(this: ClientPlugin, input: Sintetizar): Promise<Uint8Array> {
          return this.call<Uint8Array>("sintetizar", input);
        },
      },
    },
    voces: {
      method: "GET",
      path: "voz/voces",
      security: "protected",
      returns: "json",
      ops: {
        /** §GET voz/voces§: las voces que el motor tiene (para el selector del panel). */
        voces(this: ClientPlugin): Promise<{ clave: string; nombre: string; genero?: string | undefined }[]> {
          return this.call<{ clave: string; nombre: string; genero?: string | undefined }[]>("voces");
        },
      },
    },
  },
};
