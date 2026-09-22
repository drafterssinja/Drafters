// ============================================================================
// REPARTO DE PREMIOS POR TIPO DE SALA
// ============================================================================
// Tabla definitiva que mandó Iñi (23/09, "DRAFTERS · Tipos de sala"). Un
// tramo cubre una o varias posiciones consecutivas que cobran, cada una, el
// mismo % del bote — p.ej. "10º-15º 2,1% c/u" es un tramo desde=10 hasta=15
// porcentajeCadaUno=2.1.
//
// Esto solo describe CÓMO se reparte el bote cuando se liquida una sala —
// todavía no hay pantalla ni función que liquide salas de verdad (eso es
// parte del draft/clasificación, sección 12 de la arquitectura técnica), así
// que de momento esto es la referencia que usará ese cálculo cuando se
// construya.
//
// Empates (regla de Iñi, pendiente de aplicar cuando exista la liquidación):
// los jugadores empatados juntan los premios de las posiciones que ocupan
// entre todos y se los reparten a partes iguales.
//
// Porras clásicas (confirmado por Iñi, 23/09): siguen EXACTAMENTE el mismo
// reparto por tramos que el Maratón (misma tabla, mismos porcentajes según
// el número final de inscritos) — de ahí que calcularTramosPorInscritos()
// esté pensada para usarse en los dos sitios, no solo en salas de tipo
// 'maraton'.
// ============================================================================

export type TipoSala = 'doble_o_nada' | 'triple_o_nada' | 'oro_y_plata' | 'tridente' | 'maraton';

export interface TramoPremio {
  desde: number;
  hasta: number;
  porcentajeCadaUno: number;
}

function tramosPorMultiplicador(aforo: number, multiplicador: number): TramoPremio[] {
  const premiados = aforo / multiplicador;
  const porcentajeCadaUno = Math.round(((multiplicador * 100) / aforo) * 100) / 100;
  return [{ desde: 1, hasta: premiados, porcentajeCadaUno }];
}

const TRAMOS_ORO_Y_PLATA: TramoPremio[] = [
  { desde: 1, hasta: 1, porcentajeCadaUno: 70 },
  { desde: 2, hasta: 2, porcentajeCadaUno: 30 },
];

const TRAMOS_TRIDENTE: TramoPremio[] = [
  { desde: 1, hasta: 1, porcentajeCadaUno: 60 },
  { desde: 2, hasta: 2, porcentajeCadaUno: 25 },
  { desde: 3, hasta: 3, porcentajeCadaUno: 15 },
];

// Reparto del Maratón por tramos de inscritos (tabla exacta de Iñi hasta
// 250 inscritos).
const TRAMOS_MARATON_FIJOS: { min: number; max: number; tramos: TramoPremio[] }[] = [
  { min: 2, max: 6, tramos: [{ desde: 1, hasta: 1, porcentajeCadaUno: 100 }] },
  {
    min: 7,
    max: 12,
    tramos: [
      { desde: 1, hasta: 1, porcentajeCadaUno: 65 },
      { desde: 2, hasta: 2, porcentajeCadaUno: 35 },
    ],
  },
  {
    min: 13,
    max: 20,
    tramos: [
      { desde: 1, hasta: 1, porcentajeCadaUno: 50 },
      { desde: 2, hasta: 2, porcentajeCadaUno: 30 },
      { desde: 3, hasta: 3, porcentajeCadaUno: 20 },
    ],
  },
  {
    min: 21,
    max: 30,
    tramos: [
      { desde: 1, hasta: 1, porcentajeCadaUno: 40 },
      { desde: 2, hasta: 2, porcentajeCadaUno: 27 },
      { desde: 3, hasta: 3, porcentajeCadaUno: 19 },
      { desde: 4, hasta: 4, porcentajeCadaUno: 14 },
    ],
  },
  {
    min: 31,
    max: 50,
    tramos: [
      { desde: 1, hasta: 1, porcentajeCadaUno: 33 },
      { desde: 2, hasta: 2, porcentajeCadaUno: 22 },
      { desde: 3, hasta: 3, porcentajeCadaUno: 16 },
      { desde: 4, hasta: 4, porcentajeCadaUno: 12 },
      { desde: 5, hasta: 5, porcentajeCadaUno: 9.5 },
      { desde: 6, hasta: 6, porcentajeCadaUno: 7.5 },
    ],
  },
  {
    min: 51,
    max: 80,
    tramos: [
      { desde: 1, hasta: 1, porcentajeCadaUno: 28 },
      { desde: 2, hasta: 2, porcentajeCadaUno: 18 },
      { desde: 3, hasta: 3, porcentajeCadaUno: 13 },
      { desde: 4, hasta: 4, porcentajeCadaUno: 10 },
      { desde: 5, hasta: 5, porcentajeCadaUno: 8 },
      { desde: 6, hasta: 6, porcentajeCadaUno: 7 },
      { desde: 7, hasta: 7, porcentajeCadaUno: 6 },
      { desde: 8, hasta: 8, porcentajeCadaUno: 5.5 },
      { desde: 9, hasta: 9, porcentajeCadaUno: 4.5 },
    ],
  },
  {
    min: 81,
    max: 120,
    tramos: [
      { desde: 1, hasta: 1, porcentajeCadaUno: 25 },
      { desde: 2, hasta: 2, porcentajeCadaUno: 16 },
      { desde: 3, hasta: 3, porcentajeCadaUno: 11.5 },
      { desde: 4, hasta: 4, porcentajeCadaUno: 9 },
      { desde: 5, hasta: 5, porcentajeCadaUno: 7.5 },
      { desde: 6, hasta: 6, porcentajeCadaUno: 6 },
      { desde: 7, hasta: 7, porcentajeCadaUno: 5 },
      { desde: 8, hasta: 8, porcentajeCadaUno: 4 },
      { desde: 9, hasta: 9, porcentajeCadaUno: 3.4 },
      { desde: 10, hasta: 15, porcentajeCadaUno: 2.1 },
    ],
  },
  {
    min: 121,
    max: 180,
    tramos: [
      { desde: 1, hasta: 1, porcentajeCadaUno: 23 },
      { desde: 2, hasta: 2, porcentajeCadaUno: 15 },
      { desde: 3, hasta: 3, porcentajeCadaUno: 11 },
      { desde: 4, hasta: 4, porcentajeCadaUno: 8.5 },
      { desde: 5, hasta: 5, porcentajeCadaUno: 6.8 },
      { desde: 6, hasta: 6, porcentajeCadaUno: 5.5 },
      { desde: 7, hasta: 7, porcentajeCadaUno: 4.5 },
      { desde: 8, hasta: 8, porcentajeCadaUno: 3.7 },
      { desde: 9, hasta: 9, porcentajeCadaUno: 3.1 },
      { desde: 10, hasta: 15, porcentajeCadaUno: 1.9 },
      { desde: 16, hasta: 21, porcentajeCadaUno: 1.25 },
    ],
  },
  {
    min: 181,
    max: 250,
    tramos: [
      { desde: 1, hasta: 1, porcentajeCadaUno: 21.1 },
      { desde: 2, hasta: 2, porcentajeCadaUno: 13.5 },
      { desde: 3, hasta: 3, porcentajeCadaUno: 10 },
      { desde: 4, hasta: 4, porcentajeCadaUno: 7.8 },
      { desde: 5, hasta: 5, porcentajeCadaUno: 6.2 },
      { desde: 6, hasta: 6, porcentajeCadaUno: 5 },
      { desde: 7, hasta: 7, porcentajeCadaUno: 4 },
      { desde: 8, hasta: 8, porcentajeCadaUno: 3.3 },
      { desde: 9, hasta: 9, porcentajeCadaUno: 2.7 },
      { desde: 10, hasta: 18, porcentajeCadaUno: 1.6 },
      { desde: 19, hasta: 30, porcentajeCadaUno: 1 },
    ],
  },
];

// ============================================================================
// MÁS DE 250 INSCRITOS — fórmula cerrada, no una estimación
// ============================================================================
// Iñi ha llegado a tener porras de hasta 600 participantes, y pidió
// explícitamente que el reparto por encima de 250 inscritos deje de ser una
// aproximación y quede "bien, bien definido", con escalones claros al menos
// hasta 1000 y un criterio equitativo y determinista a partir de ahí (23/09).
//
// En vez de tablas fijas escritas a mano (que se quedarían cortas en cuanto
// una porra pase de la última fila), esto es una FÓRMULA: una función
// matemática que, para cualquier número de inscritos por encima de 250, da
// SIEMPRE el mismo resultado exacto, calculado — nunca "a ojo". Está
// calibrada para siga exactamente el mismo patrón que la tabla fija de Iñi
// (continúa sin salto en el punto 250→251) y para cumplir lo que pidió para
// este tramo: ~15% de inscritos premiados en campos muy grandes, y una
// curva de reparto (1º más grande, luego cae) con la misma forma que el
// resto de su tabla. Los ejemplos con números exactos para 300, 500, 600,
// 1.000, 1.500 y 2.000 inscritos están en la arquitectura técnica del
// proyecto para que Iñi los pueda revisar de un vistazo.
//
// Cómo se calcula, paso a paso:
//  1. Nº de premiados: empieza en el 12% (justo lo que da la última fila de
//     la tabla fija: 30 de 250) y sube poco a poco hasta acercarse al 15%
//     que pidió Iñi para campos grandes, sin superarlo nunca.
//  2. Premio del 1º: empieza en el 21,1% (el mismo valor exacto con el que
//     acaba la tabla fija en 250 inscritos) y baja muy poco a poco según
//     crece el campo — un campo de 5.000 inscritos reparte un primer premio
//     algo menor, en proporción, que uno de 300, tal y como ya hacía la
//     propia tabla de Iñi al crecer el campo.
//  3. Del 2º al 9º puesto: cada uno cobra la MISMA proporción sobre el 1º
//     que en la última fila de la tabla fija de Iñi (p.ej. el 2º siempre
//     cobra el 64% de lo que cobra el 1º) — se mantiene la misma "forma" de
//     reparto que él ya validó, solo que reescalada.
//  4. El resto de premiados (del 10º en adelante) se reparte en dos bloques
//     de puestos consecutivos que cobran cada uno lo mismo dentro de su
//     bloque — exactamente la misma idea que ya usa la tabla fija de Iñi
//     ("10º-18º 1,6% c/u", "19º-30º 1% c/u"), con el tamaño de cada bloque y
//     su parte del bote calibrados para dar, en el punto 250→251, el mismo
//     resultado que la tabla fija (nunca hay un salto brusco al pasar de
//     250 a 251 inscritos).
//  5. El último bloque se redondea para que la suma de TODO el reparto dé
//     siempre exactamente 100% del bote — comprobado con pruebas para 300,
//     500, 600, 1.000, 1.500, 2.000 y 5.000 inscritos.
//
// Nota aparte, pendiente para cuando exista la liquidación real (sección 12
// de la arquitectura): el "premio mínimo ≥ 1,5x la entrada" que pidió Iñi
// para este tramo se aplica sobre el importe en euros ya calculado (bote ×
// este %), no sobre el propio %, así que se comprobará en ese momento.
const RATIOS_2_A_9_SOBRE_1: number[] = [0.6398, 0.4739, 0.3697, 0.2938, 0.2370, 0.1896, 0.1564, 0.1279]; // del 2º al 9º, calibrado con la fila 181-250 de Iñi (13.5/21.1, 10/21.1, ...)
const PRIMER_PUESTO_EN_250 = 21.1;
const FRACCION_PREMIADOS_EN_250 = 30 / 250; // 0.12, punto de partida real de la tabla de Iñi
const FRACCION_PREMIADOS_LIMITE = 0.15; // techo que pidió Iñi para campos grandes
const FRACCION_BLOQUE_1 = 0.43; // proporción de los puestos "del resto" que caen en el primer bloque (calibrado con 9 de 21 en la fila 181-250)
const PARTE_BOTE_BLOQUE_1 = 0.55; // proporción del % restante que se lleva el primer bloque (calibrado con 14.4 de 26.4 en la fila 181-250)

function tramosMaratonMasDe250(inscritos: number): TramoPremio[] {
  const fraccionPremiados = Math.min(
    FRACCION_PREMIADOS_LIMITE,
    FRACCION_PREMIADOS_EN_250 + 0.03 * (1 - 250 / inscritos)
  );
  const premiados = Math.max(30, Math.round(inscritos * fraccionPremiados));

  const primerPuesto = PRIMER_PUESTO_EN_250 * Math.pow(250 / inscritos, 0.12);

  const cabecera: TramoPremio[] = [{ desde: 1, hasta: 1, porcentajeCadaUno: redondear(primerPuesto) }];
  RATIOS_2_A_9_SOBRE_1.forEach((ratio, i) => {
    cabecera.push({ desde: i + 2, hasta: i + 2, porcentajeCadaUno: redondear(primerPuesto * ratio) });
  });

  const usadoCabecera = cabecera.reduce((suma, t) => suma + t.porcentajeCadaUno, 0);
  const restantesPuestos = premiados - 9;
  const restantePorcentaje = 100 - usadoCabecera;

  if (restantesPuestos <= 0 || restantePorcentaje <= 0) {
    return cabecera;
  }

  const tamanoBloque1 = Math.min(restantesPuestos, Math.max(1, Math.round(restantesPuestos * FRACCION_BLOQUE_1)));
  const tamanoBloque2 = restantesPuestos - tamanoBloque1;

  const porcentajeBloque1 = redondear((restantePorcentaje * PARTE_BOTE_BLOQUE_1) / tamanoBloque1);
  cabecera.push({ desde: 10, hasta: 9 + tamanoBloque1, porcentajeCadaUno: porcentajeBloque1 });

  if (tamanoBloque2 > 0) {
    // El bloque 2 absorbe el redondeo, para que la suma total dé siempre
    // exactamente 100% del bote aunque el resto de valores ya estén
    // redondeados a 3 decimales para enseñarse — con más precisión aquí
    // (6 decimales) el margen de error queda por debajo de un céntimo
    // incluso en un bote de varios miles de euros.
    const usadoConBloque1 = usadoCabecera + porcentajeBloque1 * tamanoBloque1;
    const porcentajeBloque2 = redondear((100 - usadoConBloque1) / tamanoBloque2, 6);
    cabecera.push({ desde: 10 + tamanoBloque1, hasta: premiados, porcentajeCadaUno: porcentajeBloque2 });
  }

  return cabecera;
}

function redondear(n: number, decimales = 3): number {
  const factor = 10 ** decimales;
  return Math.round(n * factor) / factor;
}

// Reparto por tramos según el número final de inscritos — usado por el
// Maratón Y por las porras clásicas (mismo formato exacto, confirmado por
// Iñi). `calcularTramosMaraton` se mantiene como alias por claridad donde
// solo se habla de salas Maratón.
export function calcularTramosPorInscritos(inscritos: number): TramoPremio[] {
  if (inscritos < 2) return [];
  const tramoFijo = TRAMOS_MARATON_FIJOS.find((t) => inscritos >= t.min && inscritos <= t.max);
  if (tramoFijo) return tramoFijo.tramos;
  return tramosMaratonMasDe250(inscritos);
}

export const calcularTramosMaraton = calcularTramosPorInscritos;
export const calcularTramosPorra = calcularTramosPorInscritos;

// Reparto para los tipos de aforo fijo (todo menos maratón). `inscritos` no
// se usa en estos — el reparto ya está fijado por el aforo del tipo.
export function calcularReparto(tipo: TipoSala, aforo: number | null, inscritos?: number): TramoPremio[] {
  switch (tipo) {
    case 'doble_o_nada':
      return aforo ? tramosPorMultiplicador(aforo, 2) : [];
    case 'triple_o_nada':
      return aforo ? tramosPorMultiplicador(aforo, 3) : [];
    case 'oro_y_plata':
      return TRAMOS_ORO_Y_PLATA;
    case 'tridente':
      return TRAMOS_TRIDENTE;
    case 'maraton':
      return calcularTramosPorInscritos(inscritos ?? 0);
    default:
      return [];
  }
}
