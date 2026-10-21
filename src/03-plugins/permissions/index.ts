/**
 * Plugin de permisos (servidor): DER grupos/roles/rolesusuario/acciones (ids string), vector de acciones,
 * `GET /permisos` (perfil; `?catalogo=1`), `PUT /permisos` (carga del DER) y CRUD/list del DER. Incluye también
 * el lado cliente. Dependencias: `zod` + `kysely`.
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 */
export * from "@Jeff-Aporta/DER/src/03-plugins/permissions/schemas.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/permissions/Objetos/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/permissions/Controladores/rules.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/permissions/Controladores/server.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/permissions/Controladores/client.ts";
