/**
 * Plugin de atención conversacional omnicanal: el JSON TRANSVERSAL. WhatsApp y Telegram con canales del negocio,
 * clientes finales, chats (id + código de 4 dígitos), mensajes de todos los tipos, modo auto/entrenamiento con
 * borradores y ejemplos de entrenamiento, y calificación del cliente final por mensaje. Reutilizable: aislamiento por
 * `iempresa` (cualquier inquilino); la sesión la aporta el consumidor con `services.contexto`.
 *
 *   atencion_canales          (id, iempresa, canal, icuenta, nombre, cuenta, modo, bactivo, jdata, fhcre)  ← (canal, icuenta) único: una cuenta, una empresa
 *   atencion_clientes         (id, iempresa, icanal, iexterno, nombre, username, idioma, jetiquetas, icontacto, jdata, fhprimero, fhultimo)
 *   atencion_chats            (id, iempresa, icanal, icliente, modo, codigo, estado, fhventana, fhultimo, fhcre)
 *   atencion_mensajes         (id, iempresa, ichat, direccion, origen, iusuario, tipo, texto, jcontenido, ireply, iexterno, estado, error, fhcre)
 *   atencion_borradores       (id, iempresa, ichat, tipo, texto, jcontenido, estado, iusuario, fhcre, fhresuelto)
 *   atencion_entrenamientos   (id, iempresa, ichat, iborrador, clase, propuesto, corregido, motivo, jcontexto, iusuario, fhcre)
 *   atencion_calificaciones   (id, iempresa, ichat, imensaje, valor, jmotivos, comentario, fhcre)
 *
 * Rutas `protected` (la empresa sale de `services.contexto`) y dos públicas del cliente final (`atencion/calificacion`
 * y `atencion/calificar`, protegidas por id de chat + código de 4 dígitos y por el plazo configurable).
 *
 * ```ts
 * const at = createClient(atencionPlugin, { baseUrl: "/api", headers: auth.headers });
 * const { mensajes } = await at.mensajes({ ichat });
 * await at.enviar({ ichat, texto: "Hola" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/atencion.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type Borrador, type CalificacionAtencion, type CalificarAtencionInput, CANALES_ATENCION, type ChatAtencion, type Entrenamiento, type EnviarAtencionInput, type MensajeAtencion, MODOS, type ModoInput, ORIGENES, type ResolverBorradorInput, TIPOS_MENSAJE, type VistaCalificacion, ZCalificarAtencion, ZEnviarAtencion, ZModo, ZResolverBorrador, type CAPACIDADES } from "@Jeff-Aporta/DER/src/03-plugins/atencion/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/atencion/schemas.ts";

/** Quita las claves vacías de una query. */
function limpio(q: object | undefined): Record<string, string> | undefined {
  if (!q) return undefined;
  const e = Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return e.length ? Object.fromEntries(e.map(([k, v]) => [k, String(v)])) : undefined;
}

const base = { exposed: false, administrable: false, security: true } as const;

/** JSON transversal de atención: siete entidades (no publicadas por CRUD) y sus rutas. */
export const atencionPlugin: PluginDef = {
  name: "atencion",
  entities: {
    canales: {
      ...base,
      name: "atencion.canal",
      singular: "atencion_canal",
      plural: "atencion_canales",
      table: "atencion_canales",
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          canal: { type: "string", enum: CANALES_ATENCION, nullable: false },
          icuenta: { type: "string", length: 120, nullable: false },
          nombre: { type: "string", length: 160, nullable: false },
          cuenta: { type: "string", length: 160, nullable: true },
          modo: { type: "string", enum: MODOS, default: "entrenamiento" },
          bactivo: { type: "bool", default: true },
          jdata: { type: "json", nullable: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
    },
    clientes: {
      ...base,
      name: "atencion.cliente",
      singular: "atencion_cliente",
      plural: "atencion_clientes",
      table: "atencion_clientes",
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          icanal: { type: "string", length: 40, nullable: false },
          iexterno: { type: "string", length: 120, nullable: false },
          nombre: { type: "string", length: 160, nullable: true },
          username: { type: "string", length: 120, nullable: true },
          idioma: { type: "string", length: 20, nullable: true },
          jetiquetas: { type: "json", nullable: true },
          icontacto: { type: "string", length: 40, nullable: true },
          jdata: { type: "json", nullable: true },
          fhprimero: { type: "datetime", nullable: false },
          fhultimo: { type: "datetime", nullable: false },
        },
      },
    },
    chats: {
      ...base,
      name: "atencion.chat",
      singular: "atencion_chat",
      plural: "atencion_chats",
      table: "atencion_chats",
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          icanal: { type: "string", length: 40, nullable: false },
          icliente: { type: "string", length: 40, nullable: false },
          modo: { type: "string", enum: MODOS, nullable: true },
          codigo: { type: "string", length: 4, nullable: false },
          estado: { type: "string", enum: ["abierto", "cerrado"], default: "abierto" },
          fhventana: { type: "datetime", nullable: true },
          fhultimo: { type: "datetime", nullable: false },
          fhcre: { type: "datetime", nullable: false },
        },
      },
    },
    mensajes: {
      ...base,
      name: "atencion.mensaje",
      singular: "atencion_mensaje",
      plural: "atencion_mensajes",
      table: "atencion_mensajes",
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          ichat: { type: "string", length: 40, nullable: false },
          direccion: { type: "string", enum: ["entrante", "saliente"], nullable: false },
          origen: { type: "string", enum: ORIGENES, nullable: false },
          iusuario: { type: "string", length: 120, nullable: true },
          tipo: { type: "string", enum: TIPOS_MENSAJE, default: "texto" },
          texto: { type: "text", nullable: true },
          jcontenido: { type: "json", nullable: true },
          ireply: { type: "string", length: 40, nullable: true },
          iexterno: { type: "string", length: 200, nullable: true },
          estado: { type: "string", length: 20, default: "recibido" },
          error: { type: "text", nullable: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
    },
    borradores: {
      ...base,
      name: "atencion.borrador",
      singular: "atencion_borrador",
      plural: "atencion_borradores",
      table: "atencion_borradores",
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          ichat: { type: "string", length: 40, nullable: false },
          tipo: { type: "string", enum: TIPOS_MENSAJE, default: "texto" },
          texto: { type: "text", nullable: true },
          jcontenido: { type: "json", nullable: true },
          estado: { type: "string", enum: ["pendiente", "enviado", "corregido", "reportado", "descartado"], default: "pendiente" },
          iusuario: { type: "string", length: 120, nullable: true },
          fhcre: { type: "datetime", nullable: false },
          fhresuelto: { type: "datetime", nullable: true },
        },
      },
    },
    entrenamientos: {
      ...base,
      name: "atencion.entrenamiento",
      singular: "atencion_entrenamiento",
      plural: "atencion_entrenamientos",
      table: "atencion_entrenamientos",
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          ichat: { type: "string", length: 40, nullable: false },
          iborrador: { type: "string", length: 40, nullable: false },
          clase: { type: "string", enum: ["correccion", "error_redaccion"], nullable: false },
          propuesto: { type: "text", nullable: true },
          corregido: { type: "text", nullable: true },
          motivo: { type: "text", nullable: true },
          jcontexto: { type: "json", nullable: true },
          iusuario: { type: "string", length: 120, nullable: false },
          fhcre: { type: "datetime", nullable: false },
        },
      },
    },
    calificaciones: {
      ...base,
      name: "atencion.calificacion",
      singular: "atencion_calificacion",
      plural: "atencion_calificaciones",
      table: "atencion_calificaciones",
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          ichat: { type: "string", length: 40, nullable: false },
          imensaje: { type: "string", length: 40, nullable: false },
          valor: { type: "int", nullable: false },
          jmotivos: { type: "json", nullable: true },
          comentario: { type: "text", nullable: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
    },
  },
  irregularPaths: {
    capacidades: {
      method: "GET",
      path: "atencion/capacidades",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET atencion/capacidades`: la matriz canal × tipo de mensaje que permite cada canal. */
        capacidades(this: ClientPlugin): Promise<typeof CAPACIDADES> {
          return this.call<typeof CAPACIDADES>("capacidades");
        },
      },
    },
    chats: {
      method: "GET",
      path: "atencion/chats",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET atencion/chats?limite=`: los chats de la empresa activa, el más reciente primero. */
        chats(this: ClientPlugin, query?: { limite?: number }): Promise<ChatAtencion[]> {
          return this.call<ChatAtencion[]>("chats", limpio(query));
        },
      },
    },
    mensajes: {
      method: "GET",
      path: "atencion/mensajes",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET atencion/mensajes?ichat=&limite=&antes=`: la conversación en orden cronológico. */
        mensajes(this: ClientPlugin, query: { ichat: string; limite?: number; antes?: string }): Promise<MensajeAtencion[]> {
          return this.call<MensajeAtencion[]>("mensajes", limpio(query));
        },
      },
    },
    enviar: {
      method: "POST",
      path: "atencion/enviar",
      security: "protected",
      zod: ZEnviarAtencion,
      returns: "json",
      ops: {
        /** `POST atencion/enviar`: un humano envía cualquier tipo que el canal permita (en WhatsApp, fuera de las 24 h, solo plantilla). */
        enviar(this: ClientPlugin, input: EnviarAtencionInput): Promise<MensajeAtencion> {
          return this.call<MensajeAtencion>("enviar", input);
        },
      },
    },
    borradores: {
      method: "GET",
      path: "atencion/borradores",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET atencion/borradores?ichat=`: lo que el bot propuso y espera decisión (modo entrenamiento). */
        borradores(this: ClientPlugin, query?: { ichat?: string }): Promise<Borrador[]> {
          return this.call<Borrador[]>("borradores", limpio(query));
        },
      },
    },
    resolver: {
      method: "POST",
      path: "atencion/borradores/resolver",
      security: "protected",
      zod: ZResolverBorrador,
      returns: "json",
      ops: {
        /** `POST atencion/borradores/resolver`: `enviar` tal cual, `corregir` (envía el texto corregido y guarda el ejemplo), `reportar` (error de redacción con contexto) o `descartar`. */
        resolver(this: ClientPlugin, input: ResolverBorradorInput): Promise<{ borrador: Borrador; mensaje: MensajeAtencion | null; entrenamiento: Entrenamiento | null }> {
          return this.call("resolver", input);
        },
      },
    },
    modo: {
      method: "POST",
      path: "atencion/modo",
      security: "protected",
      zod: ZModo,
      returns: "json",
      ops: {
        /** `POST atencion/modo`: `auto` o `entrenamiento` por chat o por canal (`modo: null` en un chat hereda el del canal). */
        modo(this: ClientPlugin, input: ModoInput): Promise<{ actualizados: number }> {
          return this.call<{ actualizados: number }>("modo", input);
        },
      },
    },
    entrenamientos: {
      method: "GET",
      path: "atencion/entrenamientos",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET atencion/entrenamientos?limite=`: correcciones y errores reportados (para mejorar el contrato del bot). */
        entrenamientos(this: ClientPlugin, query?: { limite?: number }): Promise<Entrenamiento[]> {
          return this.call<Entrenamiento[]>("entrenamientos", limpio(query));
        },
      },
    },
    calificacion: {
      method: "GET",
      path: "atencion/calificacion",
      security: "public",
      returns: "json",
      ops: {
        /** `GET atencion/calificacion?ichat=&codigo=`: PÚBLICA, para el cliente final: mensajes calificables y su plazo. */
        calificacion(this: ClientPlugin, query: { ichat: string; codigo: string }): Promise<VistaCalificacion> {
          return this.call<VistaCalificacion>("calificacion", limpio(query));
        },
      },
    },
    calificar: {
      method: "POST",
      path: "atencion/calificar",
      security: "public",
      zod: ZCalificarAtencion,
      returns: "json",
      ops: {
        /** `POST atencion/calificar`: PÚBLICA: califica un mensaje (1 a 5, motivos) dentro del plazo; una por mensaje (se reemplaza). */
        calificar(this: ClientPlugin, input: CalificarAtencionInput): Promise<CalificacionAtencion> {
          return this.call<CalificacionAtencion>("calificar", input);
        },
      },
    },
  },
};
