// ============================================================================
// PUNTUACIÓN DE FÚTBOL — tablas Drafters calculadas con datos de ESPN (06/10)
// ============================================================================
// Pedido de Iñi (06/10): las mesas de fútbol dejan de puntuar con LaLiga
// Fantasy y pasan a las tablas "Cómo puntúan los jugadores" de Drafters
// (lib/puntuaciones.ts / Puntuaciones_Drafters_actualizado.md), calculadas
// con los datos por jugador que da ESPN. Vale para LaLiga y Champions.
//
// Función pura (sin red ni base de datos): recibe la posición del jugador en
// NUESTRA ficha (portero / defensa / centrocampista / delantero) y sus
// estadísticas del partido, y devuelve el total y el desglose por acción.
//
// ACCIONES QUE ESPN NO DA — quedan "Próximamente" y NO puntúan (lo mismo en
// la pantalla de información; ver ACCIONES_PROXIMAMENTE):
//   centro clave, entrada ganada, pase interceptado, despeje clave, salida
//   aérea ganada (portero), duelo aéreo ganado (defensa) y MVP del partido.
//
// Bonus que solo tienen sentido con el partido terminado (se conceden solo
// cuando ha finalizado): portería a cero (portero y defensa), victoria del
// equipo (portero) y partido completo (90 min.).

export type PosicionFutbol = 'portero' | 'defensa' | 'centrocampista' | 'delantero';

export type EstadisticasJugador = {
  /** Ha saltado al campo (titular o entró desde el banquillo). */
  jugo: boolean;
  /** Minutos jugados. Solo fiable con el partido terminado. */
  minutos: number;
  /** Titular que acaba el partido sobre el campo (sin cambio ni expulsión). */
  partidoCompleto: boolean;
  goles: number;
  asistencias: number;
  golesPropiaPuerta: number;
  tirosAPuerta: number;
  tirosTotales: number;
  faltasCometidas: number;
  amarillas: number;
  rojas: number;
  paradas: number;
  golesEncajados: number;
  penaltisFallados: number;
  penaltisParados: number;
};

export type ContextoPartido = {
  finalizado: boolean;
  /** Goles que ha encajado el equipo del jugador en todo el partido. */
  golesContraEquipo: number;
  equipoGana: boolean;
};

export type LineaDesglose = {
  /** Identificador estable de la acción. */
  clave: string;
  etiqueta: string;
  cantidad: number;
  puntos: number;
};

export const PUNTOS_GOL: Record<PosicionFutbol, number> = { delantero: 10, centrocampista: 12, defensa: 16, portero: 20 };
export const PUNTOS_ASISTENCIA: Record<PosicionFutbol, number> = { delantero: 6, centrocampista: 6, defensa: 7, portero: 0 };
export const PUNTOS_TIRO_A_PUERTA: Record<PosicionFutbol, number> = { delantero: 1, centrocampista: 1, defensa: 1.5, portero: 0 };
export const PUNTOS_TIRO_FUERA: Record<PosicionFutbol, number> = { delantero: 0.5, centrocampista: 0.5, defensa: 1, portero: 0 };

export const PUNTOS_PENALTI_FALLADO = -4;
/** CONFIRMADO por Iñi (06/10): gol en propia puerta = −4 (la tabla maestra no lo contemplaba). */
export const PUNTOS_GOL_PROPIA_PUERTA = -4;
export const PUNTOS_FALTA = -0.5;
export const PUNTOS_AMARILLA = -1.5;
export const PUNTOS_ROJA = -4;

export const PUNTOS_PORTERO = { parada: 1.5, porteriaACero: 6, golEncajado: -2, victoria: 5, penaltiParado: 5 };
export const PUNTOS_DEFENSA_PORTERIA_A_CERO = 4;
export const MINUTOS_DEFENSA_PORTERIA_A_CERO = 60;
export const MINUTOS_PORTERO_PORTERIA_A_CERO = 90;
export const PUNTOS_DOBLETE = 2;
export const PUNTOS_HATTRICK = 5;
export const PUNTOS_PARTIDO_COMPLETO = 1;

/** Acciones de las tablas que ESPN no proporciona: se muestran como
 * "Próximamente" y no puntúan. Se compara con el texto de la fila en
 * lib/puntuaciones.ts (empieza por…). */
export const ACCIONES_PROXIMAMENTE = [
  'Centro clave',
  'Entrada ganada',
  'Pase interceptado',
  'Despeje clave',
  'Salida aérea ganada',
  'Duelo aéreo ganado',
  'MVP del partido',
];

export function estadisticasVacias(): EstadisticasJugador {
  return {
    jugo: false,
    minutos: 0,
    partidoCompleto: false,
    goles: 0,
    asistencias: 0,
    golesPropiaPuerta: 0,
    tirosAPuerta: 0,
    tirosTotales: 0,
    faltasCometidas: 0,
    amarillas: 0,
    rojas: 0,
    paradas: 0,
    golesEncajados: 0,
    penaltisFallados: 0,
    penaltisParados: 0,
  };
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

export function puntuarJugador(posicion: PosicionFutbol | string | null | undefined, st: EstadisticasJugador, ctx: ContextoPartido): { total: number; desglose: LineaDesglose[] } {
  const pos: PosicionFutbol = posicion === 'portero' || posicion === 'defensa' || posicion === 'centrocampista' || posicion === 'delantero' ? posicion : 'centrocampista';
  const lineas: LineaDesglose[] = [];
  const add = (clave: string, etiqueta: string, cantidad: number, puntosUnidad: number) => {
    if (cantidad === 0 || puntosUnidad === 0) return;
    lineas.push({ clave, etiqueta, cantidad, puntos: redondear(cantidad * puntosUnidad) });
  };
  const addTotal = (clave: string, etiqueta: string, puntos: number) => {
    if (puntos === 0) return;
    lineas.push({ clave, etiqueta, cantidad: 1, puntos: redondear(puntos) });
  };

  if (!st.jugo) return { total: 0, desglose: [] };

  // Ofensivas
  add('gol', 'Gol', st.goles, PUNTOS_GOL[pos]);
  add('asistencia', 'Asistencia', st.asistencias, PUNTOS_ASISTENCIA[pos]);
  add('tiro_puerta', 'Disparo a puerta', st.tirosAPuerta, PUNTOS_TIRO_A_PUERTA[pos]);
  add('tiro_fuera', 'Disparo fuera', Math.max(0, st.tirosTotales - st.tirosAPuerta), PUNTOS_TIRO_FUERA[pos]);
  add('penalti_fallado', 'Penalti fallado', st.penaltisFallados, PUNTOS_PENALTI_FALLADO);
  add('propia_puerta', 'Gol en propia puerta', st.golesPropiaPuerta, PUNTOS_GOL_PROPIA_PUERTA);

  // Doblete / hat-trick (adicional sobre los goles)
  if (st.goles >= 3) addTotal('hattrick', 'Hat-trick', PUNTOS_HATTRICK);
  else if (st.goles === 2) addTotal('doblete', 'Doblete', PUNTOS_DOBLETE);

  // Disciplina. La 2ª amarilla (= expulsión) cuenta -4 en total, sin sumar
  // además las amarillas (ESPN ya la da como roja con 0 amarillas, pero se
  // protege el caso de que llegue como 2 amarillas + roja).
  add('falta', 'Falta cometida', st.faltasCometidas, PUNTOS_FALTA);
  if (st.rojas > 0 && st.amarillas >= 2) {
    addTotal('roja', 'Expulsión (2 amarillas)', PUNTOS_ROJA);
  } else {
    add('amarilla', 'Tarjeta amarilla', st.amarillas, PUNTOS_AMARILLA);
    add('roja', 'Tarjeta roja', st.rojas, PUNTOS_ROJA);
  }

  // Portero
  if (pos === 'portero') {
    add('parada', 'Parada', st.paradas, PUNTOS_PORTERO.parada);
    add('gol_encajado', 'Gol encajado', st.golesEncajados, PUNTOS_PORTERO.golEncajado);
    add('penalti_parado', 'Penalti parado', st.penaltisParados, PUNTOS_PORTERO.penaltiParado);
    if (ctx.finalizado) {
      if (ctx.golesContraEquipo === 0 && st.minutos >= MINUTOS_PORTERO_PORTERIA_A_CERO) addTotal('porteria_cero', 'Portería a cero', PUNTOS_PORTERO.porteriaACero);
      if (ctx.equipoGana) addTotal('victoria', 'Victoria del equipo', PUNTOS_PORTERO.victoria);
    }
  }

  // Defensa
  if (pos === 'defensa' && ctx.finalizado && ctx.golesContraEquipo === 0 && st.minutos >= MINUTOS_DEFENSA_PORTERIA_A_CERO) {
    addTotal('porteria_cero', 'Portería a cero (60+ min.)', PUNTOS_DEFENSA_PORTERIA_A_CERO);
  }

  // Partido completo (todos)
  if (ctx.finalizado && st.partidoCompleto) addTotal('completo', 'Partido completo', PUNTOS_PARTIDO_COMPLETO);

  const total = redondear(lineas.reduce((s, l) => s + l.puntos, 0));
  return { total, desglose: lineas };
}
