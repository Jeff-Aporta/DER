/**
 * Tipos y Zod del plugin de voz: la configuracion de como habla cada app y la
 * peticion de sintesis.
 *
 * La voz es una parte de la CONFIGURACION de la app (no un parametro suelto): por
 * eso se puede cambiar en cualquier momento desde el panel de administracion y
 * todos los bots (WhatsApp, Telegram, el CRM) usan la misma.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/voz.md
 */
import { z } from "zod";

/** Motores de sintesis que DER conoce. El motor es el que el consumidor implementa. */
export const MOTORES_VOZ = ["qwen", "edge", "kokoro", "otro"] as const;

/** Como habla una app: el motor, la voz y el perfil de velocidad. */
export const ZVozApp = z.strictObject({
  /** Que motor sintetiza (lo implementa el consumidor). */
  motor: z.enum(MOTORES_VOZ).default("qwen"),
  /** Clave de la voz (por ejemplo "aiden" o "serena"); la cataloga el consumidor. */
  voz: z.string().min(1).max(60).default("aiden"),
  /**
   * Perfil de generacion: "rapido" para respuestas en vivo (sin tono) y
   * "video" para texto con tono (risas, susurros). El motor decide que perfil usa.
   */
  perfil: z.enum(["rapido", "video"]).default("rapido"),
  /** Idioma hint (el motor puede usarlo para elegir voz). */
  idioma: z.string().min(2).max(10).default("es"),
  /** Direccion actoral opcional ("suave", "alegre", "serio"...). */
  tono: z.string().max(40).nullish(),
  /** Si esta activa: con false la app responde solo por texto. */
  activa: z.boolean().default(true),
});

/** Configuracion ya validada de la voz de una app. */
export type VozApp = z.infer<typeof ZVozApp>;

/** Zod estricto de la configuracion de voz por app. */
export const ZVozConfig = z.strictObject({
  /** La voz por defecto cuando una app no tiene la suya. */
  porDefecto: ZVozApp.default({
    motor: "qwen",
    voz: "aiden",
    perfil: "rapido",
    idioma: "es",
    tono: null,
    activa: true,
  }),
  /**
   * Vida del audio guardado, en dias. Por defecto 30 dias: a los 30 dias el
   * almacen (R2) lo borra y el plugin de archivos tambien lo suelta.
   */
  vidaDias: z.number().int().positive().max(365).default(30),
  /** Si las notas de voz se guardan para poder escucharlas en el CRM. */
  guardar: z.boolean().default(true),
});

/** Configuracion ya validada. */
export type VozConfig = z.infer<typeof ZVozConfig>;

/** Peticion de sintesis. */
export const ZSintetizar = z.strictObject({
  /** Que dice. */
  texto: z.string().min(1).max(4000),
  /** Que app lo pide (de ahi sale la voz). */
  iapp: z.string().min(1).max(60),
  /** Idioma opcional; si no, el de la app. */
  idioma: z.string().min(2).max(10).optional(),
  /** Direccion actoral opcional. */
  tono: z.string().max(40).optional(),
  /** Si se guarda el audio (por defecto, si la configuracion lo dice). */
  guardar: z.boolean().optional(),
  /** A que fila se adjunta (por ejemplo un mensaje del CRM). */
  origin: z.string().min(1).max(60).optional(),
  idorigin: z.string().min(1).max(120).optional(),
});

/** Peticion ya validada. */
export type Sintetizar = z.infer<typeof ZSintetizar>;

/**
 * Contrato del motor de voz: lo implementa el consumidor (el que tiene el motor
 * TTS). DER no conoce ningun motor: solo llama a este contrato.
 */
export type MotorVoz = {
  /**
   * Sintetiza y devuelve los bytes del audio (OGG/Opus, que es lo que WhatsApp
   * quiere para las notas de voz).
   */
  sintetizar(peticion: { texto: string; voz: string; perfil: "rapido" | "video"; idioma: string; tono?: string | undefined }): Promise<Uint8Array>;
  /** Las voces que el motor tiene (para el panel de administracion). */
  voces?(): Promise<{ clave: string; nombre: string; genero?: string | undefined }[]>;
};

/** Un audio ya sintetizado. */
export type AudioSintetizado = {
  bytes: Uint8Array;
  mime: string;
  duracionSeg: number | null;
  voz: string;
  perfil: "rapido" | "video";
};
