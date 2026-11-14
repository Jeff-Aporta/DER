/**
 * realtime.ts — la SALA de tiempo real del canal propio: los bots se suscriben por WebSocket (`/rt`) y reciben, al
 * instante, los mensajes nuevos, las reacciones y el latido con la presencia.
 *
 * Es el equivalente del Durable Object `CanalRT` del Worker: mismo contrato (mismos eventos, mismos filtros) pero
 * en memoria del proceso. El plugin no sabe de WebSockets: el servicio le entrega un `SocketSala` (el `enviar` y el
 * `cerrar` de su socket).
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/canal.md
 */
import { VERSION_PROTOCOLO, VIDA_HORAS } from "./protocolo.ts";

/** Un socket de la sala (lo que el servicio entrega: su WebSocket). */
export type SocketSala = {
  /** Envia un texto al bot. */
  enviar(texto: string): void;
  /** Cierra el socket. */
  cerrar(codigo?: number, motivo?: string): void;
};

/** Lo que la sala guarda de cada socket. */
export type AdjuntoSocket = {
  /** Quien es el bot. */
  bot: string;
  /** A que canales esta suscrito. */
  canales: string[];
  /** Que filtro quiere: `todos`, `para` o `mencion`. */
  filtro: string;
  /** La maquina donde vive. */
  nodo: string;
  /** Cuando entro. */
  desde: string;
};

/** Un bot conectado (para la presencia). */
export type PresenciaSala = { bot: string; canal: string; nodo: string; desde: string };

/** Avisos de la sala: el servicio los usa para marcar la presencia en la base. */
export type SalaAvisos = {
  /** Un bot entra (o cambia de canales): se marca su presencia. */
  alEntrar?(bot: string, canales: string[], nodo: string): void | Promise<void>;
  /** Un bot se va (no le queda ningun socket): su presencia pasa a desconectado. */
  alSalir?(bot: string, canales: string[], nodo: string): void | Promise<void>;
};

/**
 * La sala: un conjunto de sockets, cada uno con su bot, sus canales y su filtro.
 *
 * - Al entrar, el bot recibe `sala.estado` (sus canales, quien hay conectado, la hora y las 72 h de vida).
 * - Cada mensaje nuevo se difunde a los suscritos de ese canal (y que lo quieren, segun su filtro).
 * - El bot puede pedir el latido (`{"tipo":"latido"}`) o cambiar de canales en caliente (`{"tipo":"suscribir"}`).
 */
export class SalaCanal {
  readonly #sockets = new Map<SocketSala, AdjuntoSocket>();
  readonly #avisos: SalaAvisos;

  constructor(avisos: SalaAvisos = {}) {
    this.#avisos = avisos;
  }

  /** Entra un bot: se le manda el estado de la sala y se marca su presencia. */
  async entrar(socket: SocketSala, datos: Omit<AdjuntoSocket, "desde">): Promise<void> {
    const adjunto: AdjuntoSocket = { ...datos, desde: new Date().toISOString() };
    this.#sockets.set(socket, adjunto);
    this.#enviar(socket, {
      tipo: "sala.estado",
      de: "sala",
      ts: new Date().toISOString(),
      version: VERSION_PROTOCOLO,
      yo: datos.bot,
      nodo: datos.nodo,
      canales: datos.canales,
      filtro: datos.filtro,
      vida_horas: VIDA_HORAS,
      conectados: this.presencia(),
    });
    await this.#avisos.alEntrar?.(datos.bot, datos.canales, datos.nodo);
  }

  /** Sale un bot: si era el ultimo socket suyo, su presencia pasa a desconectado. */
  async salir(socket: SocketSala): Promise<void> {
    const a = this.#sockets.get(socket);
    if (!a) return;
    this.#sockets.delete(socket);
    if (!a.bot) return;
    for (const otro of this.#sockets.values()) {
      if (otro.bot === a.bot) return;
    }
    await this.#avisos.alSalir?.(a.bot, a.canales, a.nodo);
  }

  /** Un evento del bot: el latido o el cambio de suscripcion. */
  async evento(socket: SocketSala, datos: string): Promise<void> {
    const a = this.#sockets.get(socket);
    if (!a) return;
    if (datos.length > 64 * 1024) {
      this.#error(socket, "Evento demasiado grande (max. 64 KB)");
      return;
    }
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(datos) as Record<string, unknown>;
    } catch {
      this.#error(socket, "JSON invalido");
      return;
    }
    const tipo = String(ev["tipo"] ?? "");
    if (tipo === "latido" || tipo === "ping") {
      this.#enviar(socket, {
        tipo: "latido",
        de: "sala",
        ts: new Date().toISOString(),
        presencia: this.presencia(),
      });
      await this.#avisos.alEntrar?.(a.bot, a.canales, a.nodo);
      return;
    }
    if (tipo === "suscribir") {
      const canales = Array.isArray(ev["canales"])
        ? (ev["canales"] as unknown[]).filter((x): x is string => typeof x === "string")
        : a.canales;
      const filtro = typeof ev["filtro"] === "string" ? String(ev["filtro"]) : a.filtro;
      this.#sockets.set(socket, { ...a, canales, filtro });
      this.#enviar(socket, {
        tipo: "sala.suscrito",
        de: "sala",
        ts: new Date().toISOString(),
        canales,
        filtro,
      });
      await this.#avisos.alEntrar?.(a.bot, canales, a.nodo);
      return;
    }
    this.#error(socket, "Evento desconocido");
  }

  /** Difunde un evento a los sockets suscritos a ese canal (y que lo quieren, segun su filtro). */
  difundir(evento: Record<string, unknown>, canal: string): number {
    const texto = JSON.stringify({ ...evento, canal, ts: evento["ts"] ?? new Date().toISOString() });
    let n = 0;
    for (const [socket, a] of this.#sockets) {
      if (a.canales.length && !a.canales.includes(canal)) continue;
      if (!this.#leInteresa(a, evento)) continue;
      try {
        socket.enviar(texto);
        n++;
      } catch {
        // el socket se esta cerrando
      }
    }
    return n;
  }

  /** Quien esta conectado ahora mismo (segun los sockets). */
  presencia(): PresenciaSala[] {
    const vistos = new Map<string, PresenciaSala>();
    for (const a of this.#sockets.values()) {
      if (!a.bot) continue;
      for (const canal of a.canales.length ? a.canales : ["*"]) {
        vistos.set(`${a.bot}@${canal}`, { bot: a.bot, canal, nodo: a.nodo, desde: a.desde });
      }
    }
    return [...vistos.values()];
  }

  /** El latido periodico con la presencia (lo llama el servicio cada 30 s). */
  latido(): void {
    const evento = { tipo: "latido", de: "sala", ts: new Date().toISOString(), presencia: this.presencia() };
    for (const socket of this.#sockets.keys()) this.#enviar(socket, evento);
  }

  /** ¿Le interesa este evento a este socket? (el filtro del bot). */
  #leInteresa(a: AdjuntoSocket, evento: Record<string, unknown>): boolean {
    if (a.filtro === "para") return this.#esPara(a.bot, evento);
    if (a.filtro === "mencion") return this.#esPara(a.bot, evento) || this.#loMenciona(a.bot, evento);
    return true;
  }

  /** ¿El mensaje es para este bot? (mira el evento y el mensaje que lleva dentro). */
  #esPara(bot: string, evento: Record<string, unknown>): boolean {
    const para = evento["para"] ?? mensajeDe(evento)["para"];
    if (Array.isArray(para)) return para.some((x) => typeof x === "string" && x === bot);
    return false;
  }

  /** ¿El mensaje menciona a este bot? (`@bot`). */
  #loMenciona(bot: string, evento: Record<string, unknown>): boolean {
    const texto = evento["texto"] ?? mensajeDe(evento)["texto"];
    return typeof texto === "string" && texto.includes(`@${bot}`);
  }

  #enviar(socket: SocketSala, evento: Record<string, unknown>): void {
    try {
      socket.enviar(JSON.stringify(evento));
    } catch {
      // el socket se esta cerrando
    }
  }

  #error(socket: SocketSala, motivo: string): void {
    this.#enviar(socket, { tipo: "sala.error", de: "sala", ts: new Date().toISOString(), motivo });
  }
}

/** El mensaje que lleva un evento (si lo lleva). */
function mensajeDe(evento: Record<string, unknown>): Record<string, unknown> {
  const m = evento["mensaje"];
  return m && typeof m === "object" ? (m as Record<string, unknown>) : {};
}
