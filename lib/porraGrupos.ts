// Reparto automático de jugadores de golf en las listas por color de una
// porra clásica, tal como lo describió Iñi (22/09):
//
// - Majors (Masters de Augusta, Open Championship, US Open, PGA
//   Championship): amarillo 1-15, verde 16-35, azul 36 en adelante.
// - Resto de torneos: amarillo 1-15, verde 16-35, azul 36-70, morado 71 en
//   adelante.
// - En cualquier torneo (major o no) en el que jueguen al menos 3 jugadores
//   marcados como españoles, esos jugadores se sacan de su lista por
//   ranking y van todos juntos a una lista aparte ('espanoles'). Si hay
//   menos de 3, no hay lista de españoles y cada uno se queda en su tramo
//   de ranking normal.
//
// El puesto (rank) usado para decidir el tramo es el de la posición en el
// listado/ranking pegado por el admin — nunca se recalcula al sacar a los
// españoles de las demás listas.

export type GrupoPorra = 'amarillo' | 'verde' | 'azul' | 'morado' | 'espanoles';

export const UMBRAL_MINIMO_ESPANOLES = 3;

export function calcularGrupoPorra(rank: number, esEspanol: boolean, numEspanolesTotal: number, esMajor: boolean): GrupoPorra {
  if (esEspanol && numEspanolesTotal >= UMBRAL_MINIMO_ESPANOLES) {
    return 'espanoles';
  }
  if (rank <= 15) return 'amarillo';
  if (rank <= 35) return 'verde';
  if (esMajor) return 'azul';
  return rank <= 70 ? 'azul' : 'morado';
}

export const GRUPO_PORRA_LABELS: Record<GrupoPorra, string> = {
  amarillo: 'Amarillo (1-15)',
  verde: 'Verde (16-35)',
  azul: 'Azul (36+)',
  morado: 'Morado (71+)',
  espanoles: 'Españoles',
};
