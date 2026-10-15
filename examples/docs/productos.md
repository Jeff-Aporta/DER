# Productos

Catálogo de productos vendibles. Cada producto pertenece (opcionalmente) a una categoría.

## Reglas de negocio

- El precio nunca es negativo (`prePost`/`prePut` compartidos: corren en el front y en el server).
- `total` = `precio * stock`, calculado en SQL por el server.
- `jconfig` guarda la configuración de UI (`/cfg`), con molde Zod `ZProductoCfg`.

## Endpoints especiales

- `ajustarStock` (`POST producto/{iproducto}/ajustarStock`): suma `stock` al actual. Tiene variante `/sse`.
- `importar` (`POST productos/importar`): alta masiva en una transacción.
