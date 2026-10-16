/**
 * `Obj`: operaciones VIRTUALES sobre JSON (en memoria; nada lee archivos ni la red). Vienen de iswc por URL, así DER
 * siempre usa la definición vigente del kit:
 *
 *   Obj.insert(base, cambios, molde?)  upsert profundo: lo no mencionado se conserva; `null` quita según el molde.
 *   Obj.insertIgnore(base, nuevos)     agrega solo lo que NO existe (no pisa).
 *   Obj.update(base, cambios)          cambia solo lo que YA existe (no crea).
 *   Obj.replace(base, valor)           reemplazo directo (lo que aplica cuando no hay molde Zod).
 *   Obj.delete(base, query)            quita lo que marque la consulta.
 *   Obj.get(base, query)               la estructura desde la raíz con solo lo marcado.
 *   Obj.getValue(base, query)          el valor exacto de la única hoja marcada (`null` si no existe).
 *   Obj.aplicar(base, acciones)        las anteriores en orden (`TAccionObj[]`).
 *
 * Las operaciones FÍSICAS (`RefObj`: referencias `{ path, query, actions }` a otros JSON) son de iswc y DER no las usa.
 * Actualizar a lo último de iswc: `deno task sync`.
 * Doc: https://cdn.jsdelivr.net/gh/Jeff-Aporta/is-webcomponents@main/src/vendor-distributions/shared/lib/obj.md
 */
export { Obj, ObjError } from "https://raw.githubusercontent.com/Jeff-Aporta/is-webcomponents/main/src/vendor-distributions/shared/lib/obj.ts";
