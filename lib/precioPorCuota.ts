/**
 * Precio de fantasía de cada jugador a partir de la cuota de "Ganador" del torneo.
 * Usado en golf y tenis (sustituye a la curva por ranking de lib/pricing.ts para el precio;
 * los grupos de color de la porra clásica siguen saliendo del ranking mundial).
 *
 * Fórmula corregida (ENCARGO_precios_futbol_y_correccion_golf_tenis.md, parte B, 24/09/2026)
 * — sustituye a la versión anterior de fracción fija al 38%.
 *
 * Qué fallaba antes: con el favorito siempre al 38% del presupuesto, un favorito muy
 * claro (cuota baja, p. ej. 2,60 en el ATP de Hangzhou) no se diferenciaba lo bastante
 * del resto — los 5 favoritos cabían todos en el mismo equipo (99.500 € de 100.000 €),
 * justo lo que la Regla 1 de seguridad quiere evitar.
 *
 * 1. Fracción objetivo del favorito, según lo favorito que sea:
 *      fracciónObjetivo = limitar(0,30 + 0,68 / cuotaFavorito, mínimo 0,35, máximo 0,55)
 *    Con cuota 8,50 da 0,38 (igual que antes). Con cuota 2,60 llega al tope de 0,55.
 * 2. Curva de precio, misma forma que antes pero con la fracción de arriba:
 *      precio = MÍNIMO + (fracción × PRESUPUESTO − MÍNIMO) × (cuotaFavorito / cuota) ^ γ
 *      (redondeado a centenas)
 * 3. Dos reglas de seguridad, sobre equipos de TAMANO_EQUIPO_GOLF_TENIS (5) jugadores:
 *      Regla 1: los 5 más caros (menor cuota) deben sumar >= 110% del presupuesto —
 *               nunca cabe el equipo de puros favoritos.
 *      Regla 2: los 2 más caros + los 3 más baratos deben caber en el presupuesto —
 *               siempre se puede fichar a los dos primeros favoritos.
 * 4. Búsqueda automática de (fracción, γ) que cumplan las dos reglas, moviéndose lo
 *    mínimo posible de los valores de partida (fracciónObjetivo y γ=0,95):
 *      fracción: desde fracciónObjetivo hacia abajo hasta 0,35, en pasos de 0,005.
 *      γ: de 0,50 a 2,00, en pasos de 0,01.
 *      Entre las combinaciones válidas, se minimiza coste = 10×(fracciónObjetivo−fracción) + |γ−0,95|
 *      (es decir, se sacrifica antes la inclinación de la curva que el precio del favorito).
 *    Si ninguna combinación del grid cumple las dos reglas (pool muy pequeño o cuotas
 *    muy repartidas), se usa la mejor combinación encontrada (la de coste más bajo)
 *    aunque no cumpla del todo — nunca se bloquea el cálculo de precios por esto.
 *
 * Validado en scripts/probar-precios.ts contra dos casos reales:
 *   - Open de France (142 jugadores, cuota favorito 8,50): mismos precios que la
 *     versión anterior (fracción ya sale en 0,38 y las reglas ya se cumplen con γ=0,95).
 *   - ATP Hangzhou (23 jugadores, cuota favorito 2,60): fracción al tope (0,55), γ=1,18.
 */
import { EQUIPO_PRESUPUESTO, TAMANO_EQUIPO_GOLF_TENIS } from './draftConfig';

export const PRECIO_CUOTA_CONFIG = {
  /** Fracción mínima y máxima del presupuesto que puede costar el favorito. */
  fraccionMinima: 0.35,
  fraccionMaxima: 0.55,
  /** Paso de la búsqueda de fracción (de la objetivo hacia fraccionMinima). */
  pasoFraccion: 0.005,
  /** Rango y paso de la búsqueda de γ (afinado de la curva). */
  gammaMinima: 0.5,
  gammaMaxima: 2.0,
  pasoGamma: 0.01,
  /** γ y fracción de partida — el coste de la búsqueda mide cuánto nos alejamos de aquí. */
  gammaPreferido: 0.95,
  /** Precio del jugador con menos opciones (y de cualquiera sin cuota válida). */
  precioMinimo: 3_500,
  /** Los precios se redondean a este múltiplo. */
  redondeo: 100,
  /** Tamaño del equipo para las dos reglas de seguridad. */
  tamanoEquipo: TAMANO_EQUIPO_GOLF_TENIS,
} as const;

export type ConfigPrecioCuota = {
  presupuesto: number;
  fraccionMinima: number;
  fraccionMaxima: number;
  pasoFraccion: number;
  gammaMinima: number;
  gammaMaxima: number;
  pasoGamma: number;
  gammaPreferido: number;
  precioMinimo: number;
  redondeo: number;
  tamanoEquipo: number;
};

export type JugadorConCuota = { nombre: string; cuota: number | null | undefined };

export type JugadorConPrecio = {
  nombre: string;
  cuota: number | null;
  /** Probabilidad implícita normalizada (0-1), o null si no tiene cuota válida. */
  probabilidad: number | null;
  precio: number;
  /** true si no tenía cuota válida y se le ha puesto el precio mínimo. */
  sinCuota: boolean;
};

export function cuotaValida(cuota: number | null | undefined): cuota is number {
  return typeof cuota === 'number' && Number.isFinite(cuota) && cuota > 1;
}

function fraccionObjetivoDe(cuotaFavorito: number, cfg: ConfigPrecioCuota): number {
  const bruta = 0.3 + 0.68 / cuotaFavorito;
  return Math.min(cfg.fraccionMaxima, Math.max(cfg.fraccionMinima, bruta));
}

/** Precio de cada jugador (ordenados por cuota, más favorito primero) para una fracción/γ dadas. */
function preciosPara(cuotasOrdenadas: number[], cuotaFavorito: number, fraccion: number, gamma: number, cfg: ConfigPrecioCuota): number[] {
  const precioFavorito = cfg.presupuesto * fraccion;
  const redondear = (v: number) => Math.round(v / cfg.redondeo) * cfg.redondeo;
  return cuotasOrdenadas.map((cuota) => {
    const peso = Math.pow(cuotaFavorito / cuota, gamma);
    return redondear(cfg.precioMinimo + (precioFavorito - cfg.precioMinimo) * peso);
  });
}

function cumpleReglas(precios: number[], cfg: ConfigPrecioCuota): boolean {
  const n = cfg.tamanoEquipo;
  if (precios.length < n) return true; // pool demasiado pequeño para aplicar las reglas — no bloquea
  // precios ya viene ordenado por cuota ascendente (más favorito = más caro primero).
  const regla1 = precios.slice(0, n).reduce((s, p) => s + p, 0) >= cfg.presupuesto * 1.1;
  const ultimos = precios.slice(-3); // los 3 con cuota más alta = los 3 más baratos del pool entero
  const regla2 = precios[0] + precios[1] + ultimos.reduce((s, p) => s + p, 0) <= cfg.presupuesto;
  return regla1 && regla2;
}

/**
 * Busca la mejor (fracción, γ) — ver punto 4 de la cabecera del fichero. Devuelve también
 * si la combinación elegida cumple de verdad las dos reglas (para avisar en la vista previa
 * si no se ha encontrado ninguna combinación válida en el grid).
 */
function buscarFraccionYGamma(
  cuotasOrdenadas: number[],
  cuotaFavorito: number,
  cfg: ConfigPrecioCuota
): { fraccion: number; gamma: number; cumple: boolean } {
  const fraccionObjetivo = fraccionObjetivoDe(cuotaFavorito, cfg);

  let mejor: { fraccion: number; gamma: number; coste: number; cumple: boolean } | null = null;

  for (let fraccion = fraccionObjetivo; fraccion >= cfg.fraccionMinima - 1e-9; fraccion -= cfg.pasoFraccion) {
    const fraccionRedondeada = Math.round(fraccion * 1000) / 1000;
    for (let gamma = cfg.gammaMinima; gamma <= cfg.gammaMaxima + 1e-9; gamma += cfg.pasoGamma) {
      const gammaRedondeado = Math.round(gamma * 100) / 100;
      const precios = preciosPara(cuotasOrdenadas, cuotaFavorito, fraccionRedondeada, gammaRedondeado, cfg);
      const cumple = cumpleReglas(precios, cfg);
      const coste = 10 * (fraccionObjetivo - fraccionRedondeada) + Math.abs(gammaRedondeado - cfg.gammaPreferido);
      // Solo nos interesa el mínimo coste entre las combinaciones que cumplen las reglas;
      // si ninguna cumple, nos quedamos con la de coste más bajo igualmente (mejor esfuerzo).
      if (!mejor || (cumple && !mejor.cumple) || (cumple === mejor.cumple && coste < mejor.coste)) {
        mejor = { fraccion: fraccionRedondeada, gamma: gammaRedondeado, coste, cumple };
      }
    }
  }

  // Con el grid siempre hay al menos la combinación de partida (fracción objetivo, γ 0,95 redondeado al paso más cercano).
  return mejor ?? { fraccion: fraccionObjetivo, gamma: cfg.gammaPreferido, cumple: false };
}

export type ResultadoPreciosPorCuota = {
  precios: JugadorConPrecio[];
  /** Fracción y γ elegidos por la búsqueda automática — útil para depurar/mostrar en admin. */
  fraccionUsada: number;
  gammaUsado: number;
  /** false si ni siquiera la mejor combinación del grid cumple las dos reglas de seguridad. */
  reglasCumplidas: boolean;
};

export function calcularPreciosPorCuotaDetallado(
  jugadores: JugadorConCuota[],
  config: Partial<ConfigPrecioCuota> = {}
): ResultadoPreciosPorCuota {
  const cfg: ConfigPrecioCuota = {
    presupuesto: EQUIPO_PRESUPUESTO,
    ...PRECIO_CUOTA_CONFIG,
    ...config,
  };

  const validas = jugadores.map((j) => j.cuota).filter(cuotaValida);
  if (validas.length === 0) {
    return {
      precios: jugadores.map((j) => ({ nombre: j.nombre, cuota: null, probabilidad: null, precio: cfg.precioMinimo, sinCuota: true })),
      fraccionUsada: cfg.fraccionMinima,
      gammaUsado: cfg.gammaPreferido,
      reglasCumplidas: true,
    };
  }

  const cuotaFavorito = Math.min(...validas);
  const sumaProbabilidades = validas.reduce((s, c) => s + 1 / c, 0);
  const cuotasOrdenadas = [...validas].sort((a, b) => a - b);

  const { fraccion, gamma, cumple } = buscarFraccionYGamma(cuotasOrdenadas, cuotaFavorito, cfg);
  const precioFavorito = cfg.presupuesto * fraccion;
  const redondear = (v: number) => Math.round(v / cfg.redondeo) * cfg.redondeo;

  const precios = jugadores.map((j) => {
    if (!cuotaValida(j.cuota)) {
      return { nombre: j.nombre, cuota: null, probabilidad: null, precio: cfg.precioMinimo, sinCuota: true };
    }
    const peso = Math.pow(cuotaFavorito / j.cuota, gamma);
    const precio = redondear(cfg.precioMinimo + (precioFavorito - cfg.precioMinimo) * peso);
    return {
      nombre: j.nombre,
      cuota: j.cuota,
      probabilidad: 1 / j.cuota / sumaProbabilidades,
      precio,
      sinCuota: false,
    };
  });

  return { precios, fraccionUsada: fraccion, gammaUsado: gamma, reglasCumplidas: cumple };
}

/** Atajo para quien solo necesita los precios (el uso habitual en la vista previa de /admin). */
export function calcularPreciosPorCuota(jugadores: JugadorConCuota[], config: Partial<ConfigPrecioCuota> = {}): JugadorConPrecio[] {
  return calcularPreciosPorCuotaDetallado(jugadores, config).precios;
}
