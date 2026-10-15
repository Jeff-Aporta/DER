# Productos · Preguntas frecuentes

- **¿Por qué `list()` no trae la categoría?** `list()` es aplanado; usa `query({ include: { categoria: true } })`.
- **¿Cómo filtro por categoría?** `query({ where: { categoria: { nombre: "Bebidas" } } })`.
