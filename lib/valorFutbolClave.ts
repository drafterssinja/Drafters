import { normalizarNombre } from '@/lib/nombreMatch';

// ============================================================================
// VALOR DRAFTERS DE FÚTBOL — cosas comunes a la app y al servidor (03/11)
// ============================================================================
// Ver lib/server/valorFutbol.ts y el SQL 92.

/** Ligas con valor automático (prefijo de competición como en `jugadores.competicion`). */
export const LIGAS_VALOR_FUTBOL: { prefijo: string; apif: number; nombre: string }[] = [
  { prefijo: 'La Liga', apif: 140, nombre: 'LaLiga' },
  { prefijo: 'Champions League', apif: 2, nombre: 'Champions' },
];

/** Clave de un jugador en futbol_valor: nombre|equipo normalizados (la misma
 * que usa plantillaDeLaLiga para quedarse con la ficha más reciente). */
export function claveJugadorFutbol(nombre: string, equipo: string | null | undefined): string {
  return `${normalizarNombre(nombre)}|${normalizarNombre(equipo ?? '')}`;
}

// Reglas de Iñi (03/11): como mucho un 5 % por semana; sin jugar (lesión o
// no convocado), como mucho un 2 % a la baja; nunca más de un 30 % por
// encima o por debajo del valor cargado.
export const VALOR_MAX_SEMANA = 0.05;
export const VALOR_MAX_SIN_JUGAR = 0.02;
export const VALOR_TOPE_TOTAL = 0.3;
