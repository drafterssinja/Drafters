import type { LineaDesglose } from '@/lib/futbolPuntuacion';

// ============================================================================
// TRAMOS: MESAS DE UN SOLO DÍA (FÚTBOL) O DE UNA SOLA RONDA (GOLF) (17/10)
// ============================================================================
// Iñi: "si se te olvida hacer el equipo antes de la jornada, que puedas jugar
// los partidos del sábado o del domingo" y, en golf, la ronda 1, 2, 3 o 4
// suelta o el fin de semana (rondas 3 y 4). Ver SQL 49.
//   null          = jornada / torneo completo
//   'dia:AAAA-MM-DD' = solo los partidos de ese día (hora de Madrid), días con 3+ partidos
//   'r1'..'r4'    = una ronda · 'r34' = rondas 3 y 4 (fin de semana)
// En las rondas 3 y 4 solo entran los que pasan el corte, con precio nuevo
// (tabla precios_corte).

export type Tramo = string | null;

export function esTramoCorte(tramo: Tramo | undefined): boolean {
  return tramo === 'r3' || tramo === 'r4' || tramo === 'r34';
}

export function diaDeTramo(tramo: Tramo | undefined): string | null {
  return tramo && tramo.startsWith('dia:') ? tramo.slice(4) : null;
}

export function rondasDeTramo(tramo: Tramo | undefined): number[] | null {
  if (tramo === 'r1') return [1];
  if (tramo === 'r2') return [2];
  if (tramo === 'r3') return [3];
  if (tramo === 'r4') return [4];
  if (tramo === 'r34') return [3, 4];
  return null;
}

// Fecha (AAAA-MM-DD) en hora de Madrid.
export function fechaMadrid(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function diaBonito(dia: string, conFecha = true): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const semana = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' }).format(d);
  const fecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'numeric', timeZone: 'Europe/Madrid' }).format(d);
  return conFecha ? `${semana} ${fecha}` : semana;
}

// Etiqueta larga, para poner debajo del nombre de la mesa.
export function etiquetaTramo(tramo: Tramo | undefined, deporte: string, partidos?: number | null): string {
  const dia = diaDeTramo(tramo);
  if (dia) return `Solo partidos del ${diaBonito(dia)}${partidos ? ` · ${partidos} partidos` : ''}`;
  if (tramo === 'r34') return 'Fin de semana (rondas 3 y 4) · tras el corte';
  if (tramo === 'r3' || tramo === 'r4') return `Solo la ronda ${tramo.slice(1)} · tras el corte`;
  if (tramo === 'r1' || tramo === 'r2') return `Solo la ronda ${tramo.slice(1)}`;
  return deporte === 'golf' ? 'Torneo completo · 4 rondas' : 'Jornada completa';
}

// Etiqueta corta (pestañas, chips).
export function etiquetaTramoCorta(tramo: Tramo | undefined, deporte: string): string {
  const dia = diaDeTramo(tramo);
  if (dia) return `Solo ${diaBonito(dia)}`;
  if (tramo === 'r34') return 'Rondas 3 y 4';
  if (tramo && /^r[1-4]$/.test(tramo)) return `Ronda ${tramo.slice(1)}`;
  return deporte === 'golf' ? 'Torneo completo' : 'Jornada completa';
}

// Orden: completo primero, luego por día / ronda.
export function ordenTramo(tramo: Tramo | undefined): string {
  if (!tramo) return '0';
  if (tramo === 'r34') return '1r5';
  return `1${tramo}`;
}

// ---------------------------------------------------------------------------
// Golf: puntos de un jugador en un tramo (por_ronda la escribe la sincronización)
// ---------------------------------------------------------------------------
export type PorRonda = Record<string, { total: number; desglose: LineaDesglose[] }> | null;
export function puntosGolfTramo(fila: { puntos_total: number; desglose?: LineaDesglose[] | null; por_ronda?: PorRonda } | undefined, tramo: Tramo | undefined): { total: number; desglose: LineaDesglose[] } {
  if (!fila) return { total: 0, desglose: [] };
  const rondas = rondasDeTramo(tramo);
  if (!rondas) return { total: Number(fila.puntos_total) || 0, desglose: fila.desglose ?? [] };
  const acum = new Map<string, LineaDesglose>();
  let total = 0;
  for (const r of rondas) {
    const pr = fila.por_ronda?.[String(r)];
    if (!pr) continue;
    total += Number(pr.total) || 0;
    for (const l of pr.desglose ?? []) {
      const prev = acum.get(l.clave);
      if (prev) {
        prev.cantidad += l.cantidad;
        prev.puntos = Math.round((prev.puntos + l.puntos) * 100) / 100;
      } else acum.set(l.clave, { ...l });
    }
  }
  return { total: Math.round(total * 100) / 100, desglose: Array.from(acum.values()) };
}

