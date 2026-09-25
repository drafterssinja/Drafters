// ============================================================================
// TABLAS DE PUNTUACIÓN — resumen para la pantalla previa al draft
// ============================================================================
// Pedido de Iñi (25/09, tercera vuelta): antes de ver el listado de
// jugadores para elegir equipo (en los tres deportes), mostrar primero una
// pantalla con "cómo puntúan los jugadores" y un botón "Entendido" que lleva
// ya a la selección — "para que la gente se vaya conociéndolo". De momento
// se muestra siempre (más adelante, cuando ya no haga falta para todo el
// mundo, Iñi pidió poner solo un enlace a esta misma tabla en vez de
// interponerla cada vez).
//
// Esto es un RESUMEN, no la tabla completa de puntuación (esa vive en el
// documento del proyecto, Puntuaciones_Drafters_actualizado.md) — recoge
// solo las categorías principales para que la pantalla previa sea legible
// de un vistazo, no una copia 1:1 del documento completo.

export type FilaPuntuacion = { accion: string; puntos: string };
export type TablaPuntuacion = { titulo: string; filas: FilaPuntuacion[] };

export const PUNTUACION_FUTBOL: TablaPuntuacion[] = [
  {
    titulo: 'Goles (según posición)',
    filas: [
      { accion: 'Gol — delantero', puntos: '+10' },
      { accion: 'Gol — centrocampista', puntos: '+12' },
      { accion: 'Gol — defensa', puntos: '+16' },
      { accion: 'Gol — portero', puntos: '+20' },
      { accion: 'Asistencia', puntos: '+6 / +7' },
    ],
  },
  {
    titulo: 'Portero',
    filas: [
      { accion: 'Parada', puntos: '+1,5' },
      { accion: 'Portería a cero (90 min.)', puntos: '+6' },
      { accion: 'Penalti parado', puntos: '+5' },
      { accion: 'Gol encajado', puntos: '−2' },
    ],
  },
  {
    titulo: 'Disciplina y bonus',
    filas: [
      { accion: 'Tarjeta amarilla', puntos: '−1,5' },
      { accion: 'Tarjeta roja', puntos: '−4' },
      { accion: 'MVP del partido', puntos: '+3' },
      { accion: 'Partido completo (90 min.)', puntos: '+1' },
    ],
  },
];

export const PUNTUACION_GOLF: TablaPuntuacion[] = [
  {
    titulo: 'Por hoyo (stroke play)',
    filas: [
      { accion: 'Águila o mejor', puntos: '+8 / +15' },
      { accion: 'Birdie', puntos: '+3' },
      { accion: 'Par', puntos: '0' },
      { accion: 'Bogey', puntos: '−1' },
      { accion: 'Doble bogey', puntos: '−3' },
      { accion: 'Triple bogey o peor', puntos: '−5' },
    ],
  },
  {
    titulo: 'Rachas y golpes destacados',
    filas: [
      { accion: 'Racha de 3 birdies seguidos', puntos: '+3' },
      { accion: 'Vuelta sin bogeys (18 hoyos)', puntos: '+4' },
      { accion: 'Hole in one', puntos: '+4' },
    ],
  },
  {
    titulo: 'Posición final',
    filas: [
      { accion: '1º puesto', puntos: '+35' },
      { accion: '2º puesto', puntos: '+25' },
      { accion: '3º puesto', puntos: '+20' },
      { accion: 'Del 11º al 50º', puntos: '+1 a +6' },
    ],
  },
];

export const PUNTUACION_TENIS: TablaPuntuacion[] = [
  {
    titulo: 'Base del partido',
    filas: [
      { accion: 'Partido jugado', puntos: '+30' },
      { accion: 'Game ganado', puntos: '+2,5' },
      { accion: 'Game perdido', puntos: '−2' },
      { accion: 'Set ganado', puntos: '+6' },
      { accion: 'Set perdido', puntos: '−3' },
      { accion: 'Partido ganado', puntos: '+6' },
    ],
  },
  {
    titulo: 'Estadísticas en juego',
    filas: [
      { accion: 'Ace', puntos: '+0,4' },
      { accion: 'Doble falta', puntos: '−1' },
      { accion: 'Break conseguido', puntos: '+0,75' },
    ],
  },
  {
    titulo: 'Bonificaciones',
    filas: [
      { accion: 'Set en blanco (6-0)', puntos: '+4' },
      { accion: 'Victoria en sets directos', puntos: '+6' },
      { accion: 'Partido sin dobles faltas', puntos: '+2,5' },
    ],
  },
];

export function tablaPuntuacionPorDeporte(deporte: string): TablaPuntuacion[] {
  if (deporte === 'futbol') return PUNTUACION_FUTBOL;
  if (deporte === 'golf') return PUNTUACION_GOLF;
  if (deporte === 'tenis') return PUNTUACION_TENIS;
  return [];
}
