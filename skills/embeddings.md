# Skill: caché de embeddings (plugin de embeddings)

[← temario](README.md) · general: [plugins.md](plugins.md) · referencia: `docs/050-Plugins/020-Embeddings.md` · `cfg` completo: `README.md`

## Armar

```ts
// La caché va a su PROPIA SQLite (cfg.ruta o cfg.db); sin ruta trabaja en memoria (tests).
const emb = createServer(embeddingsServer, { db, cfg: { ruta: "datos/embeddings.sqlite", modelos: { "bge-m3": { id: "@cf/baai/bge-m3", dims: 1024, proveedor: "ai" } } }, services: { ai: workersAi(env.AI) } });
const router = createRouter(ctrls, { plugins: [emb] });
await router.seed();   // crea las tablas de la caché en SU base y embeddings_usuarios en la principal
```

Dos bases, no una: `embeddings_cache`, `embeddings_proyecciones`, `embeddings_contadores` y `embeddings_cursores` en la base de embeddings; `embeddings_usuarios` en la base principal. En tests o hosts con varias bases, inyecta `services.embeddingsDb` (una `Database` ya abierta) y el plugin la reutiliza. Para renombrar tablas en una base compartida: `Obj.insert(embeddingsServer, { entities: { cache: { table: "x_embeddings_cache" }, ... } })`.

## Usar

```ts
await emb.embeber({ items: [{ texto: "Café", entidad: "productos", id: 7 }] });   // documento
await emb.embeber({ items: [{ texto: "café", entidad: "productos", tipo: "consulta" }] });
await emb.buscar({ q: "café", entidades: ["productos"], filtros: { productos: { iempresa: 3 } } });
await emb.purgar({ simular: true });
await emb.estadisticas();
await emb.reglas();
await emb.alimentar();
// perfiles de usuario (base principal): no caducan; a los 720 días sin interacción pierden el vector
await emb.perfil({ iusuario: "beto", textos: ["compró café molido"], preferencias: { categoria: "café" } });
await emb.similares({ iusuario: "beto", limite: 5 });   // [{ iusuario, score, preferencias }]
```

## Caducidades (vienen puestas)

| Qué | Días | Regla / paso |
|---|---|---|
| Embeddings (caché) | 180 | regla `caducidad` (`edadDias`) |
| Caché sin hit (cada hit refresca) | 15 | regla `cache-sin-hit` (`sinHitsDias`) |
| Perfil de usuario sin interacción | 720 | paso `usuarios` (`usuarios.diasSinInteraccion`); conserva la fila y limpia el vector |

Se reemplazan declarando una regla con el mismo nombre; se apagan con `"activa": false`. `purgar({ simular: true })` informa también `usuarios: { dias, expirados, muestra }`.

## Reglas que no debes romper

- `entidad` en la caché es el **plural** de la entidad DER. Como la caché y las entidades están en bases distintas, `donde`/`huerfanos` se resuelven por ids contra la principal y se materializan en una tabla temporal (`cruce.ts`) antes de armar el predicado: nunca un join entre bases.
- Una regla nueva es JSON: nunca agregues un campo que lleve SQL. Operador nuevo = enum en `schemas.ts` + rama en `rules.ts` + prueba.
- `vectores.ts` define el espacio: cambiar `proyectar` o el PRNG exige subir `VERSION_PROYECCION` (hay un valor congelado en las pruebas).
- Toda sentencia cabe en 100 parámetros: troza con `trozos()`.
- El vector nunca sale por CRUD (`hidden`) y el texto no se guarda. Los perfiles de usuario se leen con SQL parametrizado (`usuarios.ts`), no con `query`, porque su `vector` está oculto.
- Con reducción activa, el índice externo debe tener las dimensiones de la proyección; el perfil de usuario se guarda en la proyección vigente del modelo.
- La base de embeddings se inyecta por `services.embeddingsDb` o se abre con `cfg.ruta`/`cfg.db`; nunca metas sus tablas en la base principal.

## Cuando usarla

- Quieres **busqueda semantica** (encontrar por significado, no por texto exacto) sobre lo que ya guardas.
- Necesitas **perfiles de usuario** por similitud de intereses.

```ts
await emb.embeber({ items: [{ texto: "cafe molido", entidad: "productos", id: 7 }] });
const { resultados } = await emb.buscar({ q: "café", entidades: ["productos"] });
```

## Como lo usa el CRM del estudio (api-crm)

- Busqueda de la bandeja (`GET /api/inbox/buscar?q=`): nombre, texto de mensajes, resumenes diarios y, si hay
  proveedor, semantica. Sin proveedor responde `semantica: false` y un `aviso`: la busqueda nunca se cae.
- La purga de la retencion configurable tambien purga embeddings.
- Variables: `EMBEDDINGS_URL`, `EMBEDDINGS_KEY`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_DIMS`.
