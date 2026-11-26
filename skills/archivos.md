# Skill: gestión de archivos

[← temario](README.md) · referencia: `docs/050-Plugins/030-Archivos.md` · relacionadas: [errores.md](errores.md), [plugins.md](plugins.md)

Carpetas y archivos como en un sistema de ficheros. DER guarda las filas y firma las URLs; **los bytes los mueve el almacén que vincula la API** (cualquier servicio). Nada en el plugin nombra una tecnología.

## Montar

```ts
const almacen: AlmacenArchivos = {
  subir: (clave, bytes, { mime, nombre }) => miServicio.put(clave, bytes, { mime, nombre }),
  bajar: async (clave) => { const o = await miServicio.get(clave); return o && { cuerpo: o.body, mime: o.mime, bytes: o.size }; },
  borrar: (clave) => miServicio.delete(clave),
};
const archivos = createServer(archivosServer, { db, cfg: { secret: "env:JWT_SECRET" }, services: { almacen, politicaArchivos } });
```

`politicaArchivos` (opcional): `limiteBytes(ctx)`, `alSubir(q, ctx)` (autoriza lanzando error; devuelve `prefijo` de la clave y `extras`, columnas propias del consumidor) y `puedeVer(archivo, ctx)`. Sin ella hace falta sesión y se ve lo propio o lo que no tiene dueño usuario.

Columnas propias o tabla con prefijo: `Obj.insert(archivosServer, { entities: { archivos: { table: "mi_archivos", schema: { columns: { iempresa: { type: "int" } } } } } })`.

## Los almacenes que ya trae DER

| almacen | donde | cuando |
|---|---|---|
| `r2Almacen(bucket)` | Cloudflare R2 | el consumidor es un Worker (meta `der-expira` + purga con `r2PurgeExpired`) |
| `discoAlmacen(carpeta)` | una carpeta del disco | el consumidor corre en un servidor propio (meta al lado del fichero + purga con `purgarDisco`) |

Los dos cumplen el mismo contrato `AlmacenArchivos`, así que el plugin no cambia. `discoAlmacen` deja **30 días de vida por defecto** (`TTL_DISCO_30D`) y `purgarDisco` borra lo vencido:

```ts
const archivos = createServer(archivosServer, {
  db,
  cfg: { secret: "env:JWT_SECRET" },
  services: { almacen: discoAlmacen("datos/archivos", { ttlSeg: 30 * 86400 }) },
});
// y de vez en cuando:
await purgarDisco("datos/archivos", { ttlSeg: 30 * 86400 });
```

## Relacionar con otra tabla

`origin` + `idorigin` enlazan un archivo con una fila de cualquier tabla, sin FK rígida: `origin: "errores", idorigin: "17"`.

```ts
await archivos.guardar({ bytes, nombre, mime, origin: "errores", idorigin: "17" }, ctx);   // desde el server
await archivos.archivosDe("errores", [17]);
await archivos.olvidarDe("errores", [17]);   // borra filas y objetos
await cliente.controllers.archivos.query({ where: { origin: "errores", idorigin: "17" } });
```

## Rutas

| Ruta | Qué hace |
|---|---|
| `POST archivos/subir?nombre=&icarpeta=&origin=&idorigin=&…` | cuerpo binario con `x-archivo-mime`, o multipart; rechaza vacíos, excesos y ejecutables |
| `GET archivo/{id}/url` | el archivo con URL firmada de corta vida |
| `GET archivos/descarga?clave=&exp=&sig=` | pública pero firmada: sirve en `<img>` y `<audio>` |
| `POST archivo/{id}/mover` | cambia de carpeta (`icarpeta: null` = raíz) |
| `GET archivos/arbol[?icarpeta=]` | subcarpetas y archivos de una carpeta: lo que pinta un explorador |
| CRUD `archivos`, `archivos/carpetas` | administrar; borrar una fila borra su objeto |

La `ruta` de una carpeta la deriva el server del padre; `(ipadre, nombre)` es único.

## Reglas

- Sin transacciones en algunos motores: primero el objeto y luego la fila; si la fila falla, se borra el objeto.
- `clave` es interna: al cliente se le da la URL firmada.
- Auditoría en cada fila: ver [plugins.md](plugins.md#auditoría).

## Cuando usarla

- Hay que **guardar bytes** (adjuntos del chat, avatares, capturas de errores) y servir los con URLs firmadas.
- Necesitas **relacionar un archivo con cualquier tabla** sin FK (`origin` + `idorigin`).
- Quieres caducidad (30 dias) y purga de lo vencido sin escribir un sistema de archivos.

```ts
const fila = await archivos.guardar({ bytes, nombre, mime, origin: "atencion", idorigin: mensaje.id }, ctx);
const url = await archivos.publico(fila, ctx);   // firmada, caduca
```

## Como lo usa el CRM del estudio (api-crm)

- Adjuntos del chat: origen `atencion`, `idorigin` = mensaje o chat; el mensaje guarda `{ iarchivo, url, nombre, mime,
  bytes, duracion?, transcripcion? }`.
- Avatares: origen `crm-avatar`, `idorigin` = `iusuario` (se reemplaza con `olvidarDe`).
- 30 dias de vida en disco: el API **renueva la firma** al abrir el chat (`GET /api/adjuntos/url`) y guarda el texto de
  las notas en su base (el audio puede caducar).
