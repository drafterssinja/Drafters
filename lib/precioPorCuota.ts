/**
 * Precio de fantasía de cada jugador a partir de la cuota de "Ganador" del torneo.
 * Usado en golf y tenis (sustituye a la curva por ranking de lib/pricing.ts para el precio;
 * los grupos de color de la porra clásica siguen saliendo del ranking mundial).
 *
 * Fórmula (acordada con Iñi, 23/09/2026):
 *   1. probabilidad implícita = 1 / cuota
 *   2. se normaliza para quitar el margen de la casa (solo informativo: al escalar
 *      contra el favorito la normalización se cancela)
 *   3. peso = (probabilidad / probabilidad del favorito) ^ EXPONENTE
 *      = (cuota del favorito / cuota del jugador) ^ EXPONENTE
 *   4. precio = MINIMO + (FAVORITO - MINIMO) * peso, redondeado a centenas
 *
 * Consecuencia útil: el precio de cada jugador solo depende de su cuota y de la del
 * favorito, así que añadir o quitar jugadores del listado no cambia el precio del resto.
 *
 * Validación (Open de France, DP World Tour 2026): Aaberg 8,50 → 38.000 €,
 * Fitzpatrick/Fleetwood 9,50 → 34.500 €, Hovland 12,50 → 27.400 €, Gerard 14 → 25.000 €.
 */
import { EQUIPO_PRESUPUESTO } from './draftConfig';

export const PRECIO_CUOTA_CONFIG = {
  /** Parte del presupuesto que cuesta el favorito del torneo (0,38 = 38.000 € con 100.000 €). */
  fraccionFavorito: 0.38,
  /** Mando de afinado de la curva: <1 aplana (acerca a los de abajo), >1 separa más. */
  exponente: 0.95,
  /** Precio del jugador con menos opciones (y de cualquiera sin cuota válida). */
  precioMinimo: 3_500,
  /** Los precios se redondean a este múltiplo. */
  redondeo: 100,
} as const;

export type ConfigPrecioCuota = {
  presupuesto: number;
  fraccionFavorito: number;
  exponente: number;
  precioMinimo: number;
  redondeo: number;
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

export function calcularPreciosPorCuota(
  jugadores: JugadorConCuota[],
  config: Partial<ConfigPrecioCuota> = {}
): JugadorConPrecio[] {
  const cfg: ConfigPrecioCuota = {
    presupuesto: EQUIPO_PRESUPUESTO,
    ...PRECIO_CUOTA_CONFIG,
    ...config,
  };
  const precioFavorito = cfg.presupuesto * cfg.fraccionFavorito;
  const redondear = (v: number) => Math.round(v / cfg.redondeo) * cfg.redondeo;

  const validas = jugadores.map((j) => j.cuota).filter(cuotaValida);
  if (validas.length === 0) {
    return jugadores.map((j) => ({
      nombre: j.nombre,
      cuota: null,
      probabilidad: null,
      precio: cfg.precioMinimo,
      sinCuota: true,
    }));
  }

  const cuotaFavorito = Math.min(...validas);
  const sumaProbabilidades = validas.reduce((s, c) => s + 1 / c, 0);

  return jugadores.map((j) => {
    if (!cuotaValida(j.cuota)) {
      return { nombre: j.nombre, cuota: null, probabilidad: null, precio: cfg.precioMinimo, sinCuota: true };
    }
    const peso = Math.pow(cuotaFavorito / j.cuota, cfg.exponente);
    const precio = redondear(cfg.precioMinimo + (precioFavorito - cfg.precioMinimo) * peso);
    return {
      nombre: j.nombre,
      cuota: j.cuota,
      probabilidad: 1 / j.cuota / sumaProbabilidades,
      precio,
      sinCuota: false,
    };
  });
}
