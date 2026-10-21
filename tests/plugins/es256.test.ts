/** JWT ES256 (ECDSA P-256 + JWK): firma/verificación puras y la integración (login firma ES256, el JWKS expone la pública). */
import { assertEquals, assertRejects } from "@std/assert";
import { ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { b64urlDecode, b64urlEncode, generateEs256KeyPair, importEs256PrivateKey, importEs256PublicKey, signJwtEs256, verifyJwtEs256 } from "@Jeff-Aporta/DER/src/03-plugins/common/crypto.ts";
import { CategoriaEntity } from "@Jeff-Aporta/DER/examples/domain.ts";
import { apiConPlugins, call, identityCfg } from "@Jeff-Aporta/DER/tests/_util.ts";

Deno.test("es256: sign/verify round-trip, header con kid, token manipulado se rechaza, JWK export/import", async () => {
  const { privateKey, publicKey } = await generateEs256KeyPair();
  const claims = { sub: "admin", jti: "abc", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = await signJwtEs256(claims, privateKey, "kid-1");
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(token.split(".")[0]!)));
  assertEquals([header.alg, header.kid], ["ES256", "kid-1"]);
  assertEquals((await verifyJwtEs256(token, publicKey)).sub, "admin");
  const parts = token.split(".");
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]!)));
  payload.sub = "root";
  const mal = [parts[0]!, b64urlEncode(new TextEncoder().encode(JSON.stringify(payload))), parts[2]!].join(".");
  await assertRejects(() => verifyJwtEs256(mal, publicKey), Error, "firma");
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  assertEquals([jwk.kty, jwk.crv], ["EC", "P-256"]);
  const priv = await importEs256PrivateKey(await crypto.subtle.exportKey("jwk", privateKey));
  assertEquals((await verifyJwtEs256(await signJwtEs256({ sub: "x", jti: "j", iat: 1, exp: 9999999999 }, priv), await importEs256PublicKey(jwk))).sub, "x");
});

Deno.test("es256 integración: login firma ES256 y JWKS expone la llave pública", async () => {
  const db = sqliteDatabase();
  const { router, cerrar } = await apiConPlugins(db, [new ServerController(CategoriaEntity, { db, table: "categorias" })], { identity: identityCfg({ jwt: { alg: "ES256", kid: "usrs" } }) });
  try {
    const login = await call(router, "POST", "usuarios/login", { body: { usuario: "admin", password: "admin-12345" } });
    assertEquals(login.status, 200);
    const token: string = login.data.token;
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(token.split(".")[0]!)));
    assertEquals([header.alg, header.kid], ["ES256", "usrs"]);
    const jwks = await call(router, "GET", ".well-known/jwks.json");
    assertEquals([jwks.status, jwks.data.keys.length], [200, 1]);
    const jwk = jwks.data.keys[0];
    assertEquals([jwk.kty, jwk.crv, jwk.kid], ["EC", "P-256", "usrs"]);
    const claims = await verifyJwtEs256(token, await importEs256PublicKey(jwk));
    assertEquals([claims.sub, claims.jti.length > 0], ["admin", true]);
  } finally {
    await cerrar();
  }
});
