/** Elemento `i` de un arreglo, o falla el test si no existe (tipado sin `undefined`). */
export function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`Se esperaba un elemento en la posición ${i} (hay ${list.length})`);
  return v;
}
