# DER

Schemas JSON → POJOs tipados (Zod) → controllers REST compartidos entre el client (fetch) y el server
(SQL agnóstico: PostgreSQL / PGlite / SQLite / MySQL / MSSQL), con plugins de seguridad como JSON. Deno primero, sin build, consumible por CDN.

**Documentación (punto de entrada, también para agentes LLM): [docs/README.md](docs/README.md)**
**Specs fundación (el WHAT desde el que se reconstruye `src/`): [specs/FOUNDATION.md](specs/FOUNDATION.md)**

```bash
deno task check     # tipos de todas las entradas, examples y tests
deno task test      # unit + SQLite + PostgreSQL (PGlite) + SQL de MySQL/MSSQL + HTTP + plugins + guardianes de arquitectura
deno task example   # servidor de ejemplo en :8000/api
```

## Plugin de embeddings

Caché declarativa de embeddings: el estándar de DER para buscar por significado. Optimiza todo el sistema (un texto conocido no vuelve a llamar al modelo) y se depura con los mismos JSON de DER, sin SQL. Referencia completa: [docs/050-Plugins/020-Embeddings.md](docs/050-Plugins/020-Embeddings.md) · skill: [skills/embeddings.md](skills/embeddings.md).

```ts
import { createServer } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { embeddingsServer, workersAi } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/server.ts";

const emb = createServer(embeddingsServer, { db, cfg, services: { ai: workersAi(env.AI) } });
const router = createRouter(ctrls, { basePath: "/api", plugins: [auth, permisos, emb] });
await router.seed();

await emb.embeber({ items: [{ texto: "Café de origen", entidad: "productos", id: 7 }] }); // miss: llama al modelo
await emb.buscar({ q: "café", entidades: ["productos"] });                               // exacta primero, luego embeddings
await emb.purgar({ simular: true });                                                      // qué borraría
await emb.purgar();                                                                       // cron o bajo demanda
```

`cfg` completo (lo valida Zod; las columnas de `donde` se validan además contra la definición de cada entidad):

```json
{
  "modelos": {
    "bge-m3": {
      "id": "@cf/baai/bge-m3",
      "dims": 1024,
      "proveedor": "ai",
      "lote": 32,
      "maxTexto": 4000,
      "reduccion": { "metodo": "aleatoria", "dims": 256, "decimales": 3, "semilla": 20261031 }
    }
  },
  "normalizacion": { "minusculas": true },
  "alimentacion": {
    "productos": { "columnas": ["nombre", "sku", "categoria"], "etiquetas": { "nombre": "Producto", "sku": "SKU" }, "lote": 50 },
    "mensajes": { "columnas": ["contenido"], "donde": { "bactivo": true }, "lote": 20 }
  },
  "busqueda": {
    "exactas": { "productos": ["nombre", "sku"], "usuarios": ["iusuario", "nombre"] },
    "limite": 10,
    "minScore": 0.35,
    "maxCandidatos": 2000
  },
  "purga": {
    "general": { "sinHitsDias": 90 },
    "obsoletas": true,
    "lote": 500,
    "maxLotes": 20,
    "reglas": [
      {
        "nombre": "mensajes-inactivos",
        "descripcion": "limpiar el cache de todos los mensajes bactivo false con más de 3 dias de que no hay hits",
        "prioridad": 10,
        "alcance": { "entidad": "mensajes" },
        "sinHitsDias": 3,
        "donde": [{ "columna": "bactivo", "op": "eq", "valor": false }]
      },
      { "nombre": "mensajes-huerfanos", "prioridad": 20, "alcance": { "entidad": "mensajes" }, "huerfanos": true },
      { "nombre": "busquedas-productos", "prioridad": 30, "alcance": { "entidad": "productos", "tipo": "consulta" }, "sinHitsDias": 14 },
      { "nombre": "usuarios-largo", "prioridad": 40, "alcance": { "entidad": "usuarios", "tipo": "documento" }, "sinHitsDias": 365, "excluirDeGeneral": true },
      { "nombre": "presion-consultas", "soloPresion": true, "alcance": { "tipo": "consulta" } },
      { "nombre": "presion-mensajes-frios", "soloPresion": true, "alcance": { "entidad": "mensajes" }, "hitsMenorQue": 2 }
    ],
    "presion": {
      "maxFilas": 200000,
      "maxBytes": 200000000,
      "objetivoPct": 80,
      "orden": ["presion-consultas", "presion-mensajes-frios"],
      "ultimoRecurso": "lru"
    }
  }
}
```

- **Tablas:** `embeddings_cache` (referencia `tipo` + `entidad` + `id`, `huella` SHA-256 del texto, `modelo` y `dims` como columnas, `iproyeccion`, `vector`, `bytes`, `hits`, `fultimohit`, `fcreado`), `embeddings_proyecciones`, `embeddings_contadores` y `embeddings_cursores`. El texto nunca se guarda.
- **Reducción sugerida:** `{ "metodo": "aleatoria", "dims": 256, "decimales": 3 }` guarda 1024 float32 (5462 caracteres) en 683: 12.5 %. La proyección queda en la tabla y se aplica igual a documentos y consultas. Mídela con tus datos antes de activarla en producción.
- **Depuración:** `GET embeddings/entradas?q=<base64url>` con el JSON de consulta de DER (o `emb.controllers.cache.query(...)`), `GET embeddings/estadisticas`, `GET embeddings/reglas` y `POST embeddings/purgar { "simular": true }`.

## Norma

[ESTANDAR — ecosistema VPS](https://github.com/Jeff-Aporta/dsh-dev-vps/blob/main/ESTANDAR.md): norma única; gana sobre este repo si hay conflicto.
