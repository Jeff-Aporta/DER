/**
 * Plugin de identidad: el JSON TRANSVERSAL (lo que comparten client y server). Entidades (usuario, sesión, intento, evento)
 * con su schema JSON, `exposed`/`administrable` explícitos y, en `usuarios`, los `paths` de las acciones de sesión
 * (login, logout, sessions, password, events) con sus `ops` de cliente. El único path sin entidad es el JWKS.
 * El server lo reusa tal cual con sus particularidades inyectadas (`identity/server.ts`). Dependencias: sólo `zod`.
 *
 * ```ts
 * const auth = createClient(identity, { baseUrl: "/api" });
 * await auth.login({ usuario: "ana", password: "..." });            // POST usuarios/login; guarda el token y la sesión singleton
 * const productos = new ClientController(ProductoEntity, { baseUrl: "/api", headers: auth.headers });
 * const u = auth.controllers.usuarios.pojo({ iusuario: "beto" });   // pojos siempre indirectos
 * await auth.logout();                                              // DELETE usuario/logout
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/identity.md
 */
import { ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { registry } from "@Jeff-Aporta/DER/src/01-objects/registry.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import { type AuditEventInfo, type AuditQuery, type LoginInput, type LoginResult, type SessionInfoView, ZAuditQuery, ZLoginInput, ZPasswordChangeInput } from "@Jeff-Aporta/DER/src/03-plugins/identity/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/identity/schemas.ts";

/** Olvida el token del cliente y la sesión singleton del registro. */
function cerrarSesion(plugin: ClientPlugin): void {
  plugin.setToken(null);
  registry.session = null;
}

/**
 * JSON transversal de identidad. Tablas `identity_*`. La contraseña llega en `password` (virtual, nunca se guarda) y se
 * persiste sólo su hash (`hash`, oculto en el server). `usuarios` es la única entidad expuesta y administrable; sesiones,
 * intentos y eventos sólo se leen por los paths de sesión.
 */
export const identity: PluginDef = {
  name: "identity",
  entities: {
    usuarios: {
      singular: "usuario",
      plural: "usuarios",
      table: "identity_usuarios",
      exposed: true,
      administrable: true,
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
      /** Acciones de sesión: sobre la colección (`usuarios/…`) las que aún no conocen al usuario; sobre el singular sin pks (`usuario/…`) las del usuario de la sesión. */
      paths: {
        login: {
          method: "POST",
          path: "login",
          prefix: "plural",
          zod: ZLoginInput,
          ops: {
            /** `POST usuarios/login`: valida en el cliente (mismo Zod que el server), guarda el token y deja la sesión singleton. */
            async login(this: ClientPlugin, input: LoginInput): Promise<LoginResult> {
              const result = await this.call<LoginResult>("login", input);
              this.setToken(result.token);
              registry.session = { id: result.usuario.iusuario, nombre: result.usuario.nombre, expira: result.expira };
              return result;
            },
          },
        },
        logout: {
          method: "DELETE",
          path: "logout",
          prefix: "singular",
          security: "protected",
          returns: "void",
          ops: {
            /** `DELETE usuario/logout`: revoca la sesión en el server y olvida el token (aunque ya estuviera vencido). */
            async logout(this: ClientPlugin): Promise<void> {
              try {
                if (this.token) await this.call("logout");
              } finally {
                cerrarSesion(this);
              }
            },
          },
        },
        logoutAll: {
          method: "DELETE",
          path: "logout/all",
          prefix: "singular",
          security: "protected",
          ops: {
            /** `DELETE usuario/logout/all`: cierra la cuenta en todos los dispositivos y olvida el token. Devuelve cuántas sesiones revocó. */
            async logoutAll(this: ClientPlugin): Promise<number> {
              try {
                const data = await this.call<{ revocadas?: number } | undefined>("logoutAll");
                return data?.revocadas ?? 0;
              } finally {
                cerrarSesion(this);
              }
            },
          },
        },
        sessions: {
          method: "GET",
          path: "sessions",
          prefix: "singular",
          security: "protected",
          ops: {
            /** `GET usuario/sessions`: sesiones vigentes con IP, dispositivo y último acceso (marca la actual). */
            sessions(this: ClientPlugin): Promise<SessionInfoView[]> {
              return this.call<SessionInfoView[]>("sessions");
            },
          },
        },
        password: {
          method: "PUT",
          path: "password",
          prefix: "singular",
          security: "protected",
          zod: ZPasswordChangeInput,
          ops: {
            /** `PUT usuario/password`: cambia la contraseña (exige la actual) y cierra las demás sesiones. Devuelve cuántas revocó. */
            async changePassword(this: ClientPlugin, actual: string, nueva: string): Promise<number> {
              const data = await this.call<{ revocadas?: number } | undefined>("password", { actual, nueva });
              return data?.revocadas ?? 0;
            },
          },
        },
        events: {
          method: "GET",
          path: "events",
          prefix: "plural",
          security: "protected",
          ops: {
            /** `GET usuarios/events`: auditoría filtrable por usuario, acción y rango de fechas. */
            events(this: ClientPlugin, query: AuditQuery = {}): Promise<AuditEventInfo[]> {
              const parsed = ZAuditQuery.safeParse(query);
              if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
              const qs = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
              return this.call<AuditEventInfo[]>("events", qs);
            },
          },
        },
      },
    },
    sesiones: {
      singular: "sesion",
      plural: "sesiones",
      table: "identity_sesiones",
      exposed: false,
      administrable: false,
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
      exposed: false,
      administrable: false,
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
      exposed: false,
      administrable: false,
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
  /** Lo único que no pertenece a una entidad: la llave pública estándar (`/.well-known/jwks.json`). */
  irregularPaths: {
    jwks: { method: "GET", path: ".well-known/jwks.json" },
  },
};
