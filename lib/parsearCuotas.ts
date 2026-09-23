/**
 * Convierte un listado de cuotas pegado desde una casa de apuestas en {nombre, cuota}[].
 *
 * Acepta, línea a línea o mezclado:
 *   "Aaberg, Ludvig 8,50"          (apellido, nombre + cuota con coma decimal)
 *   "Ludvig Aaberg<TAB>8.50"       (nombre apellido + cuota con punto decimal)
 *   "Buchanan, Jack - 1.000"       (punto de miles: 1.000 = mil)
 *   "Scottie Scheffler 9/2"        (cuota fraccional → 5,5)
 *   nombre en una línea y cuota en la siguiente (copiar de una web suele dar eso),
 *   con líneas de porcentaje ("30%") por medio, que se ignoran.
 *
 * Los nombres "Apellido, Nombre" se reordenan a "Nombre Apellido" para que cuadren
 * con el ranking mundial y con lib/nombreMatch.ts. Duplicados: se queda el primero.
 */

export type CuotaLeida = { nombre: string; cuota: number };
export type ResultadoParseo = { jugadores: CuotaLeida[]; avisos: string[] };

const RE_CUOTA_FINAL = /[\s\t:;\-–|]+(\d+\/\d+|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*$/;
const RE_SOLO_CUOTA = /^(\d+\/\d+|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)$/;
const RE_PORCENTAJE = /^\d+(?:[.,]\d+)?\s*%$/;

/** "8,50" → 8.5 · "1.000" → 1000 · "12.5" → 12.5 · "9/2" → 5.5 */
export function parsearNumeroCuota(texto: string): number | null {
  const t = texto.trim();
  if (t.includes('/')) {
    const [a, b] = t.split('/').map(Number);
    return b > 0 && Number.isFinite(a) ? 1 + a / b : null;
  }
  let normal: string;
  if (t.includes(',')) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, '');
  else normal = t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** "Aaberg, Ludvig" → "Ludvig Aaberg"; "Michael Mjaaseth" se queda igual. */
export function normalizarOrdenNombre(nombre: string): string {
  const limpio = nombre.replace(/\s+/g, ' ').trim();
  const partes = limpio.split(',');
  if (partes.length === 2 && partes[0].trim() && partes[1].trim()) {
    return `${partes[1].trim()} ${partes[0].trim()}`;
  }
  return limpio;
}

export function claveNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function parsearListadoCuotas(texto: string): ResultadoParseo {
  const jugadores: CuotaLeida[] = [];
  const avisos: string[] = [];
  const vistos = new Set<string>();
  let nombrePendiente: string | null = null;

  const anadir = (nombreBruto: string, cuotaTexto: string) => {
    const nombre = normalizarOrdenNombre(nombreBruto);
    const cuota = parsearNumeroCuota(cuotaTexto);
    if (!nombre) return;
    if (cuota === null || cuota <= 1) {
      avisos.push(`Cuota no válida para ${nombre}: "${cuotaTexto}"`);
      return;
    }
    const clave = claveNombre(nombre);
    if (vistos.has(clave)) return;
    vistos.add(clave);
    jugadores.push({ nombre, cuota });
  };

  for (const lineaBruta of texto.split(/\r?\n/)) {
    const linea = lineaBruta.trim();
    if (!linea || RE_PORCENTAJE.test(linea)) continue;

    const soloCuota = linea.match(RE_SOLO_CUOTA);
    if (soloCuota) {
      if (nombrePendiente) {
        anadir(nombrePendiente, soloCuota[1]);
        nombrePendiente = null;
      }
      continue;
    }

    const conCuota = linea.match(RE_CUOTA_FINAL);
    if (conCuota && conCuota.index !== undefined && conCuota.index > 0) {
      if (nombrePendiente) avisos.push(`Sin cuota: ${normalizarOrdenNombre(nombrePendiente)}`);
      anadir(linea.slice(0, conCuota.index), conCuota[1]);
      nombrePendiente = null;
      continue;
    }

    if (nombrePendiente) avisos.push(`Sin cuota: ${normalizarOrdenNombre(nombrePendiente)}`);
    nombrePendiente = linea;
  }
  if (nombrePendiente) avisos.push(`Sin cuota: ${normalizarOrdenNombre(nombrePendiente)}`);

  return { jugadores, avisos };
}
