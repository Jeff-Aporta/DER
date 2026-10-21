import { assertEquals, assertRejects } from "@std/assert";
import {
  b64urlDecode,
  b64urlEncode,
  generateEs256KeyPair,
  importEs256PrivateKey,
  importEs256PublicKey,
  signJwtEs256,
  verifyJwtEs256,
} from "@Jeff-Aporta/DER/src/03-plugins/identity/Controladores/crypto.ts";

Deno.test("es256: sign/verify round-trip", async () => {
  const { privateKey, publicKey } = await generateEs256KeyPair();
  const claims = { sub: "admin", jti: "abc", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 };
  const token = await signJwtEs256(claims, privateKey, "kid-1");
  const h = token.split(".")[0]!;
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  assertEquals(header.alg, "ES256");
  assertEquals(header.kid, "kid-1");
  const parsed = await verifyJwtEs256(token, publicKey);
  assertEquals(parsed.sub, "admin");
});

Deno.test("es256: token manipulado se rechaza", async () => {
  const { privateKey, publicKey } = await generateEs256KeyPair();
  const claims = { sub: "admin", jti: "abc", iat: 1, exp: 9999999999 };
  const token = await signJwtEs256(claims, privateKey);
  const parts = token.split(".");
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]!)));
  payload.sub = "root";
  const tampered = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const mal = [parts[0]!, tampered, parts[2]!].join(".");
  await assertRejects(() => verifyJwtEs256(mal, publicKey), Error, "firma");
});

Deno.test("es256: JWK export/import round-trip", async () => {
  const { privateKey, publicKey } = await generateEs256KeyPair();
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  assertEquals(jwk.kty, "EC");
  assertEquals(jwk.crv, "P-256");
  const pub = await importEs256PublicKey(jwk);
  const privJwk = await crypto.subtle.exportKey("jwk", privateKey);
  const priv = await importEs256PrivateKey(privJwk);
  const claims = { sub: "x", jti: "j", iat: 1, exp: 9999999999 };
  const token = await signJwtEs256(claims, priv);
  assertEquals((await verifyJwtEs256(token, pub)).sub, "x");
});
