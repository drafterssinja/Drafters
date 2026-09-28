// ============================================================================
// PUNTUACIÓN DE LA PORRA CLÁSICA DE GOLF — golpes respecto al par, no puntos
// ============================================================================
// Corrección de Iñi (28/09): "para la puntuación de la porra no va a ir por
// puntos... aquí va a ser directamente el resultado de los jugadores...
// como se puntúa en golf, que los birdies puntúan menos uno, los bogeys más
// uno, eagles menos dos, dobles bogeys más dos, etc." — a diferencia de las
// Mesas Drafters (que sí usan el sistema de puntos propio de
// claude/Puntuaciones_Drafters_actualizado.md, con un valor distinto por
// acción), la porra clásica de golf puntúa con el criterio de golf de toda
// la vida: el resultado de cada jugador es directamente su recuento de
// golpes respecto al par (relación 1 a 1, sin tabla de puntos de por
// medio) — exactamente el mismo criterio con el que ya estaba diseñado el
// panel "hoyo a hoyo" de la maqueta (isPorraClasificacion, Main.dc.html,
// línea 1663): "Amarillo = eagle o mejor · rojo = birdie · gris = par ·
// negro = bogey o peor".
//
// Este archivo centraliza ese formato y esos colores para que, cuando se
// construya el motor de resultados en directo (la pieza pendiente —
// sección 12 de la arquitectura técnica), tanto la clasificación de porras
// (app/porras/[id]/clasificacion/page.tsx) como cualquier otra pantalla que
// necesite pintar un resultado de golf lo hagan siempre con el mismo
// criterio, sin reinventarlo pantalla a pantalla.

// Golpes de un hoyo/ronda/torneo respecto al par (negativo = bajo par,
// positivo = sobre par). Todavía no hay ninguna fuente de datos real para
// esto (resultados_evento no existe) — es el tipo que usará esa pieza
// cuando se construya.
export type GolpesVsPar = number;

/** "E" (even, al par), "-3" (bajo par) o "+2" (sobre par) — formato estándar de golf. */
export function formatGolfScore(golpesVsPar: GolpesVsPar): string {
  if (golpesVsPar === 0) return 'E';
  return golpesVsPar > 0 ? `+${golpesVsPar}` : `${golpesVsPar}`;
}

// Mismos 4 colores y mismos umbrales que ya usaba el panel "hoyo a hoyo" de
// la maqueta — se reutilizan aquí para que la clasificación (totales, no
// solo hoyo a hoyo) pinte con el mismo criterio visual.
export const COLOR_EAGLE_O_MEJOR = '#F5D147'; // amarillo
export const COLOR_BIRDIE = '#FF5C5C'; // rojo
export const COLOR_PAR = '#AAB4AE'; // gris
export const COLOR_BOGEY_O_PEOR = '#0B0F0E'; // negro (fondo oscuro, no color de texto)

export function colorGolfScore(golpesVsPar: GolpesVsPar): string {
  if (golpesVsPar <= -2) return COLOR_EAGLE_O_MEJOR;
  if (golpesVsPar === -1) return COLOR_BIRDIE;
  if (golpesVsPar === 0) return COLOR_PAR;
  return COLOR_BOGEY_O_PEOR;
}
