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
