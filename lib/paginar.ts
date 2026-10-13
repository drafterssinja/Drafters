// ============================================================================
// LEER TODAS LAS FILAS (13/10)
// ============================================================================
// Supabase devuelve como mucho 1.000 filas por consulta. Una jornada de
// Champions tiene más de 1.000 jugadores, así que las consultas "todos los
// jugadores de la competición" se quedaban cortas: el sistema no veía a los
// que quedaban fuera (bug de Iñi: un equipo de 11 salía con 10 en la
// clasificación y el que faltaba, Mouriño, había marcado). Esto pide por
// bloques de 1.000 hasta el final. La consulta debe llevar un orden estable.
export async function todasLasFilas<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta(desde, desde + 999);
    if (error) return { data: filas, error };
    const lote = (data as T[]) ?? [];
    filas.push(...lote);
    if (lote.length < 1000) break;
  }
  return { data: filas, error: null };
}
