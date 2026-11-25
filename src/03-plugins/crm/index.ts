/**
 * Plugin CRM: el JSON TRANSVERSAL. Empresas (inquilinos), usuarios↔empresas N:M con rol por empresa, contactos por
 * empresa y el chat (conversaciones, participantes, mensajes, adjuntos), todo filtrado por la EMPRESA ACTIVA.
 *
 *   crm_empresas        (iempresa, codigo, nombre, nit, bactivo, jdata, fhcre)
 *   crm_miembros        (iempresa, iusuario, rol, bactivo, fhcre)                      ← usuarios↔empresas N:M, rol por empresa
 *   crm_contactos       (id, iempresa, nombre, email, telefono, cargo, notas, jetiquetas, iresponsable, bactivo, fhcre, fhmod)
 *   crm_conversaciones  (id, iempresa, clave, titulo, tipo, icontacto, creador, ultimo, qmensajes, bactivo, fhcre, factualizado)
 *   crm_participantes   (iconversacion, iparticipante, tipo, iempresa, fhlectura, fhcre)
 *   crm_mensajes        (id, iempresa, iconversacion, autor, iautor, texto, jwidget, jcontexto, bactivo, fhcre)
 *   crm_adjuntos        (id, iempresa, imensaje, nombre, tipo, tamano, clave, fhcre)   ← los bytes los mueve el almacén del consumidor
 *
 * Ninguna tabla se publica por CRUD (un CRUD cruzaría empresas): todo va por rutas irregulares `protected` que resuelven
 * la empresa activa (cabecera `X-Empresa`; con una sola empresa se deduce) y exigen un rol mínimo en ella. Login:
 * `POST crm/login` con `{ empresa, usuario, password }` (la contraseña la verifica el plugin `identity`).
 *
 * ```ts
 * const crm = createClient(crmPlugin, { baseUrl: "/api", headers: () => ({ [CABECERA_EMPRESA]: empresaActiva }) });
 * const { token, empresa, empresas } = await crm.login({ empresa: "acme", usuario: "ana", password: "…" });
 * await crm.enviarChat({ hilo: "general", texto: "Hola" });
 * const { lineas } = await crm.chat({ hilo: "general" });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/crm.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type ChatConsulta, type ChatEnviado, type ChatPagina, type Contacto, type ContactoInput, type Conversacion, type Empresa, type EmpresaInput, type EmpresaResumen, type EnviarChatInput, type HiloChat, type LineaChat, type LoginCrmInput, type LoginCrmResult, type Miembro, type MiembroInput, type Participante, type ParticipanteInput, type PerfilCrm, type RespuestaBotInput, ROLES_CRM, TIPOS_CONVERSACION, TIPOS_PARTICIPANTE, ZContacto, ZContactoCambio, ZConversacion, ZEmpresa, ZEnviarChat, ZLeerChat, ZLoginCrm, ZMiembro, ZParticipante, ZRespuestaBot } from "@Jeff-Aporta/DER/src/03-plugins/crm/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/crm/schemas.ts";

/** Quita las claves vacías (una query `?x=undefined` rompería el filtro) y vuelve texto el resto. */
function limpio(q: object | undefined): Record<string, string> | undefined {
  if (!q) return undefined;
  const e = Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return e.length ? Object.fromEntries(e.map(([k, v]) => [k, String(v)])) : undefined;
}

/** JSON transversal del CRM: las siete entidades (no publicadas por CRUD) y sus rutas irregulares. */
export const crmPlugin: PluginDef = {
  name: "crm",
  entities: {
    empresas: {
      name: "crm.empresa",
      singular: "crm_empresa",
      plural: "crm_empresas",
      table: "crm_empresas",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          iempresa: { type: "string", pk: true, length: 40 },
          codigo: { type: "string", length: 40, nullable: false, unique: true },
          nombre: { type: "string", length: 160, nullable: false },
          nit: { type: "string", length: 40, nullable: true },
          bactivo: { type: "bool", default: true },
          jdata: { type: "json", nullable: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["iempresa", "codigo", "nombre", "bactivo"],
    },
    miembros: {
      name: "crm.miembro",
      singular: "crm_miembro",
      plural: "crm_miembros",
      table: "crm_miembros",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          iempresa: { type: "string", pk: true, length: 40 },
          iusuario: { type: "string", pk: true, length: 120 },
          rol: { type: "string", enum: ROLES_CRM, default: "agente" },
          bactivo: { type: "bool", default: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["iempresa", "iusuario", "rol", "bactivo"],
    },
    contactos: {
      name: "crm.contacto",
      singular: "crm_contacto",
      plural: "crm_contactos",
      table: "crm_contactos",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          nombre: { type: "string", length: 160, nullable: false },
          email: { type: "string", length: 200, nullable: true },
          telefono: { type: "string", length: 60, nullable: true },
          cargo: { type: "string", length: 120, nullable: true },
          notas: { type: "text", nullable: true },
          jetiquetas: { type: "json", nullable: true },
          iresponsable: { type: "string", length: 120, nullable: true },
          bactivo: { type: "bool", default: true },
          fhcre: { type: "datetime", nullable: false },
          fhmod: { type: "datetime", nullable: true },
        },
      },
      listColumns: ["id", "iempresa", "nombre", "email", "telefono", "bactivo"],
    },
    conversaciones: {
      name: "crm.conversacion",
      singular: "crm_conversacion",
      plural: "crm_conversaciones",
      table: "crm_conversaciones",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          clave: { type: "string", length: 80, nullable: false },
          titulo: { type: "string", length: 160, nullable: false },
          tipo: { type: "string", enum: TIPOS_CONVERSACION, default: "bot" },
          icontacto: { type: "string", length: 40, nullable: true },
          creador: { type: "string", length: 120, nullable: false },
          ultimo: { type: "string", length: 200, nullable: true },
          qmensajes: { type: "int", default: 0 },
          bactivo: { type: "bool", default: true },
          fhcre: { type: "datetime", nullable: false },
          factualizado: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["id", "iempresa", "clave", "titulo", "tipo", "factualizado"],
    },
    participantes: {
      name: "crm.participante",
      singular: "crm_participante",
      plural: "crm_participantes",
      table: "crm_participantes",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          iconversacion: { type: "string", pk: true, length: 40 },
          iparticipante: { type: "string", pk: true, length: 120 },
          tipo: { type: "string", enum: TIPOS_PARTICIPANTE, default: "usuario" },
          iempresa: { type: "string", length: 40, nullable: false },
          fhlectura: { type: "datetime", nullable: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
    },
    mensajes: {
      name: "crm.mensaje",
      singular: "crm_mensaje",
      plural: "crm_mensajes",
      table: "crm_mensajes",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          iconversacion: { type: "string", length: 40, nullable: false },
          autor: { type: "string", enum: TIPOS_PARTICIPANTE, default: "usuario" },
          iautor: { type: "string", length: 120, nullable: false },
          texto: { type: "text", nullable: false },
          jwidget: { type: "json", nullable: true },
          jcontexto: { type: "json", nullable: true },
          bactivo: { type: "bool", default: true },
          fhcre: { type: "datetime", nullable: false },
        },
      },
      listColumns: ["id", "iempresa", "iconversacion", "autor", "fhcre"],
    },
    adjuntos: {
      name: "crm.adjunto",
      singular: "crm_adjunto",
      plural: "crm_adjuntos",
      table: "crm_adjuntos",
      exposed: false,
      administrable: false,
      security: true,
      schema: {
        columns: {
          id: { type: "string", pk: true, length: 40 },
          iempresa: { type: "string", length: 40, nullable: false },
          imensaje: { type: "string", length: 40, nullable: false },
          nombre: { type: "string", length: 200, nullable: false },
          tipo: { type: "string", length: 120, nullable: false },
          tamano: { type: "int", nullable: false },
          clave: { type: "string", length: 200, nullable: false },
          fhcre: { type: "datetime", nullable: false },
        },
      },
    },
  },
  irregularPaths: {
    login: {
      method: "POST",
      path: "crm/login",
      security: "public",
      zod: ZLoginCrm,
      returns: "json",
      ops: {
        /** `POST crm/login`: empresa (código o id) + usuario + contraseña. Guarda el token y devuelve la empresa activa y las demás. */
        async login(this: ClientPlugin, input: LoginCrmInput): Promise<LoginCrmResult> {
          const r = await this.call<LoginCrmResult>("login", input);
          this.setToken(r.token);
          return r;
        },
      },
    },
    yo: {
      method: "GET",
      path: "crm/yo",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET crm/yo`: el usuario de la sesión, su empresa activa (si se deduce) y todas sus empresas. */
        yo(this: ClientPlugin): Promise<PerfilCrm> {
          return this.call<PerfilCrm>("yo");
        },
      },
    },
    empresas: {
      method: "GET",
      path: "crm/empresas",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET crm/empresas`: las empresas a las que entra el usuario (para el selector). */
        empresas(this: ClientPlugin): Promise<EmpresaResumen[]> {
          return this.call<EmpresaResumen[]>("empresas");
        },
      },
    },
    crearEmpresa: {
      method: "POST",
      path: "crm/empresas",
      security: "protected",
      zod: ZEmpresa,
      returns: "json",
      ops: {
        /** `POST crm/empresas`: crea una empresa (solo `cfg.superadmins`); `propietario` queda con rol `propietario`. */
        crearEmpresa(this: ClientPlugin, input: EmpresaInput): Promise<Empresa> {
          return this.call<Empresa>("crearEmpresa", input);
        },
      },
    },
    miembros: {
      method: "GET",
      path: "crm/miembros",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET crm/miembros`: los usuarios de la empresa activa con su rol. */
        miembros(this: ClientPlugin): Promise<Miembro[]> {
          return this.call<Miembro[]>("miembros");
        },
      },
    },
    vincularMiembro: {
      method: "POST",
      path: "crm/miembros",
      security: "protected",
      zod: ZMiembro,
      returns: "json",
      ops: {
        /** `POST crm/miembros`: agrega o cambia (rol, baja) a un usuario en la empresa activa; exige `admin`. */
        vincularMiembro(this: ClientPlugin, input: MiembroInput): Promise<Miembro> {
          return this.call<Miembro>("vincularMiembro", input);
        },
      },
    },
    contactos: {
      method: "GET",
      path: "crm/contactos",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET crm/contactos?q=&limite=`: contactos de la empresa activa (búsqueda por nombre, email o teléfono). */
        contactos(this: ClientPlugin, query?: { q?: string; limite?: number }): Promise<Contacto[]> {
          return this.call<Contacto[]>("contactos", limpio(query));
        },
      },
    },
    crearContacto: {
      method: "POST",
      path: "crm/contactos",
      security: "protected",
      zod: ZContacto,
      returns: "json",
      ops: {
        /** `POST crm/contactos`: crea un contacto en la empresa activa (rol `agente` o más). */
        crearContacto(this: ClientPlugin, input: ContactoInput): Promise<Contacto> {
          return this.call<Contacto>("crearContacto", input);
        },
      },
    },
    editarContacto: {
      method: "PUT",
      path: "crm/contactos/{id}",
      security: "protected",
      zod: ZContactoCambio,
      returns: "json",
      ops: {
        /** `PUT crm/contactos/{id}`: cambia un contacto de la empresa activa (`bactivo: false` lo da de baja). */
        editarContacto(this: ClientPlugin, id: string, input: Partial<ContactoInput>): Promise<Contacto> {
          return this.call<Contacto>("editarContacto", input, { id });
        },
      },
    },
    chat: {
      method: "GET",
      path: "crm/chat",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET crm/chat?iconversacion=|hilo=&limite=&antes=&q=`: historial paginado (la página más reciente, en orden cronológico). */
        chat(this: ClientPlugin, consulta: ChatConsulta): Promise<ChatPagina> {
          return this.call<ChatPagina>("chat", limpio(consulta));
        },
      },
    },
    enviarChat: {
      method: "POST",
      path: "crm/chat",
      security: "protected",
      zod: ZEnviarChat,
      returns: "json",
      ops: {
        /** `POST crm/chat`: escribe en una conversación o hilo (lo crea si no existe) y avisa al canal del bot. */
        enviarChat(this: ClientPlugin, input: EnviarChatInput): Promise<ChatEnviado> {
          return this.call<ChatEnviado>("enviarChat", input);
        },
      },
    },
    hilos: {
      method: "GET",
      path: "crm/chat/hilos",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET crm/chat/hilos?q=`: las conversaciones del usuario en la empresa activa, con no leídas. */
        hilos(this: ClientPlugin, query?: { q?: string }): Promise<HiloChat[]> {
          return this.call<HiloChat[]>("hilos", limpio(query));
        },
      },
    },
    leerChat: {
      method: "POST",
      path: "crm/chat/leer",
      security: "protected",
      zod: ZLeerChat,
      returns: "json",
      ops: {
        /** `POST crm/chat/leer`: marca la conversación como leída hasta ahora. */
        leerChat(this: ClientPlugin, iconversacion: string): Promise<{ leidas: number }> {
          return this.call<{ leidas: number }>("leerChat", { iconversacion });
        },
      },
    },
    adjunto: {
      method: "GET",
      path: "crm/chat/adjuntos/{id}",
      security: "protected",
      returns: "json",
    },
    conversacion: {
      method: "POST",
      path: "crm/conversaciones",
      security: "protected",
      zod: ZConversacion,
      returns: "json",
      ops: {
        /** `POST crm/conversaciones`: abre (o reusa) una conversación `directa`, de `grupo` o `bot` sin escribir aún. */
        abrirConversacion(this: ClientPlugin, input: { hilo?: string; hiloTitulo?: string; tipo?: string; participantes?: string[]; icontacto?: string }): Promise<Conversacion> {
          return this.call<Conversacion>("conversacion", input);
        },
      },
    },
    participantes: {
      method: "GET",
      path: "crm/conversaciones/participantes",
      security: "protected",
      returns: "json",
      ops: {
        /** `GET crm/conversaciones/participantes?iconversacion=`: quiénes están en la conversación. */
        participantes(this: ClientPlugin, iconversacion: string): Promise<Participante[]> {
          return this.call<Participante[]>("participantes", { iconversacion });
        },
      },
    },
    agregarParticipante: {
      method: "POST",
      path: "crm/conversaciones/participantes",
      security: "protected",
      zod: ZParticipante,
      returns: "json",
      ops: {
        /** `POST crm/conversaciones/participantes`: agrega un usuario de la empresa, un bot o un contacto (grupos; quien la creó o `admin`). */
        agregarParticipante(this: ClientPlugin, input: ParticipanteInput): Promise<Participante> {
          return this.call<Participante>("agregarParticipante", input);
        },
      },
    },
    quitarParticipante: {
      method: "POST",
      path: "crm/conversaciones/participantes/quitar",
      security: "protected",
      zod: ZParticipante,
      returns: "json",
      ops: {
        /** `POST crm/conversaciones/participantes/quitar`: saca a un participante (uno puede salir solo). */
        quitarParticipante(this: ClientPlugin, input: ParticipanteInput): Promise<{ quitados: number }> {
          return this.call<{ quitados: number }>("quitarParticipante", input);
        },
      },
    },
    respuestaBot: {
      method: "POST",
      path: "crm/chat/respuesta",
      security: "public",
      zod: ZRespuestaBot,
      returns: "json",
      ops: {
        /** `POST crm/chat/respuesta`: la que usa el CANAL del bot (token `cfg.canalToken` en `Authorization`), no la app. */
        respuestaBot(this: ClientPlugin, input: RespuestaBotInput): Promise<LineaChat> {
          return this.call<LineaChat>("respuestaBot", input);
        },
      },
    },
  },
};
