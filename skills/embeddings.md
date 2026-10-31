# Skill: caché de embeddings (plugin de embeddings)

[← temario](README.md) · general: [plugins.md](plugins.md) · referencia: `docs/050-Plugins/020-Embeddings.md` · `cfg` completo: `README.md`

## Armar

```ts
const emb = createServer(embeddingsServer, { db, cfg: { modelos: { "bge-m3": { id: "@cf/baai/bge-m3", dims: 1024, proveedor: "ai" } } }, services: { ai: workersAi(env.AI) } });
const router = createRouter(ctrls, { plugins: [emb] });
await router.seed();
```

Con base compartida, renombra tablas con `Obj.insert(embeddingsServer, { entities: { cache: { table: "x_embeddings_cache" }, proyecciones: { table: "x_embeddings_proyecciones" }, contadores: { table: "x_embeddings_contadores" }, cursores: { table: "x_embeddings_cursores" } } })`.

## Usar

```ts
await emb.embeber({ items: [{ texto: "Café", entidad: "productos", id: 7 }] });   // documento
await emb.embeber({ items: [{ texto: "café", entidad: "productos", tipo: "consulta" }] });
await emb.buscar({ q: "café", entidades: ["productos"], filtros: { productos: { iempresa: 3 } } });
await emb.purgar({ simular: true });
await emb.estadisticas();
await emb.reglas();
await emb.alimentar();
```

## Reglas que no debes romper

- `entidad` en la caché es el **plural** de la entidad DER: las reglas con `donde` lo resuelven a su controller en la misma base.
- Una regla nueva es JSON: nunca agregues un campo que lleve SQL. Operador nuevo = enum en `schemas.ts` + rama en `rules.ts` + prueba.
- `vectores.ts` define el espacio: cambiar `proyectar` o el PRNG exige subir `VERSION_PROYECCION` (hay un valor congelado en las pruebas).
- Toda sentencia cabe en 100 parámetros: troza con `trozos()`.
- El vector nunca sale por CRUD (`hidden`) y el texto no se guarda.
- Con reducción activa, el índice externo debe tener las dimensiones de la proyección.
