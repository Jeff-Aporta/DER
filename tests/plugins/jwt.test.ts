/**
 * JWT HS256 independiente de la base de datos: firma, expiración, rechazo de algoritmos y middleware Bearer.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { HttpError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { jwtAuthMiddleware, jwtAuthMiddlewareFromEnv, signJwtHs256, verifyJwtHs256 } from "@Jeff-Aporta/DER/src/03-plugins/common/jwt.ts";

const SECRETO = "secreto-de-prueba-para-jwt-hs256-con-32-caracteres";
const AHORA = Date.parse("2026-11-13T12:00:00.000Z");

Deno.test("jwt HS256: firma y verifica claims con emisor, audiencia y expiración", async () => {
  const token = await signJwtHs256(
    { sub: "bot:ana", canales: ["general"], rol: "editor" },
    SECRETO,
    { expiresIn: 3600, issuer: "bots", audience: "api", now: AHORA },
  );
  assertEquals(token.split(".").length, 3);
  const claims = await verifyJwtHs256(token, SECRETO, {
    issuer: "bots",
    audience: "api",
    now: AHORA + 1000,
  });
  assertEquals(claims.sub, "bot:ana");
  assertEquals(claims.iss, "bots");
  assertEquals(claims.aud, "api");
  assertEquals(claims.exp, Math.floor(AHORA / 1000) + 3600);
  assertEquals(claims["canales"], ["general"]);
});

Deno.test("jwt HS256: firma ajena, token manipulado, algoritmo ajeno y expiración se rechazan", async () => {
  const token = await signJwtHs256({ sub: "bot:ana" }, SECRETO, { now: AHORA });
  await assertRejects(
    () => verifyJwtHs256(token, "otro-secreto-que-tambien-tiene-32-caracteres", { now: AHORA }),
    HttpError,
    "firma",
  );
  await assertRejects(
    () => verifyJwtHs256(token.replace(/^[^.]+/, "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0"), SECRETO, { now: AHORA }),
    HttpError,
    "algoritmo",
  );
  await assertRejects(
    () => verifyJwtHs256(token, SECRETO, { now: AHORA + 3601_000 }),
    HttpError,
    "vencido",
  );
});

Deno.test("jwt HS256: middleware Bearer crea la sesión del bot y el entorno toma el secreto", async () => {
  const token = await signJwtHs256({ sub: "bot:ana", rol: "editor" }, SECRETO, { now: AHORA });
  const middleware = jwtAuthMiddleware({ secret: SECRETO, now: AHORA });
  assertEquals(await middleware(new Request("https://api.test/canal")), null);
  const sesion = await middleware(new Request("https://api.test/canal", { headers: { authorization: `Bearer ${token}` } }));
  assertEquals(sesion?.id, "bot:ana");
  assertEquals(sesion?.role, "editor");
  const desdeEnv = jwtAuthMiddlewareFromEnv({ BOT_SECRET: SECRETO }, { secretEnv: "BOT_SECRET", now: AHORA });
  assertEquals((await desdeEnv(new Request("https://api.test", { headers: { authorization: `Bearer ${token}` } })))?.id, "bot:ana");
  assertThrowsMissingEnv();
});

/** La variable ausente falla antes de levantar el API. */
function assertThrowsMissingEnv(): void {
  let fallo = false;
  try {
    jwtAuthMiddlewareFromEnv({}, { secretEnv: "NO_EXISTE" });
  } catch (e) {
    fallo = e instanceof Error && e.message.includes("NO_EXISTE");
  }
  assert(fallo, "el error nombra la variable ausente");
}
