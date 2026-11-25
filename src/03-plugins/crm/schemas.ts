/**
 * Tipos y Zod del plugin CRM: empresas (inquilinos), usuarios↔empresas N:M con rol por empresa, contactos por empresa
 * y el chat (conversaciones, participantes, mensajes y adjuntos), todo filtrado por la empresa activa.
 * La identidad (usuario, contraseña, sesión) la pone el plugin `identity`; aquí solo se decide A QUÉ EMPRESAS entra
 * cada usuario y con qué rol. El chat replica el del front de peon: hilos por clave, historial paginado con `antes`,
 * búsqueda, adjuntos (máx. 4 × 8 MB), cita de contexto, widget del bot y respuesta del bot por canal.
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/crm.md
 */
import { z } from "zod";
import type { AlmacenArchivos } from "@Jeff-Aporta/DER/src/03-plugins/archivos/schemas.ts";

/** Roles de un usuario DENTRO de una empresa, de menor a mayor poder. */
export const ROLES_CRM = ["lector", "auditor", "agente", "admin", "propietario"] as const;

/** Tipos de conversación: `bot` (usuario ↔ asistente, como el chat de peon), `directa` (dos usuarios) y `grupo`. */
export const TIPOS_CONVERSACION = ["bot", "directa", "grupo"] as const;

/** Quién puede ser participante o autor: un usuario de la empresa, un bot o un contacto externo. */
export const TIPOS_PARTICIPANTE = ["usuario", "bot", "contacto"] as const;

/** Identificador del bot por defecto (el «VPS» del chat de peon). */
export const BOT_POR_DEFECTO = "vps";

/** Adjuntos por mensaje y bytes por adjunto (los de peon). */
export const MAX_ADJUNTOS = 4;

/** Máximo de bytes por adjunto (8 MB). */
export const MAX_BYTES_ADJUNTO = 8 * 1024 * 1024;

/** Cabecera con la empresa activa de cada petición. */
export const CABECERA_EMPRESA = "x-empresa";

/** Rol de un miembro. */
export type RolCrm = (typeof ROLES_CRM)[number];

/** Tipo de conversación. */
export type TipoConversacion = (typeof TIPOS_CONVERSACION)[number];

/** Tipo de participante o de autor. */
export type TipoParticipante = (typeof TIPOS_PARTICIPANTE)[number];

/** Empresa (inquilino). `codigo` es lo que escribe la persona al entrar (único, en minúsculas). */
export type Empresa = { iempresa: string; codigo: string; nombre: string; nit: string | null; bactivo: boolean; jdata: unknown; fhcre: string };

/** Pertenencia de un usuario a una empresa con su rol (N:M). */
export type Miembro = { iempresa: string; iusuario: string; rol: RolCrm; bactivo: boolean; fhcre: string };

/** Contacto (cliente, proveedor, lead) de una empresa. */
export type Contacto = { id: string; iempresa: string; nombre: string; email: string | null; telefono: string | null; cargo: string | null; notas: string | null; jetiquetas: string[] | null; iresponsable: string | null; bactivo: boolean; fhcre: string; fhmod: string | null };

/** Conversación de una empresa. `clave` es la del hilo (`general`, `contacto:12`…); `ultimo` y `qmensajes` se mantienen al escribir. */
export type Conversacion = { id: string; iempresa: string; clave: string; titulo: string; tipo: TipoConversacion; icontacto: string | null; creador: string; ultimo: string | null; qmensajes: number; bactivo: boolean; fhcre: string; factualizado: string };

/** Participante de una conversación; `fhlectura` = hasta cuándo leyó (de ahí salen las no leídas). */
export type Participante = { iconversacion: string; iparticipante: string; tipo: TipoParticipante; iempresa: string; fhlectura: string | null; fhcre: string };

/** Mensaje de una conversación. `jwidget` = widget del bot (JSON), `jcontexto` = lo citado al escribir. */
export type MensajeCrm = { id: string; iempresa: string; iconversacion: string; autor: TipoParticipante; iautor: string; texto: string; jwidget: unknown; jcontexto: unknown; bactivo: boolean; fhcre: string };

/** Ficha de un adjunto; los bytes están en el almacén del consumidor bajo `clave`. */
export type AdjuntoCrm = { id: string; iempresa: string; imensaje: string; nombre: string; tipo: string; tamano: number; clave: string; fhcre: string };

/** Alta de una empresa (con su propietario inicial opcional). */
export type EmpresaInput = { iempresa?: string | undefined; codigo?: string | undefined; nombre: string; nit?: string | null | undefined; propietario?: string | undefined };

/** Alta o cambio de un miembro de la empresa. */
export type MiembroInput = { iusuario: string; rol?: RolCrm | undefined; bactivo?: boolean | undefined };

/** Alta o cambio de un contacto. */
export type ContactoInput = { nombre: string; email?: string | null | undefined; telefono?: string | null | undefined; cargo?: string | null | undefined; notas?: string | null | undefined; jetiquetas?: string[] | null | undefined; iresponsable?: string | null | undefined; bactivo?: boolean | undefined };

/** Login por empresa: código (o id) de la empresa + usuario + contraseña. */
export type LoginCrmInput = { empresa: string; usuario: string; password: string };

/** Resumen de una empresa para el selector. */
export type EmpresaResumen = { iempresa: string; codigo: string; nombre: string; rol: RolCrm };

/** Resultado del login: lo de identidad más la empresa activa, el rol y las demás empresas del usuario. */
export type LoginCrmResult = { token: string; tipo: "Bearer"; expira: string; usuario: { iusuario: string; nombre: string | null }; empresa: EmpresaResumen; empresas: EmpresaResumen[] };

/** Quién es el usuario de la sesión y en qué empresa actúa (lo que resuelven todas las puertas). */
export type ContextoCrm = { iusuario: string; iempresa: string; rol: RolCrm; empresa: Empresa };

/** Perfil de la sesión: usuario, empresa activa y todas sus empresas. */
export type PerfilCrm = { iusuario: string; activa: EmpresaResumen | null; empresas: EmpresaResumen[] };

/** Adjunto que llega al enviar: `datos` en base64/base64url (con o sin prefijo `data:`). */
export type AdjuntoEntrada = { nombre: string; tipo?: string | undefined; datos: string };

/** Contexto citado al abrir el chat desde otra pantalla (todo acotado). */
export type ContextoChat = { tipo: string; id?: string | null | undefined; titulo?: string | null | undefined; fragmento?: string | null | undefined; pantalla?: string | null | undefined; visibles?: { pagina?: string | undefined; indice?: string | undefined; texto?: string | undefined }[] | undefined };

/** Envío de un mensaje: a una conversación (`iconversacion`) o a un hilo por clave (se crea si no existe). */
export type EnviarChatInput = { iconversacion?: string | undefined; hilo?: string | undefined; hiloTitulo?: string | null | undefined; tipo?: TipoConversacion | undefined; participantes?: string[] | undefined; icontacto?: string | null | undefined; texto?: string | undefined; transcripcion?: string | null | undefined; contexto?: ContextoChat | null | undefined; adjuntos?: AdjuntoEntrada[] | undefined };

/** Línea de chat como la pinta el front (igual que la de peon: `creado`, `widget`, `adjuntos`). */
export type LineaChat = { id: string; autor: TipoParticipante; iautor: string; texto: string; hilo: string; iconversacion: string; widget: unknown; contexto: unknown; creado: string; adjuntos: { id: string; nombre: string; tipo: string; tamano: number }[] };

/** Página del historial: la más reciente primero (en orden cronológico), `hayMas` si hay anteriores. */
export type ChatPagina = { iconversacion: string; hilo: string; hayMas: boolean; maxAdjuntos: number; maxBytes: number; lineas: LineaChat[] };

/** Consulta del historial: `antes` = id del más viejo ya cargado; `q` busca en el texto. */
export type ChatConsulta = { iconversacion?: string | undefined; hilo?: string | undefined; limite?: number | undefined; antes?: string | undefined; q?: string | undefined };

/** Un chat de la lista del usuario, con las no leídas. */
export type HiloChat = { id: string; clave: string; titulo: string; tipo: TipoConversacion; ultimo: string | null; mensajes: number; actualizado: string; noLeidas: number };

/** Respuesta de enviar: `enviado` = el canal del bot lo aceptó (o no hacía falta). */
export type ChatEnviado = { enviado: boolean; iconversacion: string; lineas: LineaChat[] };

/** Respuesta del bot (la entrega el canal con el token de `cfg.canalToken`): a quién y en qué hilo. */
export type RespuestaBotInput = { empresa: string; para: string; hilo?: string | undefined; texto: string; widget?: unknown; bot?: string | undefined };

/** Participante a agregar o quitar. */
export type ParticipanteInput = { iconversacion: string; iparticipante: string; tipo?: TipoParticipante | undefined };

/** Lo que se manda al canal del bot (el servicio `canal` del consumidor lo entrega donde sea). */
export type PaqueteCanal = { empresa: Empresa; usuario: { iusuario: string; rol: RolCrm }; conversacion: Conversacion; mensaje: LineaChat; texto: string; transcripcion: string | null; contexto: ContextoChat | null };

/** Servicios que vincula el consumidor (todos opcionales). */
export type CrmServicios = { login?: ((input: { usuario: string; password: string }, req?: Request) => Promise<{ token: string; tipo: "Bearer"; expira: string; usuario: { iusuario: string; nombre: string | null } }>) | undefined; almacen?: AlmacenArchivos | undefined; canal?: ((paquete: PaqueteCanal) => Promise<boolean> | boolean) | undefined; alMensaje?: ((linea: LineaChat, destinatarios: string[]) => Promise<void> | void) | undefined; notificar?: ((destinatarios: string[], titulo: string, texto: string, enlace: string) => Promise<void> | void) | undefined };

/** Contacto sembrado por la configuración. */
export type SemillaContacto = ContactoInput & { id?: string | undefined };

/** Empresa sembrada por la configuración: miembros y contactos incluidos. */
export type SemillaEmpresa = { iempresa: string; codigo?: string | undefined; nombre: string; nit?: string | null | undefined; miembros?: MiembroInput[] | undefined; contactos?: SemillaContacto[] | undefined };

/** Configuración: `canalToken` autentica al bot en `crm/chat/respuesta`; `superadmins` pueden crear empresas por HTTP; `empresas` las deja el seed. */
export type CrmConfig = { canalToken?: string | undefined; superadmins?: string[] | undefined; bot?: string | undefined; empresas?: SemillaEmpresa[] | undefined };

/** Verbos de servidor del plugin armado (sin HTTP): las mismas funciones que usan los handlers. */
export type VerbosCrm = { crearEmpresa(input: EmpresaInput): Promise<Empresa>; empresa(iempresa: string): Promise<Empresa | null>; empresasDe(iusuario: string): Promise<EmpresaResumen[]>; vincularMiembro(iempresa: string, input: MiembroInput): Promise<Miembro>; miembros(iempresa: string): Promise<Miembro[]>; contexto(iusuario: string, iempresa?: string | null): Promise<ContextoCrm>; login(input: LoginCrmInput, req?: Request): Promise<LoginCrmResult>; crearContacto(iempresa: string, input: ContactoInput): Promise<Contacto>; contactos(iempresa: string, q?: string, limite?: number): Promise<Contacto[]>; editarContacto(iempresa: string, id: string, input: Partial<ContactoInput>): Promise<Contacto>; abrirConversacion(ctx: ContextoCrm, input: EnviarChatInput): Promise<Conversacion>; enviarChat(ctx: ContextoCrm, input: EnviarChatInput): Promise<ChatEnviado>; responderBot(input: RespuestaBotInput): Promise<LineaChat>; historial(ctx: ContextoCrm, consulta: ChatConsulta): Promise<ChatPagina>; hilos(ctx: ContextoCrm, q?: string): Promise<HiloChat[]>; leerChat(ctx: ContextoCrm, iconversacion: string): Promise<{ leidas: number }>; agregarParticipante(ctx: ContextoCrm, input: ParticipanteInput): Promise<Participante>; quitarParticipante(ctx: ContextoCrm, input: ParticipanteInput): Promise<{ quitados: number }>; participantes(ctx: ContextoCrm, iconversacion: string): Promise<Participante[]>; adjunto(ctx: ContextoCrm, id: string): Promise<Response>; };

const texto = (max: number) => z.string().trim().min(1).max(max);

/** Zod del login por empresa. */
export const ZLoginCrm = z.strictObject({ empresa: texto(80), usuario: texto(120), password: z.string().min(1).max(500) });

/** Zod del alta de una empresa. */
export const ZEmpresa = z.strictObject({ iempresa: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/).optional(), codigo: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/).optional(), nombre: texto(160), nit: z.string().max(40).nullish(), propietario: texto(120).optional() });

/** Zod del alta o cambio de un miembro. */
export const ZMiembro = z.strictObject({ iusuario: texto(120), rol: z.enum(ROLES_CRM).optional(), bactivo: z.boolean().optional() });

/** Zod del alta de un contacto. */
export const ZContacto = z.strictObject({ nombre: texto(160), email: z.string().max(200).nullish(), telefono: z.string().max(60).nullish(), cargo: z.string().max(120).nullish(), notas: z.string().max(4000).nullish(), jetiquetas: z.array(z.string().max(40)).max(30).nullish(), iresponsable: z.string().max(120).nullish(), bactivo: z.boolean().optional() });

/** Zod del cambio de un contacto (todo opcional; el id va en la query). */
export const ZContactoCambio = ZContacto.partial();

/** Zod del contexto citado en el chat. */
export const ZContextoChat = z.object({ tipo: texto(30), id: z.string().max(40).nullish(), titulo: z.string().max(160).nullish(), fragmento: z.string().max(2000).nullish(), pantalla: z.string().max(60).nullish(), visibles: z.array(z.object({ pagina: z.string().max(80).optional(), indice: z.string().max(40).optional(), texto: z.string().max(600).optional() })).max(60).optional() });

/** Zod del envío de un mensaje. */
export const ZEnviarChat = z.strictObject({ iconversacion: z.string().max(40).optional(), hilo: z.string().max(80).optional(), hiloTitulo: z.string().max(160).nullish(), tipo: z.enum(TIPOS_CONVERSACION).optional(), participantes: z.array(texto(120)).max(100).optional(), icontacto: z.string().max(40).nullish(), texto: z.string().max(4000).optional(), transcripcion: z.string().max(4000).nullish(), contexto: ZContextoChat.nullish(), adjuntos: z.array(z.strictObject({ nombre: texto(200), tipo: z.string().max(120).optional(), datos: z.string().min(1) })).max(MAX_ADJUNTOS).optional() });

/** Zod de la respuesta del bot. */
export const ZRespuestaBot = z.strictObject({ empresa: texto(80), para: texto(120), hilo: z.string().max(80).optional(), texto: z.string().max(8000), widget: z.unknown().optional(), bot: z.string().max(60).optional() });

/** Zod de leer una conversación. */
export const ZLeerChat = z.strictObject({ iconversacion: texto(40) });

/** Zod de agregar o quitar un participante. */
export const ZParticipante = z.strictObject({ iconversacion: texto(40), iparticipante: texto(120), tipo: z.enum(TIPOS_PARTICIPANTE).optional() });

/** Zod de crear una conversación (directa o de grupo) sin mensaje. */
export const ZConversacion = z.strictObject({ hilo: z.string().max(80).optional(), hiloTitulo: z.string().max(160).nullish(), tipo: z.enum(TIPOS_CONVERSACION).optional(), participantes: z.array(texto(120)).max(100).optional(), icontacto: z.string().max(40).nullish() });

/** Zod de la configuración del plugin. */
export const ZCrmConfig = z.strictObject({
  canalToken: z.string().min(16).optional(),
  superadmins: z.array(texto(120)).optional(),
  bot: z.string().max(60).optional(),
  empresas: z.array(z.strictObject({ iempresa: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/), codigo: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/).optional(), nombre: texto(160), nit: z.string().max(40).nullish(), miembros: z.array(ZMiembro).optional(), contactos: z.array(ZContacto.extend({ id: z.string().max(40).optional() })).optional() })).optional(),
});
