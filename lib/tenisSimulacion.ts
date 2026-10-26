// ============================================================================
// CUOTA AL GANADOR DEL TORNEO DE TENIS, CALCULADA (28/10, Iñi)
// ============================================================================
// En tenis la mesa es del torneo entero (una semana), así que lo que cuenta es
// la cuota de cada jugador a GANAR EL TORNEO, como en golf. Si no hay casa de
// apuestas que la dé, se calcula: se juega el cuadro miles de veces.
//  · Fuerza de cada jugador: un "Elo" sacado de su ranking
//      elo = 2000 − 130 · ln(ranking)     (sin ranking = como el 400º)
//    P(A gana a B) = 1 / (1 + 10^((eloB − eloA)/400))
//    (nº1 contra nº10 ≈ 84 %; nº1 contra nº100 ≈ 97 %).
//  · Los partidos que ya se saben (la primera ronda del cuadro) se juegan tal
//    cual; si hay cuota de ese partido, se usa su probabilidad.
//  · Los que entran con bye pasan directos; a partir de ahí, los cruces se
//    sortean entre los que siguen vivos.
// Resultado: probabilidad de ganar el torneo → cuota = 1 / probabilidad.

export type JugadorSim = { nombre: string; ranking: number | null };
export type PartidoSim = { a: string; b: string; pA?: number | null }; // pA: prob. de que gane a (si hay cuota)

const eloDe = (r: number | null) => 2000 - 130 * Math.log(Math.max(1, r ?? 400));
const pGana = (ea: number, eb: number) => 1 / (1 + Math.pow(10, (eb - ea) / 400));

/** Generador pseudoaleatorio con semilla (para que el precio no cambie de una vez a otra). */
function azar(semilla: number) {
  let s = semilla >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

export function cuotasGanadorSimuladas(jugadores: JugadorSim[], primeraRonda: PartidoSim[], veces = 20000): Map<string, number> {
  const elo = new Map(jugadores.map((j) => [j.nombre, eloDe(j.ranking)]));
  const nombres = jugadores.map((j) => j.nombre);
  const enCruce = new Set<string>();
  const cruces = primeraRonda.filter((p) => elo.has(p.a) && elo.has(p.b) && !enCruce.has(p.a) && !enCruce.has(p.b) && (enCruce.add(p.a), enCruce.add(p.b), true));
  const byes = nombres.filter((n) => !enCruce.has(n));
  const victorias = new Map<string, number>(nombres.map((n) => [n, 0]));
  const rnd = azar(nombres.length * 7919 + cruces.length);
  const juega = (a: string, b: string, pA?: number | null) => ((pA ?? pGana(elo.get(a)!, elo.get(b)!)) > rnd() ? a : b);

  for (let v = 0; v < veces; v++) {
    let vivos = [...byes, ...cruces.map((c) => juega(c.a, c.b, c.pA))];
    while (vivos.length > 1) {
      // Barajar y emparejar; si son impares, uno pasa sin jugar.
      for (let i = vivos.length - 1; i > 0; i--) {
        const k = Math.floor(rnd() * (i + 1));
        [vivos[i], vivos[k]] = [vivos[k], vivos[i]];
      }
      const sig: string[] = [];
      for (let i = 0; i + 1 < vivos.length; i += 2) sig.push(juega(vivos[i], vivos[i + 1]));
      if (vivos.length % 2 === 1) sig.push(vivos[vivos.length - 1]);
      vivos = sig;
    }
    if (vivos[0]) victorias.set(vivos[0], (victorias.get(vivos[0]) ?? 0) + 1);
  }

  // Cuota = 1 / probabilidad (con un mínimo de probabilidad para los que no ganan nunca).
  const out = new Map<string, number>();
  for (const n of nombres) {
    const p = Math.max((victorias.get(n) ?? 0) / veces, 1 / (veces * 2));
    out.set(n, Math.round(Math.min(2000, 1 / p) * 100) / 100);
  }
  return out;
}
