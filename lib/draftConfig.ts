// ============================================================================
// CONFIGURACIÓN DEL DRAFT (elegir jugadores dentro de un presupuesto)
// ============================================================================
// Mismos valores en el cliente (para pintar la barra de presupuesto y
// deshabilitar filas) y en el servidor (drafters-schema.sql,
// inscribirse_en_sala()) — si se cambia aquí, hay que cambiarlo también ahí.

// Presupuesto "de fantasía" para elegir jugadores (nada que ver con el
// saldo simulado real que se descuenta al inscribirse — ver
// lib/pricing.ts para el rango de precios de cada jugador).
export const EQUIPO_PRESUPUESTO = 100000;

// Tamaño fijo del equipo en golf y tenis (fútbol usa la alineación elegida,
// ver huecosPorLinea en lib/salaShared.ts). No lo fijó Iñi explícitamente
// para la versión real — se ha tomado de los 5 huecos de la maqueta visual
// (Main.dc.html, pantalla "Crea tu equipo"). Avisar si debe ser otro número.
export const TAMANO_EQUIPO_GOLF_TENIS = 5;

export interface FormacionFutbol {
  label: string;
  alineacion: string;
}

// Mismas 4 alineaciones de la maqueta (futbolFormacionesDisponibles).
export const FORMACIONES_FUTBOL: FormacionFutbol[] = [
  { label: '4-3-3', alineacion: '4-3-3' },
  { label: '4-4-2', alineacion: '4-4-2' },
  { label: '3-5-2', alineacion: '3-5-2' },
  { label: '4-2-3-1', alineacion: '4-2-3-1' },
];

export function colorPresupuesto(restante: number): string {
  if (restante < 0) return '#FF5C5C';
  if (restante < EQUIPO_PRESUPUESTO * 0.15) return '#F0B94D';
  return '#3DDC84';
}
