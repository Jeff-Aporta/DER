/**
 * Plugin de identidad: el JSON TRANSVERSAL (lo que comparten client y server). Entidades (usuario, sesión, intento, evento)
 * con su schema JSON, rutas irregulares (login/logout/sessions/password/events/jwks) y las operaciones del cliente.
 * El server lo reusa tal cual con sus particularidades inyectadas (`identity/server.ts`). Dependencias: sólo `zod`.
 *
 * ```ts
 * const auth = createClient(identity, { baseUrl: "/api" });
 * await auth.login({ usuario: "ana", password: "..." });            // guarda el token y la sesión singleton
 * const productos = new ClientController(ProductoEntity, { baseUrl: "/api", headers: auth.headers });
 * const u = auth.controllers.usuarios.pojo({ iusuario: "beto" });   // pojos siempre indirectos
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
import { ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import { type AuditEventInfo, type AuditQuery, type LoginInput, type LoginResult, type SessionInfoView, ZAuditQuery, ZLoginInput, ZPasswordChangeInput } from "@Jeff-Aporta/DER/src/03-plugins/identity/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/identity/schemas.ts";

/** Tablas: `identity_*`. La contraseña llega en `password` (virtual, nunca se guarda) y se persiste sólo su hash (`hash`, oculto en el server). */
export const identity: PluginDef = {
  name: "identity",
  entities: {
    usuarios: {
      singular: "usuario",
      plural: "usuarios",
      table: "identity_usuarios",
      schema: {
        columns: {
          iusuario: { type: "string", pk: true, length: 120 },
          nombre: { type: "string", length: 200 },
          email: { type: "string", length: 200 },
          bactivo: { type: "bool", default: true },
          jdata: { type: "json" },
          creado: { type: "datetime" },
          hash: { type: "string", length: 300 },
          password: { type: "string", virtual: true },
        },
      },
      listColumns: ["iusuario", "nombre", "email", "bactivo"],
      security: true,
      hooks: {
        prePost(u) {
          if (!u.password) return "Falta la contraseña";
          return u.password.length < 8 ? "La contraseña debe tener al menos 8 caracteres" : null;
        },
        prePut(u) {
          return u.password != null && u.password.length < 8 ? "La contraseña debe tener al menos 8 caracteres" : null;
        },
      },
    },
    sesiones: {
      singular: "sesion",
      plural: "sesiones",
      table: "identity_sesiones",
      schema: {
        columns: {
          jti: { type: "string", pk: true, length: 64 },
          iusuario: { type: "string", length: 120, nullable: false },
          emitido: { type: "datetime" },
          expira: { type: "datetime" },
          brevocado: { type: "bool", default: false },
          ip: { type: "string", length: 64 },
          user_agent: { type: "string", length: 400 },
          dispositivo: { type: "string", length: 40 },
          so: { type: "string", length: 60 },
          navegador: { type: "string", length: 60 },
          huella: { type: "string", length: 40 },
          ultimo_acceso: { type: "datetime" },
        },
      },
      security: true,
    },
    intentos: {
      singular: "intento",
      plural: "intentos",
      table: "identity_intentos",
      schema: {
        columns: {
          iintento: { type: "int", pk: true, autoincrement: true },
          iusuario: { type: "string", length: 120 },
          ip: { type: "string", length: 64 },
          user_agent: { type: "string", length: 400 },
          dispositivo: { type: "string", length: 40 },
          so: { type: "string", length: 60 },
          navegador: { type: "string", length: 60 },
          resultado: { type: "string", length: 20, nullable: false },
          motivo: { type: "string", length: 60 },
          creado: { type: "datetime" },
        },
      },
      security: true,
    },
    eventos: {
      singular: "evento",
      plural: "eventos",
      table: "identity_eventos",
      schema: {
        columns: {
          ievento: { type: "string", pk: true, length: 64 },
          iusuario: { type: "string", length: 120 },
          accion: { type: "string", length: 80, nullable: false },
          entidad: { type: "string", length: 80 },
          entidad_id: { type: "string", length: 120 },
          ip: { type: "string", length: 64 },
          user_agent: { type: "string", length: 400 },
          dispositivo: { type: "string", length: 40 },
          jdata: { type: "json" },
          creado: { type: "datetime" },
        },
      },
      security: true,
    },
  },
  routes: {
    jwks: { method: "GET", path: ".well-known/jwks.json" },
    login: { method: "POST", path: "login", zod: ZLoginInput },
    logout: { method: "DELETE", path: "logout", security: "protected", returns: "void" },
    logoutAll: { method: "DELETE", path: "logout/all", security: "protected" },
    sessions: { method: "GET", path: "sessions", security: "protected" },
    password: { method: "PUT", path: "password", security: "protected", zod: ZPasswordChangeInput },
    events: { method: "GET", path: "events", security: "protected", zod: ZAuditQuery },
  },
  ops: {
    /** `POST /login`: valida en el cliente (mismo Zod que el server), guarda el token y deja la sesión singleton. */
    async login(this: ClientPlugin, input: LoginInput): Promise<LoginResult> {
      const result = await this.call<LoginResult>("login", input);
      this.setToken(result.token);
      registry.session = { id: result.usuario.iusuario, nombre: result.usuario.nombre, expira: result.expira };
      return result;
    },
    /** `DELETE /logout`: revoca la sesión en el server y olvida el token (aunque ya estuviera vencido). */
    async logout(this: ClientPlugin): Promise<void> {
      try {
        if (this.token) await this.call("logout");
      } finally {
        this.setToken(null);
        registry.session = null;
      }
    },
    /** `DELETE /logout/all`: cierra la cuenta en todos los dispositivos y olvida el token. */
    async logoutAll(this: ClientPlugin): Promise<number> {
      try {
        const data = await this.call<{ revocadas?: number } | undefined>("logoutAll");
        return data?.revocadas ?? 0;
      } finally {
        this.setToken(null);
        registry.session = null;
      }
    },
    /** `GET /sessions`: sesiones vigentes con IP, dispositivo y último acceso (marca la actual). */
    sessions(this: ClientPlugin): Promise<SessionInfoView[]> {
      return this.call<SessionInfoView[]>("sessions");
    },
    /** `PUT /password`: cambia la contraseña (exige la actual) y cierra las demás sesiones. */
    async changePassword(this: ClientPlugin, actual: string, nueva: string): Promise<number> {
      const data = await this.call<{ revocadas?: number } | undefined>("password", { actual, nueva });
      return data?.revocadas ?? 0;
    },
    /** `GET /events`: auditoría filtrable por usuario, acción y rango de fechas. */
    events(this: ClientPlugin, query: AuditQuery = {}): Promise<AuditEventInfo[]> {
      const parsed = ZAuditQuery.safeParse(query);
      if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
      const qs = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
      return this.call<AuditEventInfo[]>("events", qs);
    },
  },
};
