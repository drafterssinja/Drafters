/**
 * Precio de fantasía de cada jugador de fútbol, a partir de su valor de
 * mercado de un fantasy oficial (LaLiga Fantasy / FPL / fantasy de la UEFA)
 * y, cuando están cargadas, las cuotas 1X2 del partido de esa jornada.
 *
 * ENCARGO_precios_futbol_y_correccion_golf_tenis.md, parte A.3 (24/09/2026).
 * Sustituye (salvo como respaldo, ver A.5 y lib/pricing.ts) al precio fijo
 * por posición.
 *
 * 1. Nivel base (0-1) dentro de la competición, en escala logarítmica —
 *    porque el rango de valores es muy distinto según la competición (en
 *    LaLiga Fantasy hay de 0,4 M a 159 M, casi 400 veces; en el FPL de
 *    £4m a £15,5m, unas 4 veces):
 *      nivel = (ln(valor) − ln(valor_mín)) / (ln(valor_máx) − ln(valor_mín))
 *    (valor_mín/valor_máx son los de la tabla de valores cargada para esa
 *    competición, no de toda la jornada).
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
 *      precio = MÍN + (TOPE − MÍN) × (nivel_ajustado / nivel_ajustado_máx) ^ γ
 *      (redondeado a centenas)
 *
 * 4. Dos reglas de seguridad, sobre las 4 alineaciones válidas de la app
 *    (4-3-3, 4-4-2, 3-5-2, 4-2-3-1 — ver FORMACIONES_FUTBOL):
 *      Regla 1: el once más caro posible (la alineación que más cueste)
 *               debe costar >= 110% del presupuesto.
 *      Regla 2: los 3 jugadores más caros, completados con los más baratos
 *               que formen una alineación válida, deben caber en el
 *               presupuesto.
 *
 * 5. Búsqueda automática de (TOPE, γ) que cumplan las dos reglas, moviéndose
 *    lo mínimo posible de los valores de partida (TOPE = 20% del
 *    presupuesto, γ = 1,0) — mismo método que golf/tenis: TOPE se mueve
 *    entre el 15% y el 25% del presupuesto, γ entre 0,5 y 3,0, minimizando
 *    coste = 10 × |fracción_TOPE_objetivo − fracción_TOPE| + |γ − γ_objetivo|.
 *
 * Los valores de partida (MÍN=2.500€, TOPE=20.000€, γ=1,0) están pendientes
 * de calibrar con datos reales (ENCARGO, A.8.1) — enseñar a Iñi el reparto
 * de precios de la primera jornada real antes de darlos por buenos.
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
  /** TOPE de partida: lo que cuesta el jugador con más nivel ajustado de la jornada. */
  topeInicial: 20_000,
  /** Rango de búsqueda de TOPE, como fracción del presupuesto. */
  topeMinimoFraccion: 0.15,
  topeMaximoFraccion: 0.25,
  /** Paso de la búsqueda de TOPE (como fracción del presupuesto). */
  pasoTopeFraccion: 0.005,
  /** Rango y paso de la búsqueda de γ. */
  gammaMinima: 0.5,
  gammaMaxima: 3.0,
  pasoGamma: 0.01,
  /** γ de partida — el coste de la búsqueda mide cuánto nos alejamos de aquí. */
  gammaInicial: 1.0,
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
  gammaMinima: number;
  gammaMaxima: number;
  pasoGamma: number;
  gammaInicial: number;
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
  (Object.keys(porLinea) as LineaFutbol[]).forEach((k) => porLinea[k].sort((a, b) => b - a));

  // Regla 1: el once más caro posible (la alineación que más cueste) >= 110% del presupuesto.
  let algunaFormacionFactible = false;
  let maxOnceMasCaro = -Infinity;
  for (const f of FORMACIONES_FUTBOL) {
    const h = huecosPorLinea(f.alineacion);
    if (porLinea.POR.length < h.POR || porLinea.DEF.length < h.DEF || porLinea.MED.length < h.MED || porLinea.DEL.length < h.DEL) continue;
    algunaFormacionFactible = true;
    const coste = sumaTop(porLinea.POR, h.POR) + sumaTop(porLinea.DEF, h.DEF) + sumaTop(porLinea.MED, h.MED) + sumaTop(porLinea.DEL, h.DEL);
    if (coste > maxOnceMasCaro) maxOnceMasCaro = coste;
  }
  // Plantilla demasiado pequeña para formar ninguna alineación (jornada de prueba, pool minúsculo) — no bloquea.
  if (!algunaFormacionFactible) return true;
  const regla1 = maxOnceMasCaro >= cfg.presupuesto * 1.1;

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
  if (mejorCompletado === null) return regla1;
  const regla2 = mejorCompletado <= cfg.presupuesto;
  return regla1 && regla2;
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

  const preciosValidos: Interno[] = validos.map((j) => {
    const ratio = nivelAjustadoMax > 0 ? Math.max(0, j.nivelAjustado) / nivelAjustadoMax : 0;
    const precio = redondear(cfg.minimo + (tope - cfg.minimo) * Math.pow(ratio, gamma));
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
  /** false si ni siquiera la mejor combinación del grid cumple las dos reglas de seguridad. */
  reglasCumplidas: boolean;
};

export function calcularPreciosFutbolDetallado(
  jugadores: JugadorParaPrecioFutbol[],
  config: Partial<ConfigPrecioFutbol> = {}
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
  const valorMin = Math.min(...valores);
  const valorMax = Math.max(...valores);

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
export function calcularPreciosFutbol(jugadores: JugadorParaPrecioFutbol[], config: Partial<ConfigPrecioFutbol> = {}): JugadorConPrecioFutbol[] {
  return calcularPreciosFutbolDetallado(jugadores, config).precios;
}
