import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parsearListadoCuotas, parsearNumeroCuota } from '../lib/parsearCuotas';
import { calcularPreciosPorCuota, calcularPreciosPorCuotaDetallado, type JugadorConCuota } from '../lib/precioPorCuota';

// Números
assert.equal(parsearNumeroCuota('8,50'), 8.5);
assert.equal(parsearNumeroCuota('1.000'), 1000);
assert.equal(parsearNumeroCuota('12.5'), 12.5);
assert.equal(parsearNumeroCuota('9/2'), 5.5);
assert.equal(parsearNumeroCuota('1.000,50'), 1000.5);

// ----------------------------------------------------------------------------
// ATP Hangzhou (23 jugadores) — CAMPO PEQUEÑO (≤ 30), sin tramo "top" separado:
// la curva es exactamente la de siempre, sin ningún cambio por la compresión del
// 26/09 (que solo entra en juego en campos grandes) — cuota favorito 2,60 →
// fracción objetivo bruta = 0,30 + 0,68/2,60 = 0,5615, por encima del tope (0,55),
// así que se queda en el tope. Antes (38% fijo) los 5 favoritos cabían en el mismo
// equipo (99.500 € de 100.000) — con la fórmula del 24/09 no deben caber (Regla 1).
// ----------------------------------------------------------------------------
const { jugadores: jugadoresHZ, avisos: avisosHZ } = parsearListadoCuotas(readFileSync('scripts/datos-atp-hangzhou.txt', 'utf8'));
assert.equal(jugadoresHZ.length, 23);
assert.deepEqual(avisosHZ, []);

const resultadoHZ = calcularPreciosPorCuotaDetallado(jugadoresHZ);
assert.equal(resultadoHZ.fraccionUsada, 0.55, 'fracción al tope con cuota favorito 2,60');
assert.equal(resultadoHZ.gammaUsado, 1.18, 'γ elegido por la búsqueda automática');
assert.equal(resultadoHZ.precioTopKUsado, 3500, 'campo pequeño: sin tramo top, precioTopKUsado = precioMinimo');
assert.equal(resultadoHZ.reglasCumplidas, true);

const preciosHZ = resultadoHZ.precios;
const pHZ = (n: string) => preciosHZ.find((j) => j.nombre === n)!.precio;
const esperadoHZ: Record<string, number> = {
  'Daniil Medvedev': 55000,
  'Andrey Rublev': 32700,
  'Quentin Halys': 14000,
  'Tomas Martín Etcheverry': 12900,
  'Fabian Marozsan': 10900,
  'Roman Safiullin': 10000,
  'Jaime Faria': 8400,
  'Kamil Majchrzak': 8400,
};
for (const [n, v] of Object.entries(esperadoHZ)) assert.equal(pHZ(n), v, n);

const ordenHZ = [...preciosHZ].sort((a, b) => b.precio - a.precio || a.cuota! - b.cuota!);
const vHZ = ordenHZ.map((j) => j.precio);
const top2HZ = vHZ[0] + vHZ[1];
const top5HZ = vHZ[0] + vHZ[1] + vHZ[2] + vHZ[3] + vHZ[4];
console.log('ATP Hangzhou — top2', top2HZ, '(quedan', 100000 - top2HZ, 'para tres) | top5', top5HZ, '| min', vHZ.at(-1));
assert.equal(top2HZ, 87700, 'dos primeros: 87.700, quedan 12.300 para tres — cumple Regla 2');
assert.equal(top5HZ, 125500, 'cinco primeros: 125.500 — >= 110.000, cumple Regla 1');
assert.equal(vHZ.at(-1), 3800, 'mínimo: 3.800');

// ----------------------------------------------------------------------------
// Open de France (142 jugadores) — CAMPO GRANDE (≥ 120): tramo "top" comprimido
// (26/09) — pedido de Iñi tras fichar 5 jugadores del top 20 con presupuesto de
// sobra en un torneo de golf real de tamaño parecido: "la diferencia de precios
// tiene que ser todo mucho más consecutivo... no puede haber tanta diferencia".
// Los precios YA NO coinciden con la versión anterior a propósito — la fracción
// del favorito (0,38) y el γ de la cola (0,95) no cambian, pero el top 20 pasa de
// desplomarse cerca del mínimo a quedarse entre el favorito y el 60% de su precio.
// ----------------------------------------------------------------------------
const { jugadores, avisos } = parsearListadoCuotas(readFileSync('scripts/datos-open-de-france.txt', 'utf8'));
assert.equal(jugadores.length, 142, '142 jugadores (Fleetwood repetido al final se descarta)');
assert.deepEqual(avisos, []);
assert.equal(jugadores[0].nombre, 'Ludvig Aaberg');
assert.equal(jugadores.find((j) => j.nombre === 'Iván Cantero Gutiérrez')?.cuota, 700);
assert.equal(jugadores.find((j) => j.nombre === 'Michael Mjaaseth')?.cuota, 600);

const resultadoOF = calcularPreciosPorCuotaDetallado(jugadores);
assert.equal(resultadoOF.fraccionUsada, 0.38, 'fracción objetivo con cuota 8,50 — no cambia con el tamaño del campo');
assert.equal(resultadoOF.gammaUsado, 0.95, 'γ de la cola, de partida — ya cumple las reglas');
assert.equal(resultadoOF.precioTopKUsado, 22800, 'campo grande: el jugador nº20 cuesta el 60% del favorito (22.800 € de 38.000 €)');
assert.equal(resultadoOF.reglasCumplidas, true);

const precios = resultadoOF.precios;
const p = (n: string) => precios.find((j) => j.nombre === n)!.precio;
const esperadoOF: Record<string, number> = {
  'Ludvig Aaberg': 38000,
  'Matthew Fitzpatrick': 36100,
  'Tommy Fleetwood': 36100,
  'Viktor Hovland': 32200,
  'Ryan Gerard': 30900,
  'Kristoffer Reitan': 27300,
  'Eugenio Chacarra': 26100,
  'Thomas Detry': 24300,
  'Victor Perez': 24300,
  'Angel Ayora': 23700,
};
for (const [n, v] of Object.entries(esperadoOF)) assert.equal(p(n), v, n);
// "Cauley" del encargo es William Bud Cauley (cuota 42, igual que Ayora) → mismo precio.
assert.equal(p('William Bud Cauley'), 23700, 'Cauley — mismo precio que Ayora, cuota 42 igual');
assert.equal(p('Ewen Ferguson'), 23500, 'cuota 44, siguiente escalón por debajo de Ayora/Cauley — ya notablemente más cerca (antes 10.700, ahora 23.500)');

const ordenOF = [...precios].sort((a, b) => b.precio - a.precio || a.cuota! - b.cuota!);
const vOF = ordenOF.map((j) => j.precio);
const top2OF = vOF[0] + vOF[1];
const top5OF = vOF[0] + vOF[1] + vOF[2] + vOF[3] + vOF[4];
const ultimos3OF = vOF.slice(-3).reduce((s, v) => s + v, 0);
const top20OF = ordenOF.slice(0, 20);
const cinco20OF = top20OF.slice(-5).reduce((s, j) => s + j.precio, 0);
console.log(
  'Open de France — top2',
  top2OF,
  '| top5',
  top5OF,
  '| top2+3 más baratos',
  top2OF + ultimos3OF,
  '| min',
  vOF.at(-1),
  '| top20, 5 más baratos',
  cinco20OF,
  '| mediana',
  [...vOF].sort((a, b) => a - b)[71]
);
// Regla 1 (top 5 >= 110% presupuesto): nunca cabe un equipo de puros favoritos.
assert.ok(top5OF >= 110_000, `top5 (${top5OF}) debe ser >= 110.000 — Regla 1`);
// Regla 2 (2 favoritos + 3 más baratos de TODO el campo <= presupuesto): completar
// equipo tras fichar a los dos favoritos sigue siendo posible — la cola del campo
// sigue bajando hasta cerca del mínimo, sin verse afectada por la compresión del top.
assert.ok(top2OF + ultimos3OF <= 100_000, `top2+3 más baratos (${top2OF + ultimos3OF}) debe ser <= 100.000 — Regla 2`);
// Regla 3 (nueva, 26/09): los 5 más baratos DENTRO del top 20 deben sumar >= 90% del
// presupuesto — ya NO se puede montar un equipo de 5 "buenos pero no favoritos" con
// presupuesto de sobra, que era la queja real de Iñi.
assert.ok(cinco20OF >= 90_000, `los 5 más baratos del top 20 (${cinco20OF}) deben ser >= 90.000 — Regla 3`);
// El top 20 queda comprimido de forma parecida a DraftKings (~1,7 veces entre el
// primero y el último de esa franja, frente a las 10-16 veces de antes).
const ratioTop20 = top20OF[0].precio / top20OF[19].precio;
console.log('ratio favorito/último del top 20:', ratioTop20);
assert.ok(ratioTop20 < 2, `el top 20 debe quedar comprimido (ratio ${ratioTop20} < 2)`);

const csvOF = ['Puesto;Jugador;Cuota;Precio (€)']
  .concat(ordenOF.map((j, i) => `${i + 1};${j.nombre};${String(j.cuota).replace('.', ',')};${j.precio}`))
  .join('\n');
writeFileSync('/home/claude/precios_open_de_france.csv', '﻿' + csvOF);

// Sin cuota → mínimo (sin cambios, no depende del tamaño de campo).
assert.equal(calcularPreciosPorCuota([{ nombre: 'X', cuota: 5 }, { nombre: 'Y', cuota: null }])[1].precio, 3500);

// ----------------------------------------------------------------------------
// Campo sintético de 140 jugadores (26/09, nuevo) — cuotas mucho más repartidas que
// el Open de France real (favorito muy claro, cola muy larga y plana), para
// comprobar que la compresión del top 20 y la Regla 3 se sostienen incluso en un
// campo "difícil" y no son un efecto de casualidad de un único dataset real.
// ----------------------------------------------------------------------------
const sinteticos: JugadorConCuota[] = Array.from({ length: 140 }, (_, i) => {
  const rank = i + 1;
  // Favorito a cuota 7, y una cola que crece deprisa (rank^1.35) hasta cuotas muy
  // altas para los últimos puestos — un campo grande "de verdad", no un caso fácil.
  const cuota = Math.round(7 * Math.pow(rank, 1.35) * 10) / 10;
  return { nombre: `Jugador ${rank}`, cuota };
});
const resultadoSint = calcularPreciosPorCuotaDetallado(sinteticos);
const preciosSint = [...resultadoSint.precios].sort((a, b) => b.precio - a.precio);
const top5Sint = preciosSint.slice(0, 5).reduce((s, j) => s + j.precio, 0);
const top2Sint = preciosSint[0].precio + preciosSint[1].precio;
const ultimos3Sint = preciosSint.slice(-3).reduce((s, j) => s + j.precio, 0);
const cinco20Sint = preciosSint.slice(0, 20).slice(-5).reduce((s, j) => s + j.precio, 0);
console.log(
  'Sintético 140 — fraccion',
  resultadoSint.fraccionUsada,
  'gamma',
  resultadoSint.gammaUsado,
  'precioTopK',
  resultadoSint.precioTopKUsado,
  'reglasCumplidas',
  resultadoSint.reglasCumplidas,
  '| top5',
  top5Sint,
  '| top2+3 más baratos',
  top2Sint + ultimos3Sint,
  '| top20 5 más baratos',
  cinco20Sint,
  '| min',
  preciosSint.at(-1)!.precio
);
assert.ok(top5Sint >= 110_000, `sintético: top5 (${top5Sint}) debe ser >= 110.000 — Regla 1`);
assert.ok(top2Sint + ultimos3Sint <= 100_000, `sintético: top2+3 más baratos (${top2Sint + ultimos3Sint}) debe ser <= 100.000 — Regla 2`);
assert.ok(cinco20Sint >= 90_000, `sintético: 5 más baratos del top 20 (${cinco20Sint}) deben ser >= 90.000 — Regla 3`);

console.log('OK: todas las pruebas pasan');
console.log('Open de France, top 25:');
console.log(ordenOF.slice(0, 25).map((j) => `${j.nombre} ${j.precio}`).join('\n'));
console.log('ATP Hangzhou, todos:');
console.log(ordenHZ.map((j) => `${j.nombre} ${j.precio}`).join('\n'));
