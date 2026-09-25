import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parsearListadoCuotas, parsearNumeroCuota } from '../lib/parsearCuotas';
import { calcularPreciosPorCuota, calcularPreciosPorCuotaDetallado } from '../lib/precioPorCuota';

// Números
assert.equal(parsearNumeroCuota('8,50'), 8.5);
assert.equal(parsearNumeroCuota('1.000'), 1000);
assert.equal(parsearNumeroCuota('12.5'), 12.5);
assert.equal(parsearNumeroCuota('9/2'), 5.5);
assert.equal(parsearNumeroCuota('1.000,50'), 1000.5);

// ----------------------------------------------------------------------------
// Open de France (DP World Tour) — cuota favorito 8,50 → fracción objetivo ya
// sale en 0,38 (igual que la fórmula anterior) y las dos reglas de seguridad
// ya se cumplen con γ=0,95, así que los precios no deberían moverse ni un
// euro respecto a la versión anterior.
// ----------------------------------------------------------------------------
const { jugadores, avisos } = parsearListadoCuotas(readFileSync('scripts/datos-open-de-france.txt', 'utf8'));
assert.equal(jugadores.length, 142, '142 jugadores (Fleetwood repetido al final se descarta)');
assert.deepEqual(avisos, []);
assert.equal(jugadores[0].nombre, 'Ludvig Aaberg');
assert.equal(jugadores.find((j) => j.nombre === 'Iván Cantero Gutiérrez')?.cuota, 700);
assert.equal(jugadores.find((j) => j.nombre === 'Michael Mjaaseth')?.cuota, 600);

const resultadoOF = calcularPreciosPorCuotaDetallado(jugadores);
assert.equal(resultadoOF.fraccionUsada, 0.38, 'fracción objetivo con cuota 8,50');
assert.equal(resultadoOF.gammaUsado, 0.95, 'γ de partida, ya cumple las reglas');
assert.equal(resultadoOF.reglasCumplidas, true);

const precios = resultadoOF.precios;
const p = (n: string) => precios.find((j) => j.nombre === n)!.precio;
const esperadoOF: Record<string, number> = {
  'Ludvig Aaberg': 38000,
  'Matthew Fitzpatrick': 34500,
  'Tommy Fleetwood': 34500,
  'Viktor Hovland': 27400,
  'Ryan Gerard': 25000,
  'Kristoffer Reitan': 18100,
  'Eugenio Chacarra': 15900,
  'Thomas Detry': 12300,
  'Victor Perez': 12300,
  'Angel Ayora': 11100,
};
for (const [n, v] of Object.entries(esperadoOF)) assert.equal(p(n), v, n);
// "Cauley" del encargo es William Bud Cauley (cuota 42, igual que Ayora) → mismo precio, 11.100 €.
assert.equal(p('William Bud Cauley'), 11100, 'Cauley — mismo precio que Ayora, cuota 42 igual');
assert.equal(p('Ewen Ferguson'), 10700, 'cuota 44, siguiente escalón por debajo de Ayora/Cauley');

const ordenOF = [...precios].sort((a, b) => b.precio - a.precio || a.cuota! - b.cuota!);
const vOF = ordenOF.map((j) => j.precio);
console.log(
  'Open de France — top2',
  vOF[0] + vOF[1],
  '| top3',
  vOF[0] + vOF[1] + vOF[2],
  '| top5',
  vOF[0] + vOF[1] + vOF[2] + vOF[3] + vOF[4],
  '| min',
  vOF.at(-1),
  '| mediana',
  [...vOF].sort((a, b) => a - b)[71]
);
// Añadir o quitar jugadores del final no cambia el precio del resto (el favorito no cambia).
const sinCola = calcularPreciosPorCuota(jugadores.slice(0, 50));
assert.equal(sinCola.find((j) => j.nombre === 'Viktor Hovland')!.precio, 27400);
// Sin cuota → mínimo
assert.equal(calcularPreciosPorCuota([{ nombre: 'X', cuota: 5 }, { nombre: 'Y', cuota: null }])[1].precio, 3500);

const csvOF = ['Puesto;Jugador;Cuota;Precio (€)']
  .concat(ordenOF.map((j, i) => `${i + 1};${j.nombre};${String(j.cuota).replace('.', ',')};${j.precio}`))
  .join('\n');
writeFileSync('/home/claude/precios_open_de_france.csv', '﻿' + csvOF);

// ----------------------------------------------------------------------------
// ATP Hangzhou — cuota favorito 2,60 → fracción objetivo bruta = 0,30 + 0,68/2,60
// = 0,5615, por encima del tope (0,55), así que se queda en el tope. Antes (38%
// fijo) los 5 favoritos cabían en el mismo equipo (99.500 € de 100.000) — con
// la fórmula nueva no deben caber (Regla 1: >= 110.000 €).
// ----------------------------------------------------------------------------
const { jugadores: jugadoresHZ, avisos: avisosHZ } = parsearListadoCuotas(readFileSync('scripts/datos-atp-hangzhou.txt', 'utf8'));
assert.equal(jugadoresHZ.length, 23);
assert.deepEqual(avisosHZ, []);

const resultadoHZ = calcularPreciosPorCuotaDetallado(jugadoresHZ);
assert.equal(resultadoHZ.fraccionUsada, 0.55, 'fracción al tope con cuota favorito 2,60');
assert.equal(resultadoHZ.gammaUsado, 1.18, 'γ elegido por la búsqueda automática');
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

console.log('OK: todas las pruebas pasan');
console.log('Open de France, top 12:');
console.log(ordenOF.slice(0, 12).map((j) => `${j.nombre} ${j.precio}`).join('\n'));
console.log('ATP Hangzhou, todos:');
console.log(ordenHZ.map((j) => `${j.nombre} ${j.precio}`).join('\n'));
