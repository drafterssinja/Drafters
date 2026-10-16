import { calcularReparto, type TipoSala } from '@/lib/repartoPremios';

// ============================================================================
// DRAFTIS DE UNA MESA DE LA LIGA (V2, 16/10)
// ============================================================================
// Cada jugador pone 100 draftis: bote = 100 × aforo, sin comisión. Lo que se
// lleva cada puesto sale de los mismos tramos que las mesas de la V1; el
// resultado neto es lo que se lleva menos los 100 que puso (los que no cobran
// restan 100). Doble o Nada +100 · Triple o Nada +200 · Oro y Plata +250/+50
// · Tridente +500/+150/+50.

export const DRAFTIS_POR_JUGADOR = 100;

export function boteDraftis(aforo: number | null): number {
  return DRAFTIS_POR_JUGADOR * (aforo ?? 0);
}

// Neto de cada puesto (posición 1 = índice 0), a mesa llena.
export function draftisPorPuesto(tipo: string, aforo: number | null): number[] {
  const n = aforo ?? 0;
  const bote = boteDraftis(n);
  const netos = Array<number>(n).fill(-DRAFTIS_POR_JUGADOR);
  calcularReparto(tipo as TipoSala, n).forEach((t) => {
    for (let p = t.desde; p <= Math.min(t.hasta, n); p++) netos[p - 1] = Math.round((bote * t.porcentajeCadaUno) / 100) - DRAFTIS_POR_JUGADOR;
  });
  return netos;
}

export function textoDraftis(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('es-ES')}`;
}

// "LaLiga - Jornada 9" → "LaLiga · Jornada 9"
export function competicionBonita(c: string): string {
  return c.replace(/\s*-\s*Jornada\s*/i, ' · Jornada ').replace('Champions League', 'Champions');
}

// Nombre de la mesa sin el "· 0 €" que heredan de la V1.
export function nombreMesaV2(nombre: string): string {
  return nombre.replace(/\s*·\s*\d+([.,]\d+)?\s*€\s*$/, '');
}
