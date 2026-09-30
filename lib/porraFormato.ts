// ============================================================================
// FORMATO DE PORRA — clásica (grupos de color) vs. presupuesto (draft 100.000 €)
// ============================================================================
// Nuevo (28/09): hasta ahora todas las porras de golf eran del mismo
// formato ("clásica", por grupos de color — lib/porraGrupos.ts). Iñi pidió
// un segundo formato ("el formato de sueldo de 100.000 con un valor de cada
// uno de los jugadores"), igual mecanismo que el draft por presupuesto de
// las Mesas Drafters de golf/tenis (lib/draftConfig.ts) pero dentro de una
// porra: sin aforo, con el precio de entrada fijo de porras.precio y
// equipos ilimitados por participante — exactamente igual que la porra
// clásica en todo lo demás. Lo único que cambia es cómo se elige el equipo.
//
// Cada porra guarda ahora su formato (porras.formato, ver
// drafters-schema.sql) y toda pantalla que la muestre tiene que dejarlo
// claro (pedido de Iñi, 28/09: "cuando una porra esté creada, tiene que
// dejar claro que va a ser un formato u otro"): el índice de porras
// (app/porras/page.tsx), el detalle de cada porra (app/porras/[id]/page.tsx),
// el admin (app/admin/porras-golf/page.tsx) y, antes de que el participante
// empiece a elegir jugadores, una pantalla que le explica qué modo es esta
// porra en concreto (app/porras/[id]/crear-equipo/page.tsx, paso "info").
//
// Este módulo centraliza esas etiquetas/colores para no repetirlos pantalla
// a pantalla (mismo criterio que ya sigue lib/golfScoring.ts o
// lib/porraGrupos.ts).
//
// 'futbol_jornada' añadido el 29/09 — porra de fútbol de Primera División
// por jornada de liga (pedido de Iñi), un tercer formato bien distinto de
// los otros dos: no hay jugadores que elegir, sino 10 partidos a pronosticar
// (1/X/2) — ver app/admin/porras-futbol y
// app/porras/[id]/crear-equipo/page.tsx.

export type PorraFormato = 'clasica' | 'presupuesto' | 'futbol_jornada';

export const PORRA_FORMATO_LABELS: Record<PorraFormato, string> = {
  clasica: 'Porra clásica',
  presupuesto: 'Modo draft',
  futbol_jornada: 'Porra de fútbol',
};

// Colores usados para la etiqueta/badge de formato allá donde se muestre —
// el naranja ya identifica a las porras en general (/inicio); el verde es
// el mismo que usan las Mesas Drafters, porque comparten mecanismo
// (presupuesto de 100.000 €); el azul distingue la porra de fútbol de las
// dos de golf.
export const PORRA_FORMATO_COLOR: Record<PorraFormato, string> = {
  clasica: '#FF7A45',
  presupuesto: '#3DDC84',
  futbol_jornada: '#3D7BFF',
};

// Frase corta para tarjetas/listados (índice, admin).
export const PORRA_FORMATO_DESCRIPCION_CORTA: Record<PorraFormato, string> = {
  clasica: 'Un jugador de cada grupo de color, más un comodín',
  presupuesto: 'Elige libremente dentro de un presupuesto de 100.000 €',
  futbol_jornada: 'Pronostica el 1X2 de los 10 partidos de la jornada',
};

// Explicación algo más larga, para la pantalla previa "qué modo es esta
// porra" que ve el participante antes de elegir jugadores.
export const PORRA_FORMATO_DESCRIPCION_LARGA: Record<PorraFormato, string> = {
  clasica:
    'En esta porra el campo está repartido en grupos de color según su nivel (Amarillo, Verde, Azul, Morado, y Españoles si aplica). Eliges un jugador de cada grupo que tenga esta porra, más un comodín que puede salir de cualquiera de esas listas.',
  presupuesto:
    'En esta porra no hay grupos de color: eliges 5 jugadores libremente, el que quieras, siempre que el precio total del equipo no supere el presupuesto de 100.000 €. Cuanto mejor es un jugador, más caro sale.',
  futbol_jornada:
    'Pronostica el resultado (1, X o 2) de los 10 partidos de la jornada. Puedes apuntarte tantas veces como quieras — cada apunte es un equipo nuevo con su propio pronóstico.',
};
