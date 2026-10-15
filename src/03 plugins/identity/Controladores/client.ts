/**
 * Lado cliente del plugin de identidad, armado con `ClientController`: login/logout, el token de la sesión y
 * el CRUD de usuarios. `headers` se pasa a cualquier otro ClientController para mandar el token.
 *
 * ```ts
 * const auth = new IdentityClient({ baseUrl: "/api" });
 * await auth.login({ usuario: "ana", password: "..." });
 * const productos = new ClientController(Producto, { baseUrl: "/api", headers: auth.headers });
 * await auth.logout();
 * ```
 */
import { ValidationError } from "../../../00 common/errors.ts";
import { ClientController } from "../../../02 controllers/client/controller.ts";
import { zodMessage } from "../../../01 objects/zod.ts";
import { type IdentityClientConfig, type LoginInput, type LoginResult, ZLoginInput } from "../schemas.ts";
import { type TUsuario, Usuario } from "../Objetos/mod.ts";

export class IdentityClient {
  /** CRUD + list de usuarios (con el token de la sesión). */
  readonly usuarios: ClientController<TUsuario>;
  #token: string | null;

  constructor(readonly config: IdentityClientConfig) {
    this.#token = config.token ?? null;
    this.usuarios = new ClientController(Usuario, {
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
}
