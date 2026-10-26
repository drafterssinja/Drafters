import type { LineaDesglose } from '@/lib/futbolPuntuacion';

// ============================================================================
// PUNTUACIÓN DRAFTERS DE TENIS (27/10) — con lo que da ESPN gratis
// ============================================================================
// Tabla (Puntuaciones_Drafters_actualizado.md · Tenis):
//   Partido jugado +30 · Juego ganado +2,5 · Juego perdido −2 · Set ganado +6
//   Set perdido −3 · Partido ganado +6 · Break conseguido +0,75
//   Set en blanco (6-0) +4 · Victoria en sets directos +6 · Victoria por
//   retirada del rival +3.
//   Ace +0,4, doble falta −1, partido sin dobles faltas +2,5 y racha de 10
//   aces +2: "Próximamente" (ESPN no da aces ni dobles faltas).
// Los breaks se calculan con quién sacaba en cada juego (ver detectarBreaks).

export const PUNTOS_TENIS = {
  jugado: 30,
  juegoGanado: 2.5,
  juegoPerdido: -2,
  setGanado: 6,
  setPerdido: -3,
  partidoGanado: 6,
  break: 0.75,
  setEnBlanco: 4,
  setsDirectos: 6,
  retiradaRival: 3,
};

export type EstadoPartido = 'pre' | 'in' | 'post';

/** Un set está terminado si alguien llega a 6 con 2 de ventaja, o a 7 (tie-break). */
export function setTerminado(a: number, b: number): boolean {
  const max = Math.max(a, b);
  return (max >= 6 && Math.abs(a - b) >= 2) || max === 7;
}

export type LadoPartido = {
  estado: EstadoPartido;
  mios: number[]; // juegos por set
  rival: number[];
  gane: boolean | null; // null si no ha terminado
  rivalRetirado: boolean; // ganó porque el rival se retiró
  breaks: number;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export function puntuarPartidoTenis(p: LadoPartido): { total: number; desglose: LineaDesglose[] } {
  if (p.estado === 'pre') return { total: 0, desglose: [] };
  const lineas: LineaDesglose[] = [];
  const add = (clave: string, etiqueta: string, cantidad: number, porUnidad: number) => {
    if (cantidad <= 0) return;
    lineas.push({ clave, etiqueta, cantidad, puntos: r2(cantidad * porUnidad) });
  };
  add('jugado', 'Partido jugado', 1, PUNTOS_TENIS.jugado);
  const jg = p.mios.reduce((s, x) => s + (x || 0), 0);
  const jp = p.rival.reduce((s, x) => s + (x || 0), 0);
  add('juego_ganado', 'Juegos ganados', jg, PUNTOS_TENIS.juegoGanado);
  add('juego_perdido', 'Juegos perdidos', jp, PUNTOS_TENIS.juegoPerdido);
  let sg = 0;
  let sp = 0;
  let blancos = 0;
  for (let i = 0; i < Math.max(p.mios.length, p.rival.length); i++) {
    const a = p.mios[i] ?? 0;
    const b = p.rival[i] ?? 0;
    if (!setTerminado(a, b)) continue;
    if (a > b) {
      sg++;
      if (b === 0 && a >= 6) blancos++;
    } else sp++;
  }
  add('set_ganado', 'Sets ganados', sg, PUNTOS_TENIS.setGanado);
  add('set_perdido', 'Sets perdidos', sp, PUNTOS_TENIS.setPerdido);
  add('break', 'Breaks conseguidos', p.breaks, PUNTOS_TENIS.break);
  add('set_blanco', 'Set en blanco (6-0)', blancos, PUNTOS_TENIS.setEnBlanco);
  if (p.estado === 'post' && p.gane) {
    add('partido_ganado', 'Partido ganado', 1, PUNTOS_TENIS.partidoGanado);
    if (p.rivalRetirado) add('retirada', 'Victoria por retirada del rival', 1, PUNTOS_TENIS.retiradaRival);
    else if (sp === 0 && sg >= 2) add('sets_directos', 'Victoria en sets directos', 1, PUNTOS_TENIS.setsDirectos);
  }
  return { total: r2(lineas.reduce((s, l) => s + l.puntos, 0)), desglose: lineas };
}

/**
 * Breaks entre dos lecturas del marcador. `sirvio` = quién sacaba en la lectura
 * anterior (1 o 2): el saque se alterna cada juego. Si entre las dos lecturas
 * hay más de un juego, se reparte con el mínimo de breaks posible. El juego
 * del tie-break (6-6 → 7-6) no cuenta como break.
 */
export function detectarBreaks(
  antes: { j1: number[]; j2: number[]; sirve: number | null },
  ahora: { j1: number[]; j2: number[] }
): { b1: number; b2: number } {
  if (antes.sirve !== 1 && antes.sirve !== 2) return { b1: 0, b2: 0 };
  const suma = (xs: number[]) => xs.reduce((s, x) => s + (x || 0), 0);
  let d1 = suma(ahora.j1) - suma(antes.j1);
  let d2 = suma(ahora.j2) - suma(antes.j2);
  if (d1 < 0 || d2 < 0 || d1 + d2 === 0) return { b1: 0, b2: 0 };
  // Tie-breaks que se han jugado entre medias: no son breaks.
  const n = Math.max(ahora.j1.length, ahora.j2.length);
  let tiebreaks = 0;
  for (let i = 0; i < n; i++) {
    const a = ahora.j1[i] ?? 0;
    const b = ahora.j2[i] ?? 0;
    const a0 = antes.j1[i] ?? 0;
    const b0 = antes.j2[i] ?? 0;
    if (Math.max(a, b) === 7 && Math.min(a, b) === 6 && !(Math.max(a0, b0) === 7)) {
      tiebreaks++;
      if (a > b) d1--;
      else d2--;
    }
  }
  const k = d1 + d2;
  if (k <= 0) return { b1: 0, b2: 0 };
  // Juegos al saque de cada uno en esos k juegos (alternando desde el que sacaba).
  const saca1 = antes.sirve === 1 ? Math.ceil(k / 2) : Math.floor(k / 2);
  const saca2 = k - saca1;
  void tiebreaks;
  return { b1: Math.max(0, d1 - saca1), b2: Math.max(0, d2 - saca2) };
}
