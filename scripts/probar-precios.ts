import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parsearListadoCuotas, parsearNumeroCuota } from '../lib/parsearCuotas';
import { calcularPreciosPorCuota } from '../lib/precioPorCuota';

// Números
assert.equal(parsearNumeroCuota('8,50'), 8.5);
assert.equal(parsearNumeroCuota('1.000'), 1000);
assert.equal(parsearNumeroCuota('12.5'), 12.5);
assert.equal(parsearNumeroCuota('9/2'), 5.5);
assert.equal(parsearNumeroCuota('1.000,50'), 1000.5);

const { jugadores, avisos } = parsearListadoCuotas(readFileSync('scripts/datos-open-de-france.txt', 'utf8'));
assert.equal(jugadores.length, 142, '142 jugadores (Fleetwood repetido al final se descarta)');
assert.deepEqual(avisos, []);
assert.equal(jugadores[0].nombre, 'Ludvig Aaberg');
assert.equal(jugadores.find((j) => j.nombre === 'Iván Cantero Gutiérrez')?.cuota, 700);
assert.equal(jugadores.find((j) => j.nombre === 'Michael Mjaaseth')?.cuota, 600);

const precios = calcularPreciosPorCuota(jugadores);
const p = (n: string) => precios.find((j) => j.nombre === n)!.precio;
// Mismos valores que calculamos por voz
const esperado: Record<string, number> = {
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
  'Ewen Ferguson': 10700,
};
for (const [n, v] of Object.entries(esperado)) assert.equal(p(n), v, n);

const orden = [...precios].sort((a, b) => b.precio - a.precio || a.cuota! - b.cuota!);
const v = orden.map((j) => j.precio);
console.log('top2', v[0] + v[1], '| top3', v[0] + v[1] + v[2], '| min', v.at(-1), '| mediana', [...v].sort((a, b) => a - b)[71]);
// Añadir o quitar jugadores no cambia el precio del resto
const sinCola = calcularPreciosPorCuota(jugadores.slice(0, 50));
assert.equal(sinCola.find((j) => j.nombre === 'Viktor Hovland')!.precio, 27400);
// Sin cuota → mínimo
assert.equal(calcularPreciosPorCuota([{ nombre: 'X', cuota: 5 }, { nombre: 'Y', cuota: null }])[1].precio, 3500);

const csv = ['Puesto;Jugador;Cuota;Precio (€)']
  .concat(orden.map((j, i) => `${i + 1};${j.nombre};${String(j.cuota).replace('.', ',')};${j.precio}`))
  .join('\n');
writeFileSync('/home/claude/precios_open_de_france.csv', '﻿' + csv);
console.log('OK: todas las pruebas pasan');
console.log(orden.slice(0, 12).map((j) => `${j.nombre} ${j.precio}`).join('\n'));
