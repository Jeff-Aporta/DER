import { assertEquals } from "@std/assert";
import { createRouter, type Database, type Router, ServerController } from "@Jeff-Aporta/DER/src/02 controllers/server/mod.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02 controllers/server/sqlite/mod.ts";
import { pluginsFromConfig } from "@Jeff-Aporta/DER/src/03 plugins/mod.ts";
import { CategoriaEntity } from "@Jeff-Aporta/DER/examples/domain.ts";
import { b64urlDecode, importEs256PublicKey, verifyJwtEs256 } from "@Jeff-Aporta/DER/src/03 plugins/identity/Controladores/crypto.ts";

const SECRET = "una-secret-key-de-pruebas-con-mas-de-32-caracteres";

async function setupEs256() {
  const db: Database = sqliteDatabase();
  const c = new ServerController(CategoriaEntity, { db, table: "categorias" });
  const plugins = pluginsFromConfig(
    { identity: { secret: SECRET, jwt: { alg: "ES256", kid: "usrs" }, admin: { usuario: "admin", password: "admin-12345" } } },
    { db },
  );
  const router = createRouter([c], { basePath: "/api", plugins });
  await router.seed();
  return { db, router };
}

const call = async (router: Router, method: string, path: string, body?: unknown) => {
  const res = await router.fetch(new Request("http://t/api/" + path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

Deno.test("es256 integración: login firma ES256 y JWKS expone la llave pública", async () => {
  const { db, router } = await setupEs256();
  try {
    // login → token ES256
    const login = await call(router, "POST", "login", { usuario: "admin", password: "admin-12345" });
    assertEquals(login.status, 200);
    const token: string = login.data.token;
    const [h] = token.split(".");
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h!)));
    assertEquals(header.alg, "ES256");
    assertEquals(header.kid, "usrs");

    // JWKS expone la pública
    const jwks = await call(router, "GET", ".well-known/jwks.json");
    assertEquals(jwks.status, 200);
    assertEquals(jwks.data.keys.length, 1);
    const jwk = jwks.data.keys[0];
    assertEquals(jwk.kty, "EC");
    assertEquals(jwk.crv, "P-256");
    assertEquals(jwk.kid, "usrs");

    // verifica el token con la pública del JWKS
    const pub = await importEs256PublicKey(jwk);
    const claims = await verifyJwtEs256(token, pub);
    assertEquals(claims.sub, "admin");
    assertEquals(claims.jti.length > 0, true);
  } finally {
    db.destroy();
  }
});
