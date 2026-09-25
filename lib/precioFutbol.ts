/**
 * Precio de fantasía de cada jugador de fútbol, a partir de su valor de
 * mercado de un fantasy oficial (LaLiga Fantasy / FPL / fantasy de la UEFA)
 * y, cuando están cargadas, las cuotas 1X2 del partido de esa jornada.
 *
 * ENCARGO_precios_futbol_y_correccion_golf_tenis.md, parte A.3 (24/09/2026).
 * Sustituye (salvo como respaldo, ver A.5 y lib/pricing.ts) al precio fijo
 * por posición.
 *
 * Corregido el 25/09 (continuación) tras las dos quejas reales de Iñi con
 * la primera jornada de 639 jugadores: (1) los porteros se comían demasiado
 * presupuesto para lo poco que puntúan comparados con un delantero; (2) un
 * equipo hecho solo con jugadores de dos equipos flojos (Málaga y Español)
 * no llegaba ni a completarse por presupuesto. Ver el punto 6 más abajo.
 *
 * 1. Nivel base (0-1) dentro de la competición, en escala logarítmica —
 *    porque el rango de valores es muy distinto según la competición (en
 *    LaLiga Fantasy hay de 0,4 M a 159 M, casi 400 veces; en el FPL de
 *    £4m a £15,5m, unas 4 veces):
 *      nivel = (ln(valor) − ln(valor_mín)) / (ln(valor_máx) − ln(valor_mín))
 *    valor_mín/valor_máx son los de TODA la tabla de valores de mercado
 *    cargada para esa competición (todos los equipos, jueguen o no esta
 *    jornada) — NUNCA los del subconjunto de equipos que juegan esta
 *    jornada en concreto. Antes del 25/09 el llamante (app/admin/page.tsx)
 *    pasaba por error solo los jugadores de la jornada, así que si una
 *    jornada no incluía a los equipos grandes de referencia (p. ej. se pegan
 *    las cuotas de solo unos pocos partidos), el "techo" de la escala pasaba
 *    a ser el jugador más caro de ESE grupo reducido — y dentro de un grupo
 *    de equipos flojos, hasta un jugador mediocre podía salir con nivel
 *    cercano a 1 (carísimo). Ahora el rango se calcula siempre sobre toda la
 *    tabla de valor de mercado de la competición (ver calcularPreciosFutbolDetallado,
 *    parámetro rangoNivel, y su uso en app/admin/page.tsx) — así el precio de
 *    un jugador no depende de qué otros equipos juegan esa semana en
 *    concreto, y un equipo flojo sigue teniendo jugadores baratos de verdad.
 *
 * 2. Ajuste por partido, con las cuotas 1X2 (quitando el margen de la
 *    casa):
 *      fuerza_equipo = p(su resultado) + 0,5 × p(empate)     (0 a 1)
 *      factor = 1 + amplitud × (fuerza − 0,5)
 *      amplitud = 0,2 para porteros (0,9 a 1,1), 0,4 para el resto (0,8 a 1,2)
 *      nivel_ajustado = nivel × factor
 *    Sin cuotas para su partido, factor = 1 (y el llamante debe avisarlo en
 *    la vista previa — este módulo no sabe qué partidos faltan, solo recibe
 *    ya resuelto el factor de cada jugador, ver factoresPorEquipo()).
 *
 * 3. Precio, misma forma de curva que golf/tenis (lib/precioPorCuota.ts):
 *      precio = MÍN + (TOPE_línea − MÍN) × (nivel_ajustado / nivel_ajustado_máx) ^ γ
 *      (redondeado a centenas)
 *    TOPE_línea es el TOPE normal para defensas/centrocampistas/delanteros,
 *    pero para PORTEROS es solo una fracción de ese TOPE (ver punto 6.1) —
 *    así el portero más caro de la jornada nunca se acerca al precio de un
 *    delantero estrella, aunque su valor de mercado bruto sea alto.
 *
 * 4. Tres reglas de seguridad, sobre las 4 alineaciones válidas de la app
 *    (4-3-3, 4-4-2, 3-5-2, 4-2-3-1 — ver FORMACIONES_FUTBOL):
 *      Regla 1: el once más caro posible (la alineación que más cueste)
 *               debe costar >= 110% del presupuesto.
 *      Regla 2: los 3 jugadores más caros, completados con los más baratos
 *               que formen una alineación válida, deben caber en el
 *               presupuesto.
 *      Regla 3 (nueva, 25/09): el once más BARATO posible (la alineación
 *               que menos cueste, con los jugadores más baratos de cada
 *               línea) no debe superar el 50% del presupuesto — para que
 *               SIEMPRE quepa un equipo completo con margen de sobra, sea
 *               cual sea la combinación de equipos elegida (incluso solo
 *               con equipos flojos), y para que sobre presupuesto real para
 *               elegir entre "muchos jugadores de la parte media/alta" o
 *               "pocas estrellas + relleno barato" (pedido de Iñi, 25/09).
 *
 * 5. Búsqueda automática de (TOPE, γ) que cumplan las tres reglas,
 *    moviéndose lo mínimo posible de los valores de partida (TOPE = 20% del
 *    presupuesto, γ = 2,0 — antes 1,0, ver punto 6.2) — mismo método que
 *    golf/tenis: TOPE se mueve entre el 15% y el 25% del presupuesto, γ
 *    entre 1,2 y 3,0 (antes 0,5 a 3,0, ver 6.2), minimizando
 *    coste = 10 × |fracción_TOPE_objetivo − fracción_TOPE| + |γ − γ_objetivo|.
 *
 * 6. Qué cambió el 25/09 y por qué, punto por punto:
 *    6.1. Tope reducido para porteros — `porteroFraccionTope` (0,45): el
 *         portero más caro de la jornada cuesta como mucho MÍN + 45% de lo
 *         que cuesta el TOPE normal por encima de MÍN (aprox. la mitad del
 *         delantero más caro), en vez de poder llegar al mismo TOPE que
 *         cualquier otra posición.
 *    6.2. Curva de partida más pronunciada — γ de partida sube de 1,0 a 2,0,
 *         y el rango de búsqueda de γ sube su mínimo de 0,5 a 1,2. Con
 *         γ=1 (recta) demasiados jugadores "normales" quedaban cerca de la
 *         mitad de la escala de precio; con γ más alto (curva convexa) el
 *         precio se hunde mucho más rápido para los jugadores de nivel
 *         medio/bajo, dejando solo a las auténticas estrellas cerca del
 *         TOPE — así hay más margen real para elegir entre "muchos buenos"
 *         o "pocas estrellas + relleno".
 *    6.3. Rango de valor de mercado estable — ver el punto 1 de arriba.
 *    6.4. Regla 3 nueva — ver el punto 4 de arriba: una garantía dura
 *         (no solo una esperanza de que la curva salga bien) de que
 *         siempre habrá un equipo completo asequible.
 *
 * Los valores de partida (MÍN=2.500€, TOPE=20.000€, γ=2,0) siguen
 * pendientes de un último ajuste fino con más jornadas reales (ENCARGO,
 * A.8.1) — pero ya corrigen los dos problemas concretos que reportó Iñi.
 *
 * Caso especial (A.5): un jugador sin valor de mercado (fichaje de última
 * hora, canterano) recibe el precio MEDIANO de su posición en esa jornada,
 * y se marca sinValor=true (el llamante debe guardarlo en
 * jugadores.valor_a_revisar).
 */
import { EQUIPO_PRESUPUESTO, FORMACIONES_FUTBOL } from './draftConfig';
import { huecosPorLinea, lineaDePosicion, LineaFutbol } from './salaShared';

export type PosicionFutbol = 'portero' | 'defensa' | 'centrocampista' | 'delantero';

export const PRECIO_FUTBOL_CONFIG = {
  /** Precio del jugador con menos nivel (y de cualquiera sin valor de mercado, antes de la mediana). */
  minimo: 2_500,
  /** TOPE de partida: lo que cuesta el jugador con más nivel ajustado de la jornada (defensa/centrocampista/delantero). */
  topeInicial: 20_000,
  /** Rango de búsqueda de TOPE, como fracción del presupuesto. */
  topeMinimoFraccion: 0.15,
  topeMaximoFraccion: 0.25,
  /** Paso de la búsqueda de TOPE (como fracción del presupuesto). */
  pasoTopeFraccion: 0.005,
  /**
   * Fracción del TOPE (por encima de MÍN) que puede alcanzar un portero —
   * 25/09, corrección de Iñi: los porteros se comían demasiado presupuesto.
   * Con 0,45, el portero más caro de la jornada cuesta MÍN + 45% × (TOPE − MÍN),
   * aprox. la mitad de lo que cuesta el jugador de campo más caro.
   */
  porteroFraccionTope: 0.45,
  /** Rango y paso de la búsqueda de γ. */
  gammaMinima: 1.2,
  gammaMaxima: 3.0,
  pasoGamma: 0.01,
  /** γ de partida — el coste de la búsqueda mide cuánto nos alejamos de aquí. */
  gammaInicial: 2.0,
  /**
   * Regla 3 (25/09): el once más barato posible no puede superar esta
   * fracción del presupuesto — garantiza que siempre se pueda completar un
   * equipo con margen de sobra, sea cual sea la combinación de equipos.
   */
  fraccionMaxOnceBarato: 0.5,
  /** Los precios se redondean a este múltiplo. */
  redondeo: 100,
} as const;

export type ConfigPrecioFutbol = {
  presupuesto: number;
  minimo: number;
  topeInicial: number;
  topeMinimoFraccion: number;
  topeMaximoFraccion: number;
  pasoTopeFraccion: number;
  porteroFraccionTope: number;
  gammaMinima: number;
  gammaMaxima: number;
  pasoGamma: number;
  gammaInicial: number;
  fraccionMaxOnceBarato: number;
  redondeo: number;
};

// ----------------------------------------------------------------------------
// Paso 1 — nivel base por valor de mercado
// ----------------------------------------------------------------------------

export function nivelBase(valor: number, valorMin: number, valorMax: number): number {
  if (!(valor > 0)) return 0;
  if (!(valorMax > valorMin)) return 1; // toda la tabla al mismo valor: no hay escala que discriminar
  const nivel = (Math.log(valor) - Math.log(valorMin)) / (Math.log(valorMax) - Math.log(valorMin));
  return Math.min(1, Math.max(0, nivel));
}

// ----------------------------------------------------------------------------
// Paso 2 — ajuste por partido (cuotas 1X2)
// ----------------------------------------------------------------------------

export function cuotaValidaFutbol(cuota: number | null | undefined): cuota is number {
  return typeof cuota === 'number' && Number.isFinite(cuota) && cuota > 1;
}

/** Probabilidades implícitas del partido, ya sin el margen de la casa. */
export function fuerzaPartido(cuota1: number, cuotaX: number, cuota2: number): { fuerzaLocal: number; fuerzaVisit: number } {
  const s = 1 / cuota1 + 1 / cuotaX + 1 / cuota2;
  const pLocal = 1 / cuota1 / s;
  const pEmpate = 1 / cuotaX / s;
  const pVisit = 1 / cuota2 / s;
  return {
    fuerzaLocal: pLocal + 0.5 * pEmpate,
    fuerzaVisit: pVisit + 0.5 * pEmpate,
  };
}

export function factorPosicion(fuerza: number, posicion: PosicionFutbol): number {
  const amplitud = posicion === 'portero' ? 0.2 : 0.4;
  return 1 + amplitud * (fuerza - 0.5);
}

export type PartidoConCuotas = {
  equipoLocal: string;
  equipoVisitante: string;
  cuota1: number | null | undefined;
  cuotaX: number | null | undefined;
  cuota2: number | null | undefined;
};

/**
 * A partir de los partidos de una jornada (con los nombres de equipo YA
 * emparejados contra `jugadores.equipo_real`, ver lib/aliasEquipos.ts), da
 * la fuerza de cada equipo — para que el llamante calcule el factor de cada
 * jugador con factorPosicion(fuerza, jugador.posicion). Un equipo sin
 * partido cargado, o con cuotas inválidas, no aparece en el mapa: el
 * llamante debe usar factor 1 para sus jugadores y avisarlo en la vista
 * previa (partido sin cuotas, A.3).
 */
export function fuerzaPorEquipo(partidos: PartidoConCuotas[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const p of partidos) {
    if (!cuotaValidaFutbol(p.cuota1) || !cuotaValidaFutbol(p.cuotaX) || !cuotaValidaFutbol(p.cuota2)) continue;
    const { fuerzaLocal, fuerzaVisit } = fuerzaPartido(p.cuota1, p.cuotaX, p.cuota2);
    mapa.set(p.equipoLocal, fuerzaLocal);
    mapa.set(p.equipoVisitante, fuerzaVisit);
  }
  return mapa;
}

// ----------------------------------------------------------------------------
// Paso 4 — reglas de seguridad
// ----------------------------------------------------------------------------

type JugadorParaReglas = { id: string; posicion: PosicionFutbol; precio: number };

function sumaTop(lista: number[], n: number): number {
  let suma = 0;
  for (let i = 0; i < n && i < lista.length; i++) suma += lista[i];
  return suma;
}

function cumpleReglasFutbol(jugadores: JugadorParaReglas[], cfg: ConfigPrecioFutbol): boolean {
  const porLinea: Record<LineaFutbol, number[]> = { POR: [], DEF: [], MED: [], DEL: [] };
  for (const j of jugadores) porLinea[lineaDePosicionFutbol(j.posicion)].push(j.precio);
  // Copia ascendente (los más baratos primero) para la Regla 3, antes de ordenar porLinea descendente para la Regla 1.
  const porLineaAsc: Record<LineaFutbol, number[]> = {
    POR: [...porLinea.POR].sort((a, b) => a - b),
    DEF: [...porLinea.DEF].sort((a, b) => a - b),
    MED: [...porLinea.MED].sort((a, b) => a - b),
    DEL: [...porLinea.DEL].sort((a, b) => a - b),
  };
  (Object.keys(porLinea) as LineaFutbol[]).forEach((k) => porLinea[k].sort((a, b) => b - a));

  // Regla 1: el once más caro posible (la alineación que más cueste) >= 110% del presupuesto.
  let algunaFormacionFactible = false;
  let maxOnceMasCaro = -Infinity;
  let minOnceMasBarato = Infinity;
  for (const f of FORMACIONES_FUTBOL) {
    const h = huecosPorLinea(f.alineacion);
    if (porLinea.POR.length < h.POR || porLinea.DEF.length < h.DEF || porLinea.MED.length < h.MED || porLinea.DEL.length < h.DEL) continue;
    algunaFormacionFactible = true;
    const costeMax = sumaTop(porLinea.POR, h.POR) + sumaTop(porLinea.DEF, h.DEF) + sumaTop(porLinea.MED, h.MED) + sumaTop(porLinea.DEL, h.DEL);
    if (costeMax > maxOnceMasCaro) maxOnceMasCaro = costeMax;
    const costeMin = sumaAscendente(porLineaAsc.POR, h.POR) + sumaAscendente(porLineaAsc.DEF, h.DEF) + sumaAscendente(porLineaAsc.MED, h.MED) + sumaAscendente(porLineaAsc.DEL, h.DEL);
    if (costeMin < minOnceMasBarato) minOnceMasBarato = costeMin;
  }
  // Plantilla demasiado pequeña para formar ninguna alineación (jornada de prueba, pool minúsculo) — no bloquea.
  if (!algunaFormacionFactible) return true;
  const regla1 = maxOnceMasCaro >= cfg.presupuesto * 1.1;
  // Regla 3 (25/09): el once más barato posible no debe superar esta fracción del presupuesto.
  const regla3 = minOnceMasBarato <= cfg.presupuesto * cfg.fraccionMaxOnceBarato;

  // Regla 2: los 3 más caros + los más baratos que completen una alineación válida, caben en el presupuesto.
  const ordenados = [...jugadores].sort((a, b) => b.precio - a.precio);
  if (ordenados.length < 3) return regla1;
  const top3 = ordenados.slice(0, 3);
  const top3Ids = new Set(top3.map((j) => j.id));

  const baratosPorLinea: Record<LineaFutbol, number[]> = { POR: [], DEF: [], MED: [], DEL: [] };
  for (const j of jugadores) {
    if (top3Ids.has(j.id)) continue;
    baratosPorLinea[lineaDePosicionFutbol(j.posicion)].push(j.precio);
  }
  (Object.keys(baratosPorLinea) as LineaFutbol[]).forEach((k) => baratosPorLinea[k].sort((a, b) => a - b));

  let mejorCompletado: number | null = null;
  for (const f of FORMACIONES_FUTBOL) {
    const h = huecosPorLinea(f.alineacion);
    const restantes: Record<LineaFutbol, number> = { ...h };
    let factible = true;
    for (const t of top3) {
      const l = lineaDePosicionFutbol(t.posicion);
      restantes[l] -= 1;
      if (restantes[l] < 0) { factible = false; break; }
    }
    if (!factible) continue;

    let totalRestante = 0;
    for (const l of ['POR', 'DEF', 'MED', 'DEL'] as LineaFutbol[]) {
      const necesarios = restantes[l];
      if (necesarios === 0) continue;
      if (baratosPorLinea[l].length < necesarios) { factible = false; break; }
      totalRestante += sumaAscendente(baratosPorLinea[l], necesarios);
    }
    if (!factible) continue;

    const total = top3.reduce((s, j) => s + j.precio, 0) + totalRestante;
    if (mejorCompletado === null || total < mejorCompletado) mejorCompletado = total;
  }
  // Ninguna alineación cabe con estos 3 jugadores concretos (posiciones raras en un pool pequeño) — no bloquea esta regla.
  if (mejorCompletado === null) return regla1 && regla3;
  const regla2 = mejorCompletado <= cfg.presupuesto;
  return regla1 && regla2 && regla3;
}

function sumaAscendente(lista: number[], n: number): number {
  let suma = 0;
  for (let i = 0; i < n; i++) suma += lista[i];
  return suma;
}

// lineaDePosicion (salaShared) espera el mismo texto que jugadores.posicion — alias local por claridad de tipos.
function lineaDePosicionFutbol(posicion: PosicionFutbol): LineaFutbol {
  return lineaDePosicion(posicion);
}

// ----------------------------------------------------------------------------
// Mediana (caso especial A.5 — jugador sin valor de mercado)
// ----------------------------------------------------------------------------

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 !== 0 ? ordenados[mid] : Math.round((ordenados[mid - 1] + ordenados[mid]) / 2);
}

// ----------------------------------------------------------------------------
// Precios para un (TOPE, γ) dados
// ----------------------------------------------------------------------------

type Interno = { id: string; posicion: PosicionFutbol; nivel: number | null; nivelAjustado: number | null; precio: number; sinValor: boolean };

function preciosParaFutbol(
  validos: { id: string; posicion: PosicionFutbol; nivel: number; nivelAjustado: number }[],
  sinValor: { id: string; posicion: PosicionFutbol }[],
  nivelAjustadoMax: number,
  tope: number,
  gamma: number,
  cfg: ConfigPrecioFutbol
): Interno[] {
  const redondear = (v: number) => Math.round(v / cfg.redondeo) * cfg.redondeo;
  // Tope reducido para porteros (25/09) — ver cabecera del archivo, punto 6.1.
  const topePortero = cfg.minimo + (tope - cfg.minimo) * cfg.porteroFraccionTope;

  const preciosValidos: Interno[] = validos.map((j) => {
    const ratio = nivelAjustadoMax > 0 ? Math.max(0, j.nivelAjustado) / nivelAjustadoMax : 0;
    const topeJugador = j.posicion === 'portero' ? topePortero : tope;
    const precio = redondear(cfg.minimo + (topeJugador - cfg.minimo) * Math.pow(ratio, gamma));
    return { id: j.id, posicion: j.posicion, nivel: j.nivel, nivelAjustado: j.nivelAjustado, precio, sinValor: false };
  });

  const posiciones: PosicionFutbol[] = ['portero', 'defensa', 'centrocampista', 'delantero'];
  const medianaPorPosicion: Partial<Record<PosicionFutbol, number>> = {};
  for (const pos of posiciones) {
    const precios = preciosValidos.filter((j) => j.posicion === pos).map((j) => j.precio);
    if (precios.length > 0) medianaPorPosicion[pos] = mediana(precios);
  }
  const medianaGeneral = preciosValidos.length > 0 ? mediana(preciosValidos.map((j) => j.precio)) : cfg.minimo;

  const preciosSinValor: Interno[] = sinValor.map((j) => ({
    id: j.id,
    posicion: j.posicion,
    nivel: null,
    nivelAjustado: null,
    precio: medianaPorPosicion[j.posicion] ?? medianaGeneral,
    sinValor: true,
  }));

  return [...preciosValidos, ...preciosSinValor];
}

// ----------------------------------------------------------------------------
// Paso 5 — búsqueda automática de (TOPE, γ)
// ----------------------------------------------------------------------------

function buscarTopeYGamma(
  validos: { id: string; posicion: PosicionFutbol; nivel: number; nivelAjustado: number }[],
  sinValor: { id: string; posicion: PosicionFutbol }[],
  nivelAjustadoMax: number,
  cfg: ConfigPrecioFutbol
): { tope: number; gamma: number; cumple: boolean } {
  const fraccionInicial = cfg.topeInicial / cfg.presupuesto;
  const topeMin = cfg.presupuesto * cfg.topeMinimoFraccion;
  const topeMax = cfg.presupuesto * cfg.topeMaximoFraccion;

  let mejor: { tope: number; gamma: number; coste: number; cumple: boolean } | null = null;

  for (let tope = topeMin; tope <= topeMax + 1e-6; tope += cfg.presupuesto * cfg.pasoTopeFraccion) {
    const topeRedondeado = Math.round(tope / cfg.redondeo) * cfg.redondeo;
    const fraccionTope = topeRedondeado / cfg.presupuesto;
    for (let gamma = cfg.gammaMinima; gamma <= cfg.gammaMaxima + 1e-9; gamma += cfg.pasoGamma) {
      const gammaRedondeado = Math.round(gamma * 100) / 100;
      const precios = preciosParaFutbol(validos, sinValor, nivelAjustadoMax, topeRedondeado, gammaRedondeado, cfg);
      const cumple = cumpleReglasFutbol(precios, cfg);
      const coste = 10 * Math.abs(fraccionInicial - fraccionTope) + Math.abs(gammaRedondeado - cfg.gammaInicial);
      if (!mejor || (cumple && !mejor.cumple) || (cumple === mejor.cumple && coste < mejor.coste)) {
        mejor = { tope: topeRedondeado, gamma: gammaRedondeado, coste, cumple };
      }
    }
  }

  return mejor ?? { tope: cfg.topeInicial, gamma: cfg.gammaInicial, cumple: false };
}

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------

export type JugadorParaPrecioFutbol = {
  id: string;
  posicion: PosicionFutbol;
  /** null / undefined / <= 0 → caso especial A.5 (sin valor de mercado). */
  valorMercado: number | null | undefined;
  /** Factor ya resuelto por el llamante (ver fuerzaPorEquipo + factorPosicion). 1 si no hay cuotas para su partido. */
  factorPartido?: number | null;
};

export type JugadorConPrecioFutbol = {
  id: string;
  posicion: PosicionFutbol;
  valorMercado: number | null;
  nivel: number | null;
  nivelAjustado: number | null;
  precio: number;
  /** true si no tenía valor de mercado válido y se le ha puesto la mediana de su posición (A.5) — guardar en jugadores.valor_a_revisar. */
  sinValor: boolean;
};

export type ResultadoPreciosFutbol = {
  precios: JugadorConPrecioFutbol[];
  topeUsado: number;
  gammaUsado: number;
  /** false si ni siquiera la mejor combinación del grid cumple las tres reglas de seguridad. */
  reglasCumplidas: boolean;
};

export function calcularPreciosFutbolDetallado(
  jugadores: JugadorParaPrecioFutbol[],
  config: Partial<ConfigPrecioFutbol> = {},
  /**
   * Rango de valor de mercado (mín/máx) a usar para el nivel base — 25/09,
   * ver cabecera del archivo, punto 1 y 6.3. Cuando se pasa (recomendado:
   * el mín/máx de TODA la tabla de valores de mercado cargada para la
   * competición, no solo de los equipos que juegan esta jornada), el nivel
   * de cada jugador queda estable jornada a jornada, sin depender de qué
   * otros equipos juegan esa semana en concreto. Si se omite, se calcula
   * (como antes) a partir de la propia lista `jugadores` recibida — pensado
   * solo para pruebas o para cuando de verdad no hay más tabla que esa.
   */
  rangoNivel?: { valorMin: number; valorMax: number }
): ResultadoPreciosFutbol {
  const cfg: ConfigPrecioFutbol = {
    presupuesto: EQUIPO_PRESUPUESTO,
    ...PRECIO_FUTBOL_CONFIG,
    ...config,
  };

  const tieneValor = (j: JugadorParaPrecioFutbol) => typeof j.valorMercado === 'number' && Number.isFinite(j.valorMercado) && j.valorMercado > 0;
  const conValorInput = jugadores.filter(tieneValor);
  const sinValorInput = jugadores.filter((j) => !tieneValor(j));

  if (conValorInput.length === 0) {
    // No hay ningún valor de mercado cargado todavía — no debería pasar en producción
    // (el cargador de valores se confirma antes que las cuotas), pero no bloquea.
    return {
      precios: jugadores.map((j) => ({ id: j.id, posicion: j.posicion, valorMercado: null, nivel: null, nivelAjustado: null, precio: cfg.minimo, sinValor: true })),
      topeUsado: cfg.topeInicial,
      gammaUsado: cfg.gammaInicial,
      reglasCumplidas: false,
    };
  }

  const valores = conValorInput.map((j) => j.valorMercado as number);
  const valorMin = rangoNivel && rangoNivel.valorMin > 0 ? Math.min(rangoNivel.valorMin, ...valores) : Math.min(...valores);
  const valorMax = rangoNivel && rangoNivel.valorMax > 0 ? Math.max(rangoNivel.valorMax, ...valores) : Math.max(...valores);

  const validos = conValorInput.map((j) => {
    const nivel = nivelBase(j.valorMercado as number, valorMin, valorMax);
    const factor = typeof j.factorPartido === 'number' && Number.isFinite(j.factorPartido) ? j.factorPartido : 1;
    return { id: j.id, posicion: j.posicion, nivel, nivelAjustado: nivel * factor };
  });
  const nivelAjustadoMax = Math.max(...validos.map((j) => j.nivelAjustado));

  const sinValor = sinValorInput.map((j) => ({ id: j.id, posicion: j.posicion }));

  const { tope, gamma, cumple } = buscarTopeYGamma(validos, sinValor, nivelAjustadoMax, cfg);
  const internos = preciosParaFutbol(validos, sinValor, nivelAjustadoMax, tope, gamma, cfg);
  const porId = new Map(internos.map((j) => [j.id, j]));

  const precios: JugadorConPrecioFutbol[] = jugadores.map((j) => {
    const i = porId.get(j.id)!;
    return {
      id: j.id,
      posicion: j.posicion,
      valorMercado: tieneValor(j) ? (j.valorMercado as number) : null,
      nivel: i.nivel,
      nivelAjustado: i.nivelAjustado,
      precio: i.precio,
      sinValor: i.sinValor,
    };
  });

  return { precios, topeUsado: tope, gammaUsado: gamma, reglasCumplidas: cumple };
}

/** Atajo para quien solo necesita los precios (uso habitual en la vista previa de /admin). */
export function calcularPreciosFutbol(
  jugadores: JugadorParaPrecioFutbol[],
  config: Partial<ConfigPrecioFutbol> = {},
  rangoNivel?: { valorMin: number; valorMax: number }
): JugadorConPrecioFutbol[] {
  return calcularPreciosFutbolDetallado(jugadores, config, rangoNivel).precios;
}
