/**
 * Plugin de permisos (servidor): DER grupos/roles/rolesusuario/acciones (ids string), vector de acciones,
 * `GET /permisos` (perfil; `?catalogo=1`), `PUT /permisos` (carga del DER) y CRUD/list del DER. Incluye también
 * el lado cliente. Dependencias: `zod` + `kysely`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/Controllers@main/docs/README.md
 */
export * from "./schemas.ts";
export * from "./Objetos/mod.ts";
export * from "./Controladores/rules.ts";
export * from "./Controladores/server.ts";
export * from "./Controladores/client.ts";
