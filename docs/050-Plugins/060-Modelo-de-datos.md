---
Titulo: Modelo de datos de archivos, errores y penalizaciones
Estado: vigente
Autor:
tags: [plugins, diagramas, der, auditoria]
---
# Modelo de datos de archivos, errores y penalizaciones

[← índice](../README.md) · hoja generada: `deno task diagramas` (no editar a mano)

## Relaciones

- `archivos.icarpeta` → `archivos_carpetas.icarpeta`; `archivos_carpetas.ipadre` → `archivos_carpetas.icarpeta` (árbol).
- **Relación libre:** `archivos.origin` + `archivos.idorigin` apuntan a una fila de cualquier tabla (`errores` / `<ierror>`). No se dibuja como FK porque no lo es.
- **Propiedad:** `propietario_tipo` + `propietario`: un usuario, una página con su ruta o nadie. Tampoco es FK.
- `penalizaciones` no se relaciona con nada: su `id` es el vector (`errores:ip:<ip>`, `errores:global`).

## Auditoría común

`archivos`, `archivos_carpetas` y `errores` esparcen `COLUMNAS_AUDITORIA` (`src/03-plugins/common/auditoria.ts`): `propietario_tipo`, `propietario`, `apporigin`, `iporigin`, `fhcre`, `fhmod`.

## Diagrama ER

Payload declarativo para `<iswc-er-diagram>`:

```json
{
  "erDiagram": {
    "direction": "LR",
    "ratio": 1.4,
    "entities": [
      {
        "id": "archivos.carpeta",
        "name": "archivos/carpeta",
        "attributes": [
          {
            "name": "icarpeta",
            "type": "int",
            "key": "PK"
          },
          {
            "name": "ipadre",
            "type": "int",
            "key": "FK"
          },
          {
            "name": "nombre",
            "type": "varchar(200)"
          },
          {
            "name": "ruta",
            "type": "varchar(1000)"
          },
          {
            "name": "propietario_tipo",
            "type": "varchar(20)"
          },
          {
            "name": "propietario",
            "type": "varchar(400)"
          },
          {
            "name": "apporigin",
            "type": "varchar(120)"
          },
          {
            "name": "iporigin",
            "type": "varchar(64)"
          },
          {
            "name": "fhcre",
            "type": "datetime"
          },
          {
            "name": "fhmod",
            "type": "datetime"
          }
        ]
      },
      {
        "id": "archivos.archivo",
        "name": "archivo",
        "attributes": [
          {
            "name": "iarchivo",
            "type": "int",
            "key": "PK"
          },
          {
            "name": "icarpeta",
            "type": "int",
            "key": "FK"
          },
          {
            "name": "nombre",
            "type": "varchar(200)"
          },
          {
            "name": "clave",
            "type": "varchar(400)"
          },
          {
            "name": "mime",
            "type": "varchar(120)"
          },
          {
            "name": "bytes",
            "type": "int"
          },
          {
            "name": "ancho",
            "type": "int"
          },
          {
            "name": "alto",
            "type": "int"
          },
          {
            "name": "duracion",
            "type": "decimal"
          },
          {
            "name": "origin",
            "type": "varchar(60)"
          },
          {
            "name": "idorigin",
            "type": "varchar(120)"
          },
          {
            "name": "propietario_tipo",
            "type": "varchar(20)"
          },
          {
            "name": "propietario",
            "type": "varchar(400)"
          },
          {
            "name": "apporigin",
            "type": "varchar(120)"
          },
          {
            "name": "iporigin",
            "type": "varchar(64)"
          },
          {
            "name": "fhcre",
            "type": "datetime"
          },
          {
            "name": "fhmod",
            "type": "datetime"
          }
        ]
      },
      {
        "id": "errores.error",
        "name": "error",
        "attributes": [
          {
            "name": "ierror",
            "type": "int",
            "key": "PK"
          },
          {
            "name": "titulo",
            "type": "varchar(200)"
          },
          {
            "name": "descripcion",
            "type": "text"
          },
          {
            "name": "transcripcion",
            "type": "text"
          },
          {
            "name": "severidad",
            "type": "varchar(10)"
          },
          {
            "name": "estado",
            "type": "varchar(12)"
          },
          {
            "name": "ruta",
            "type": "varchar(1000)"
          },
          {
            "name": "url",
            "type": "varchar(2000)"
          },
          {
            "name": "html",
            "type": "text"
          },
          {
            "name": "contexto",
            "type": "json"
          },
          {
            "name": "atendido_por",
            "type": "varchar(120)"
          },
          {
            "name": "ftoma",
            "type": "datetime"
          },
          {
            "name": "avance",
            "type": "json"
          },
          {
            "name": "propietario_tipo",
            "type": "varchar(20)"
          },
          {
            "name": "propietario",
            "type": "varchar(400)"
          },
          {
            "name": "apporigin",
            "type": "varchar(120)"
          },
          {
            "name": "iporigin",
            "type": "varchar(64)"
          },
          {
            "name": "fhcre",
            "type": "datetime"
          },
          {
            "name": "fhmod",
            "type": "datetime"
          }
        ]
      },
      {
        "id": "penalizaciones.penalizacion",
        "name": "penalizacion",
        "attributes": [
          {
            "name": "id",
            "type": "varchar(200)",
            "key": "PK"
          },
          {
            "name": "intentos",
            "type": "json"
          },
          {
            "name": "fhmod",
            "type": "datetime"
          }
        ]
      }
    ],
    "relations": [
      {
        "id": "archivos.carpeta.padre",
        "from": "archivos.carpeta",
        "to": "archivos.carpeta",
        "fromCard": "many",
        "toCard": "one",
        "label": "padre",
        "identifying": false
      },
      {
        "id": "archivos.archivo.carpeta",
        "from": "archivos.archivo",
        "to": "archivos.carpeta",
        "fromCard": "many",
        "toCard": "one",
        "label": "carpeta",
        "identifying": false
      }
    ]
  }
}
```
