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

## Norma

[ESTANDAR — ecosistema VPS](https://github.com/Jeff-Aporta/dsh-dev-vps/blob/main/ESTANDAR.md): norma única; gana sobre este repo si hay conflicto.
