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
// medio).
//
// Colores del hoyo a hoyo — pedido explícito de Iñi (28/09), ampliando los 4
// colores originales de la maqueta a 5, separando el bogey normal del doble
// bogey o peor: "cuando sea un birdie, un golpe por debajo del par... en
// rojo, si es un eagle en amarillo, si es un par lo dejas en gris, un bogey
// en negro y doble bogey o peor en azul". Se pintan como FONDO de una
// pastilla/círculo con el número de golpes dentro (no como color de texto
// sobre el fondo oscuro de la app — un texto literalmente negro sería
// invisible ahí) — mismo criterio que ya usa una tarjeta de resultados de
// golf en papel (círculo/cuadro de color alrededor del número), y cada
// color de fondo lleva emparejado el color de texto que mejor contrasta.

export type GolpesVsPar = number;

/** "E" (even, al par), "-3" (bajo par) o "+2" (sobre par) — formato estándar de golf. */
export function formatGolfScore(golpesVsPar: GolpesVsPar): string {
  if (golpesVsPar === 0) return 'E';
  return golpesVsPar > 0 ? `+${golpesVsPar}` : `${golpesVsPar}`;
}

export type TipoResultadoHoyo = 'eagle_o_mejor' | 'birdie' | 'par' | 'bogey' | 'doble_bogey_o_peor';

/** Clasifica un resultado de UN hoyo (golpes de ese hoyo menos su par) en uno de los 5 tipos. */
export function tipoResultadoHoyo(golpes: number, par: number): TipoResultadoHoyo {
  const vsPar = golpes - par;
  if (vsPar <= -2) return 'eagle_o_mejor';
  if (vsPar === -1) return 'birdie';
  if (vsPar === 0) return 'par';
  if (vsPar === 1) return 'bogey';
  return 'doble_bogey_o_peor';
}

export const ETIQUETA_TIPO_RESULTADO: Record<TipoResultadoHoyo, string> = {
  eagle_o_mejor: 'Eagle o mejor',
  birdie: 'Birdie',
  par: 'Par',
  bogey: 'Bogey',
  doble_bogey_o_peor: 'Doble bogey o peor',
};

/** Fondo de la pastilla + color de texto que mejor contrasta con ese fondo. */
export const COLOR_TIPO_RESULTADO: Record<TipoResultadoHoyo, { fondo: string; texto: string }> = {
  eagle_o_mejor: { fondo: '#F5D147', texto: '#241C02' }, // amarillo
  birdie: { fondo: '#FF5C5C', texto: '#2B0000' }, // rojo
  par: { fondo: '#AAB4AE', texto: '#0B0F0E' }, // gris
  bogey: { fondo: '#0B0F0E', texto: '#F5F7F5' }, // negro
  doble_bogey_o_peor: { fondo: '#3D7BFF', texto: '#F5F7F5' }, // azul
};

// Mantenido por compatibilidad con el total (no hoyo a hoyo) de un
// jugador/equipo — usa los mismos 5 colores, pero aplicado al RESULTADO
// TOTAL respecto al par en vez de a un hoyo suelto (aquí no hay un
// concepto de "bogey vs. doble bogey" tan marcado, así que un total
// positivo cualquiera se trata como el tramo "sobre par" más suave: bogey).
export function colorGolfScore(golpesVsPar: GolpesVsPar): { fondo: string; texto: string } {
  if (golpesVsPar <= -2) return COLOR_TIPO_RESULTADO.eagle_o_mejor;
  if (golpesVsPar === -1) return COLOR_TIPO_RESULTADO.birdie;
  if (golpesVsPar === 0) return COLOR_TIPO_RESULTADO.par;
  if (golpesVsPar <= 2) return COLOR_TIPO_RESULTADO.bogey;
  return COLOR_TIPO_RESULTADO.doble_bogey_o_peor;
}

// ============================================================================
// BONO DE PODIO (nuevo, 29/09)
// ============================================================================
// Pedido de Iñi, para la clasificación en directo de una porra de golf
// 'clasica' con `bono_podio_activo` marcado (ver drafters-schema.sql,
// tabla porras): "el primer jugador del torneo va a restar menos 10, el
// segundo menos 5 y el tercero menos 3". Importante: esto es el 1º/2º/3er
// clasificado REAL DEL TORNEO (jugadores.resultado_en_vivo_posicion, tal
// cual la da ESPN — "1", "T2", "T3"...), NO el 1º/2º/3er puesto de la
// porra — el bono se resta al resultado de CUALQUIER equipo de la porra que
// tenga a ese jugador en su plantilla, en el mismo sitio donde ya se suman
// los golpes de sus jugadores (app/porras/[id]/clasificacion/page.tsx).
//
// Empates en el propio torneo ("T1", "T2"...): se reparte el mismo criterio
// que da ESPN — un "T1" cuenta como 1er puesto (bono -10) para todos los
// que compartan esa posición, igual que un "T2"/"T3" cuentan como 2º/3er
// puesto (-5/-3) para todos los que la compartan. No hay reparto a medias
// aquí: a diferencia del reparto de premios en euros (que sí divide entre
// empatados, ver lib/repartoPremios.ts), esto es una resta de golpes
// aplicada individualmente a cada jugador según su propio puesto.
const BONO_PODIO_POR_PUESTO: Record<number, number> = { 1: -10, 2: -5, 3: -3 };

/**
 * A partir de la posición tal cual la da ESPN (p.ej. "1", "T2", "CUT",
 * "WD", null si todavía no hay dato), devuelve el bono de golpes a restar
 * (-10/-5/-3) o 0 si no está en el podio (o la posición no se puede
 * interpretar, como "CUT"/"WD"/null).
 */
export function bonoPodioParaJugador(posicion: string | null): number {
  if (!posicion) return 0;
  const soloNumero = posicion.trim().replace(/^T/i, '');
  const puesto = parseInt(soloNumero, 10);
  if (!Number.isFinite(puesto)) return 0;
  return BONO_PODIO_POR_PUESTO[puesto] ?? 0;
}
