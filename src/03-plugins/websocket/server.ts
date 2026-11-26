/**
 * server.ts — el servidor del WebSocket de DER: una sala con JWT, filtro por alcance y limites anti-abuso.
 *
 * - El socket se autentica con el mismo token de sesion que la API (JWT HS256). Sin token valido, no entra.
 * - Lo que llega se valida con Zod: lo que no encaja en el contrato se rechaza.
 * - El socket solo recibe **avisos** y hace **consultas de solo lectura**. Nada que mute datos pasa por aqui:
 *   eso va por HTTP, con su token y su proteccion.
 * - Los limites (tamano, mensajes por minuto, silencio) cortan el abuso antes de que Santo Tomas entienda.
 *
 * El transporte se lo entrega el consumidor (Deno: `Deno.upgradeWebSocket`; Workers: `WebSocketPair`): el plugin
 * no sabe de Deno ni de Workers, solo de sockets.
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 */
import {
  INTERVALO_LATIDO_MS,
  MAX_BYTES,
  MAX_POR_MINUTO,
  TIMEOUT_SILENCIO_MS,
  VERSION_PROTOCOLO,
} from "@Jeff-Aporta/DER/src/03-plugins/websocket/protocolo.ts";
import { ZAviso, ZPeticion } from "@Jeff-Aporta/DER/src/03-plugins/websocket/schemas.ts";
import { verifyJwtHs256 } from "@Jeff-Aporta/DER/src/03-plugins/common/jwt.ts";
import type {
  AdjuntoSocket,
  Difusion,
  Identidad,
  Peticion,
  Socket,
} from "@Jeff-Aporta/DER/src/03-plugins/websocket/schemas.ts";
import type { Filtro } from "@Jeff-Aporta/DER/src/03-plugins/websocket/protocolo.ts";

/** Lo que el consumidor le da al servidor. */
export type ConfigServidor = {
  /** Secreto HS256 con el que se verifica el token de sesion (el mismo de la API). */
  secreto: string;
  /** Emisor esperado en el token (`iss`). Si no se pone, se acepta el que venga. */
  emisor?: string | undefined;
  /** Verifica la sesion del token (la app mira si el `jti` sigue abierto). Si devuelve `false`, no entra. */
  sesionValida?: ((claims: Record<string, unknown>) => boolean | Promise<boolean>) | undefined;
  /** Convierte los claims en la identidad del socket. Por defecto: `sub` = cedula, `rol` = claim `rol`. */
  identidad?: ((claims: Record<string, unknown>) => Identidad) | undefined;
  /** Responde a una peticion «consultar» (solo lectura). Si no se define, se rechaza. */
  consultar?: ((p: Peticion, identidad: Identidad) => Promise<Record<string, unknown>>) | undefined;
};

/** La sala: los sockets conectados, con su identidad y su filtro. */
export class SalaWebSocket {
  readonly #sockets = new Map<string, AdjuntoSocket>();
  readonly #cfg: ConfigServidor;
  #latido: ReturnType<typeof setInterval> | undefined;

  constructor(cfg: ConfigServidor) {
    this.#cfg = cfg;
    this.#latido = setInterval(() => this.#vigilar(), INTERVALO_LATIDO_MS);
  }

  /** Cierra la sala (al apagar el servidor). */
  cerrar(): void {
    if (this.#latido) clearInterval(this.#latido);
    for (const s of this.#sockets.values()) s.socket.cerrar(1001, "el servidor se apaga");
    this.#sockets.clear();
  }

  /** Cuantos sockets hay conectados. */
  get cantidad(): number {
    return this.#sockets.size;
  }

  /**
   * Entra un socket. El token se verifica **antes**: si no vale, se cierra con 4401 y no entra en la sala.
   * Devuelve el socket si entro, o `null` si se rechazo.
   */
  async entrar(socket: Socket, token: string | null): Promise<AdjuntoSocket | null> {
    if (!token) {
      socket.cerrar(4401, "falta el token");
      return null;
    }
    let claims: Record<string, unknown>;
    try {
      claims = await verifyJwtHs256(
        token,
        this.#cfg.secreto,
        this.#cfg.emisor ? { issuer: this.#cfg.emisor } : {},
      );
    } catch {
      socket.cerrar(4401, "token invalido");
      return null;
    }
    if (this.#cfg.sesionValida && !(await this.#cfg.sesionValida(claims))) {
      socket.cerrar(4403, "sesion no valida");
      return null;
    }
    const identidad = this.#cfg.identidad?.(claims) ?? {
      sub: String(claims["sub"] ?? ""),
      rol: String(claims["rol"] ?? ""),
      ref: null,
    };
    if (!identidad.sub) {
      socket.cerrar(4401, "token sin identidad");
      return null;
    }
    const adjunto: AdjuntoSocket = {
      id: crypto.randomUUID(),
      identidad,
      filtro: "todos",
      desde: new Date().toISOString(),
      ultimoLatido: Date.now(),
      ventana: Date.now(),
      cuenta: 0,
      socket,
    };
    this.#sockets.set(adjunto.id, adjunto);
    this.#enviar(adjunto, {
      tipo: "hola",
      ts: new Date().toISOString(),
      version: VERSION_PROTOCOLO,
      para: [identidad.sub],
      datos: { filtro: adjunto.filtro },
    });
    return adjunto;
  }

  /** Sale un socket. */
  salir(id: string): void {
    this.#sockets.delete(id);
  }

  /**
   * Llega un mensaje del cliente. Se valida con Zod; si no encaja, se avisa y se sigue (no se cierra el socket:
   * un mensaje raro no es un ataque, y cerrarle al usuario por un error suyo seria peor).
   */
  async mensaje(id: string, texto: string): Promise<void> {
    const adjunto = this.#sockets.get(id);
    if (!adjunto) return;
    adjunto.ultimoLatido = Date.now();
    if (texto.length > MAX_BYTES) {
      adjunto.socket.cerrar(1009, "mensaje demasiado grande");
      this.#sockets.delete(id);
      return;
    }
    if (!this.#pasaElLimite(adjunto)) {
      this.#enviar(adjunto, {
        tipo: "error",
        ts: new Date().toISOString(),
        version: VERSION_PROTOCOLO,
        para: [adjunto.identidad.sub],
        datos: { motivo: "demasiados mensajes" },
      });
      return;
    }
    let crudo: unknown;
    try {
      crudo = JSON.parse(texto);
    } catch {
      return;
    }
    const peticion = ZPeticion.safeParse(crudo);
    if (!peticion.success) {
      this.#enviar(adjunto, {
        tipo: "error",
        ts: new Date().toISOString(),
        version: VERSION_PROTOCOLO,
        para: [adjunto.identidad.sub],
        datos: { motivo: "peticion invalida" },
      });
      return;
    }
    const p = peticion.data;
    if (p.tipo === "suscribir") {
      if (p.filtro) adjunto.filtro = p.filtro;
      this.#enviar(adjunto, {
        tipo: "hola",
        ts: new Date().toISOString(),
        version: VERSION_PROTOCOLO,
        para: [adjunto.identidad.sub],
        datos: { filtro: adjunto.filtro },
      });
      return;
    }
    // «consultar»: solo lectura. Si el consumidor no la define, se rechaza (nada de improvisar).
    if (!this.#cfg.consultar) {
      this.#enviar(adjunto, {
        tipo: "error",
        ts: new Date().toISOString(),
        version: VERSION_PROTOCOLO,
        para: [adjunto.identidad.sub],
        datos: { motivo: "la consulta no esta disponible" },
      });
      return;
    }
    try {
      const datos = await this.#cfg.consultar(p, adjunto.identidad);
      this.#enviar(adjunto, {
        tipo: "consulta",
        ts: new Date().toISOString(),
        version: VERSION_PROTOCOLO,
        para: [adjunto.identidad.sub],
        datos: { id: p.id, ...datos },
      });
    } catch (e) {
      this.#enviar(adjunto, {
        tipo: "error",
        ts: new Date().toISOString(),
        version: VERSION_PROTOCOLO,
        para: [adjunto.identidad.sub],
        datos: { motivo: e instanceof Error ? e.message : "error" },
      });
    }
  }

  /**
   * Publica un aviso. `para` = lista de destinatarios (cedulas) o «todos». Cada socket recibe lo que le toca segun
   * su filtro y su identidad.
   */
  publicar(d: Difusion): void {
    const aviso = {
      tipo: d.tipo,
      ts: new Date().toISOString(),
      version: VERSION_PROTOCOLO,
      para: d.para === "todos" ? [] : (d.para ?? []),
      datos: d.datos,
    };
    if (!ZAviso.safeParse(aviso).success) return;
    for (const s of this.#sockets.values()) {
      if (d.para === "todos") {
        if (s.filtro !== "todos") continue;
        this.#enviar(s, aviso);
        continue;
      }
      const para = d.para ?? [];
      if (!para.includes(s.identidad.sub)) continue;
      this.#enviar(s, aviso);
    }
  }

  /** El latido: avisa a todos y cierra los que llevan demasiado callados. */
  #vigilar(): void {
    const ahora = Date.now();
    for (const s of [...this.#sockets.values()]) {
      if (ahora - s.ultimoLatido > TIMEOUT_SILENCIO_MS) {
        s.socket.cerrar(1001, "silencio");
        this.#sockets.delete(s.id);
        continue;
      }
      this.#enviar(s, {
        tipo: "latido",
        ts: new Date().toISOString(),
        version: VERSION_PROTOCOLO,
        para: [s.identidad.sub],
        datos: {},
      });
    }
  }

  /** Envia un aviso (si el Zod no lo acepta, no se manda: el contrato manda). */
  #enviar(s: AdjuntoSocket, aviso: Record<string, unknown>): void {
    const bien = ZAviso.safeParse(aviso);
    if (!bien.success) return;
    try {
      s.socket.enviar(JSON.stringify(bien.data));
    } catch {
      this.#sockets.delete(s.id);
    }
  }

  /** El limite anti-abuso: mensajes por minuto y por socket. */
  #pasaElLimite(s: AdjuntoSocket): boolean {
    const ahora = Date.now();
    if (ahora - s.ventana > 60_000) {
      s.ventana = ahora;
      s.cuenta = 0;
    }
    s.cuenta += 1;
    return s.cuenta <= MAX_POR_MINUTO;
  }
}

/** El tipo del filtro (lo reexporta el protocolo). */
export type { Filtro };
