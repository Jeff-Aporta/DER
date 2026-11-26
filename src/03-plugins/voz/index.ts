import type { PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";

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
};
