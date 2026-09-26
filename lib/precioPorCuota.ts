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
 * 2. Curva de precio EN DOS TRAMOS (el segundo tramo es nuevo, 26/09 — ver el punto 5):
 *      Tramo "top" (los top20Tamano mejores por cuota, o todo el campo si es más
 *      pequeño): interpola entre precioFavorito (rank 1) y precioTopK (el precio del
 *      último del grupo top) usando la misma forma de curva de cuotas de siempre,
 *      pero re-escalada para que encaje exactamente en esos dos extremos.
 *      Tramo "cola" (el resto del campo, solo existe si hay más jugadores que
 *      top20Tamano): interpola entre precioTopK y precioMinimo con la curva de
 *      siempre, re-anclada en precioTopK en vez de en precioFavorito.
 *    En campos pequeños (≤ campoPequenoUmbral) no hay tramo "top" separado — es
 *    exactamente la curva única de siempre, sin cambios respecto a lo ya validado.
 * 3. Reglas de seguridad, sobre equipos de TAMANO_EQUIPO_GOLF_TENIS (5) jugadores:
 *      Regla 1: los 5 más caros (menor cuota) deben sumar >= 110% del presupuesto —
 *               nunca cabe el equipo de puros favoritos.
 *      Regla 2: los 2 más caros + los 3 más baratos de TODO el campo deben caber en
 *               el presupuesto — siempre se puede fichar a los dos primeros favoritos
 *               y aun así completar equipo. Se apoya en que el tramo "cola" sigue
 *               bajando hasta precioMinimo igual que siempre, así que esta regla no
 *               se ve afectada por la compresión del tramo "top" (ver el punto 5).
 *      Regla 3 (nueva, 26/09 — solo si hay tramo "cola", es decir, campo > top20Tamano):
 *               los 5 más baratos DENTRO del top 20 por cuota deben sumar >= 90% del
 *               presupuesto — nunca se puede montar un equipo entero con jugadores
 *               "buenos pero no favoritos" (top 20) sobrando mucho presupuesto.
 * 4. Búsqueda automática de (fracción, γ) que cumplan las reglas activas, moviéndose lo
 *    mínimo posible de los valores de partida (fracciónObjetivo y γ=0,95):
 *      fracción: desde fracciónObjetivo hacia abajo hasta 0,35, en pasos de 0,005.
 *      γ (el de la cola — ver el punto 5): de 0,50 a 2,00, en pasos de 0,01.
 *      Entre las combinaciones válidas, se minimiza coste = 10×(fracciónObjetivo−fracción) + |γ−0,95|
 *      (es decir, se sacrifica antes la inclinación de la curva que el precio del favorito).
 *    Si ninguna combinación del grid cumple las reglas activas (pool muy pequeño o cuotas
 *    muy repartidas), se usa la mejor combinación encontrada (la de coste más bajo)
 *    aunque no cumpla del todo — nunca se bloquea el cálculo de precios por esto.
 * 5. **Compresión del tramo "top" por tamaño de campo (nuevo, 26/09)** — pedido de Iñi
 *    tras montar un equipo de golf con un torneo de ~140 jugadores: "creo que la
 *    diferencia de precios tiene que ser todo mucho más consecutivo, no puede haber
 *    tanta diferencia... el algoritmo tiene que ser diferente cuando hay pocos
 *    jugadores participantes... que cuando hay muchos [ej. 140 en golf]... no digo que
 *    los jugadores de arriba tengan menos valor... pero los siguientes jugadores... las
 *    diferencias no pueden ser tan grandes" — acabó fichando 5 jugadores del top 20 con
 *    presupuesto de sobra, señal de que los precios caían demasiado rápido fuera de los
 *    4-5 primeros favoritos.
 *
 *    Primer intento (descartado): subir directamente el precio mínimo de todo el
 *    cálculo ("suelo") en campos grandes. Comprimía bien el top 20 (arreglaba la queja
 *    de Iñi), pero de rebote también encarecía a los jugadores con peor cuota de todo
 *    el campo (los que antes costaban cerca del mínimo) — y eso rompía la Regla 2: con
 *    todo el campo más caro, los "2 favoritos + 3 más baratos" dejaban de caber en el
 *    presupuesto (106.600 € de 100.000 € en la prueba con el Open de France), así que
 *    fichar a los dos favoritos podía dejarte sin ninguna forma legal de completar
 *    equipo. Solución: separar el campo en dos tramos (arriba). Solo se comprime el
 *    tramo "top" (donde estaba la queja real); la cola del campo (jugadores con
 *    cuotas mucho peores, pensados como "relleno barato" para cuadrar presupuesto)
 *    sigue bajando hasta `precioMinimo` exactamente igual que siempre, así que la
 *    Regla 2 no se ve afectada.
 *
 *    `precioTopK` (el precio del último jugador del grupo top20) se fija como una
 *    fracción de `precioFavorito` que crece con el tamaño del campo — `topKFraccion`,
 *    interpolada linealmente entre `topKFraccionCampoPequeno` (justo por encima del
 *    umbral pequeño) y `topKFraccionCampoGrande` (en campos de `campoGrandeUmbral`
 *    jugadores o más). Con `topKFraccionCampoGrande = 0,6`, el jugador nº20 de un
 *    campo grande cuesta el 60% del favorito en vez de, como antes, acercarse al
 *    precio mínimo — así el 20 cuesta notablemente menos que el 1º (las cuotas se
 *    siguen notando) pero sin el desplome brusco que dejaba escoger 5 jugadores del
 *    top 20 casi al precio mínimo.
 *
 *    A falta de una cifra exacta que dar, Iñi pidió mirar de referencia DraftKings: su
 *    reparto de un campo de 132 jugadores del PGA Tour (Biltmore Championship,
 *    20/09/2026) va de 6.200 $ a 10.500 $, una proporción de solo ~1,7 veces entre el
 *    primero y el último. No se copia ese ratio tal cual — es un sistema de puntos por
 *    rendimiento proyectado, no de probabilidad de victoria pura, y además solo cubre
 *    el campo completo (no compara "top 20" con el resto) — pero confirma que la
 *    horquilla real del mercado es mucho más estrecha de lo que salía antes; 0,6 para
 *    el tramo top es un punto intermedio razonable, ni tan plano como DraftKings ni
 *    tan escalonado como la versión anterior.
 *
 * Validado en scripts/probar-precios.ts contra tres casos:
 *   - ATP Hangzhou (23 jugadores, campo pequeño): sin cambios respecto a la versión
 *     anterior — fracción al tope (0,55), γ=1,18, curva única (sin tramo top).
 *   - Open de France (142 jugadores, campo grande, cuota favorito 8,50): precios
 *     recalculados con el tramo top comprimido (26/09) — ya NO coinciden con la
 *     versión anterior a propósito, es justo lo que pedía Iñi. Los 3 más baratos de
 *     todo el campo siguen bajando cerca del mínimo (Regla 2 intacta).
 *   - Campo sintético de 140 jugadores con cuotas muy repartidas (26/09, nuevo):
 *     confirma que la Regla 3 se cumple con margen y que las tres reglas siguen
 *     cumpliéndose a la vez.
 */
import { EQUIPO_PRESUPUESTO, TAMANO_EQUIPO_GOLF_TENIS } from './draftConfig';

export const PRECIO_CUOTA_CONFIG = {
  /** Fracción mínima y máxima del presupuesto que puede costar el favorito. */
  fraccionMinima: 0.35,
  fraccionMaxima: 0.55,
  /** Paso de la búsqueda de fracción (de la objetivo hacia fraccionMinima). */
  pasoFraccion: 0.005,
  /** Rango y paso de la búsqueda de γ (afinado de la curva de la cola). */
  gammaMinima: 0.5,
  gammaMaxima: 2.0,
  pasoGamma: 0.01,
  /** γ de la curva dentro del tramo "top" — fijo, no se busca (el tramo top ya queda anclado por topKFraccion). */
  gammaTop: 1.0,
  /** γ y fracción de partida — el coste de la búsqueda mide cuánto nos alejamos de aquí. */
  gammaPreferido: 0.95,
  /** Precio del jugador con menos opciones (y de cualquiera sin cuota válida). */
  precioMinimo: 3_500,
  /** Los precios se redondean a este múltiplo. */
  redondeo: 100,
  /** Tamaño del equipo para las reglas de seguridad. */
  tamanoEquipo: TAMANO_EQUIPO_GOLF_TENIS,
  /** Campo con este nº de jugadores (con cuota válida) o menos: curva única, sin tramo top separado. */
  campoPequenoUmbral: 30,
  /** Campo con este nº de jugadores o más: compresión máxima del tramo top (topKFraccionCampoGrande). */
  campoGrandeUmbral: 120,
  /** Tamaño del grupo "top" (por cuota) que recibe el tramo comprimido y sobre el que se aplica la Regla 3. */
  top20Tamano: 20,
  /** Fracción de precioFavorito que cuesta el último del top 20 justo por encima del umbral pequeño. */
  topKFraccionCampoPequeno: 0.3,
  /** Fracción de precioFavorito que cuesta el último del top 20 en campos de campoGrandeUmbral o más (26/09). */
  topKFraccionCampoGrande: 0.6,
  /** Fracción mínima del presupuesto que deben sumar los 5 más baratos del top 20 (Regla 3). */
  top20MinFraccionPresupuesto: 0.9,
} as const;

export type ConfigPrecioCuota = {
  presupuesto: number;
  fraccionMinima: number;
  fraccionMaxima: number;
  pasoFraccion: number;
  gammaMinima: number;
  gammaMaxima: number;
  pasoGamma: number;
  gammaTop: number;
  gammaPreferido: number;
  precioMinimo: number;
  redondeo: number;
  tamanoEquipo: number;
  campoPequenoUmbral: number;
  campoGrandeUmbral: number;
  top20Tamano: number;
  topKFraccionCampoPequeno: number;
  topKFraccionCampoGrande: number;
  top20MinFraccionPresupuesto: number;
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

/**
 * Tamaño del grupo "top" para este campo, y fracción de precioFavorito que cuesta su
 * último jugador (26/09 — ver el punto 5 de la cabecera del archivo). `topK === null`
 * cuando el campo es pequeño y no hace falta ningún tramo separado (curva única, igual
 * que siempre). En campo grande, topK = min(top20Tamano, numJugadores − 1) — siempre
 * deja al menos un jugador para el tramo "cola", que es el que mantiene la Regla 2.
 */
function tramoTopParaCampo(numJugadores: number, cfg: ConfigPrecioCuota): { topK: number; fraccion: number } | null {
  if (numJugadores <= cfg.campoPequenoUmbral) return null;
  const topK = Math.min(cfg.top20Tamano, numJugadores - 1);
  const t = Math.min(1, (numJugadores - cfg.campoPequenoUmbral) / (cfg.campoGrandeUmbral - cfg.campoPequenoUmbral));
  const fraccion = cfg.topKFraccionCampoPequeno + t * (cfg.topKFraccionCampoGrande - cfg.topKFraccionCampoPequeno);
  return { topK, fraccion };
}

/**
 * Precio de cada jugador (cuotasOrdenadas ya ascendente: más favorito primero) para una
 * fracción/γ dadas. Si `tramoTop` es null, es la curva única de siempre. Si no, los
 * primeros `tramoTop.topK` jugadores usan la curva re-escalada entre precioFavorito y
 * precioTopK, y el resto usa la curva de siempre re-anclada entre precioTopK y precioMinimo.
 */
function preciosPara(
  cuotasOrdenadas: number[],
  cuotaFavorito: number,
  fraccion: number,
  gamma: number,
  tramoTop: { topK: number; fraccion: number } | null,
  cfg: ConfigPrecioCuota
): number[] {
  const precioFavorito = cfg.presupuesto * fraccion;
  const redondear = (v: number) => Math.round(v / cfg.redondeo) * cfg.redondeo;

  if (!tramoTop) {
    return cuotasOrdenadas.map((cuota) => {
      const peso = Math.pow(cuotaFavorito / cuota, gamma);
      return redondear(cfg.precioMinimo + (precioFavorito - cfg.precioMinimo) * peso);
    });
  }

  const { topK, fraccion: topKFraccion } = tramoTop;
  const cuotaTopK = cuotasOrdenadas[topK - 1];
  const precioTopK = precioFavorito * topKFraccion;
  const pesoTopK = Math.pow(cuotaFavorito / cuotaTopK, cfg.gammaTop);
  const rangoTop = Math.max(1 - pesoTopK, 0.01); // evita dividir por ~0 si el campo top es casi homogéneo

  return cuotasOrdenadas.map((cuota, i) => {
    if (i < topK) {
      // Tramo "top": misma forma de curva de cuotas de siempre, re-escalada para que
      // el rank 1 dé exactamente precioFavorito y el rank topK dé exactamente precioTopK.
      const peso = Math.pow(cuotaFavorito / cuota, cfg.gammaTop);
      const normalizado = (peso - pesoTopK) / rangoTop;
      return redondear(precioTopK + (precioFavorito - precioTopK) * normalizado);
    }
    // Tramo "cola": la curva de siempre, re-anclada en precioTopK en vez de en
    // precioFavorito — sigue bajando hasta precioMinimo para los peor clasificados,
    // que es lo que mantiene la Regla 2 (completar equipo tras fichar a los favoritos).
    const peso = Math.pow(cuotaTopK / cuota, gamma);
    return redondear(cfg.precioMinimo + (precioTopK - cfg.precioMinimo) * peso);
  });
}

function cumpleReglas(precios: number[], numJugadores: number, cfg: ConfigPrecioCuota): boolean {
  const n = cfg.tamanoEquipo;
  if (precios.length < n) return true; // pool demasiado pequeño para aplicar las reglas — no bloquea
  // precios ya viene ordenado por cuota ascendente (más favorito = más caro primero).
  const regla1 = precios.slice(0, n).reduce((s, p) => s + p, 0) >= cfg.presupuesto * 1.1;
  const ultimos = precios.slice(-3); // los 3 con cuota más alta = los 3 más baratos del pool entero
  const regla2 = precios[0] + precios[1] + ultimos.reduce((s, p) => s + p, 0) <= cfg.presupuesto;
  // Regla 3 (nueva, 26/09): solo entra en juego cuando hay tramo "cola" (campo >
  // campoPequenoUmbral) — los 5 más baratos DENTRO del top 20 por cuota deben sumar al
  // menos el 90% del presupuesto, para que no se pueda montar un equipo entero de
  // jugadores "buenos pero no favoritos" con presupuesto de sobra (la queja real de Iñi).
  let regla3 = true;
  if (numJugadores > cfg.campoPequenoUmbral) {
    const top20 = precios.slice(0, Math.min(cfg.top20Tamano, precios.length));
    if (top20.length >= n) {
      const cincoMasBaratosDelTop = top20.slice(-n);
      regla3 = cincoMasBaratosDelTop.reduce((s, p) => s + p, 0) >= cfg.presupuesto * cfg.top20MinFraccionPresupuesto;
    }
  }
  return regla1 && regla2 && regla3;
}

/**
 * Busca la mejor (fracción, γ de la cola) — ver punto 4 de la cabecera del fichero.
 * Devuelve también si la combinación elegida cumple de verdad las reglas activas (para
 * avisar en la vista previa si no se ha encontrado ninguna combinación válida en el grid).
 */
function buscarFraccionYGamma(
  cuotasOrdenadas: number[],
  cuotaFavorito: number,
  numJugadores: number,
  cfg: ConfigPrecioCuota
): { fraccion: number; gamma: number; tramoTop: { topK: number; fraccion: number } | null; cumple: boolean } {
  const fraccionObjetivo = fraccionObjetivoDe(cuotaFavorito, cfg);
  const tramoTop = tramoTopParaCampo(numJugadores, cfg);

  let mejor: { fraccion: number; gamma: number; coste: number; cumple: boolean } | null = null;

  for (let fraccion = fraccionObjetivo; fraccion >= cfg.fraccionMinima - 1e-9; fraccion -= cfg.pasoFraccion) {
    const fraccionRedondeada = Math.round(fraccion * 1000) / 1000;
    for (let gamma = cfg.gammaMinima; gamma <= cfg.gammaMaxima + 1e-9; gamma += cfg.pasoGamma) {
      const gammaRedondeado = Math.round(gamma * 100) / 100;
      const precios = preciosPara(cuotasOrdenadas, cuotaFavorito, fraccionRedondeada, gammaRedondeado, tramoTop, cfg);
      const cumple = cumpleReglas(precios, numJugadores, cfg);
      const coste = 10 * (fraccionObjetivo - fraccionRedondeada) + Math.abs(gammaRedondeado - cfg.gammaPreferido);
      // Solo nos interesa el mínimo coste entre las combinaciones que cumplen las reglas;
      // si ninguna cumple, nos quedamos con la de coste más bajo igualmente (mejor esfuerzo).
      if (!mejor || (cumple && !mejor.cumple) || (cumple === mejor.cumple && coste < mejor.coste)) {
        mejor = { fraccion: fraccionRedondeada, gamma: gammaRedondeado, coste, cumple };
      }
    }
  }

  // Con el grid siempre hay al menos la combinación de partida (fracción objetivo, γ 0,95 redondeado al paso más cercano).
  const elegido = mejor ?? { fraccion: fraccionObjetivo, gamma: cfg.gammaPreferido, coste: 0, cumple: false };
  return { fraccion: elegido.fraccion, gamma: elegido.gamma, tramoTop, cumple: elegido.cumple };
}

export type ResultadoPreciosPorCuota = {
  precios: JugadorConPrecio[];
  /** Fracción y γ elegidos por la búsqueda automática — útil para depurar/mostrar en admin. */
  fraccionUsada: number;
  gammaUsado: number;
  /** Precio del último jugador del tramo "top" (26/09) — igual a precioMinimo en campos pequeños, donde no hay tramo top. */
  precioTopKUsado: number;
  /** false si ni siquiera la mejor combinación del grid cumple las reglas de seguridad activas. */
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
      precioTopKUsado: cfg.precioMinimo,
      reglasCumplidas: true,
    };
  }

  const cuotaFavorito = Math.min(...validas);
  const sumaProbabilidades = validas.reduce((s, c) => s + 1 / c, 0);
  const cuotasOrdenadas = [...validas].sort((a, b) => a - b);

  const { fraccion, gamma, tramoTop, cumple } = buscarFraccionYGamma(cuotasOrdenadas, cuotaFavorito, validas.length, cfg);
  const precioFavorito = cfg.presupuesto * fraccion;
  const redondear = (v: number) => Math.round(v / cfg.redondeo) * cfg.redondeo;

  const cuotaTopK = tramoTop ? cuotasOrdenadas[tramoTop.topK - 1] : null;
  const precioTopK = tramoTop ? precioFavorito * tramoTop.fraccion : cfg.precioMinimo;
  const pesoTopK = tramoTop ? Math.pow(cuotaFavorito / cuotaTopK!, cfg.gammaTop) : 0;
  const rangoTop = tramoTop ? Math.max(1 - pesoTopK, 0.01) : 1;

  const precios = jugadores.map((j) => {
    if (!cuotaValida(j.cuota)) {
      return { nombre: j.nombre, cuota: null, probabilidad: null, precio: cfg.precioMinimo, sinCuota: true };
    }
    const puesto = cuotasOrdenadas.indexOf(j.cuota); // primera coincidencia — suficiente para decidir el tramo (empates de cuota caen en el mismo tramo de todas formas)
    let precio: number;
    if (!tramoTop) {
      // Campo pequeño: curva única de siempre, con el γ buscado (no cfg.gammaTop, que
      // solo tiene sentido dentro del tramo "top" de un campo grande).
      const peso = Math.pow(cuotaFavorito / j.cuota, gamma);
      precio = redondear(cfg.precioMinimo + (precioFavorito - cfg.precioMinimo) * peso);
    } else if (puesto < tramoTop.topK) {
      const peso = Math.pow(cuotaFavorito / j.cuota, cfg.gammaTop);
      const normalizado = (peso - pesoTopK) / rangoTop;
      precio = redondear(precioTopK + (precioFavorito - precioTopK) * normalizado);
    } else {
      const peso = Math.pow(cuotaTopK! / j.cuota, gamma);
      precio = redondear(cfg.precioMinimo + (precioTopK - cfg.precioMinimo) * peso);
    }
    return {
      nombre: j.nombre,
      cuota: j.cuota,
      probabilidad: 1 / j.cuota / sumaProbabilidades,
      precio,
      sinCuota: false,
    };
  });

  return { precios, fraccionUsada: fraccion, gammaUsado: gamma, precioTopKUsado: redondear(precioTopK), reglasCumplidas: cumple };
}

/** Atajo para quien solo necesita los precios (el uso habitual en la vista previa de /admin). */
export function calcularPreciosPorCuota(jugadores: JugadorConCuota[], config: Partial<ConfigPrecioCuota> = {}): JugadorConPrecio[] {
  return calcularPreciosPorCuotaDetallado(jugadores, config).precios;
}
