// ============================================================================
// PRECIO AUTOMÁTICO DE JUGADORES
// ============================================================================
// Objetivo (pedido por Iñi): que cada jugador tenga un precio "equitativo
// según su nivel" sin que el admin tenga que ponerlo a mano uno a uno.
//
// La señal de nivel que realmente tenemos varía por deporte:
//   - Golf/tenis: al pegar el listado del torneo (ver parsePlayerList.ts) casi
//     siempre viene ya ordenado por ranking mundial (OWGR / ATP / WTA) o por
//     cabeza de serie — ese orden es un buen proxy del nivel real.
//   - Fútbol (plan gratuito de football-data.org): no da estadísticas ni
//     valor de mercado, así que no hay ranking real disponible — se usa un
//     precio de partida por posición (ver PRECIO_POR_POSICION_FUTBOL),
//     ajustable a mano por el admin. El día que se conecte una fuente con
//     valor de mercado o estadísticas reales, se puede sustituir por
//     precioPorRanking() igual que golf/tenis.
// ============================================================================

const PRECIO_MIN_POR_DEFECTO = 3000;
const PRECIO_MAX_POR_DEFECTO = 15000;

/**
 * Reparte precios de forma equitativa según la posición en un ranking
 * (rank = 1 es el mejor). Usa una curva exponencial, no lineal: en el
 * deporte profesional el nivel real está muy concentrado arriba (el nº1 es
 * muchísimo mejor que el nº50, pero del nº80 al nº100 apenas hay diferencia)
 * — así el precio se comporta igual, en vez de repartir el rango de forma
 * uniforme.
 */
export function precioPorRanking(
  rank: number,
  totalJugadores: number,
  opts?: { min?: number; max?: number }
): number {
  const min = opts?.min ?? PRECIO_MIN_POR_DEFECTO;
  const max = opts?.max ?? PRECIO_MAX_POR_DEFECTO;
  if (totalJugadores <= 1 || rank <= 1) return max;

  const posicionRelativa = Math.min(1, Math.max(0, (rank - 1) / (totalJugadores - 1))); // 0 (mejor) .. 1 (peor)
  const factor = Math.exp(-3 * posicionRelativa); // caída exponencial
  const precio = min + (max - min) * factor;
  return Math.round(precio / 100) * 100; // redondeado a la centena, más legible en la app
}

// Fútbol: sin ranking real disponible todavía, precio de partida por
// posición (el admin lo puede ajustar a mano en cualquier momento desde
// /admin).
export const PRECIO_POR_POSICION_FUTBOL: Record<string, number> = {
  portero: 4000,
  defensa: 5000,
  centrocampista: 6500,
  delantero: 8000,
};

export function precioFutbolPorPosicion(posicion: string | null): number {
  if (!posicion) return 5000;
  return PRECIO_POR_POSICION_FUTBOL[posicion] ?? 5000;
}
