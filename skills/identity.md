# Skill: entidad `usuarios` (plugin de identidad)

[← temario](README.md) · general: [plugins.md](plugins.md) · referencia: `docs/050-Plugins/010-Seguridad.md`

## Entidades

| Clave | Ruta | Tabla | exposed | administrable |
|---|---|---|---|---|
| `usuarios` | `usuario` / `usuarios` | `identity_usuarios` | sí | sí (CRUD con sesión + permisos) |
| `sesiones`, `intentos`, `eventos` | — | `identity_*` | no | no (solo por los paths de abajo) |

`usuarios`: `iusuario` (pk texto), `nombre`, `email`, `bactivo`, `jdata`, `creado`, `hash` (oculto), `password` (virtual: llega, nunca se guarda ni devuelve; mínimo 8).

## Paths de la entidad `usuarios`

| Op (cliente y server) | Ruta | Prefijo | Sesión | Qué hace |
|---|---|---|---|---|
| `login({ usuario, password })` | `POST usuarios/login` | plural | no | token Bearer + sesión; deja `registry.session`; 401/429/403 |
| `logout()` | `DELETE usuario/logout` | singular, sin pks | sí | revoca la sesión del token (204) |
| `logoutAll()` | `DELETE usuario/logout/all` | singular | sí | revoca todas → `{ revocadas }` |
| `sessions()` | `GET usuario/sessions` | singular | sí | vigentes con ip/dispositivo/último acceso, `actual` |
| `changePassword(actual, nueva)` | `PUT usuario/password` | singular | sí | exige la actual, política, revoca las demás |
| `events(query)` | `GET usuarios/events` | plural | sí | auditoría (`iusuario`, `accion`, `desde`, `hasta`, `limit`, `offset`) |
| — | `GET /.well-known/jwks.json` | irregular | no | llave pública (ES256) |

Las acciones del usuario de la sesión cuelgan del singular SIN pks (`usuario/...`): el usuario es el del token. Server en proceso: `auth.login(input, req?)`, `auth.verify(token)`, `auth.logout(info)`, `auth.logoutAll(info)`, `auth.sessions(info)`, `auth.changePassword(info, input)`, `auth.events(query)`.

## Configuración (`createServer(identityServer, { db, cfg })`)

```ts
{ secret: "env:JWT_SECRET",          // ≥ 32, firma HS384
  pepper: "env:PEPPER",              // ≥ 32, hash de contraseñas (default: secret)
  expiresIn: 86400, issuer: "api", iterations: 100000,
  admin: { usuario: "admin", password: "env:ADMIN_PASSWORD" },
  security: { maxAttempts: 5, windowSeconds: 900, lockSeconds: 900, blockNewDevice: false, travel: { enabled: true, minMinutes: 5, block: false }, password: { minLength: 12 } },
  jwt: { alg: "ES256", kid: "usrs", privateJwk, publicJwk }, trustProxy: 1, trustedIssuers: [{ name: "usrs", jwksUrl, issuer }] }
```

## Cliente

```ts
const auth = createClient(identity, { baseUrl: "/api", onToken: guardar });
await auth.login({ usuario: "ana", password: "..." });
const productos = new ClientController(ProductoEntity, { baseUrl: "/api", headers: auth.headers });
await auth.controllers.usuarios.post(auth.controllers.usuarios.pojo({ iusuario: "beto", password: "..." }));
await auth.logout();
```

## Puerta que aporta

`extract`: `Authorization: Bearer <token>` → `{ id, claims }`; sin cabecera → anónimo; inválido/vencido/revocado/inactivo → 401 con mensaje distinto. El rol no viaja en el token.
