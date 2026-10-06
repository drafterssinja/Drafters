// ============================================================================
// PUNTUACIÓN DRAFTERS DE GOLF PARA LAS MESAS (07/10)
// ============================================================================
// Pedido de Iñi: las mesas Drafters de golf puntúan con la tabla propia de
// Drafters ("Cómo puntúan los jugadores"), no por golpes respecto al par como
// las porras. Todo se calcula con el hoyo a hoyo que ya reconstruimos con Data
// Golf (resultados_golf_hoyo) y la posición que da Data Golf:
//
//   Por hoyo      Albatros o mejor +15 · Eagle +8 · Birdie +3 · Par 0
//                 Bogey −1 · Doble bogey −3 · Triple bogey o peor −5
//   Rachas        3 birdies seguidos +3 (máx. 1 por día)
//                 5 birdies seguidos +2 más (máx. 1 por día; se suma a la de 3)
//                 Vuelta sin bogeys (18 hoyos) +4
//                 Hole in one +4 (además de los puntos del hoyo)
//   Posición      1º +35 · 2º +25 · 3º +20 · 4º +18 · 5º +16 · 6º +14 · 7º +12 ·
//                 8º +10 · 9º +8 · 10º +6 · 11-15 +5 · 16-20 +4 · 21-30 +3 ·
//                 31-40 +2 · 41-50 +1. Empatados: todos reciben los puntos de ese
//                 puesto. Solo cuenta cuando el torneo ha terminado.
//   Próximamente  Putt de +30 pies y approach metido (Data Golf no los da).
//
// Reglas del documento maestro:
//  - Si un jugador se retira o es descalificado solo cuentan los hoyos jugados.
//  - Los hoyos de desempate (playoff) no puntúan, solo deciden la posición.
//  - "Racha" = hoyos CONSECUTIVOS en orden de juego (un hoyo sin dato corta la
//    racha, y la vuelta sin bogeys solo se da con los 18 hoyos confirmados).
import type { LineaDesglose } from './futbolPuntuacion';

export type HoyoGolf = { ronda: number; hoyo: number; par: number; golpes: number; actualizado_en: string };

export const PUNTOS_GOLF_HOYO = { albatros: 15, eagle: 8, birdie: 3, par: 0, bogey: -1, dobleBogey: -3, tripleOPeor: -5 } as const;
export const PUNTOS_GOLF_RACHA_3 = 3;
export const PUNTOS_GOLF_RACHA_5 = 2;
export const PUNTOS_GOLF_VUELTA_SIN_BOGEYS = 4;
export const PUNTOS_GOLF_HOLE_IN_ONE = 4;
export const RONDAS_MAXIMAS_PUNTUABLES = 4;

/** Puntos por la posición final. Devuelve 0 si no puntúa (más allá del 50º, corte, retirada...). */
export function puntosPorPosicionGolf(posicion: number): number {
  if (posicion === 1) return 35;
  if (posicion === 2) return 25;
  if (posicion === 3) return 20;
  if (posicion === 4) return 18;
  if (posicion === 5) return 16;
  if (posicion === 6) return 14;
  if (posicion === 7) return 12;
  if (posicion === 8) return 10;
  if (posicion === 9) return 8;
  if (posicion === 10) return 6;
  if (posicion >= 11 && posicion <= 15) return 5;
  if (posicion >= 16 && posicion <= 20) return 4;
  if (posicion >= 21 && posicion <= 30) return 3;
  if (posicion >= 31 && posicion <= 40) return 2;
  if (posicion >= 41 && posicion <= 50) return 1;
  return 0;
}

/** "T5" → 5, "1" → 1; "CUT", "WD", "DQ", "MDF", vacío... → null. */
export function numeroDePosicionGolf(posicion: string | null | undefined): number | null {
  if (!posicion) return null;
  const m = /^T?(\d+)$/i.exec(posicion.trim());
  return m ? Number(m[1]) : null;
}

export type ResultadoGolfJugador = {
  total: number;
  desglose: LineaDesglose[];
  /** Avisos para el admin: rondas con hoyos sin dato (pueden faltar puntos). */
  avisos: string[];
  hoyosContados: number;
};

export type EntradaGolf = {
  hoyos: HoyoGolf[];
  /** Posición tal cual la da Data Golf ("T5", "CUT"...). */
  posicion: string | null;
  /** Solo cuando el torneo está dado por terminado se suman los puntos de posición. */
  torneoTerminado: boolean;
  /** Ronda en la que va el jugador y hoyos jugados en ella (para detectar hoyos sin dato). */
  rondaActual: number | null;
  thruActual: number | null;
};

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

export function puntuarGolfJugador(e: EntradaGolf): ResultadoGolfJugador {
  const acum = new Map<string, LineaDesglose>();
  const sumar = (clave: string, etiqueta: string, puntosUnidad: number, cantidad = 1) => {
    if (puntosUnidad === 0 || cantidad === 0) return;
    const prev = acum.get(clave);
    if (prev) {
      prev.cantidad += cantidad;
      prev.puntos = redondear(prev.puntos + puntosUnidad * cantidad);
    } else {
      acum.set(clave, { clave, etiqueta, cantidad, puntos: redondear(puntosUnidad * cantidad) });
    }
  };

  const avisos: string[] = [];
  let hoyosContados = 0;
  const porRonda = new Map<number, HoyoGolf[]>();
  for (const h of e.hoyos) {
    if (h.ronda < 1 || h.ronda > RONDAS_MAXIMAS_PUNTUABLES) continue; // playoff: no puntúa
    const l = porRonda.get(h.ronda) ?? [];
    l.push(h);
    porRonda.set(h.ronda, l);
  }

  for (const ronda of Array.from(porRonda.keys()).sort((a, b) => a - b)) {
    // Orden de juego = orden en que se fueron guardando (cada hoyo se escribe
    // una sola vez, al completarlo); el nº de hoyo desempata.
    const hoyos = (porRonda.get(ronda) as HoyoGolf[]).slice().sort((a, b) => (a.actualizado_en < b.actualizado_en ? -1 : a.actualizado_en > b.actualizado_en ? 1 : a.hoyo - b.hoyo));

    let rachaActual = 0;
    let ultimoHoyo: number | null = null;
    let racha3 = false;
    let racha5 = false;
    let peorQueParEnRonda = false;
    const distintos = new Set<number>();

    for (const h of hoyos) {
      distintos.add(h.hoyo);
      hoyosContados++;
      const dif = h.golpes - h.par;

      if (dif <= -3) sumar('albatros', 'Albatros o mejor', PUNTOS_GOLF_HOYO.albatros);
      else if (dif === -2) sumar('eagle', 'Eagle', PUNTOS_GOLF_HOYO.eagle);
      else if (dif === -1) sumar('birdie', 'Birdie', PUNTOS_GOLF_HOYO.birdie);
      else if (dif === 1) sumar('bogey', 'Bogey', PUNTOS_GOLF_HOYO.bogey);
      else if (dif === 2) sumar('doble_bogey', 'Doble bogey', PUNTOS_GOLF_HOYO.dobleBogey);
      else if (dif >= 3) sumar('triple_bogey', 'Triple bogey o peor', PUNTOS_GOLF_HOYO.tripleOPeor);
      if (dif > 0) peorQueParEnRonda = true;

      if (h.golpes === 1) sumar('hole_in_one', 'Hole in one', PUNTOS_GOLF_HOLE_IN_ONE);

      // Racha: birdie o mejor en hoyos consecutivos (el siguiente al 18 es el 1).
      const consecutivo = ultimoHoyo !== null && h.hoyo === (ultimoHoyo % 18) + 1;
      if (dif <= -1) {
        rachaActual = consecutivo ? rachaActual + 1 : 1;
      } else {
        rachaActual = 0;
      }
      ultimoHoyo = h.hoyo;
      if (rachaActual >= 3 && !racha3) {
        racha3 = true;
        sumar('racha_3', 'Racha de 3 birdies seguidos', PUNTOS_GOLF_RACHA_3);
      }
      if (rachaActual >= 5 && !racha5) {
        racha5 = true;
        sumar('racha_5', 'Racha de 5 birdies seguidos', PUNTOS_GOLF_RACHA_5);
      }
    }

    if (distintos.size === 18 && !peorQueParEnRonda) sumar('vuelta_sin_bogeys', 'Vuelta sin bogeys', PUNTOS_GOLF_VUELTA_SIN_BOGEYS);

    // ¿Faltan hoyos por registrar en esta ronda?
    if (e.rondaActual !== null) {
      const esperados = ronda < e.rondaActual ? 18 : ronda === e.rondaActual ? Math.min(18, e.thruActual ?? 0) : 0;
      const faltan = esperados - distintos.size;
      if (faltan > 0) avisos.push(`Ronda ${ronda}: faltan ${faltan} hoyo${faltan === 1 ? '' : 's'} por registrar`);
    }
  }

  if (e.torneoTerminado) {
    const pos = numeroDePosicionGolf(e.posicion);
    const pts = pos !== null ? puntosPorPosicionGolf(pos) : 0;
    if (pts > 0 && pos !== null) sumar('posicion', `Posición final (${pos}º)`, pts);
  }

  // Orden estable del desglose: hoyos, rachas, posición.
  const orden = ['albatros', 'eagle', 'birdie', 'bogey', 'doble_bogey', 'triple_bogey', 'hole_in_one', 'racha_3', 'racha_5', 'vuelta_sin_bogeys', 'posicion'];
  const desglose = Array.from(acum.values()).sort((a, b) => orden.indexOf(a.clave) - orden.indexOf(b.clave));
  const total = redondear(desglose.reduce((s, l) => s + l.puntos, 0));
  return { total, desglose, avisos, hoyosContados };
}
