/**
 * Convierte el listado de cuotas 1X2 de una jornada de fútbol, pegado en
 * /admin, en partidos {equipoLocal, equipoVisitante, cuota1, cuotaX, cuota2}.
 *
 * ENCARGO_precios_futbol_y_correccion_golf_tenis.md, A.4. Formato, una línea
 * por partido:
 *
 *   "Real Madrid - Osasuna 1,25 6,50 11,00"
 *   "Celta - Girona	2.10	3.30	3.60"   (con coma o punto decimal)
 *
 * Reutiliza el mismo parseo de números que golf/tenis (lib/parsearCuotas.ts)
 * para aceptar coma o punto decimal, y puntos de miles en cuotas absurdamente
 * altas (no debería hacer falta, pero no cuesta nada ser consistentes).
 */
import { parsearNumeroCuota } from './parsearCuotas';

export type PartidoCuotaLeido = {
  equipoLocal: string;
  equipoVisitante: string;
  cuota1: number;
  cuotaX: number;
  cuota2: number;
};

export type ResultadoParseoCuotasFutbol = { partidos: PartidoCuotaLeido[]; avisos: string[] };

// "Local - Visitante  1,85  3,40  4,20" — el guion entre equipos necesita
// espacios a los dos lados para no confundirse con un apellido compuesto.
const RE_PARTIDO = /^(.+?)\s+-\s+(.+?)[\s\t]+([\d.,]+)[\s\t]+([\d.,]+)[\s\t]+([\d.,]+)\s*$/;

export function parsearCuotasPartidosFutbol(texto: string): ResultadoParseoCuotasFutbol {
  const partidos: PartidoCuotaLeido[] = [];
  const avisos: string[] = [];

  for (const lineaBruta of texto.split(/\r?\n/)) {
    const linea = lineaBruta.replace(/\r$/, '').trim();
    if (!linea) continue;

    const m = linea.match(RE_PARTIDO);
    if (!m) {
      avisos.push(`Línea no reconocida (se esperaba "Local - Visitante 1,85 3,40 4,20"): "${linea}"`);
      continue;
    }
    const [, local, visitante, c1, cx, c2] = m;
    const cuota1 = parsearNumeroCuota(c1);
    const cuotaX = parsearNumeroCuota(cx);
    const cuota2 = parsearNumeroCuota(c2);
    if (cuota1 === null || cuota1 <= 1 || cuotaX === null || cuotaX <= 1 || cuota2 === null || cuota2 <= 1) {
      avisos.push(`Cuotas no válidas en "${linea}"`);
      continue;
    }
    partidos.push({ equipoLocal: local.trim(), equipoVisitante: visitante.trim(), cuota1, cuotaX, cuota2 });
  }

  return { partidos, avisos };
}
