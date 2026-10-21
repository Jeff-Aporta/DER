/**
 * Plugin de identidad (server): el JSON transversal con sus particularidades inyectadas (`Obj.insert`): hash de la
 * contraseña, columna `hash` oculta, handlers de los paths de `usuarios` (y del JWKS), puerta `extract` (JWT → sesión) y
 * las operaciones en proceso (`auth.login`, `auth.verify`, `auth.logout`...), que son las mismas funciones que usan los handlers.
 *
 * ```ts
 * const auth = createServer(identityServer, { db, cfg: { secret: "env:JWT_SECRET", admin: { usuario: "admin", password: "env:ADMIN_PASSWORD" } } });
 * const router = createRouter(ctrls, { basePath: "/api", plugins: [auth] });   // `extract` entra al registro si no hay otra
 * await router.seed();                                                           // tablas + usuario admin
 * const sesion = await auth.verify(token);                                       // en proceso, sin HTTP
 * ```
 * Endurecimiento del login (`cfg.security`): audita cada intento (IP real, user-agent, SO, navegador, dispositivo, resultado y
 * motivo); bloquea por N fallos por IP o usuario en una ventana; detecta dispositivo nuevo y viaje imposible básico.
 * Es hermético: no depende del plugin de permisos (y viceversa); el consumidor puede usar cualquiera con su propio sistema.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/identity.md
 */
import { HttpError, Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import type { SessionInfo, Where } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import type { ExtraRouteInput, ServerCtx, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { b64urlDecode, generateEs256KeyPair, hashPassword, importEs256PrivateKey, importEs256PublicKey, randomId, signJwt, signJwtEs256, verifyJwt, verifyJwtEs256, verifyPassword } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { deviceInfo } from "@Jeff-Aporta/DER/src/03-plugins/common/device.ts";
import { identity } from "@Jeff-Aporta/DER/src/03-plugins/identity/index.ts";
import { type AuditEventInfo, type AuditQuery, type DeviceInfo, type IdentityConfig, type IdentityState, type JwtClaims, type LoginResult, type SessionInfoView, ZAuditQuery, ZIdentityConfig, ZLoginInput, ZPasswordChangeInput } from "@Jeff-Aporta/DER/src/03-plugins/identity/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/identity/index.ts";

const BEARER = /^Bearer\s+(\S+)$/i;
const CREDENCIALES = "Usuario o contraseña inválidos";
/** Cada cuánto se refresca `ultimo_acceso` de una sesión (evita una escritura por request). */
const ULTIMO_ACCESO_MS = 60_000;
const SIN_DISPOSITIVO: DeviceInfo = { ip: "desconocido", userAgent: "", dispositivo: "desconocido", so: "desconocido", navegador: "desconocido", huella: "" };

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

/** Estado derivado de la configuración (lo arma `setup`). */
function state(p: ServerPlugin): IdentityState {
  return p.state as IdentityState;
}

/** Configuración validada del plugin. */
function cfg(p: ServerPlugin): IdentityConfig {
  return p.cfg as IdentityConfig;
}

/** Sesión del request o 401. */
function session(ctxState: Record<string, unknown>): SessionInfo {
  const s = ctxState["session"] as SessionInfo | null | undefined;
  if (!s) throw new HttpError(401, "Requiere autenticación");
  return s;
}

/** `jti` de la sesión (viene en los claims del token). */
function jtiOf(info: SessionInfo): string {
  const jti = info.claims?.["jti"];
  if (typeof jti !== "string") throw new HttpError(401, "Token sin sesión");
  return jti;
}

/** Reemplaza `password` (virtual) por su hash antes de guardar. */
async function withHash(p: ServerPlugin, u: Record<string, unknown>): Promise<void> {
  if (!u["password"]) return;
  u["hash"] = await hashPassword(String(u["password"]), state(p).pepper, state(p).iterations);
  u["password"] = undefined;
}

/** JWKS de un emisor de confianza, con caché de 5 minutos. */
async function getJwks(p: ServerPlugin, url: string): Promise<{ keys: JsonWebKey[] } | null> {
  const now = Date.now();
  const hit = state(p).jwksCache.get(url);
  if (hit && hit.exp > now) return hit.jwks as { keys: JsonWebKey[] };
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const jwks = await r.json() as { keys: Record<string, unknown>[] };
    state(p).jwksCache.set(url, { jwks, exp: now + 5 * 60_000 });
    return jwks as { keys: JsonWebKey[] };
  } catch {
    return null;
  }
}

/** Par ES256: el configurado (JWK) o uno efímero (se avisa el público para persistirlo). Se carga una vez. */
function es256Keys(p: ServerPlugin): Promise<CryptoKeyPair> {
  const st = state(p);
  st.es256Keys ??= (async () => {
    const jwt = cfg(p).jwt;
    if (jwt?.privateJwk) {
      const privateKey = await importEs256PrivateKey(jwt.privateJwk as JsonWebKey);
      const publicKey = await importEs256PublicKey(jwt.publicJwk ? jwt.publicJwk as JsonWebKey : await crypto.subtle.exportKey("jwk", privateKey));
      return { privateKey, publicKey };
    }
    const kp = await generateEs256KeyPair();
    console.warn("identity ES256 sin llave persistida: par efímero. Guarda el JWK público: " + JSON.stringify(await crypto.subtle.exportKey("jwk", kp.publicKey)));
    return kp;
  })();
  return st.es256Keys;
}

/** Firma los claims con el algoritmo configurado. */
async function firmar(p: ServerPlugin, claims: JwtClaims): Promise<string> {
  if (state(p).alg === "ES256") return signJwtEs256(claims, (await es256Keys(p)).privateKey, cfg(p).jwt?.kid ?? undefined);
  return signJwt(claims, state(p).secret);
}

/** Verifica firma, algoritmo, emisor y vigencia con la llave propia. */
async function verificarToken(p: ServerPlugin, token: string): Promise<JwtClaims> {
  if (state(p).alg === "ES256") return verifyJwtEs256(token, (await es256Keys(p)).publicKey, { issuer: cfg(p).issuer });
  return verifyJwt(token, state(p).secret, { issuer: cfg(p).issuer });
}

/** Verifica un token ES256 contra los emisores de confianza. Devuelve la sesión externa o null si ninguno la valida. */
async function verifyExternal(p: ServerPlugin, token: string): Promise<SessionInfo | null> {
  const issuers = state(p).trustedIssuers;
  if (!issuers.length) return null;
  let header: { alg?: string; kid?: string } | null = null;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(token.split(".")[0] ?? "")));
  } catch {
    return null;
  }
  if (!header || header.alg !== "ES256") return null;
  for (const iss of issuers) {
    const jwks = await getJwks(p, iss.jwksUrl);
    if (!jwks) continue;
    const key = header.kid ? jwks.keys.find((k) => (k as { kid?: string }).kid === header.kid) : jwks.keys[0];
    if (!key) continue;
    try {
      const claims = await verifyJwtEs256(token, await importEs256PublicKey(key), iss.issuer ? { issuer: iss.issuer } : {});
      return { id: claims.sub, claims: { ...claims, __external: iss.name } };
    } catch {
      continue;
    }
  }
  return null;
}

/** Un intento de login en la auditoría. */
async function registrarIntento(p: ServerPlugin, resultado: string, motivo: string | null, dev: DeviceInfo, usuario: string | null): Promise<void> {
  await p.controllers["intentos"]!.post({ iusuario: usuario ?? null, ip: dev.ip, user_agent: dev.userAgent, dispositivo: dev.dispositivo, so: dev.so, navegador: dev.navegador, resultado, motivo: motivo ?? null, creado: new Date() });
}

/** Un evento de seguridad en la auditoría. */
async function registrarEvento(p: ServerPlugin, accion: string, dev: DeviceInfo, opts: { iusuario?: string | null; entidad?: string; entidadId?: string; jdata?: unknown } = {}): Promise<void> {
  await p.controllers["eventos"]!.post({ ievento: randomId(), iusuario: opts.iusuario ?? null, accion, entidad: opts.entidad ?? null, entidad_id: opts.entidadId ?? null, ip: dev.ip, user_agent: dev.userAgent, dispositivo: dev.dispositivo, jdata: opts.jdata ?? null, creado: new Date() });
}

/** Bloqueo activo por fuerza bruta: restante en segundos (0 = sin bloqueo). */
async function bloqueoRestante(p: ServerPlugin, dev: DeviceInfo, usuario: string | null): Promise<number> {
  const st = state(p);
  const desde = Date.now() - st.ventanaMs;
  const recientes = await p.controllers["intentos"]!.select({ fields: ["iintento", "ip", "iusuario", "resultado", "creado"], orderBy: ["-creado"], limit: 500 });
  const fallos = recientes.filter((x) => x.resultado === "fallo" && ts(x.creado) >= desde && (x.ip === dev.ip || (usuario != null && x.iusuario === usuario)));
  if (fallos.length < st.maxAttempts) return 0;
  const hasta = Math.max(...fallos.map((x) => ts(x.creado))) + st.lockSeconds * 1000;
  const ahora = Date.now();
  return hasta > ahora ? Math.ceil((hasta - ahora) / 1000) : 0;
}

/** ¿Es la primera vez que este usuario entra desde este equipo? */
async function dispositivoNuevo(p: ServerPlugin, iusuario: string, dev: DeviceInfo): Promise<boolean> {
  const sesiones = p.controllers["sesiones"]!;
  const previas = await sesiones.select({ fields: ["jti", "huella"], where: { iusuario }, limit: 1 });
  if (!previas.length) return false;
  const mismaHuella = await sesiones.select({ fields: ["jti"], where: { iusuario, huella: dev.huella }, limit: 1 });
  return mismaHuella.length === 0;
}

/** Viaje imposible básico: cambio de IP en menos de `travel.minMinutes` respecto del último login correcto. */
async function viajeImposible(p: ServerPlugin, iusuario: string, dev: DeviceInfo, ahora: number): Promise<boolean> {
  const st = state(p);
  if (!st.travelEnabled) return false;
  const [ultimo] = await p.controllers["intentos"]!.select({ fields: ["ip", "creado"], where: { iusuario, resultado: "ok" }, orderBy: ["-creado"], limit: 1 });
  if (!ultimo || ultimo.ip === dev.ip) return false;
  return (ahora - ts(ultimo.creado)) / 60_000 < st.travelMinMinutes;
}

/** JSON del server de identidad: `identity` + particularidades. */
export const identityServer: ServerPluginDef = Obj.insert(identity, {
  cfg: ZIdentityConfig,
  entities: {
    usuarios: {
      hidden: ["hash"],
      actions: {
        async post(this: any, u: any, _ctx: unknown, next: (u: any) => Promise<any>) {
          u.creado ??= new Date();
          await withHash(this.plugin, u);
          return next(u);
        },
        async put(this: any, u: any, _ctx: unknown, next: (u: any) => Promise<any>) {
          await withHash(this.plugin, u);
          return next(u);
        },
        async postList(this: any, list: any[], _ctx: unknown, next: (l: any[]) => Promise<any[]>) {
          for (const u of list) await withHash(this.plugin, u);
          return next(list);
        },
        async putList(this: any, list: any[], _ctx: unknown, next: (l: any[]) => Promise<any[]>) {
          for (const u of list) await withHash(this.plugin, u);
          return next(list);
        },
      },
      paths: {
        login: {
          handler(this: ServerPlugin, { body, request }: ExtraRouteInput) {
            return this["login"](body, request);
          },
          ops: {
            /** Login en proceso (lo mismo que `POST usuarios/login`). `req` alimenta la auditoría; sin él se registra como `desconocido`. */
            async login(this: ServerPlugin, input: unknown, req?: Request): Promise<LoginResult> {
              const parsed = ZLoginInput.safeParse(input);
              if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Credenciales inválidas");
              const { usuario, password } = parsed.data;
              const st = state(this);
              const dev = req ? await deviceInfo(req, st.trustProxy) : { ...SIN_DISPOSITIVO, huella: randomId(8) };
              const restante = await bloqueoRestante(this, dev, usuario);
              if (restante > 0) {
                await registrarIntento(this, "bloqueado", "bloqueo", dev, usuario);
                await registrarEvento(this, "bloqueo", dev, { iusuario: usuario, jdata: { restante } });
                throw new HttpError(429, `Demasiados intentos fallidos. Reintenta en ${restante} segundos`);
              }
              const [u] = await this.controllers["usuarios"]!.select({ fields: ["iusuario", "nombre", "hash", "bactivo"], where: { iusuario: usuario } });
              const valido = u?.hash ? await verifyPassword(password, u.hash, st.pepper) : false;
              if (!u) {
                await registrarIntento(this, "fallo", "usuario_inexistente", dev, usuario);
                throw new HttpError(401, CREDENCIALES);
              }
              if (!valido) {
                await registrarIntento(this, "fallo", "credenciales", dev, usuario);
                throw new HttpError(401, CREDENCIALES);
              }
              if (u.bactivo === false) {
                await registrarIntento(this, "fallo", "usuario_inactivo", dev, usuario);
                throw new HttpError(401, CREDENCIALES);
              }
              const iusuario = String(u.iusuario);
              const ahora = Date.now();
              const nuevo = await dispositivoNuevo(this, iusuario, dev);
              if (nuevo) await registrarEvento(this, "dispositivo_nuevo", dev, { iusuario, jdata: { huella: dev.huella, so: dev.so, navegador: dev.navegador } });
              if (nuevo && st.blockNewDevice) {
                await registrarIntento(this, "bloqueado", "dispositivo_nuevo", dev, usuario);
                throw new HttpError(403, "Dispositivo no reconocido. Inicia sesión desde un equipo autorizado");
              }
              if (await viajeImposible(this, iusuario, dev, ahora)) {
                await registrarEvento(this, "viaje_imposible", dev, { iusuario, jdata: { ip: dev.ip } });
                if (st.travelBlock) {
                  await registrarIntento(this, "bloqueado", "viaje_imposible", dev, usuario);
                  throw new HttpError(403, "Inicio de sesión desde una ubicación inesperada");
                }
              }
              const now = Math.floor(ahora / 1000);
              const jti = randomId();
              const exp = now + st.expiresIn;
              await this.controllers["sesiones"]!.post({ jti, iusuario, emitido: new Date(now * 1000), expira: new Date(exp * 1000), ip: dev.ip, user_agent: dev.userAgent, dispositivo: dev.dispositivo, so: dev.so, navegador: dev.navegador, huella: dev.huella, ultimo_acceso: new Date(ahora) });
              const issuer = cfg(this).issuer;
              const token = await firmar(this, { sub: iusuario, jti, iat: now, exp, ...(issuer ? { iss: issuer } : {}), ...(u.nombre ? { nombre: u.nombre } : {}) });
              await registrarIntento(this, "ok", null, dev, usuario);
              await registrarEvento(this, "login", dev, { iusuario, jdata: { jti, dispositivoNuevo: nuevo } });
              return { token, tipo: "Bearer", expira: new Date(exp * 1000).toISOString(), usuario: { iusuario, nombre: u.nombre ?? null } };
            },
            /** Verifica un token (firma, vigencia, sesión no revocada, usuario activo) y devuelve la sesión. Es lo que usa la puerta `extract`. */
            async verify(this: ServerPlugin, token: string): Promise<SessionInfo> {
              const claims = await verificarToken(this, token);
              const sesiones = this.controllers["sesiones"]!;
              const sesion = await sesiones.get({ jti: claims.jti });
              if (!sesion || sesion.brevocado || sesion.iusuario !== claims.sub) throw new HttpError(401, "Sesión cerrada o inexistente");
              const [u] = await this.controllers["usuarios"]!.select({ fields: ["iusuario", "bactivo"], where: { iusuario: claims.sub } });
              if (!u || u.bactivo === false) throw new HttpError(401, "Usuario inactivo");
              // refresco del último acceso con throttle (una escritura por minuto y sesión)
              if (Date.now() - ts(sesion.ultimo_acceso) > ULTIMO_ACCESO_MS) await sesiones.put({ jti: claims.jti, ultimo_acceso: new Date() });
              return { id: claims.sub, claims: { ...claims } };
            },
          },
        },
        logout: {
          async handler(this: ServerPlugin, _input: ExtraRouteInput, ctx: ServerCtx) {
            await this["logout"](session(ctx.state));
            return undefined;
          },
          ops: {
            /** Revoca la sesión del token (lo mismo que `DELETE usuario/logout`). */
            async logout(this: ServerPlugin, info: SessionInfo): Promise<void> {
              await this.controllers["sesiones"]!.put({ jti: jtiOf(info), brevocado: true });
            },
          },
        },
        logoutAll: {
          async handler(this: ServerPlugin, input: ExtraRouteInput, ctx: ServerCtx) {
            return { revocadas: await this["logoutAll"](session(ctx.state), await deviceInfo(input.request, state(this).trustProxy)) };
          },
          ops: {
            /** Revoca todas las sesiones vigentes del usuario y devuelve cuántas cerró (lo mismo que `DELETE usuario/logout/all`). */
            async logoutAll(this: ServerPlugin, info: SessionInfo, dev?: DeviceInfo): Promise<number> {
              const sesiones = this.controllers["sesiones"]!;
              const vigentes = await sesiones.select({ fields: ["jti"], where: { iusuario: info.id, brevocado: false } });
              for (const s of vigentes) await sesiones.put({ jti: s.jti, brevocado: true });
              if (dev) await registrarEvento(this, "logout_all", dev, { iusuario: info.id, jdata: { revocadas: vigentes.length } });
              return vigentes.length;
            },
          },
        },
        sessions: {
          handler(this: ServerPlugin, _input: ExtraRouteInput, ctx: ServerCtx) {
            return this["sessions"](session(ctx.state));
          },
          ops: {
            /** Sesiones vigentes del usuario, marcando la actual (lo mismo que `GET usuario/sessions`). */
            async sessions(this: ServerPlugin, info: SessionInfo): Promise<SessionInfoView[]> {
              const jtiActual = jtiOf(info);
              const ahora = Date.now();
              const vigentes = await this.controllers["sesiones"]!.select({ where: { iusuario: info.id, brevocado: false }, orderBy: ["-emitido"] });
              return vigentes.filter((s) => ts(s.expira) > ahora).map((s): SessionInfoView => ({ jti: s.jti ?? "", emitido: iso(s.emitido), expira: iso(s.expira), ultimoAcceso: iso(s.ultimo_acceso), ip: s.ip ?? null, userAgent: s.user_agent ?? null, dispositivo: s.dispositivo ?? null, so: s.so ?? null, navegador: s.navegador ?? null, actual: s.jti === jtiActual }));
            },
          },
        },
        password: {
          async handler(this: ServerPlugin, { body, request }: ExtraRouteInput, ctx: ServerCtx) {
            return { revocadas: await this["changePassword"](session(ctx.state), body, await deviceInfo(request, state(this).trustProxy)) };
          },
          ops: {
            /** Cambia la contraseña (exige la actual, aplica la política) y revoca las demás sesiones (lo mismo que `PUT usuario/password`). */
            async changePassword(this: ServerPlugin, info: SessionInfo, input: unknown, dev?: DeviceInfo): Promise<number> {
              const parsed = ZPasswordChangeInput.safeParse(input);
              if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Datos inválidos");
              const { actual, nueva } = parsed.data;
              const st = state(this);
              if (nueva.length < st.minLength) throw new ValidationError(`La contraseña debe tener al menos ${st.minLength} caracteres`);
              if (actual === nueva) throw new ValidationError("La nueva contraseña debe ser distinta de la actual");
              const usuarios = this.controllers["usuarios"]!;
              const [u] = await usuarios.select({ fields: ["iusuario", "hash"], where: { iusuario: info.id } });
              if (!u?.hash || !(await verifyPassword(actual, u.hash, st.pepper))) throw new HttpError(401, "La contraseña actual no coincide");
              await usuarios.put({ iusuario: info.id, hash: await hashPassword(nueva, st.pepper, st.iterations) });
              const jtiActual = jtiOf(info);
              const sesiones = this.controllers["sesiones"]!;
              const otras = (await sesiones.select({ fields: ["jti"], where: { iusuario: info.id, brevocado: false } })).filter((s) => s.jti !== jtiActual);
              for (const s of otras) await sesiones.put({ jti: s.jti, brevocado: true });
              if (dev) await registrarEvento(this, "password", dev, { iusuario: info.id, jdata: { sesionesRevocadas: otras.length } });
              return otras.length;
            },
          },
        },
        events: {
          handler(this: ServerPlugin, { query }: ExtraRouteInput, ctx: ServerCtx) {
            session(ctx.state);
            const raw: Record<string, string> = {};
            for (const key of ["iusuario", "accion", "desde", "hasta", "limit", "offset"]) {
              const v = query.get(key);
              if (v != null && v !== "") raw[key] = v;
            }
            const parsed = ZAuditQuery.safeParse(raw);
            if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Filtro inválido");
            return this["events"](parsed.data);
          },
          ops: {
            /** Eventos de auditoría filtrables por usuario, acción y rango de fechas (lo mismo que `GET usuarios/events`). */
            async events(this: ServerPlugin, query: AuditQuery): Promise<AuditEventInfo[]> {
              const where: Record<string, unknown> = {};
              if (query.iusuario) where["iusuario"] = query.iusuario;
              if (query.accion) where["accion"] = query.accion;
              const desde = query.desde ? new Date(query.desde) : null;
              const hasta = query.hasta ? new Date(query.hasta) : null;
              if (desde && !Number.isNaN(desde.getTime())) where["creado"] = { ...(where["creado"] as object ?? {}), gte: desde };
              if (hasta && !Number.isNaN(hasta.getTime())) where["creado"] = { ...(where["creado"] as object ?? {}), lte: hasta };
              const filas = await this.controllers["eventos"]!.select({ where: where as Where, orderBy: ["-creado"], limit: query.limit ?? 100, offset: query.offset ?? 0 });
              return filas.map((e): AuditEventInfo => ({ ievento: e.ievento ?? "", iusuario: e.iusuario ?? null, accion: e.accion ?? "", entidad: e.entidad ?? null, entidadId: e.entidad_id ?? null, ip: e.ip ?? null, userAgent: e.user_agent ?? null, dispositivo: e.dispositivo ?? null, jdata: e.jdata ?? null, creado: iso(e.creado) }));
            },
          },
        },
      },
    },
  },
  irregularPaths: {
    jwks: {
      /** Llave pública para verificar tokens ES256 (vacío con HS384). */
      async handler(this: ServerPlugin) {
        if (state(this).alg !== "ES256") return { keys: [] };
        const pub = await crypto.subtle.exportKey("jwk", (await es256Keys(this)).publicKey);
        return { keys: [{ ...pub, kid: cfg(this).jwt?.kid, alg: "ES256", use: "sig" }] };
      },
    },
  },
  security: {
    /** `Authorization: Bearer <token>` → sesión `{ id, claims }`; sin cabecera → `null`; token inválido → 401. */
    async extract(this: ServerPlugin, req: Request): Promise<SessionInfo | null> {
      const header = req.headers.get("authorization");
      if (!header) return null;
      const token = BEARER.exec(header)?.[1];
      if (!token) throw new HttpError(401, "Token inválido: se espera `Authorization: Bearer <token>`");
      try {
        return await this["verify"](token);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // "Sesión cerrada", "Usuario inactivo", "Token vencido": se relanzan tal cual; sólo un token no verificable prueba emisores externos
        if (!msg.startsWith("Token inválido") || !state(this).trustedIssuers.length) throw e;
      }
      const ext = await verifyExternal(this, token);
      if (ext) return ext;
      throw new HttpError(401, "Token inválido o no verificable");
    },
  },
  /** Estado derivado de la configuración, una sola vez. */
  setup(this: ServerPlugin) {
    const c = cfg(this);
    if (c.secret.length < 32) throw new Error("identity: secret debe tener al menos 32 caracteres");
    const sec = c.security ?? {};
    const windowSeconds = sec.windowSeconds ?? 900;
    const lockSeconds = sec.lockSeconds ?? 900;
    const st: IdentityState = { secret: c.secret, pepper: c.pepper ?? c.secret, alg: c.jwt?.alg ?? "HS384", iterations: c.iterations ?? 100_000, expiresIn: c.expiresIn ?? 86_400, trustProxy: c.trustProxy ?? 0, trustedIssuers: c.trustedIssuers ?? [], maxAttempts: sec.maxAttempts ?? 5, windowSeconds, lockSeconds, blockNewDevice: sec.blockNewDevice ?? false, travelEnabled: sec.travel?.enabled ?? false, travelMinMinutes: sec.travel?.minMinutes ?? 5, travelBlock: sec.travel?.block ?? false, minLength: Math.max(8, sec.password?.minLength ?? 8), ventanaMs: Math.max(windowSeconds, lockSeconds) * 1000, jwksCache: new Map() };
    Object.assign(this.state, st);
    // los overrides de acciones corren con `this` = el controller: le damos acceso al plugin
    for (const ctrl of this.list) (ctrl as unknown as Record<string, unknown>)["plugin"] = this;
  },
  /** Crea el usuario administrador si no existe. */
  async seed(this: ServerPlugin) {
    const admin = cfg(this).admin;
    const usuarios = this.controllers["usuarios"]!;
    if (!admin || await usuarios.get({ iusuario: admin.usuario })) return;
    await usuarios.post({ iusuario: admin.usuario, nombre: admin.nombre ?? admin.usuario, password: admin.password });
  },
}) as ServerPluginDef;
