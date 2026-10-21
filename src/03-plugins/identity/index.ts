/**
 * Plugin de identidad (servidor): usuarios (id único string), hash PBKDF2 con secret key, JWT HS384,
 * `POST /login`, `DELETE /logout`. Incluye también el lado cliente. Dependencias: `zod` + `kysely`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/schemas.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/Objetos/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/Controladores/crypto.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/Controladores/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/Controladores/client.ts";
