/**
 * Plugin de identidad (cliente): `IdentityClient` (login/logout, token, CRUD de usuarios), objetos y contratos.
 * Dependencias: sólo `zod`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/schemas.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/Objetos/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/identity/Controladores/client.ts";
