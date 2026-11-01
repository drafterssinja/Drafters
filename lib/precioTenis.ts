import { EQUIPO_PRESUPUESTO, TAMANO_EQUIPO_GOLF_TENIS } from '@/lib/draftConfig';
import { PUNTOS_TENIS } from '@/lib/tenisPuntuacion';

// ============================================================================
// PRECIO DE LOS JUGADORES DE TENIS (01/11, Iñi) — "como DraftKings"
// ============================================================================
// Problema: en el Masters de París se podían fichar 5 de los 8 primeros (todos
// hacían el mismo equipo). El precio salía de la probabilidad de GANAR el
// torneo con la curva de golf: del 6º-7º para abajo los precios caían muy
// rápido y el mínimo (4.000 €) dejaba mucho dinero para las estrellas.
//
// DraftKings (tenis): 6 jugadores, tope 50.000 $ (media 8.333 $). Precios de
// ~4.300 $ a ~11.000-12.000 $: el más caro ≈ 1,4-1,5× la media y el más barato
// ≈ 0,5× la media. Allí el precio sigue a los PUNTOS que se esperan de cada
// jugador, no a su probabilidad de ganar. Aquí, igual:
//
// 1. Puntos esperados en el torneo. Con la probabilidad p de ganarlo (de la
//    cuota de las casas o de la simulación del cuadro) y R rondas, la
//    probabilidad de ganar cada partido es q = p^(1/R). Cada partido jugado
//    vale de media ~18 puntos si lo pierde y ~72 si lo gana (tabla de tenis),
//    así que:  puntos = (18 + 54·q) · (1 − q^R) / (1 − q).
// 2. Precio = mínimo + (favorito − mínimo) · z^γ, con z = puntos normalizados
//    (0 el peor, 1 el mejor):
//      · favorito = media × k, k = 1,40 + 0,8 × prob. del favorito (entre 1,50
//        y 1,70) → 30.000-34.000 €;
//      · mínimo = 0,45 × media = 9.000 € (DraftKings ≈ 0,5×; aquí algo menos
//        porque el que cae en primera ronda puntúa poco). Con 9.000 € ya no se
//        pueden meter 4 de los 8 primeros + el más barato en París;
//      · γ hace que el jugador que cuesta la MEDIA (20.000 €) sea el puesto
//        ~20 % del cuadro (el 11º en un cuadro de 56, el 6º-7º en uno de 32),
//        con un máximo del 14º.
// 3. Reglas (si no se cumplen se mueve el puesto de la media):
//      · Con 5 jugadores NO caben 5 de los 8 primeros (los puestos 4º a 8º
//        suman ≥ 105 % del presupuesto).
//      · Los 2 más caros + los 3 más baratos SÍ caben.
// Cuotas iguales → mismo precio; nunca uno con mejor cuota cuesta menos.

export const PRECIO_TENIS = {
  minimoSobreMedia: 0.45,
  kBase: 1.4,
  kPorProbFavorito: 0.8,
  kMinimo: 1.5,
  kMaximo: 1.7,
  fraccionPuestoMedia: 0.2,
  puestoMediaMinimo: 5,
  puestoMediaMaximo: 14,
  margenTop8: 1.05,
  redondeo: 500,
} as const;

// Puntos medios de un partido perdido y de uno ganado (2 sets, 6-3 6-4 aprox.).
const P = PUNTOS_TENIS;
export const PUNTOS_PARTIDO_PERDIDO = P.jugado + 7 * P.juegoGanado + 12 * P.juegoPerdido + 2 * P.setPerdido + 1 * P.break; // ≈ 18
export const PUNTOS_PARTIDO_GANADO = P.jugado + 12 * P.juegoGanado + 7 * P.juegoPerdido + 2 * P.setGanado + P.partidoGanado + P.setsDirectos + 2.5 * P.break; // ≈ 72

export type JugadorTenisCuota = { nombre: string; cuota: number | null };
export type PrecioTenis = { nombre: string; cuota: number | null; prob: number | null; puntosEsperados: number | null; precio: number };

/** Puntos esperados en un torneo de R rondas con probabilidad p de ganarlo. */
export function puntosEsperadosTenis(p: number, rondas: number): number {
  const q = Math.min(0.999, Math.max(0.01, Math.pow(Math.max(p, 1e-9), 1 / rondas)));
  const partidos = (1 - Math.pow(q, rondas)) / (1 - q); // 1 + q + … + q^(R−1)
  return (PUNTOS_PARTIDO_PERDIDO + (PUNTOS_PARTIDO_GANADO - PUNTOS_PARTIDO_PERDIDO) * q) * partidos;
}

export function calcularPreciosTenisDetallado(
  jugadores: JugadorTenisCuota[],
  opciones: { presupuesto?: number; tamanoEquipo?: number } = {}
): { precios: PrecioTenis[]; favorito: number; minimo: number; gamma: number; puestoMedia: number; cumple: boolean } {
  const c = PRECIO_TENIS;
  const presupuesto = opciones.presupuesto ?? EQUIPO_PRESUPUESTO;
  const tam = opciones.tamanoEquipo ?? TAMANO_EQUIPO_GOLF_TENIS;
  const media = presupuesto / tam;
  const redondear = (x: number) => Math.round(x / c.redondeo) * c.redondeo;
  const minimo = redondear(media * c.minimoSobreMedia);
  const validas = jugadores.filter((j) => typeof j.cuota === 'number' && Number.isFinite(j.cuota) && j.cuota > 1);
  const n = jugadores.length;
  if (validas.length === 0) {
    return { precios: jugadores.map((j) => ({ nombre: j.nombre, cuota: null, prob: null, puntosEsperados: null, precio: minimo })), favorito: minimo, minimo, gamma: 1, puestoMedia: 0, cumple: false };
  }
  const suma = validas.reduce((s, j) => s + 1 / (j.cuota as number), 0);
  const rondas = Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
  const prob = (cuota: number) => 1 / cuota / suma;
  const pts = (cuota: number) => puntosEsperadosTenis(prob(cuota), rondas);
  const cuotasOrd = validas.map((j) => j.cuota as number).sort((a, b) => a - b);
  const ptsOrd = cuotasOrd.map(pts);
  const ptsMax = ptsOrd[0];
  const ptsMin = ptsOrd[ptsOrd.length - 1];
  const zDe = (x: number) => (ptsMax - ptsMin > 1e-9 ? Math.max(0, Math.min(1, (x - ptsMin) / (ptsMax - ptsMin))) : 1);
  const k = Math.min(c.kMaximo, Math.max(c.kMinimo, c.kBase + c.kPorProbFavorito * prob(cuotasOrd[0])));
  let favorito = media * k;

  const preciosCon = (gamma: number, fav: number) => ptsOrd.map((x) => redondear(minimo + (fav - minimo) * Math.pow(zDe(x), gamma)));
  const cumpleReglas = (pr: number[]) => {
    if (pr.length < tam) return true;
    const dosMasTres = pr[0] + pr[1] + pr.slice(-(tam - 2)).reduce((a, b) => a + b, 0);
    if (dosMasTres > presupuesto) return false;
    if (pr.length >= 12) return pr.slice(3, 3 + tam).reduce((a, b) => a + b, 0) >= presupuesto * c.margenTop8; // puestos 4º-8º
    return pr.slice(0, tam).reduce((a, b) => a + b, 0) >= presupuesto * 1.1;
  };
  const gammaPara = (r: number, fav: number) => {
    const z = zDe(ptsOrd[r - 1]);
    const objetivo = (media - minimo) / (fav - minimo);
    const g = z > 0 && z < 1 && objetivo > 0 && objetivo < 1 ? Math.log(objetivo) / Math.log(z) : 1;
    return Math.min(6, Math.max(0.3, g));
  };

  const nv = ptsOrd.length;
  const rBase = Math.min(c.puestoMediaMaximo, Math.max(c.puestoMediaMinimo, Math.round(nv * c.fraccionPuestoMedia)), Math.max(2, nv - 1));
  const candidatos = [rBase, ...Array.from({ length: 12 }, (_, i) => rBase + i + 1), ...Array.from({ length: 3 }, (_, i) => rBase - i - 1)].filter((r) => r >= 2 && r <= nv - 1);
  let elegido = { gamma: gammaPara(rBase, favorito), r: rBase, cumple: false };
  buscar: for (let paso = 0; paso < 6; paso++) {
    for (const r of candidatos) {
      const g = gammaPara(r, favorito);
      if (cumpleReglas(preciosCon(g, favorito))) {
        elegido = { gamma: g, r, cumple: true };
        break buscar;
      }
    }
    favorito = Math.max(media * 1.2, favorito - media * 0.05); // si los 2 más caros no caben con los 3 más baratos
  }
  if (!elegido.cumple) elegido = { ...elegido, gamma: gammaPara(rBase, favorito) };

  const precioDe = (cuota: number) => redondear(minimo + (favorito - minimo) * Math.pow(zDe(pts(cuota)), elegido.gamma));
  return {
    precios: jugadores.map((j) =>
      typeof j.cuota === 'number' && Number.isFinite(j.cuota) && j.cuota > 1
        ? { nombre: j.nombre, cuota: j.cuota, prob: prob(j.cuota), puntosEsperados: Math.round(pts(j.cuota) * 10) / 10, precio: precioDe(j.cuota) }
        : { nombre: j.nombre, cuota: null, prob: null, puntosEsperados: null, precio: minimo }
    ),
    favorito: redondear(favorito),
    minimo,
    gamma: Math.round(elegido.gamma * 100) / 100,
    puestoMedia: elegido.r,
    cumple: elegido.cumple,
  };
}

export function calcularPreciosTenis(jugadores: JugadorTenisCuota[]): PrecioTenis[] {
  return calcularPreciosTenisDetallado(jugadores).precios;
}
