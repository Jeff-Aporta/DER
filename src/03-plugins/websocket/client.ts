/**
 * client.ts — el cliente del WebSocket de DER para el navegador: conecta, reintenta y entrega los avisos.
 *
 * Valida lo que llega con el MISMO Zod del servidor, asi que si el contrato se rompe en un lado, el otro lo ve
 * al instante y no se rompe en silencio.
 *
 * ```ts
 * const ws = crearClienteWebSocket({ url: "wss://api.peon.app/api/ws", token: sesion.token });
 * ws.alRecibir("cambio", (datos) => refrescar());
 * ```
 *
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/plugins.md
 */
import { ZAviso } from "@Jeff-Aporta/DER/src/03-plugins/websocket/schemas.ts";
import { MAX_BYTES } from "@Jeff-Aporta/DER/src/03-plugins/websocket/protocolo.ts";
import type { Aviso, ClienteWebSocket, OpcionesCliente } from "@Jeff-Aporta/DER/src/03-plugins/websocket/schemas.ts";

/** Conecta (y reconecta) al socket del servidor. */
export function crearClienteWebSocket(opciones: OpcionesCliente): ClienteWebSocket {
  const oyentes = new Map<string, Set<(datos: Record<string, unknown>) => void>>();
  let socket: WebSocket | null = null;
  let cerrado = false;
  let intentos = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const avisa = (tipo: string, datos: Record<string, unknown>): void => {
    for (const fn of oyentes.get(tipo) ?? []) {
      try {
        fn(datos);
      } catch { /* un oyente que falla no tumba los demas */ }
    }
  };

  const conectar = (): void => {
    if (cerrado) return;
    const url = `${opciones.url}${opciones.url.includes("?") ? "&" : "?"}token=${
      encodeURIComponent(opciones.token)
    }`;
    try {
      socket = new WebSocket(url);
    } catch {
      reintentar();
      return;
    }
    socket.onopen = () => {
      intentos = 0;
      opciones.alAbrir?.();
    };
    socket.onmessage = (e) => {
      const texto = String(e.data ?? "");
      if (texto.length > MAX_BYTES) return;
      let crudo: unknown;
      try {
        crudo = JSON.parse(texto);
      } catch {
        return;
      }
      const aviso = ZAviso.safeParse(crudo);
      if (!aviso.success) return;
      const a = aviso.data as Aviso;
      avisa(a.tipo, a.datos);
      if (a.tipo === "hola") avisa("*", a.datos);
    };
    socket.onclose = () => {
      socket = null;
      opciones.alCerrar?.();
      reintentar();
    };
    socket.onerror = () => {
      try {
        socket?.close();
      } catch { /* ya estaba cerrado */ }
    };
  };

  const reintentar = (): void => {
    if (cerrado || timer) return;
    intentos++;
    // Espera creciente hasta 30 s: si el servidor no esta, no se le martillea.
    const espera = Math.min(30000, 500 * 2 ** Math.min(intentos, 6));
    timer = setTimeout(() => {
      timer = undefined;
      conectar();
    }, espera);
  };

  conectar();

  return {
    alRecibir(tipo, fn) {
      const set = oyentes.get(tipo) ?? new Set();
      set.add(fn);
      oyentes.set(tipo, set);
      return () => set.delete(fn);
    },
    pedir(datos) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(datos));
        } catch { /* se reconecta solo */ }
      }
    },
    cerrar() {
      cerrado = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      try {
        socket?.close();
      } catch { /* ya estaba cerrado */ }
      socket = null;
    },
    get conectado() {
      return socket?.readyState === WebSocket.OPEN;
    },
  };
}
