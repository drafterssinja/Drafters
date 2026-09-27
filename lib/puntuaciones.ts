// ============================================================================
// TABLAS DE PUNTUACIÓN — listado COMPLETO para la pantalla previa al draft
// ============================================================================
// Pedido de Iñi (25/09, tercera vuelta): antes de ver el listado de
// jugadores para elegir equipo (en los tres deportes), mostrar primero una
// pantalla con "cómo puntúan los jugadores" y un botón "Entendido" que lleva
// ya a la selección — "para que la gente se vaya conociéndolo". De momento
// se muestra siempre (más adelante, cuando ya no haga falta para todo el
// mundo, Iñi pidió poner solo un enlace a esta misma tabla en vez de
// interponerla cada vez).
//
// Corregido el 27/09 (a petición de Iñi): esto ERA un resumen condensado
// (solo 3-4 categorías por deporte); Iñi pidió expresamente que no se
// resuma nada — "lístame todas las formas de puntuar de todos los tipos de
// jugadores sin resumir nada" — así que esta tabla pasa a ser una
// transcripción completa, fila a fila, del documento maestro
// (Puntuaciones_Drafters_DEFINITIVO.md / claude/Puntuaciones_Drafters_actualizado.md
// en el proyecto), con la única columna de "Drafters" (se deja fuera la
// comparación con DraftKings, que es material interno de producto, no algo
// que el usuario final necesite ver aquí). En golf se transcribe solo el
// formato "Stroke Play" (por hoyo + rachas + posición final), que es el
// único formato que Drafters usa de verdad hoy (los torneos se importan
// como un ranking por golpes/cuotas) — las tablas de Match Play y Ryder/
// Presidents Cup del documento maestro no aplican a ningún tipo de sala
// existente en la app, así que no se incluyen aquí (si algún día se monta
// un torneo de ese formato, se añaden entonces).

export type FilaPuntuacion = { accion: string; puntos: string };
export type TablaPuntuacion = { titulo: string; filas: FilaPuntuacion[] };

export const PUNTUACION_FUTBOL: TablaPuntuacion[] = [
  {
    titulo: 'Acciones ofensivas (según posición)',
    filas: [
      { accion: 'Gol — delantero', puntos: '+10' },
      { accion: 'Gol — centrocampista', puntos: '+12' },
      { accion: 'Gol — defensa', puntos: '+16' },
      { accion: 'Gol — portero', puntos: '+20' },
      { accion: 'Asistencia — delantero / centrocampista', puntos: '+6' },
      { accion: 'Asistencia — defensa', puntos: '+7' },
      { accion: 'Disparo a puerta — delantero / centrocampista', puntos: '+1' },
      { accion: 'Disparo a puerta — defensa', puntos: '+1,5' },
      { accion: 'Disparo fuera de puerta — delantero / centrocampista', puntos: '+0,5' },
      { accion: 'Disparo fuera de puerta — defensa', puntos: '+1' },
      { accion: 'Centro clave (acaba en remate) — centrocampista', puntos: '+1' },
      { accion: 'Centro clave (acaba en remate) — defensa', puntos: '+1' },
      { accion: 'Penalti fallado — cualquier posición', puntos: '−4' },
    ],
  },
  {
    titulo: 'Acciones defensivas (según posición)',
    filas: [
      { accion: 'Entrada ganada — centrocampista / defensa', puntos: '+1' },
      { accion: 'Pase interceptado — centrocampista', puntos: '+0,5' },
      { accion: 'Pase interceptado — defensa', puntos: '+1' },
      { accion: 'Despeje clave — defensa', puntos: '+0,5' },
      { accion: 'Falta cometida — cualquier posición', puntos: '−0,5' },
      { accion: 'Tarjeta amarilla — cualquier posición', puntos: '−1,5' },
      { accion: 'Tarjeta roja (directa o 2ª amarilla) — cualquier posición', puntos: '−4' },
    ],
  },
  {
    titulo: 'Portero (tabla propia)',
    filas: [
      { accion: 'Parada', puntos: '+1,5' },
      { accion: 'Portería a cero (90 min. completos)', puntos: '+6' },
      { accion: 'Gol encajado', puntos: '−2' },
      { accion: 'Victoria del equipo', puntos: '+5' },
      { accion: 'Penalti parado', puntos: '+5' },
      { accion: 'Salida aérea ganada', puntos: '+0,5' },
    ],
  },
  {
    // Iñi pidió el 27/09 igualar esto al portero (+6, 90 min. completos),
    // pero en el mismo día, al ver que el defensa YA puntuaba la portería a
    // cero, aclaró que se refería a que ya lo tenía incluido y que quería
    // dejarlo tal cual estaba — "me gusta que los defensas con más de 60
    // minutos jugados puntúen a cuatro puntos y su equipo tiene portería
    // cero... no lo tocamos". Revertido a los valores originales: +4 ptos,
    // con solo 60+ minutos jugados (más laxo que los 90 minutos completos
    // que sí exige el portero).
    titulo: 'Defensas (bonus adicional)',
    filas: [
      { accion: 'Portería a cero (60+ minutos jugados)', puntos: '+4' },
      { accion: 'Duelo aéreo ganado', puntos: '+0,3' },
    ],
  },
  {
    titulo: 'Bonus para todos los jugadores',
    filas: [
      { accion: 'MVP del partido', puntos: '+3' },
      { accion: 'Hat-trick (3 goles en el mismo partido)', puntos: '+5 adicionales' },
      { accion: 'Doblete (2 goles en el mismo partido)', puntos: '+2 adicionales' },
      { accion: 'Partido completo jugado (90 min.)', puntos: '+1' },
    ],
  },
];

export const PUNTUACION_GOLF: TablaPuntuacion[] = [
  {
    titulo: 'Por hoyo (stroke play)',
    filas: [
      { accion: 'Albatros o mejor', puntos: '+15' },
      { accion: 'Eagle', puntos: '+8' },
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
      { accion: 'Racha de 3 birdies seguidos (máx. 1 por día)', puntos: '+3' },
      { accion: 'Racha de 5 birdies seguidos (máx. 1 por día)', puntos: '+2' },
      { accion: 'Vuelta sin bogeys (18 hoyos)', puntos: '+4' },
      { accion: 'Putt de +30 pies', puntos: '+1' },
      { accion: 'Approach metido', puntos: '+1' },
      { accion: 'Hole in one', puntos: '+4' },
    ],
  },
  {
    titulo: 'Posición final en el torneo',
    filas: [
      { accion: '1º puesto', puntos: '+35' },
      { accion: '2º puesto', puntos: '+25' },
      { accion: '3º puesto', puntos: '+20' },
      { accion: '4º puesto', puntos: '+18' },
      { accion: '5º puesto', puntos: '+16' },
      { accion: '6º puesto', puntos: '+14' },
      { accion: '7º puesto', puntos: '+12' },
      { accion: '8º puesto', puntos: '+10' },
      { accion: '9º puesto', puntos: '+8' },
      { accion: '10º puesto', puntos: '+6' },
      { accion: '11º–15º puesto', puntos: '+5' },
      { accion: '16º–20º puesto', puntos: '+4' },
      { accion: '21º–30º puesto', puntos: '+3' },
      { accion: '31º–40º puesto', puntos: '+2' },
      { accion: '41º–50º puesto', puntos: '+1' },
    ],
  },
];

export const PUNTUACION_TENIS: TablaPuntuacion[] = [
  {
    titulo: 'Puntuaciones base',
    filas: [
      { accion: 'Partido jugado (base)', puntos: '+30' },
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
      { accion: 'Racha de 10 aces o más', puntos: '+2' },
      { accion: 'Victoria por retirada del rival', puntos: '+3' },
    ],
  },
];

export function tablaPuntuacionPorDeporte(deporte: string): TablaPuntuacion[] {
  if (deporte === 'futbol') return PUNTUACION_FUTBOL;
  if (deporte === 'golf') return PUNTUACION_GOLF;
  if (deporte === 'tenis') return PUNTUACION_TENIS;
  return [];
}
