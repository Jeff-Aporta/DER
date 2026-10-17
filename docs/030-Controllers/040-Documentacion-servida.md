---
Titulo: Documentación servida (/doc)
Estado: vigente
Autor:
tags: [controllers, doc]
---
# Documentación servida (`/doc` y `/doc?v=1`)

[← índice](../README.md) · `src/02 controllers/server/doc.ts` · tipos `DocSources`, `DocSheet`, `DocViewOptions` en `src/02 controllers/server/schemas.ts`

Cada controller expone su documentación para que humanos y agentes LLM se contextualicen. La base es **siempre el md autogenerado** (una utilidad de la librería). El controller solo agrega secciones.

| Ruta | Respuesta |
|---|---|
| `GET plural/doc` | `text/markdown`: contrato autogenerado de la entidad + las fuentes `doc` concatenadas como secciones |
| `GET plural/doc?v=1` | `text/html`: esa misma doc en `<iswc-md-docs-vault>` |
| `GET {base}/doc` | índice autogenerado del API + las fuentes de `RouterOptions.doc` como secciones |
| `GET {base}/doc?v=1` | el libro del API: el índice y una hoja por entidad (`productos.md`, `pedido-lineas.md`…) |

## Md autogenerado

Se genera desde la definición compartida de la entidad: rutas (con `basePath`), columnas (tipo, pk, nulos, default, enum, molde Zod), relaciones, endpoints especiales, `/cfg`, consulta y verificaciones. Utilidades: `entityContractMd(entity, { table, basePath })` y `apiIndexMd(entities, basePath)`.

## Secciones: rutas `.md` para concatenar

```ts
new ServerController(ProductoEntity, {
  db, table: "productos",
  doc: [new URL("./docs/productos.md", import.meta.url).href, "docs/productos-faq.md"],
  docBase: new URL("./", import.meta.url),   // base de las rutas relativas (default: cwd)
});
// también en la entidad (compartido): defineEntity({ ..., doc: ["https://.../productos.md"] })
// o calculado: doc() { return [...]; }
createRouter(ctrls, { basePath: "/api", doc: ["docs/README.md"], docView: { title: "Mi API" } });
```

- Cada fuente puede ser una ruta local (relativa a `docBase` o al cwd), un `file:` o una URL http(s); es indistinto: el server lee el archivo o hace el fetch.
- Se concatenan **en orden** al final del md autogenerado. Sus encabezados bajan un nivel (`#` → `##`) para quedar como secciones; los bloques de código no se tocan. Utilidades: `composeDoc` y `demoteHeadings`.

## Vista (`/doc?v=1`)

- Página con el patrón de `ISS-AyudasCPIA/docs/index.html`: el kit is-webcomponents por CDN **pineado por SHA de 40** (default `ISWC_PIN`, el mismo de ISS), `initApp` (tema y paleta), loader e `iswc-md-docs-vault` con las hojas embebidas.
- Los datos van en un `<script type="application/json">` con `<`, U+2028 y U+2029 escapados: un `</script>` dentro de un markdown no rompe la página.
- `docView: { pin, title, theme, palette }` en `RouterOptions` personaliza la vista.

## Client

`await ctrl.doc()` hace `GET plural/doc` y devuelve el texto.

## Diagramas del DER (payload para ISWC)

Cada `/doc` incluye un **payload declarativo** derivado de la definición compartida de las entidades
(columnas, relaciones, cardinalidades y propagación). No dibuja: sólo produce el JSON que consumen
`<iswc-er-diagram>` y `<iswc-class-diagram>` del kit is-webcomponents.

| Función | Salida |
| --- | --- |
| `erDiagramPayload(entities, opts)` | `{ "erDiagram": { entities, relations } }` |
| `classDiagramPayload(entities, opts)` | `{ "classDiagram": { classes, relations } }` |
| `diagramPayloads(entities, opts)` | `{ er, class }` (los dos) |

Reglas de la traducción:

| Definición DER | Payload |
| --- | --- |
| `kind: "one"` (N:1) | `fromCard: "many"`, `toCard: "one"` |
| `kind: "many"` (1:N) | `fromCard: "one"`, `toCard: "many"` |
| columna `pk: true` | atributo con `key: "PK"` |
| columna local de `on` | atributo con `key: "FK"` |
| relación en `propagations` | `dashStyle: "dashed"` (ER) y `kind: "dependency"` (clases), etiqueta «propaga» |
| `nullableCards: true` + FK nullable | `zeroOrOne` / `zeroOrMany` |

```ts
import { diagramPayloads } from "@Jeff-Aporta/DER/src/01 objects/diagram.ts";
const { er, class: cls } = diagramPayloads([ProductoEntity, PedidoEntity, LineaEntity], {
  title: "Dominio",
  propagations: { pedido: ["lineas"] },
});
```

En el markdown de `/doc` va como bloque `json` (para agentes); en `/doc?v=1` se puede incrustar
dentro de `<script type="application/json">` del componente. `entityContractMd` incluye el subgrafo
de la entidad (ella y sus destinos directos); `apiIndexMd` incluye los dos diagramas completos.
Se desactivan con `{ diagram: false }`.
