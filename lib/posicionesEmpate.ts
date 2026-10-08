// ============================================================================
// POSICIONES CON EMPATE "T" (08/10, pedido de Iñi)
// ============================================================================
// "En las clasificaciones, tanto de las porras, como de las mesas drafters
// como de las ligas... si hay algún equipo empatado, que sus posiciones
// aparezcan como la misma posición, precedido de una T, como en golf. Si hay
// dos primeros, los dos aparecerán como T1."
//
// Criterio de golf: los empatados comparten el puesto más alto del bloque y
// el siguiente salta los puestos ocupados (1, T2, T2, 4...). Requiere que la
// lista ya venga ORDENADA por el mismo valor (los empatados, juntos).

/** Valor normalizado para comparar empates (2 decimales; sin valor = 0). */
function claveEmpate(v: number | null | undefined): number {
  if (v === null || v === undefined || !Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/** Etiqueta de posición de cada elemento de una lista ya ordenada: "1", "T2", "T2", "4"... */
export function etiquetasPosicion<T>(ordenados: readonly T[], valor: (x: T) => number | null | undefined): string[] {
  const out: string[] = new Array(ordenados.length);
  let i = 0;
  while (i < ordenados.length) {
    const c = claveEmpate(valor(ordenados[i]));
    let fin = i + 1;
    while (fin < ordenados.length && claveEmpate(valor(ordenados[fin])) === c) fin++;
    const etiqueta = fin - i > 1 ? `T${i + 1}` : String(i + 1);
    for (let k = i; k < fin; k++) out[k] = etiqueta;
    i = fin;
  }
  return out;
}

/** Para listas que ya traen el puesto numérico (p. ej. el reparto de premios):
 * "T3" si otro elemento comparte ese puesto, "3º" si no. */
export function etiquetaPuestoPremio(posicion: number, todas: readonly number[]): string {
  const repetido = todas.filter((p) => p === posicion).length > 1;
  return repetido ? `T${posicion}` : `${posicion}º`;
}
