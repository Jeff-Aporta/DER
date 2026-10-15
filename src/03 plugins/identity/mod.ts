/**
 * Plugin de identidad (servidor): usuarios (id único string), hash PBKDF2 con secret key, JWT HS384,
 * `POST /login`, `DELETE /logout`. Incluye también el lado cliente. Dependencias: `zod` + `kysely`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/Controllers@main/docs/README.md
 */
export * from "./schemas.ts";
export * from "./Objetos/mod.ts";
export * from "./Controladores/crypto.ts";
export * from "./Controladores/server.ts";
export * from "./Controladores/client.ts";
