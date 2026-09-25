import assert from 'node:assert/strict';
import {
  nivelBase,
  fuerzaPartido,
  factorPosicion,
  fuerzaPorEquipo,
  calcularPreciosFutbolDetallado,
  PosicionFutbol,
  PRECIO_FUTBOL_CONFIG,
} from '../lib/precioFutbol';
import { EQUIPO_PRESUPUESTO } from '../lib/draftConfig';

// ----------------------------------------------------------------------------
// Piezas sueltas
// ----------------------------------------------------------------------------

// nivel base: extremos y caso degenerado (toda la tabla al mismo valor).
assert.equal(nivelBase(400_000, 400_000, 159_000_000), 0, 'el valor mínimo de la tabla da nivel 0');
assert.equal(nivelBase(159_000_000, 400_000, 159_000_000), 1, 'el valor máximo de la tabla da nivel 1');
assert.equal(nivelBase(5_000_000, 5_000_000, 5_000_000), 1, 'toda la tabla al mismo valor: nivel 1 (no hay escala que discriminar)');
// A mitad de camino en escala LOGARÍTMICA (no lineal): sqrt(mín×máx).
const medioLog = Math.sqrt(400_000 * 159_000_000);
assert.ok(Math.abs(nivelBase(medioLog, 400_000, 159_000_000) - 0.5) < 1e-9, 'la media geométrica cae en nivel 0,5');

// fuerza de partido: cuotas simétricas -> mismo nivel para ambos equipos.
const simetrico = fuerzaPartido(3, 3.5, 3);
assert.ok(Math.abs(simetrico.fuerzaLocal - simetrico.fuerzaVisit) < 1e-9, 'cuotas simétricas dan fuerza igual a los dos');
assert.ok(Math.abs(simetrico.fuerzaLocal - 0.5) < 1e-9, 'cuotas simétricas dan fuerza 0,5 a cada uno');
// favorito claro en casa.
const favoritoLocal = fuerzaPartido(1.5, 4.5, 6.5);
assert.ok(favoritoLocal.fuerzaLocal > 0.7, 'favorito claro en casa: fuerza alta');
assert.ok(Math.abs(favoritoLocal.fuerzaLocal + favoritoLocal.fuerzaVisit - 1) < 1e-9, 'fuerza local + fuerza visitante siempre suman 1 (p_local+p_visit+p_empate=1, repartiendo el empate a medias entre los dos)');

// factor por posición: límites exactos del rango del ENCARGO.
assert.equal(factorPosicion(1, 'defensa'), 1.2);
assert.equal(factorPosicion(0, 'defensa'), 0.8);
assert.equal(factorPosicion(0.5, 'defensa'), 1);
assert.equal(factorPosicion(1, 'portero'), 1.1);
assert.equal(factorPosicion(0, 'portero'), 0.9);

// fuerzaPorEquipo: partido sin cuotas no aparece en el mapa (factor 1 para sus jugadores, lo decide el llamante).
const mapaFuerza = fuerzaPorEquipo([
  { equipoLocal: 'Equipo A', equipoVisitante: 'Equipo B', cuota1: 1.8, cuotaX: 3.6, cuota2: 4.5 },
  { equipoLocal: 'Equipo C', equipoVisitante: 'Equipo D', cuota1: null, cuotaX: null, cuota2: null },
]);
assert.ok(mapaFuerza.has('Equipo A') && mapaFuerza.has('Equipo B'));
assert.ok(!mapaFuerza.has('Equipo C') && !mapaFuerza.has('Equipo D'));
assert.ok((mapaFuerza.get('Equipo A') as number) > 0.5, 'Equipo A es favorito en casa');

console.log('OK: piezas sueltas (nivelBase, fuerzaPartido, factorPosicion, fuerzaPorEquipo)');

// ----------------------------------------------------------------------------
// Jornada sintética completa: 6 equipos (3 partidos), 25 jugadores cada uno
// (3 porteros, 8 defensas, 8 centrocampistas, 6 delanteros — plantilla real
// de sobra para las 4 alineaciones), valores en escala logarítmica de
// 400.000 € a 159.000.000 € (el mismo rango que LaLiga Fantasy real, ver
// ENCARGO A.6/A.7).
// ----------------------------------------------------------------------------

type Semilla = { id: string; equipo: string; posicion: PosicionFutbol; valorMercado: number };

const EQUIPOS = ['Equipo A', 'Equipo B', 'Equipo C', 'Equipo D', 'Equipo E', 'Equipo F'];
const PLANTILLA_POR_EQUIPO: [PosicionFutbol, number][] = [
  ['portero', 3],
  ['defensa', 8],
  ['centrocampista', 8],
  ['delantero', 6],
];
const VALOR_MIN = 400_000;
const VALOR_MAX = 159_000_000;
const TOTAL_JUGADORES = EQUIPOS.length * 25; // 150

let i = 0;
const jugadores: Semilla[] = [];
for (const equipo of EQUIPOS) {
  for (const [posicion, n] of PLANTILLA_POR_EQUIPO) {
    for (let k = 0; k < n; k++) {
      // Log-espaciado y decreciente con el índice global, para cubrir todo el rango.
      const t = i / (TOTAL_JUGADORES - 1);
      const valorMercado = Math.round(VALOR_MAX * Math.pow(VALOR_MIN / VALOR_MAX, t));
      jugadores.push({ id: `j${i}`, equipo, posicion, valorMercado });
      i++;
    }
  }
}
assert.equal(jugadores.length, TOTAL_JUGADORES);

const partidos = [
  { equipoLocal: 'Equipo A', equipoVisitante: 'Equipo B', cuota1: 1.8, cuotaX: 3.6, cuota2: 4.5 }, // A favorito
  { equipoLocal: 'Equipo C', equipoVisitante: 'Equipo D', cuota1: 2.5, cuotaX: 3.3, cuota2: 2.8 }, // igualado
  { equipoLocal: 'Equipo E', equipoVisitante: 'Equipo F', cuota1: 6.0, cuotaX: 4.2, cuota2: 1.5 }, // F favorito claro fuera
];
const fuerzaEquipo = fuerzaPorEquipo(partidos);

const entrada = jugadores.map((j) => {
  const fuerza = fuerzaEquipo.get(j.equipo);
  const factorPartidoJugador = fuerza !== undefined ? factorPosicion(fuerza, j.posicion) : 1;
  return { id: j.id, posicion: j.posicion, valorMercado: j.valorMercado, factorPartido: factorPartidoJugador };
});

const resultado = calcularPreciosFutbolDetallado(entrada);

console.log(`TOPE elegido: ${resultado.topeUsado} € | γ elegido: ${resultado.gammaUsado} | reglas cumplidas: ${resultado.reglasCumplidas}`);
assert.equal(resultado.reglasCumplidas, true, 'con una plantilla realista, la búsqueda automática debe encontrar un (TOPE, γ) que cumpla las tres reglas');

const porId = new Map(resultado.precios.map((p) => [p.id, p]));

// Quien tenga el nivel_ajustado más alto de la jornada (nivel × factor de
// partido) tiene que costar exactamente el TOPE (ratio = 1). Ojo: no tiene
// por qué ser el de más valor de mercado en bruto — un jugador de campo del
// equipo favorito (factor hasta ×1,2) puede superar a un portero (factor
// hasta ×1,1 nada más) aunque el portero tenga algo más de valor. Eso es
// justo lo que pide el ENCARGO (A.3), así que aquí se busca dinámicamente
// quién es en vez de asumir que es el de más valorMercado.
let mejorNivelAjustado = -Infinity;
let idMejorNivelAjustado: string | null = null;
for (const p of resultado.precios) {
  if (p.nivelAjustado !== null && p.nivelAjustado > mejorNivelAjustado) {
    mejorNivelAjustado = p.nivelAjustado;
    idMejorNivelAjustado = p.id;
  }
}
assert.ok(idMejorNivelAjustado !== null);
assert.equal(porId.get(idMejorNivelAjustado!)!.precio, resultado.topeUsado, 'quien tenga el nivel ajustado más alto cuesta justo el TOPE');

// El de más valor de mercado en bruto es un portero (jugadores[0]: primer
// portero de Equipo A, el de más valor de toda la plantilla sintética) —
// desde el 25/09 los porteros tienen un TOPE reducido (porteroFraccionTope,
// ver cabecera de precioFutbol.ts), así que YA NO debe acercarse al TOPE
// general: debe quedar cerca de su propio tope reducido, no del de un
// delantero. Antes de esta corrección se esperaba justo lo contrario (que
// quedara cerca del TOPE general) — ese era el problema que reportó Iñi.
const masValioso = jugadores[0];
assert.equal(masValioso.valorMercado, VALOR_MAX);
assert.equal(masValioso.posicion, 'portero', 'este dataset sintético pone al portero de más valor primero en el índice');
const topePorteroEsperado = PRECIO_FUTBOL_CONFIG.minimo + (resultado.topeUsado - PRECIO_FUTBOL_CONFIG.minimo) * PRECIO_FUTBOL_CONFIG.porteroFraccionTope;
assert.ok(
  porId.get(masValioso.id)!.precio <= topePorteroEsperado + 1e-6,
  'un portero, por muy alto que sea su valor de mercado bruto, nunca debe superar el tope reducido para porteros'
);
assert.ok(
  porId.get(masValioso.id)!.precio < resultado.topeUsado * 0.85,
  'el portero de más valor debe quedar claramente por debajo del TOPE general (no comerse presupuesto como un jugador de campo)'
);

// El jugador de campo (no portero) de más valor de mercado en bruto sí debe
// seguir estando cerca del TOPE general, no barato — su nivel base ya es 1
// y no tiene el tope reducido de los porteros.
const masValiosoDeCampo = jugadores.filter((j) => j.posicion !== 'portero').sort((a, b) => b.valorMercado - a.valorMercado)[0];
assert.ok(
  porId.get(masValiosoDeCampo.id)!.precio >= resultado.topeUsado * 0.7,
  'el jugador de campo de más valor de mercado tiene que quedar cerca del TOPE general (aunque el TOPE exacto lo alcance otro por el factor de partido)'
);

// El jugador de menos valor: nivel base 0, así que nivel_ajustado también 0 salvo
// que el factor de partido lo cambiara (nivel 0 × cualquier factor = 0) -> precio mínimo.
const menosValioso = jugadores[jugadores.length - 1];
assert.equal(menosValioso.valorMercado, VALOR_MIN);
assert.equal(porId.get(menosValioso.id)!.precio, PRECIO_FUTBOL_CONFIG.minimo, 'nivel base 0 siempre da el precio mínimo, tenga el factor de partido que tenga');

// Todos los precios dentro de [mínimo, TOPE].
for (const p of resultado.precios) {
  assert.ok(p.precio >= PRECIO_FUTBOL_CONFIG.minimo - 1e-9 && p.precio <= resultado.topeUsado + 1e-9, `precio de ${p.id} fuera de rango: ${p.precio}`);
}

// Verificación independiente de las dos reglas de seguridad, recalculadas aquí
// sin reutilizar la función interna del módulo (para no validar la fórmula
// contra sí misma).
function huecos(alineacion: string) {
  const [def, med, del] = alineacion === '4-3-3' ? [4, 3, 3] : alineacion === '4-4-2' ? [4, 4, 2] : alineacion === '3-5-2' ? [3, 5, 2] : [4, 5, 1]; // 4-2-3-1
  return { POR: 1, DEF: def, MED: med, DEL: del };
}
const ALINEACIONES = ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1'];
const preciosConPosicion = jugadores.map((j) => ({ ...j, precio: porId.get(j.id)!.precio }));
const porLinea = {
  POR: preciosConPosicion.filter((j) => j.posicion === 'portero').map((j) => j.precio).sort((a, b) => b - a),
  DEF: preciosConPosicion.filter((j) => j.posicion === 'defensa').map((j) => j.precio).sort((a, b) => b - a),
  MED: preciosConPosicion.filter((j) => j.posicion === 'centrocampista').map((j) => j.precio).sort((a, b) => b - a),
  DEL: preciosConPosicion.filter((j) => j.posicion === 'delantero').map((j) => j.precio).sort((a, b) => b - a),
};
let maxOnce = -Infinity;
for (const alineacion of ALINEACIONES) {
  const h = huecos(alineacion);
  const coste =
    porLinea.POR.slice(0, h.POR).reduce((s, p) => s + p, 0) +
    porLinea.DEF.slice(0, h.DEF).reduce((s, p) => s + p, 0) +
    porLinea.MED.slice(0, h.MED).reduce((s, p) => s + p, 0) +
    porLinea.DEL.slice(0, h.DEL).reduce((s, p) => s + p, 0);
  if (coste > maxOnce) maxOnce = coste;
}
console.log(`Regla 1 — once más caro posible: ${maxOnce} € (>= ${EQUIPO_PRESUPUESTO * 1.1} € requeridos)`);
assert.ok(maxOnce >= EQUIPO_PRESUPUESTO * 1.1, 'Regla 1: el once más caro posible debe costar al menos el 110% del presupuesto');

const top3 = [...preciosConPosicion].sort((a, b) => b.precio - a.precio).slice(0, 3);
console.log(`Regla 2 — 3 más caros: ${top3.map((j) => j.precio).join(' + ')} = ${top3.reduce((s, j) => s + j.precio, 0)} €`);
assert.ok(top3.reduce((s, j) => s + j.precio, 0) <= EQUIPO_PRESUPUESTO, 'los 3 más caros por sí solos ya deben caber de sobra en el presupuesto');

// Regla 3 (25/09): el once más BARATO posible no debe superar el
// fraccionMaxOnceBarato del presupuesto — para que siempre quepa un equipo
// completo con margen de sobra, sea cual sea la combinación de equipos.
const porLineaAsc = {
  POR: [...porLinea.POR].sort((a, b) => a - b),
  DEF: [...porLinea.DEF].sort((a, b) => a - b),
  MED: [...porLinea.MED].sort((a, b) => a - b),
  DEL: [...porLinea.DEL].sort((a, b) => a - b),
};
let minOnce = Infinity;
for (const alineacion of ALINEACIONES) {
  const h = huecos(alineacion);
  const coste =
    porLineaAsc.POR.slice(0, h.POR).reduce((s, p) => s + p, 0) +
    porLineaAsc.DEF.slice(0, h.DEF).reduce((s, p) => s + p, 0) +
    porLineaAsc.MED.slice(0, h.MED).reduce((s, p) => s + p, 0) +
    porLineaAsc.DEL.slice(0, h.DEL).reduce((s, p) => s + p, 0);
  if (coste < minOnce) minOnce = coste;
}
const topeBarato = EQUIPO_PRESUPUESTO * PRECIO_FUTBOL_CONFIG.fraccionMaxOnceBarato;
console.log(`Regla 3 — once más barato posible: ${minOnce} € (<= ${topeBarato} € permitidos, ${((minOnce / EQUIPO_PRESUPUESTO) * 100).toFixed(1)}% del presupuesto)`);
assert.ok(minOnce <= topeBarato, 'Regla 3: el once más barato posible no debe superar la mitad del presupuesto — siempre debe quedar margen para completar un equipo');

console.log('OK: jornada sintética — TOPE/γ encontrados cumplen las tres reglas de seguridad');

// ----------------------------------------------------------------------------
// Caso especial A.5: jugador sin valor de mercado -> mediana de su posición.
// ----------------------------------------------------------------------------
const entradaConSinValor = [...entrada.slice(0, 40), { id: 'sin-valor-1', posicion: 'delantero' as PosicionFutbol, valorMercado: null, factorPartido: 1 }];
const resultadoSinValor = calcularPreciosFutbolDetallado(entradaConSinValor);
const jugadorSinValor = resultadoSinValor.precios.find((p) => p.id === 'sin-valor-1')!;
assert.equal(jugadorSinValor.sinValor, true);
const delanterosConValor = resultadoSinValor.precios.filter((p) => p.id !== 'sin-valor-1' && p.posicion === 'delantero').map((p) => p.precio).sort((a, b) => a - b);
const medianaEsperada = delanterosConValor.length % 2 !== 0
  ? delanterosConValor[Math.floor(delanterosConValor.length / 2)]
  : Math.round((delanterosConValor[delanterosConValor.length / 2 - 1] + delanterosConValor[delanterosConValor.length / 2]) / 2);
assert.equal(jugadorSinValor.precio, medianaEsperada, 'sin valor de mercado -> precio mediano de su posición en esa jornada');

console.log('OK: caso especial A.5 (jugador sin valor de mercado -> mediana de su posición)');
console.log('OK: todas las pruebas de precioFutbol.ts pasan');
