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

`createServer` valida `cfg` con Zod, resuelve `"env:NOMBRE"`, y falla si un path no tiene `handler` ni `sse`.

## Las tres puertas del registro

```ts
registry.secure({
  extract: (req) => sesionDesde(req),                        // sin esta, NO hay seguridad (todo se sirve)
  protected: (info) => info !== null,                        // default
  permissions: (info, action, entity, { method, route }) => ({ allowed: true, value: true }),
});
```

El consumidor puede definir cualquiera; los plugins solo aportan implementaciones (identidad → `extract`; permisos → `permissions`) y nunca pisan las del consumidor. Son herméticos: identidad sin permisos y al revés funcionan.
