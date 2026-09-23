// Reparto automático de jugadores de golf en las listas por color de una
// porra clásica, tal como lo corrigió Iñi (23/09, sustituyendo la versión
// anterior basada en "es un major"):
//
// - Amarillo: puesto 1-15 del ranking mundial.
// - Verde: puesto 16-35.
// - A partir de ahí, depende de si juegan 3 o más españoles en el torneo:
//   - Con menos de 3 españoles inscritos: Azul = 36-70, Morado = 71 en
//     adelante (ambos grupos existen).
//   - Con 3 o más españoles inscritos: Azul = 36 en adelante (sin tope, no
//     hay grupo Morado), y esos españoles se sacan de su tramo de ranking
//     normal y van todos juntos a una lista aparte ("Españoles").
// - El quinto jugador del equipo es siempre un "comodín": se puede repetir
//   un jugador de cualquiera de las listas ya usadas (ver el hueco extra en
//   la pantalla de crear equipo, app/porras/[id]/crear-equipo/page.tsx, y
//   la comprobación equivalente en inscribirse_en_porra() del esquema SQL).
//
// El puesto (rank) usado para decidir el tramo es el del **ranking mundial
// real** (tabla `rankings_mundiales`, mantenida aparte por Iñi), no el
// orden en que se pegó el listado de inscritos de este torneo en concreto
// — ver confirmarImportacionTorneo() en app/admin/page.tsx, que cruza
// ambos listados por nombre antes de llamar a esta función. Un jugador que
// no aparezca en el ranking mundial guardado se trata como si tuviera un
// puesto muy bajo (cae siempre en Morado, o en Azul sin tope si hay lista
// de españoles) — nunca se le asigna Amarillo o Verde por error.

export type GrupoPorra = 'amarillo' | 'verde' | 'azul' | 'morado' | 'espanoles';

export const UMBRAL_MINIMO_ESPANOLES = 3;

// Puesto que se usa para un jugador que no se ha podido encontrar en el
// ranking mundial guardado (ver arriba) — suficientemente alto para caer
// siempre en el tramo más bajo disponible, nunca en Amarillo/Verde.
export const PUESTO_NO_ENCONTRADO = 100000;

export function calcularGrupoPorra(rank: number, esEspanol: boolean, numEspanolesTotal: number): GrupoPorra {
  const hayListaEspanoles = numEspanolesTotal >= UMBRAL_MINIMO_ESPANOLES;
  if (esEspanol && hayListaEspanoles) {
    return 'espanoles';
  }
  if (rank <= 15) return 'amarillo';
  if (rank <= 35) return 'verde';
  if (hayListaEspanoles) return 'azul'; // sin tope: al no haber Morado, todo lo que sobra de Verde es Azul
  return rank <= 70 ? 'azul' : 'morado';
}

export const GRUPO_PORRA_LABELS: Record<GrupoPorra, string> = {
  amarillo: 'Amarillo (1-15)',
  verde: 'Verde (16-35)',
  azul: 'Azul (36+)',
  morado: 'Morado (71+)',
  espanoles: 'Españoles',
};

// Orden y color visual de los grupos — compartido por la pantalla de
// detalle de porra (pestaña "Grupos") y la de crear equipo (slots), para
// que ambas se vean y se ordenen igual.
export const ORDEN_GRUPOS: GrupoPorra[] = ['espanoles', 'amarillo', 'verde', 'azul', 'morado'];

export const COLOR_GRUPO: Record<GrupoPorra, string> = {
  espanoles: '#FF5C5C',
  amarillo: '#F0D94D',
  verde: '#3DDC84',
  azul: '#4DA3FF',
  morado: '#B07AFF',
};
