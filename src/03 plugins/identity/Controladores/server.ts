/**
 * Plugin de identidad: usuarios, hash con secret key, JWT HS384 y las rutas `POST /login` y `DELETE /logout`.
 * Aporta la puerta de autenticación del Router (`authenticate`): sin plugin de identidad no hay seguridad.
 */
import { HttpError, ValidationError } from "../../../00 common/errors.ts";
import { ServerController } from "../../../02 controllers/server/controller.ts";
import type { Database } from "../../../02 controllers/server/database.ts";
import type { Identity } from "../../../02 controllers/server/schemas.ts";
import { type IdentityConfig, type LoginResult, ZLoginInput } from "../schemas.ts";
import type { IdentityPlugin } from "../../schemas.ts";
import { hashPassword, randomId, signJwt, verifyJwt, verifyPassword } from "./crypto.ts";
import { Sesion, type TUsuario, Usuario } from "../Objetos/mod.ts";

const BEARER = /^Bearer\s+(\S+)$/i;
const CREDENCIALES = "Usuario o contraseña inválidos";

export function identityPlugin(cfg: IdentityConfig & { db: Database }): IdentityPlugin {
  const { db, secret } = cfg;
  if (secret.length < 32) throw new Error("identity.secret debe tener al menos 32 caracteres");
  const iterations = cfg.iterations ?? 100_000;
  const expiresIn = cfg.expiresIn ?? 86_400;

  /** Reemplaza `password` (virtual) por su hash antes de guardar. */
  const withHash = async (u: TUsuario): Promise<TUsuario> => {
    if (u.password) {
      u.hash = await hashPassword(u.password, secret, iterations);
      u.password = undefined;
    }
    return u;
  };

  const usuarios = new ServerController(Usuario, {
    db,
    table: "sec_usuarios",
    hidden: ["hash"],
    security: true,
    actions: {
      async post(u, _ctx, next) {
        u.creado ??= new Date();
        return next(await withHash(u));
      },
      async put(u, _ctx, next) {
        return next(await withHash(u));
      },
      async postList(list, _ctx, next) {
        for (const u of list) await withHash(u);
        return next(list);
      },
      async putList(list, _ctx, next) {
        for (const u of list) await withHash(u);
        return next(list);
      },
    },
  });

  const sesiones = new ServerController(Sesion, { db, table: "sec_sesiones", expose: [], security: true });

  async function login(input: unknown): Promise<LoginResult> {
    const parsed = ZLoginInput.safeParse(input);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Credenciales inválidas");
    const { usuario, password } = parsed.data;
    const [u] = await usuarios.select({ fields: ["iusuario", "nombre", "hash", "bactivo"], where: { iusuario: usuario } });
    const valido = u?.hash ? await verifyPassword(password, u.hash, secret) : false;
    if (!u || !valido || u.bactivo === false) throw new HttpError(401, CREDENCIALES);
    const now = Math.floor(Date.now() / 1000);
    const jti = randomId();
    const exp = now + expiresIn;
    await sesiones.post({ jti, iusuario: u.iusuario, emitido: new Date(now * 1000), expira: new Date(exp * 1000) });
    const token = await signJwt({
      sub: String(u.iusuario),
      jti,
      iat: now,
      exp,
      ...(cfg.issuer ? { iss: cfg.issuer } : {}),
      ...(u.nombre ? { nombre: u.nombre } : {}),
    }, secret);
    return {
      token,
      tipo: "Bearer",
      expira: new Date(exp * 1000).toISOString(),
      usuario: { iusuario: String(u.iusuario), nombre: u.nombre ?? null },
    };
  }

  async function verify(token: string): Promise<Identity> {
    const claims = await verifyJwt(token, secret, { issuer: cfg.issuer });
    const sesion = await sesiones.get({ jti: claims.jti });
    if (!sesion || sesion.brevocado || sesion.iusuario !== claims.sub) {
      throw new HttpError(401, "Sesión cerrada o inexistente");
    }
    const [u] = await usuarios.select({ fields: ["iusuario", "bactivo"], where: { iusuario: claims.sub } });
    if (!u || u.bactivo === false) throw new HttpError(401, "Usuario inactivo");
    return { id: claims.sub, claims: { ...claims } };
  }

  async function logout(identity: Identity): Promise<void> {
    const jti = identity.claims["jti"];
    if (typeof jti !== "string") throw new HttpError(401, "Token sin sesión");
    await sesiones.put({ jti, brevocado: true });
  }

  return {
    name: "identity",
    usuarios,
    sesiones,
    controllers: [usuarios, sesiones],
    login,
    logout,
    verify,
    routes: [
      { method: "POST", path: "login", handler: ({ body }) => login(body) },
      {
        method: "DELETE",
        path: "logout",
        security: { protected: true, permissions: false },
        async handler(_input, ctx) {
          const identity = ctx.state["identity"] as Identity | null | undefined;
          if (!identity) throw new HttpError(401, "Requiere autenticación");
          await logout(identity);
          return undefined;
        },
      },
    ],
    async authenticate(req) {
      const header = req.headers.get("authorization");
      if (!header) return null;
      const token = BEARER.exec(header)?.[1];
      if (!token) throw new HttpError(401, "Token inválido: se espera `Authorization: Bearer <token>`");
      return await verify(token);
    },
    async seed() {
      const admin = cfg.admin;
      if (!admin || await usuarios.get({ iusuario: admin.usuario })) return;
      await usuarios.post({ iusuario: admin.usuario, nombre: admin.nombre ?? admin.usuario, password: admin.password });
    },
  };
}
