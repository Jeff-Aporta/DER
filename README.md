# DER

Schemas JSON → POJOs tipados (Zod) → controllers REST compartidos entre el client (fetch) y el server
(SQL agnóstico: PostgreSQL / SQLite). Deno primero, sin build, consumible por CDN.

**Documentación (punto de entrada, también para agentes LLM): [docs/README.md](docs/README.md)**

```bash
deno task check     # tipos de todas las entradas
deno task test      # unit + SQLite + PostgreSQL (PGlite) + HTTP + guardianes de arquitectura
deno task example   # servidor de ejemplo en :8000/api
```
