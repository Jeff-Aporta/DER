/**
 * Plugin de voz (server): la configuracion de voz por app y la sintesis.
 *
 * DER no conoce ningun motor de voz: el consumidor lo aporta (`services.motor`) y
 * DER solo guarda la configuracion, la pide y, si el consumidor tambien da un
 * almacen (`services.guardar`), deja el audio guardado con su caducidad para que
 * se pueda escuchar despues (por ejemplo, en la conversacion del CRM).
 *
 * ```ts
 * const voz = createServer(vozServer, { db, cfg: { vidaDias: 30 }, services: { motor, guardar } });
 * await voz.configDe("chat-assistant");        // la voz de esa app
 * const a = await voz.sintetizar({ texto: "Hola", iapp: "chat-assistant" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/voz.md
 */
import { HttpError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { z } from "zod";
import type { ExtraRouteInput, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { vozPlugin } from "@Jeff-Aporta/DER/src/03-plugins/voz/index.ts";
import {
  type AudioSintetizado,
  type GuardarVoz,
  type MotorVoz,
  type Sintetizar,
  type VozApp,
  type VozConfig,
  ZGuardarVoz,
  ZSintetizar,
  ZVozConfig,
} from "@Jeff-Aporta/DER/src/03-plugins/voz/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/voz/index.ts";

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

/** El motor de voz que puso el consumidor (o 503). */
function motorDe(p: ServerPlugin): MotorVoz {
  const m = (p.services as { motor?: MotorVoz } | undefined)?.motor;
  if (!m) throw new HttpError(503, "El motor de voz no esta disponible");
  return m;
}

/** La fila de configuracion de voz de una app, como la guarda la tabla. */
type FilaVoz = {
  iapp: string;
  motor: string;
  voz: string;
  perfil: string;
  idioma: string;
  tono: string | null;
  activa: boolean;
};

/** De la fila a la config tipada (con lo de por defecto si no se reconoce). */
function aConfig(fila: FilaVoz | undefined, porDefecto: VozApp): VozApp {
  if (!fila) return porDefecto;
  return {
    motor: (fila.motor as VozApp["motor"]) ?? porDefecto.motor,
    voz: fila.voz ?? porDefecto.voz,
    perfil: (fila.perfil as VozApp["perfil"]) ?? porDefecto.perfil,
    idioma: fila.idioma ?? porDefecto.idioma,
    tono: fila.tono ?? null,
    activa: fila.activa !== false,
  };
}

/** JSON del server de voz: la entidad `voz_app` mas las ops. */
export const vozServer: ServerPluginDef = Obj.insert(vozPlugin, {
  cfg: ZVozConfig,
  setup(this: ServerPlugin) {
    const cfg = (): VozConfig => this.cfg as VozConfig;

    /** La voz de una app (la suya o la de por defecto). */
    this["configDe"] = async (iapp: string): Promise<VozApp> => {
      const fila = await this.controllers["voz_app"]!.get({ iapp });
      return aConfig(fila as FilaVoz | undefined, cfg().porDefecto);
    };

    /** Guarda (o cambia) la voz de una app. */
    this["configurar"] = async (iapp: string, cambios: Partial<VozApp>): Promise<VozApp> => {
      const previa = await this["configDe"]!(iapp);
      const nueva: VozApp = {
        motor: cambios.motor ?? previa.motor,
        voz: cambios.voz ?? previa.voz,
        perfil: cambios.perfil ?? previa.perfil,
        idioma: cambios.idioma ?? previa.idioma,
        tono: cambios.tono !== undefined ? cambios.tono : previa.tono,
        activa: cambios.activa ?? previa.activa,
      };
      const ctrl = this.controllers["voz_app"]!;
      const pojo = ctrl.pojo({
        iapp,
        motor: nueva.motor,
        voz: nueva.voz,
        perfil: nueva.perfil,
        idioma: nueva.idioma,
        tono: nueva.tono ?? null,
        activa: nueva.activa,
      });
      const existe = await ctrl.get({ iapp });
      if (existe) await ctrl.put(pojo);
      else await ctrl.post(pojo);
      return nueva;
    };

    /** Sintetiza el texto con la voz de la app. */
    this["sintetizar"] = async (entrada: unknown): Promise<AudioSintetizado & { guardado?: { clave: string; url?: string | undefined } }> => {
      const d = validado<Sintetizar>(ZSintetizar, entrada);
      const voz = await this["configDe"]!(d.iapp);
      if (!voz.activa) throw new HttpError(409, "La voz de esta app esta desactivada");

      const motor = motorDe(this);
      const bytes = await motor.sintetizar({
        texto: d.texto,
        voz: voz.voz,
        perfil: voz.perfil,
        idioma: d.idioma ?? voz.idioma,
        tono: d.tono ?? voz.tono ?? undefined,
      });

      const resultado: AudioSintetizado & { guardado?: { clave: string; url?: string | undefined } } = {
        bytes,
        mime: "audio/ogg",
        duracionSeg: null,
        voz: voz.voz,
        perfil: voz.perfil,
      };

      const guardar = (this.services as {
        guardar?: (datos: {
          bytes: Uint8Array;
          mime: string;
          nombre: string;
          origin?: string | undefined;
          idorigin?: string | undefined;
        }) => Promise<{ clave: string; url?: string | undefined } | void>;
      } | undefined)?.guardar;
      const quiereGuardar = d.guardar ?? cfg().guardar;
      if (guardar && quiereGuardar) {
        const g = await guardar({
          bytes,
          mime: resultado.mime,
          nombre: "nota-" + d.iapp + ".ogg",
          origin: d.origin,
          idorigin: d.idorigin,
        });
        if (g) resultado.guardado = { clave: g.clave, url: g.url };
      }
      return resultado;
    };

    /** Las voces que el motor tiene (para el panel de administracion). */
    this["voces"] = async (): Promise<{ clave: string; nombre: string; genero?: string | undefined }[]> => {
      const motor = motorDe(this);
      return (await motor.voces?.()) ?? [];
    };
  },
  irregularPaths: {
    config: {
      async handler(this: ServerPlugin, i: ExtraRouteInput) {
        const iapp = i.query.get("iapp") ?? "";
        if (!iapp) throw new ValidationError("Falta iapp");
        return { iapp, config: await this["configDe"]!(iapp) };
      },
    },
    guardarConfig: {
      async handler(this: ServerPlugin, i: ExtraRouteInput) {
        const d = validado<GuardarVoz>(ZGuardarVoz, i.body);
        const { iapp, ...cambios } = d;
        return { iapp, config: await this["configurar"]!(iapp, cambios) };
      },
    },
    voces: {
      async handler(this: ServerPlugin) {
        return { voces: await this["voces"]!() };
      },
    },
    sintetizar: {
      async handler(this: ServerPlugin, i: ExtraRouteInput) {
        const a = await this["sintetizar"]!(i.body);
        const headers = new Headers({
          "content-type": a.mime,
          "x-voz": a.voz,
          "x-perfil": a.perfil,
          "x-content-type-options": "nosniff",
        });
        if (a.guardado?.url) headers.set("x-archivo-url", a.guardado.url);
        return new Response(a.bytes as unknown as BodyInit, { status: 200, headers });
      },
    },
  },
  /** Crea sus tablas (y les suma columnas nuevas) en cualquier motor. */
  async seed(this: ServerPlugin) {
    for (const c of this.list) {
      await c.seed();
      await c.syncSchema({ keepExtra: true });
    }
  },
}) as ServerPluginDef;
