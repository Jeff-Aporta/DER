# Skill: plugins JSON (createClient / createServer, paths, puertas)

[← temario](README.md) · referencia: `docs/050-Plugins/010-Seguridad.md` · entidades concretas: [identity.md](identity.md), [permissions.md](permissions.md)

## Anatomía

```
plugin/
  schemas.ts   tipos (uno por línea) y Zod compartidos (solo zod)
  index.ts     el JSON TRANSVERSAL (PluginDef): entities + irregularPaths
  server.ts    Obj.insert(transversal, { particularidades del server })
```

```ts
export const miPlugin: PluginDef = {
  name: "mi",
  entities: {
    cosas: {
      singular: "cosa", plural: "cosas", schema: { columns: { ... } },
      exposed: true,            // ¿se publica por API?           (explícito)
      administrable: true,      // ¿admite escrituras por CRUD?   (explícito; false = solo lectura)
      security: true,
      paths: {                  // irregulares DE LA ENTIDAD
        activar:  { method: "POST", path: "activar", prefix: "singular", pks: true, security: "protected" },   // cosa/{id}/activar
        resumen:  { method: "GET",  path: "resumen" },                                                            // cosas/resumen (prefix plural por defecto)
      },
    },
  },
  irregularPaths: {           // los que NO pertenecen a ninguna entidad
    salud: { method: "GET", path: "mi/salud", ops: { salud(this: ClientPlugin) { return this.call("salud"); } } },
  },
};
export const miPluginServer: ServerPluginDef = Obj.insert(miPlugin, {
  cfg: ZMiConfig,
  entities: { cosas: { hidden: ["secreto"], paths: { activar: { async handler(this: ServerPlugin, { pks }, ctx) { ... } }, resumen: { handler() { ... } } } } },
  irregularPaths: { salud: { handler() { return { ok: true }; } } },
  security: { permissions(this: ServerPlugin, info, action, entity, { method }) { ... } },
  async seed(this: ServerPlugin) { ... },
});
```

- `ops` de un path son funciones con `this` = el plugin armado; quedan como métodos (`auth.login(...)`). Pueden ser de cliente (en `index.ts`) o de server (en `server.ts`).
- Lo transversal de la entidad va a la `Entity`; lo demás (`hidden`, `actions`, `expose`, `sse`, handlers) a la config del `ServerController`.

## Armar

```ts
// client (solo zod)
const mi = createClient(miPlugin, { baseUrl: "/api", headers: auth.headers });
await mi.call("activar", { motivo: "x" }, { id: "7" });    // o un pojo como tercer argumento
mi.controllers.cosas.query({ ... });  mi.salud();  mi.token;  mi.setToken(t);

// server
const mi = createServer(miPluginServer, { db, cfg: { secret: "env:X" }, env });
const router = createRouter(ctrls, { plugins: [mi] });   // registra sus controllers y rutas; sus puertas entran si no hay otras
await router.seed();
```

`createServer` valida `cfg` con Zod, resuelve `"env:NOMBRE"`, y falla si un path no tiene `handler` ni `sse`. Lo que no es JSON (bindings, proveedores) va en `services` y queda en `plugin.services`; `cfg` lo nombra por clave.

## Las tres puertas del registro

```ts
registry.secure({
  extract: (req) => sesionDesde(req),                        // sin esta, NO hay seguridad (todo se sirve)
  protected: (info) => info !== null,                        // default
  permissions: (info, action, entity, { method, route }) => ({ allowed: true, value: true }),
});
```

El consumidor puede definir cualquiera; los plugins solo aportan implementaciones (identidad → `extract`; permisos → `permissions`) y nunca pisan las del consumidor. Son herméticos: identidad sin permisos y al revés funcionan.

## Servicios del consumidor

DER define datos, rutas y helpers; **no ejecuta servicios externos**. Lo externo lo vincula cada API. El orden de búsqueda es `services` del plugin y luego el singleton:

```ts
servicios.configurar({ credenciales: { llm: { apiKey: "env:LLM_KEY" }, agente: { url: "env:AGENTE_URL", apiKey: "env:AGENTE_KEY" } } }, env);
servicios.vincular("almacen", miAlmacen);
servicios.credencial("agente")?.["url"];   // un env: sin definir queda fuera: el servicio es opcional
```

## JWT HS256 para bots

El helper es independiente de la base de datos y del plugin de identidad:

```ts
import { jwtAuthMiddlewareFromEnv, jwtSecurityHooks, signJwtHs256 } from "@Jeff-Aporta/DER/src/03-plugins/common/jwt.ts";

const token = await signJwtHs256({ sub: "bot:ana", canales: ["general"] }, env.JWT_SECRET, { expiresIn: 3600, issuer: "bots" });
registry.secure(jwtSecurityHooks({ secret: env.JWT_SECRET, issuer: "bots" }));
// o, sin tocar el registro: const auth = jwtAuthMiddlewareFromEnv(env, { issuer: "bots" });
```

`verifyJwtHs256` acepta sólo `HS256`, exige `sub` y `exp`, y puede comprobar `iss` y `aud`. `signJwtHs256` añade `iat` y `exp` (una hora por defecto). `jwtAuthMiddleware` lee `Authorization: Bearer`; sin cabecera devuelve `null` y un token inválido produce 401. El secreto debe tener al menos 32 caracteres.

## Cloudflare R2

`r2Almacen(bucket)` implementa el contrato `AlmacenArchivos` del plugin de archivos y añade una caducidad por objeto:

```ts
const almacen = r2Almacen(env.FILES);                    // TTL: 72 horas
const ficha = await almacen.subirConCaducidad(clave, bytes, { mime: "image/png", nombre: "a.png" });
export const scheduled = r2CronHandler(env.FILES);       // purga los vencidos
```

La caducidad se guarda en el metadato `der-expira` (epoch en segundos). Al bajar, un objeto vencido se borra y no se entrega. Para el borrado automático real, el Worker debe ejecutar `r2CronHandler` con un trigger Cron y, como red de seguridad, el bucket R2 debe tener una regla de lifecycle que elimine objetos a los 3 días. R2 no ofrece una caducidad nativa por objeto: el helper aplica esa política en lectura y purga.

## Proveedor de LLM

`proveedorLlm({ credencial, acciones, reglas })` no llama a ningún modelo: el consumidor escribe cada acción con su API y su credencial, y las reglas dicen qué hacer por mime. `dataUrl` y `entradaConImagenes` arman la entrada multimodal de un modelo tipo «responses».

## Auditoría

Entidad con dueño: `...COLUMNAS_AUDITORIA` en sus columnas (`propietario_tipo`, `propietario`, `apporigin`, `iporigin`, `fhcre`, `fhmod`), `selloAlta(ctx, { apporigin, pagina, ip })` al crear y `selloCambio()` al modificar. La IP real sale de `ipReal(plugin, req)`.
