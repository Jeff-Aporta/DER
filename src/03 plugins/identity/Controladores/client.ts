/**
 * Lado cliente del plugin de identidad, armado con `ClientController`: login/logout, el token de la sesión y
 * el CRUD de usuarios. `headers` se pasa a cualquier otro ClientController para mandar el token.
 *
 * ```ts
 * const auth = new IdentityClient({ baseUrl: "/api" });
 * await auth.login({ usuario: "ana", password: "..." });
 * const productos = new ClientController(ProductoEntity, { baseUrl: "/api", headers: auth.headers });
 * await auth.logout();
 * ```
 */
import { ValidationError } from "@Jeff-Aporta/DER/src/00 common/errors.ts";
import { ClientController } from "@Jeff-Aporta/DER/src/02 controllers/client/controller.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01 objects/zod.ts";
import {
  type AuditEventInfo,
  type AuditQuery,
  type IdentityClientConfig,
  type LoginInput,
  type LoginResult,
  type SessionInfo,
  ZAuditQuery,
  ZLoginInput,
  ZPasswordChangeInput,
} from "@Jeff-Aporta/DER/src/03 plugins/identity/schemas.ts";
import { type Usuario, UsuarioEntity } from "@Jeff-Aporta/DER/src/03 plugins/identity/Objetos/mod.ts";

export class IdentityClient {
  /** CRUD + list de usuarios (con el token de la sesión). */
  readonly usuarios: ClientController<Usuario>;
  #token: string | null;

  constructor(readonly config: IdentityClientConfig) {
    this.#token = config.token ?? null;
    this.usuarios = new ClientController(UsuarioEntity, {
      baseUrl: config.baseUrl,
      headers: this.headers,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
  }

  /** Token vigente de la sesión (o `null`). */
  get token(): string | null {
    return this.#token;
  }

  /** Cambia el token (p.ej. al recuperarlo de un almacenamiento) y avisa a `onToken`. */
  setToken(token: string | null): void {
    this.#token = token;
    this.config.onToken?.(token);
  }

  /** Cabeceras con el token: pásalas como `headers` a cualquier ClientController. */
  headers = (): HeadersInit => (this.#token ? { authorization: `Bearer ${this.#token}` } : {});

  /** `POST /login`: valida en el cliente (mismo Zod que el server), guarda el token y lo retorna. */
  async login(input: LoginInput): Promise<LoginResult> {
    const parsed = ZLoginInput.safeParse(input);
    if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
    const res = await this.usuarios.request("POST", "login", parsed.data);
    const result = await res.json() as LoginResult;
    this.setToken(result.token);
    return result;
  }

  /** `DELETE /logout`: revoca la sesión en el server y olvida el token (aunque ya estuviera vencido). */
  async logout(): Promise<void> {
    try {
      if (this.#token) await this.usuarios.request("DELETE", "logout");
    } finally {
      this.setToken(null);
    }
  }

  /** `DELETE /logout/all`: cierra la cuenta en todos los dispositivos y olvida el token. */
  async logoutAll(): Promise<number> {
    try {
      const res = await this.usuarios.request("DELETE", "logout/all");
      const data = await res.json() as { revocadas?: number } | undefined;
      return data?.revocadas ?? 0;
    } finally {
      this.setToken(null);
    }
  }

  /** `GET /sessions`: sesiones vigentes con IP, dispositivo y último acceso (marca la actual). */
  async sessions(): Promise<SessionInfo[]> {
    const res = await this.usuarios.request("GET", "sessions");
    return await res.json() as SessionInfo[];
  }

  /** `PUT /password`: cambia la contraseña (exige la actual) y cierra las demás sesiones. */
  async changePassword(actual: string, nueva: string): Promise<number> {
    const parsed = ZPasswordChangeInput.safeParse({ actual, nueva });
    if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
    const res = await this.usuarios.request("PUT", "password", parsed.data);
    const data = await res.json() as { revocadas?: number } | undefined;
    return data?.revocadas ?? 0;
  }

  /** `GET /events`: auditoría filtrable por usuario, acción y rango de fechas. */
  async events(query: AuditQuery = {}): Promise<AuditEventInfo[]> {
    const parsed = ZAuditQuery.safeParse(query);
    if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    const res = await this.usuarios.request("GET", qs ? `events?${qs}` : "events");
    return await res.json() as AuditEventInfo[];
  }
}