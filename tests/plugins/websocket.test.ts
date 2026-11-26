/**
 * WebSocket de DER: el token manda (sin token valido no entra), el contrato manda (Zod en los dos lados) y los
 * limites cortan el abuso. Nada que mute datos pasa por el socket.
 */
import { assert, assertEquals } from "@std/assert";
import { SalaWebSocket } from "@Jeff-Aporta/DER/src/03-plugins/websocket/server.ts";
import { MAX_BYTES, MAX_POR_MINUTO } from "@Jeff-Aporta/DER/src/03-plugins/websocket/protocolo.ts";
import { signJwtHs256 } from "@Jeff-Aporta/DER/src/03-plugins/common/jwt.ts";
import type { Socket } from "@Jeff-Aporta/DER/src/03-plugins/websocket/schemas.ts";

const SECRETO = "secreto-de-prueba-para-el-websocket-con-32-caracteres";

/** Un socket de mentira: guarda lo que se le envia. */
function socketFalso() {
  const enviados: string[] = [];
  const cierres: { codigo?: number | undefined; motivo?: string | undefined }[] = [];
  const s: Socket = {
    enviar: (t) => enviados.push(t),
    cerrar: (codigo, motivo) => cierres.push({ codigo, motivo }),
  };
  return { s, enviados, cierres };
}

const token = (claims: Record<string, unknown> = {}, secreto = SECRETO) =>
  signJwtHs256({ sub: "1094955983", rol: "ADMIN", ...claims }, secreto, { expiresIn: 3600, issuer: "peon" });

Deno.test("websocket: sin token o con token invalido, el socket se cierra y NO entra en la sala", async () => {
  const sala = new SalaWebSocket({ secreto: SECRETO, emisor: "peon" });
  try {
    const a = socketFalso();
    assertEquals(await sala.entrar(a.s, null), null, "sin token no entra");
    assertEquals(a.cierres[0]?.codigo, 4401, "se cierra con 4401");

    const b = socketFalso();
    assertEquals(await sala.entrar(b.s, "no-es-un-token"), null, "token invalido no entra");
    assertEquals(b.cierres[0]?.codigo, 4401);

    const c = socketFalso();
    assertEquals(
      await sala.entrar(c.s, await token({}, "otro-secreto-distinto-de-32-caracteres")),
      null,
      "firma ajena no entra",
    );
    assertEquals(c.cierres[0]?.codigo, 4401);

    assertEquals(sala.cantidad, 0, "no entro ninguno");
  } finally {
    sala.cerrar();
  }
});

Deno.test("websocket: con token valido entra, y recibe el aviso «hola» con su identidad", async () => {
  const sala = new SalaWebSocket({ secreto: SECRETO, emisor: "peon" });
  try {
    const a = socketFalso();
    const adjunto = await sala.entrar(a.s, await token());
    assert(adjunto, "entra con token valido");
    assertEquals(adjunto.identidad.sub, "1094955983");
    assertEquals(adjunto.identidad.rol, "ADMIN");
    assertEquals(sala.cantidad, 1);
    const hola = JSON.parse(a.enviados[0] ?? "{}");
    assertEquals(hola.tipo, "hola");
    assertEquals(hola.version, "1.0.0");
  } finally {
    sala.cerrar();
  }
});

Deno.test("websocket: la sesion revocada deja entrar al socket pero no a la sala", async () => {
  const sala = new SalaWebSocket({
    secreto: SECRETO,
    emisor: "peon",
    sesionValida: () => false,
  });
  try {
    const a = socketFalso();
    assertEquals(await sala.entrar(a.s, await token()), null, "una sesion cerrada no entra");
    assertEquals(a.cierres[0]?.codigo, 4403);
    assertEquals(sala.cantidad, 0);
  } finally {
    sala.cerrar();
  }
});

Deno.test("websocket: los avisos llegan solo a quien son (y «todos» a los que no filtran)", async () => {
  const sala = new SalaWebSocket({ secreto: SECRETO, emisor: "peon" });
  try {
    const ana = socketFalso();
    const beto = socketFalso();
    await sala.entrar(ana.s, await token({ sub: "111" }));
    await sala.entrar(beto.s, await token({ sub: "222" }));
    sala.publicar({ tipo: "cambio", para: ["111"], datos: { entidad: "persona" } });
    const deAna = ana.enviados.filter((t) => t.includes("cambio"));
    const deBeto = beto.enviados.filter((t) => t.includes("cambio"));
    assertEquals(deAna.length, 1, "ana recibe su aviso");
    assertEquals(deBeto.length, 0, "beto no recibe lo de ana");
  } finally {
    sala.cerrar();
  }
});

Deno.test("websocket: una peticion que no encaja en el contrato se rechaza sin tumbar el socket", async () => {
  const sala = new SalaWebSocket({ secreto: SECRETO, emisor: "peon" });
  try {
    const a = socketFalso();
    const adjunto = await sala.entrar(a.s, await token());
    assert(adjunto);
    await sala.mensaje(adjunto.id, JSON.stringify({ tipo: "borrar_todo", id: "1", ts: "2026-01-01" }));
    const errores = a.enviados.filter((t) => t.includes("peticion invalida"));
    assertEquals(errores.length, 1, "avisa del error");
    assertEquals(a.cierres.length, 0, "no cierra el socket por un mensaje raro");
    assertEquals(sala.cantidad, 1, "sigue en la sala");
  } finally {
    sala.cerrar();
  }
});

Deno.test("websocket: un mensaje enorme cierra el socket (no se traga la memoria)", async () => {
  const sala = new SalaWebSocket({ secreto: SECRETO, emisor: "peon" });
  try {
    const a = socketFalso();
    const adjunto = await sala.entrar(a.s, await token());
    assert(adjunto);
    await sala.mensaje(adjunto.id, "x".repeat(MAX_BYTES + 1));
    assertEquals(a.cierres[0]?.codigo, 1009);
    assertEquals(sala.cantidad, 0);
  } finally {
    sala.cerrar();
  }
});

Deno.test("websocket: el limite de mensajes por minuto corta el abuso", async () => {
  const sala = new SalaWebSocket({ secreto: SECRETO, emisor: "peon" });
  try {
    const a = socketFalso();
    const adjunto = await sala.entrar(a.s, await token());
    assert(adjunto);
    const peticion = JSON.stringify({ tipo: "suscribir", id: "1", ts: "2026-01-01" });
    for (let i = 0; i < MAX_POR_MINUTO + 5; i++) await sala.mensaje(adjunto.id, peticion);
    const errores = a.enviados.filter((t) => t.includes("demasiados mensajes"));
    assert(errores.length >= 1, "avisa del limite");
  } finally {
    sala.cerrar();
  }
});

Deno.test("websocket: «consultar» responde por el socket y solo de lectura", async () => {
  const sala = new SalaWebSocket({
    secreto: SECRETO,
    emisor: "peon",
    consultar: (p) => Promise.resolve({ ref: p.ref ?? null, ok: true }),
  });
  try {
    const a = socketFalso();
    const adjunto = await sala.entrar(a.s, await token());
    assert(adjunto);
    await sala.mensaje(
      adjunto.id,
      JSON.stringify({ tipo: "consultar", id: "q1", ts: "2026-01-01", ref: "nix123" }),
    );
    const respuesta = a.enviados.filter((t) => t.includes("consulta")).map((t) => JSON.parse(t));
    const ultima = respuesta[respuesta.length - 1];
    assertEquals(ultima.datos.ref, "nix123");
    assertEquals(ultima.datos.ok, true);
  } finally {
    sala.cerrar();
  }
});
