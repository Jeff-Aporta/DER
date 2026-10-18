/**
 * Plugin de identidad: usuarios, hash con secret key, JWT HS384 y las rutas de sesión.
 *
 * Endurecimiento del login (configurable en `identity.security`):
 * - audita cada intento (IP real, user-agent, SO, navegador, dispositivo, resultado y motivo);
 * - bloquea por N fallos por IP o usuario dentro de una ventana;
 * - detecta dispositivo nuevo (huella del user-agent) y viaje imposible básico (cambio de IP en ventana corta);
 * - expone `GET /sessions`, `DELETE /logout/all`, `PUT /password` y `GET /events`.
 */
import { HttpError, ValidationError } from "@Jeff-Aporta/DER/src/00 common/errors.ts";
import { ServerController } from "@Jeff-Aporta/DER/src/02 controllers/server/controller.ts";
import type { Database } from "@Jeff-Aporta/DER/src/02 controllers/server/database.ts";
import type { Identity } from "@Jeff-Aporta/DER/src/02 controllers/server/schemas.ts";
import type { Where } from "@Jeff-Aporta/DER/src/00 common/schemas.ts";
import {
  type AuditEventInfo,
  type AuditQuery,
  type DeviceInfo,
  type IdentityConfig,
  type JwtClaims,
  type LoginResult,
  type SessionInfo,
  ZAuditQuery,
  ZLoginInput,
  ZPasswordChangeInput,
} from "@Jeff-Aporta/DER/src/03 plugins/identity/schemas.ts";
import type { IdentityPlugin } from "@Jeff-Aporta/DER/src/03 plugins/schemas.ts";
import { generateEs256KeyPair, hashPassword, importEs256PrivateKey, importEs256PublicKey, randomId, signJwt, signJwtEs256, verifyJwt, verifyJwtEs256, verifyPassword, b64urlDecode } from "@Jeff-Aporta/DER/src/03 plugins/identity/Controladores/crypto.ts";
import type { JwksCacheEntry } from "@Jeff-Aporta/DER/src/03 plugins/identity/schemas.ts";
import { deviceInfo } from "@Jeff-Aporta/DER/src/03 plugins/identity/Controladores/device.ts";
import {
  EventoEntity,
  type Intento,
  IntentoEntity,
  SesionEntity,
  type Usuario,
  UsuarioEntity,
} from "@Jeff-Aporta/DER/src/03 plugins/identity/Objetos/mod.ts";

const BEARER = /^Bearer\s+(\S+)$/i;
const CREDENCIALES = "Usuario o contraseña inválidos";
/** Cada cuánto se refresca `ultimo_acceso` de una sesión (evita una escritura por request). */
const ULTIMO_ACCESO_MS = 60_000;

/** Marca de tiempo de un valor datetime del motor (Date, ISO o epoch). */
function ts(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime();
  return 0;
}

/** ISO de un datetime del motor, o `null`. */
function iso(value: unknown): string | null {
  const t = ts(value);
  return t > 0 ? new Date(t).toISOString() : null;
}

export function identityPlugin(cfg: IdentityConfig & { db: Database }): IdentityPlugin {
  const { db, secret } = cfg;
  if (secret.length < 32) throw new Error("identity.secret debe tener al menos 32 caracteres");
  const pepper = cfg.pepper ?? secret;
  const trustProxy = cfg.trustProxy ?? 0;
  const trustedIssuers: Array<{ name: string; jwksUrl: string; issuer?: string }> = Array.isArray(cfg.trustedIssuers) ? cfg.trustedIssuers : [];
  console.log('[identity DEBUG] trustedIssuers length:', trustedIssuers.length, JSON.stringify(trustedIssuers.map(i=>i.name)));
  /** Caché simple de JWKS por URL (TTL 5 min). */
  const jwksCache = new Map<string, JwksCacheEntry>();
  async function getJwks(url: string): Promise<{ keys: JsonWebKey[] } | null> {
    const now = Date.now();
    const hit = jwksCache.get(url);
    if (hit && hit.exp > now) return hit.jwks;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const jwks = await r.json() as { keys: Record<string, unknown>[] };
      jwksCache.set(url, { jwks, exp: now + 5 * 60_000 });
      return jwks;
    } catch { return null; }
  }

  // Firma: HS384 (simétrico) o ES256 (asimétrico + JWKS). Las llaves se cargan una vez (perezoso).
  const alg = cfg.jwt?.alg ?? "HS384";
  let es256KeysPromise: Promise<CryptoKeyPair> | undefined;
  async function es256Keys(): Promise<CryptoKeyPair> {
    es256KeysPromise ??= (async () => {
      if (cfg.jwt?.privateJwk) {
        const privateKey = await importEs256PrivateKey(cfg.jwt.privateJwk as JsonWebKey);
        const publicKey = cfg.jwt.publicJwk
          ? await importEs256PublicKey(cfg.jwt.publicJwk as JsonWebKey)
          : await importEs256PublicKey(await crypto.subtle.exportKey("jwk", privateKey));
        return { privateKey, publicKey };
      }
      const kp = await generateEs256KeyPair();
      const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
      console.warn("identity ES256 sin llave persistida: par efímero. Guarda el JWK público: " + JSON.stringify(pub));
      return kp;
    })();
    return es256KeysPromise;
  }
  async function firmar(claims: JwtClaims): Promise<string> {
    if (alg === "ES256") return signJwtEs256(claims, (await es256Keys()).privateKey, cfg.jwt?.kid);
    return signJwt(claims, secret);
  }
  async function verificarToken(token: string): Promise<JwtClaims> {
    if (alg === "ES256") return verifyJwtEs256(token, (await es256Keys()).publicKey, { issuer: cfg.issuer });
    return verifyJwt(token, secret, { issuer: cfg.issuer });
  }
  /** Verifica un token ES256 contra los emisores de confianza (trusted issuers).
   *  Devuelve la identidad externa o null si ninguno la valida. */
  async function verifyExternal(token: string): Promise<{ id: string; claims: JwtClaims & { __external: string } } | null> {
    if (trustedIssuers.length === 0) return null;
    let header: { alg?: string; kid?: string } | null = null;
    try { const p = token.split("."); header = JSON.parse(new TextDecoder().decode(b64urlDecode(p[0]!))); } catch { return null; }
    if (!header || header.alg !== "ES256") return null;
    const kid = header.kid;
    for (const iss of trustedIssuers) {
      const jwks = await getJwks(iss.jwksUrl);
      if (!jwks) continue;
      const key = kid ? jwks.keys.find((k) => (k as any).kid === kid) : jwks.keys[0];
      if (!key) continue;
      try {
        const pub = await importEs256PublicKey(key as JsonWebKey);
        const claims = await verifyJwtEs256(token, pub, iss.issuer ? { issuer: iss.issuer } : {});
        return { id: claims.sub, claims: { ...claims, __external: iss.name } };
      } catch { continue; }
    }
    return null;
  }
  async function publicJwk(): Promise<JsonWebKey> {
    return await crypto.subtle.exportKey("jwk", (await es256Keys()).publicKey);
  }
  const iterations = cfg.iterations ?? 100_000;
  const expiresIn = cfg.expiresIn ?? 86_400;

  const sec = cfg.security ?? {};
  const maxAttempts = sec.maxAttempts ?? 5;
  const windowSeconds = sec.windowSeconds ?? 900;
  const lockSeconds = sec.lockSeconds ?? 900;
  const blockNewDevice = sec.blockNewDevice ?? false;
  const travelEnabled = sec.travel?.enabled ?? false;
  const travelMinMinutes = sec.travel?.minMinutes ?? 5;
  const travelBlock = sec.travel?.block ?? false;
  const minLength = Math.max(8, sec.password?.minLength ?? 8);
  /** Para respetar el bloqueo aunque dure más que la ventana de conteo. */
  const ventanaMs = Math.max(windowSeconds, lockSeconds) * 1000;

  /** Reemplaza `password` (virtual) por su hash antes de guardar. */
  const withHash = async (u: Usuario): Promise<Usuario> => {
    if (u.password) {
      u.hash = await hashPassword(u.password, pepper, iterations);
      u.password = undefined;
    }
    return u;
  };

  const usuarios = new ServerController(UsuarioEntity, {
    db,
    table: "permisos_usuarios",
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

  const sesiones = new ServerController(SesionEntity, { db, table: "permisos_sesiones", expose: [], security: true });
  const intentos = new ServerController(IntentoEntity, { db, table: "permisos_intentos", expose: [], security: true });
  const eventos = new ServerController(EventoEntity, { db, table: "permisos_eventos", expose: [], security: true });

  // ============================================================ auditoría

  async function registrarIntento(
    resultado: string,
    motivo: string | null,
    dev: DeviceInfo,
    usuario: string | null,
  ): Promise<void> {
    await intentos.post({
      iusuario: usuario ?? null,
      ip: dev.ip,
      user_agent: dev.userAgent,
      dispositivo: dev.dispositivo,
      so: dev.so,
      navegador: dev.navegador,
      resultado,
      motivo: motivo ?? null,
      creado: new Date(),
    });
  }

  async function registrarEvento(
    accion: string,
    dev: DeviceInfo,
    opts: { iusuario?: string | null; entidad?: string; entidadId?: string; jdata?: unknown } = {},
  ): Promise<void> {
    await eventos.post({
      ievento: randomId(),
      iusuario: opts.iusuario ?? null,
      accion,
      entidad: opts.entidad ?? null,
      entidad_id: opts.entidadId ?? null,
      ip: dev.ip,
      user_agent: dev.userAgent,
      dispositivo: dev.dispositivo,
      jdata: opts.jdata ?? null,
      creado: new Date(),
    });
  }

  /** Intentos fallidos recientes (por IP o por usuario) dentro de la ventana de bloqueo. */
  async function fallosRecientes(dev: DeviceInfo, usuario: string | null, desde: number): Promise<Intento[]> {
    const recientes = await intentos.select({
      fields: ["iintento", "ip", "iusuario", "resultado", "creado"],
      orderBy: ["-creado"],
      limit: 500,
    });
    return recientes.filter((x) =>
      x.resultado === "fallo" && ts(x.creado) >= desde && (x.ip === dev.ip || (usuario != null && x.iusuario === usuario))
    );
  }

  /** Bloqueo activo por fuerza bruta: restante en segundos (0 = sin bloqueo). */
  async function bloqueoRestante(dev: DeviceInfo, usuario: string | null): Promise<number> {
    const desde = Date.now() - ventanaMs;
    const fallos = await fallosRecientes(dev, usuario, desde);
    if (fallos.length < maxAttempts) return 0;
    const ultimo = Math.max(...fallos.map((x) => ts(x.creado)));
    const hasta = ultimo + lockSeconds * 1000;
    const ahora = Date.now();
    return hasta > ahora ? Math.ceil((hasta - ahora) / 1000) : 0;
  }

  /** ¿Es la primera vez que este usuario entra desde este equipo? */
  async function dispositivoNuevo(iusuario: string, dev: DeviceInfo): Promise<boolean> {
    const previas = await sesiones.select({ fields: ["jti", "huella"], where: { iusuario }, limit: 1 });
    if (!previas.length) return false;
    const mismaHuella = await sesiones.select({ fields: ["jti"], where: { iusuario, huella: dev.huella }, limit: 1 });
    return mismaHuella.length === 0;
  }

  /** Viaje imposible básico: cambio de IP en menos de `travel.minMinutes` respecto del último login correcto. */
  async function viajeImposible(iusuario: string, dev: DeviceInfo, ahora: number): Promise<boolean> {
    if (!travelEnabled) return false;
    const [ultimo] = await intentos.select({
      fields: ["ip", "creado"],
      where: { iusuario, resultado: "ok" },
      orderBy: ["-creado"],
      limit: 1,
    });
    if (!ultimo || ultimo.ip === dev.ip) return false;
    const minutos = (ahora - ts(ultimo.creado)) / 60_000;
    return minutos < travelMinMinutes;
  }

  // ============================================================ login

  async function login(input: unknown, req?: Request): Promise<LoginResult> {
    const parsed = ZLoginInput.safeParse(input);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Credenciales inválidas");
    const { usuario, password } = parsed.data;
    const dev = req
      ? await deviceInfo(req, trustProxy)
      : { ip: "desconocido", userAgent: "", dispositivo: "desconocido", so: "desconocido", navegador: "desconocido", huella: randomId(8) };

    const restante = await bloqueoRestante(dev, usuario);
    if (restante > 0) {
      await registrarIntento("bloqueado", "bloqueo", dev, usuario);
      await registrarEvento("bloqueo", dev, { iusuario: usuario, jdata: { restante } });
      throw new HttpError(429, `Demasiados intentos fallidos. Reintenta en ${restante} segundos`);
    }

    const [u] = await usuarios.select({ fields: ["iusuario", "nombre", "hash", "bactivo"], where: { iusuario: usuario } });
    const valido = u?.hash ? await verifyPassword(password, u.hash, pepper) : false;
    if (!u) {
      await registrarIntento("fallo", "usuario_inexistente", dev, usuario);
      throw new HttpError(401, CREDENCIALES);
    }
    if (!valido) {
      await registrarIntento("fallo", "credenciales", dev, usuario);
      throw new HttpError(401, CREDENCIALES);
    }
    if (u.bactivo === false) {
      await registrarIntento("fallo", "usuario_inactivo", dev, usuario);
      throw new HttpError(401, CREDENCIALES);
    }

    const iusuario = String(u.iusuario);
    const ahora = Date.now();
    const nuevo = await dispositivoNuevo(iusuario, dev);
    if (nuevo) {
      await registrarEvento("dispositivo_nuevo", dev, { iusuario, jdata: { huella: dev.huella, so: dev.so, navegador: dev.navegador } });
      if (blockNewDevice) {
        await registrarIntento("bloqueado", "dispositivo_nuevo", dev, usuario);
        throw new HttpError(403, "Dispositivo no reconocido. Inicia sesión desde un equipo autorizado");
      }
    }

    if (await viajeImposible(iusuario, dev, ahora)) {
      await registrarEvento("viaje_imposible", dev, { iusuario, jdata: { ip: dev.ip } });
      if (travelBlock) {
        await registrarIntento("bloqueado", "viaje_imposible", dev, usuario);
        throw new HttpError(403, "Inicio de sesión desde una ubicación inesperada");
      }
    }

    const now = Math.floor(ahora / 1000);
    const jti = randomId();
    const exp = now + expiresIn;
    await sesiones.post({
      jti,
      iusuario,
      emitido: new Date(now * 1000),
      expira: new Date(exp * 1000),
      ip: dev.ip,
      user_agent: dev.userAgent,
      dispositivo: dev.dispositivo,
      so: dev.so,
      navegador: dev.navegador,
      huella: dev.huella,
      ultimo_acceso: new Date(ahora),
    });
    const token = await firmar({
      sub: iusuario,
      jti,
      iat: now,
      exp,
      ...(cfg.issuer ? { iss: cfg.issuer } : {}),
      ...(u.nombre ? { nombre: u.nombre } : {}),
    });

    await registrarIntento("ok", null, dev, usuario);
    await registrarEvento("login", dev, { iusuario, jdata: { jti, dispositivoNuevo: nuevo } });

    return {
      token,
      tipo: "Bearer",
      expira: new Date(exp * 1000).toISOString(),
      usuario: { iusuario, nombre: u.nombre ?? null },
    };
  }

  // ============================================================ verificación

  async function verify(token: string): Promise<Identity> {
    const claims = await verificarToken(token);
    const sesion = await sesiones.get({ jti: claims.jti });
    if (!sesion || sesion.brevocado || sesion.iusuario !== claims.sub) {
      throw new HttpError(401, "Sesión cerrada o inexistente");
    }
    const [u] = await usuarios.select({ fields: ["iusuario", "bactivo"], where: { iusuario: claims.sub } });
    if (!u || u.bactivo === false) throw new HttpError(401, "Usuario inactivo");
    // refresco del último acceso con throttle (una escritura por minuto y sesión)
    if (Date.now() - ts(sesion.ultimo_acceso) > ULTIMO_ACCESO_MS) {
      await sesiones.put({ jti: claims.jti, ultimo_acceso: new Date() });
    }
    return { id: claims.sub, claims: { ...claims } };
  }

  // ============================================================ operaciones

  async function logout(identity: Identity): Promise<void> {
    const jti = claimsJti(identity);
    await sesiones.put({ jti, brevocado: true });
  }

  function claimsJti(identity: Identity): string {
    const jti = identity.claims["jti"];
    if (typeof jti !== "string") throw new HttpError(401, "Token sin sesión");
    return jti;
  }

  /** Revoca todas las sesiones vigentes del usuario. */
  async function logoutAll(identity: Identity, dev?: DeviceInfo): Promise<number> {
    const vigentes = await sesiones.select({ fields: ["jti"], where: { iusuario: identity.id, brevocado: false } });
    for (const s of vigentes) await sesiones.put({ jti: s.jti, brevocado: true });
    if (dev) await registrarEvento("logout_all", dev, { iusuario: identity.id, jdata: { revocadas: vigentes.length } });
    return vigentes.length;
  }

  /** Sesiones vigentes del usuario, marcando la actual. */
  async function sessions(identity: Identity): Promise<SessionInfo[]> {
    const jtiActual = claimsJti(identity);
    const ahora = Date.now();
    const vigentes = await sesiones.select({ where: { iusuario: identity.id, brevocado: false }, orderBy: ["-emitido"] });
    return vigentes
      .filter((s) => ts(s.expira) > ahora)
      .map((s): SessionInfo => ({
        jti: s.jti ?? "",
        emitido: iso(s.emitido),
        expira: iso(s.expira),
        ultimoAcceso: iso(s.ultimo_acceso),
        ip: s.ip ?? null,
        userAgent: s.user_agent ?? null,
        dispositivo: s.dispositivo ?? null,
        so: s.so ?? null,
        navegador: s.navegador ?? null,
        actual: s.jti === jtiActual,
      }));
  }

  /** Cambia la contraseña (exige la actual) y revoca las demás sesiones. */
  async function changePassword(identity: Identity, input: unknown, dev?: DeviceInfo): Promise<number> {
    const parsed = ZPasswordChangeInput.safeParse(input);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Datos inválidos");
    const { actual, nueva } = parsed.data;
    if (nueva.length < minLength) throw new ValidationError(`La contraseña debe tener al menos ${minLength} caracteres`);
    if (actual === nueva) throw new ValidationError("La nueva contraseña debe ser distinta de la actual");
    const [u] = await usuarios.select({ fields: ["iusuario", "hash"], where: { iusuario: identity.id } });
    if (!u?.hash || !(await verifyPassword(actual, u.hash, secret))) {
      throw new HttpError(401, "La contraseña actual no coincide");
    }
    await usuarios.put({ iusuario: identity.id, hash: await hashPassword(nueva, pepper, iterations) });
    const jtiActual = claimsJti(identity);
    const otras = await sesiones.select({ fields: ["jti"], where: { iusuario: identity.id, brevocado: false } });
    let revocadas = 0;
    for (const s of otras) {
      if (s.jti === jtiActual) continue;
      await sesiones.put({ jti: s.jti, brevocado: true });
      revocadas++;
    }
    if (dev) await registrarEvento("password", dev, { iusuario: identity.id, jdata: { sesionesRevocadas: revocadas } });
    return revocadas;
  }

  /** Eventos de auditoría filtrables por usuario, acción y rango de fechas. */
  async function events(query: AuditQuery): Promise<AuditEventInfo[]> {
    const where: Record<string, unknown> = {};
    if (query.iusuario) where["iusuario"] = query.iusuario;
    if (query.accion) where["accion"] = query.accion;
    const desde = query.desde ? new Date(query.desde) : null;
    const hasta = query.hasta ? new Date(query.hasta) : null;
    if (desde && !Number.isNaN(desde.getTime())) where["creado"] = { ...(where["creado"] as object ?? {}), gte: desde };
    if (hasta && !Number.isNaN(hasta.getTime())) where["creado"] = { ...(where["creado"] as object ?? {}), lte: hasta };
    const filas = await eventos.select({
      where: where as Where,
      orderBy: ["-creado"],
      limit: query.limit ?? 100,
      offset: query.offset ?? 0,
    });
    return filas.map((e): AuditEventInfo => ({
      ievento: e.ievento ?? "",
      iusuario: e.iusuario ?? null,
      accion: e.accion ?? "",
      entidad: e.entidad ?? null,
      entidadId: e.entidad_id ?? null,
      ip: e.ip ?? null,
      userAgent: e.user_agent ?? null,
      dispositivo: e.dispositivo ?? null,
      jdata: e.jdata ?? null,
      creado: iso(e.creado),
    }));
  }

  return {
    name: "identity",
    usuarios,
    sesiones,
    intentos,
    eventos,
    controllers: [usuarios, sesiones, intentos, eventos],
    login,
    logout,
    logoutAll,
    sessions,
    changePassword,
    events,
    verify,
    routes: [
      { method: "GET", path: ".well-known/jwks.json", handler: async () => ({ keys: alg === "ES256" ? [{ ...await publicJwk(), kid: cfg.jwt?.kid, alg: "ES256", use: "sig" }] : [] }) },
      { method: "POST", path: "login", handler: ({ body, request }) => login(body, request) },
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
      {
        method: "DELETE",
        path: "logout/all",
        security: { protected: true, permissions: false },
        async handler(input, ctx) {
          const identity = ctx.state["identity"] as Identity | null | undefined;
          if (!identity) throw new HttpError(401, "Requiere autenticación");
          const revocadas = await logoutAll(identity, await deviceInfo(input.request, trustProxy));
          return { revocadas };
        },
      },
      {
        method: "GET",
        path: "sessions",
        security: { protected: true, permissions: false },
        async handler(_input, ctx) {
          const identity = ctx.state["identity"] as Identity | null | undefined;
          if (!identity) throw new HttpError(401, "Requiere autenticación");
          return await sessions(identity);
        },
      },
      {
        method: "PUT",
        path: "password",
        security: { protected: true, permissions: false },
        async handler({ body, request }, ctx) {
          const identity = ctx.state["identity"] as Identity | null | undefined;
          if (!identity) throw new HttpError(401, "Requiere autenticación");
          const revocadas = await changePassword(identity, body, await deviceInfo(request, trustProxy));
          return { revocadas };
        },
      },
      {
        method: "GET",
        path: "events",
        security: { protected: true, permissions: false },
        async handler({ query }, ctx) {
          const identity = ctx.state["identity"] as Identity | null | undefined;
          if (!identity) throw new HttpError(401, "Requiere autenticación");
          const raw: Record<string, string> = {};
          for (const key of ["iusuario", "accion", "desde", "hasta", "limit", "offset"]) {
            const v = query.get(key);
            if (v != null && v !== "") raw[key] = v;
          }
          const parsed = ZAuditQuery.safeParse(raw);
          if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Filtro inválido");
          return await events(parsed.data);
        },
      },
    ],
    async authenticate(req) {
      const header = req.headers.get("authorization");
      if (!header) return null;
      const token = BEARER.exec(header)?.[1];
      if (!token) throw new HttpError(401, "Token inválido: se espera `Authorization: Bearer <token>`");
      console.log('[identity DEBUG] authenticate: alg guess from header (ES256 if 2nd field), trustedIssuers=', trustedIssuers.length);
      try { return await verify(token); } catch (e) { const m = String((e as any)?.message ?? ""); console.log('[identity DEBUG] verify threw:', m, 'startsInv=', m.startsWith("Token inválido"), 'len=', trustedIssuers.length); if (!m.startsWith("Token inválido")) throw e; if (trustedIssuers.length === 0) throw e; /* firma/formato y hay emisores externos: probar */ }
      const ext = await verifyExternal(token);
      if (ext) return ext;
      throw new HttpError(401, "Token inválido o no verificable");
    },
    async seed() {
      const admin = cfg.admin;
      if (!admin || await usuarios.get({ iusuario: admin.usuario })) return;
      await usuarios.post({ iusuario: admin.usuario, nombre: admin.nombre ?? admin.usuario, password: admin.password });
    },
  };
}