/**
 * Server-Sent Events (https://developer.mozilla.org/docs/Web/API/Server-sent_events).
 * Cada `send(texto)` es un evento `message` cuyo `data` es TEXTO plano; qué representa
 * (json, xml, tokens de un LLM...) lo decide quien consume.
 * El fin del stream es el cierre de la conexión. Un error se envía como `event: error`.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/objetos.md
 */

import type { SseEvent } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";

/** Codifica un texto como evento SSE (las líneas múltiples van en varios `data:`). */
export function encodeEvent(text: string, event?: string): string {
  const head = event ? `event: ${event}\n` : "";
  return head + String(text).split(/\r\n|\r|\n/).map((l) => `data: ${l}`).join("\n") + "\n\n";
}

/** Parser incremental de un stream `text/event-stream`. */
export async function* parseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let data: string[] = [];
  let event = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buf += decoder.decode();
        break;
      }
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.search(/\r\n|\r|\n/)) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + (buf.startsWith("\r\n", idx) ? 2 : 1));
        if (line === "") {
          if (data.length) yield { event: event || "message", data: data.join("\n") };
          data = [];
          event = "";
          continue;
        }
        if (line.startsWith(":")) continue;
        const c = line.indexOf(":");
        const field = c < 0 ? line : line.slice(0, c);
        let val = c < 0 ? "" : line.slice(c + 1);
        if (val.startsWith(" ")) val = val.slice(1);
        if (field === "data") data.push(val);
        else if (field === "event") event = val;
      }
    }
    if (data.length) yield { event: event || "message", data: data.join("\n") };
  } finally {
    reader.releaseLock();
  }
}

/** Cola push → AsyncIterable, para que un handler con `send()` se consuma como iterador. */
export class TextChannel implements AsyncIterable<string> {
  #items: string[] = [];
  #waiting: ((r: IteratorResult<string>) => void) | null = null;
  #failWaiting: ((e: unknown) => void) | null = null;
  #done = false;
  #error: unknown = undefined;

  /** Emite un texto al consumidor (lo entrega si está esperando o lo encola). Sin efecto si ya se cerró. */
  push(text: string): void {
    if (this.#done) return;
    if (this.#waiting) {
      const w = this.#waiting;
      this.#waiting = this.#failWaiting = null;
      w({ value: String(text), done: false });
    } else this.#items.push(String(text));
  }

  /** Termina el stream; con `error`, el consumidor recibe el rechazo tras lo ya emitido. */
  close(error?: unknown): void {
    if (this.#done) return;
    this.#done = true;
    this.#error = error;
    if (this.#waiting) {
      const w = this.#waiting, f = this.#failWaiting;
      this.#waiting = this.#failWaiting = null;
      if (error !== undefined) f!(error);
      else w({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        if (this.#items.length) return Promise.resolve({ value: this.#items.shift()!, done: false });
        if (this.#done) {
          return this.#error !== undefined
            ? Promise.reject(this.#error)
            : Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((res, rej) => {
          this.#waiting = res;
          this.#failWaiting = rej;
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
