/**
 * Convierte la tabla de valores de mercado que se pega en /admin (una línea
 * por jugador, "Equipo<TAB>Jugador<TAB>Posición<TAB>Valor[<TAB>% titular]")
 * en filas listas para emparejar contra los jugadores ya cargados, o para
 * crear jugadores nuevos si no existían (25/09: ya no hace falta ninguna API
 * — este listado es ahora la única fuente del listado de jugadores de
 * fútbol, así que tiene que traer también la posición de cada uno).
 *
 * ENCARGO_precios_futbol_y_correccion_golf_tenis.md, A.4 (formato base) +
 * corrección de Iñi del 25/09 (añade la columna de posición, quita la
 * dependencia de football-data.org).
 *
 *   "Real Madrid	Kylian Mbappé	Delantero	153.400.000"
 *   "Sevilla	Rafa Garrido (Rafita)	Defensa	1.200.000	62%"
 *
 * Acepta los números con separadores de miles en cualquiera de los dos
 * estilos (158,927,883 o 158.927.883) — nunca llevan decimales, así que
 * basta con quitar todo lo que no sea dígito. Si viene la cabecera
 * ("Equipo  Jugador  Posición  Valor"), se ignora sola: su columna de valor
 * no parsea como número, así que esa línea se descarta sin avisar.
 *
 * La posición acepta variantes habituales (portero/POR/GK, defensa/DEF,
 * centrocampista/medio/MED/CC, delantero/DEL/ariete) sin distinguir mayúsculas
 * ni acentos — si no se reconoce, la fila se marca con aviso en vez de
 * adivinar, porque el precio de fútbol necesita la posición para calcularse
 * (ver lib/precioFutbol.ts).
 *
 * Un nombre con un apodo entre paréntesis al final ("Alfonso González
 * (Alfon)") se separa en nombre principal + apodo — el emparejador
 * (app/admin/page.tsx, usando lib/nombreMatch.ts) prueba los dos.
 */
import { PosicionFutbol } from './precioFutbol';

export type FilaValorMercado = {
  equipo: string;
  jugador: string;
  apodo: string | null;
  posicion: PosicionFutbol | null; // null si la columna no se reconoce — hay que corregirla antes de guardar
  posicionOrigen: string;
  valor: number;
  probabilidadTitular: number | null;
};

export type ResultadoParseoValores = { filas: FilaValorMercado[]; avisos: string[] };

const RE_APODO = /\(([^)]+)\)\s*$/;

const POSICIONES_RECONOCIDAS: Record<string, PosicionFutbol> = {
  portero: 'portero',
  por: 'portero',
  po: 'portero',
  gk: 'portero',
  meta: 'portero',
  defensa: 'defensa',
  defensor: 'defensa',
  def: 'defensa',
  df: 'defensa',
  central: 'defensa',
  lateral: 'defensa',
  centrocampista: 'centrocampista',
  centrocampismo: 'centrocampista',
  mediocampista: 'centrocampista',
  medio: 'centrocampista',
  med: 'centrocampista',
  cc: 'centrocampista',
  mc: 'centrocampista',
  delantero: 'delantero',
  del: 'delantero',
  dl: 'delantero',
  ariete: 'delantero',
  atacante: 'delantero',
  delantera: 'delantero',
};

function normalizarTexto(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function parsearPosicion(texto: string): PosicionFutbol | null {
  return POSICIONES_RECONOCIDAS[normalizarTexto(texto)] ?? null;
}

function parsearNumeroEntero(texto: string): number | null {
  const limpio = texto.replace(/[^\d]/g, '');
  if (!limpio) return null;
  const n = parseInt(limpio, 10);
  return Number.isFinite(n) ? n : null;
}

function parsearPorcentaje(texto: string): number | null {
  const limpio = texto.trim().replace('%', '').replace(',', '.');
  if (!limpio) return null;
  const n = parseFloat(limpio);
  return Number.isFinite(n) ? n : null;
}

export function parsearValoresMercado(texto: string): ResultadoParseoValores {
  const filas: FilaValorMercado[] = [];
  const avisos: string[] = [];

  for (const lineaBruta of texto.split(/\r?\n/)) {
    const linea = lineaBruta.replace(/\r$/, '');
    if (!linea.trim()) continue;

    const columnas = (linea.includes('\t') ? linea.split('\t') : linea.split(/ {2,}/))
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (columnas.length < 4) {
      avisos.push(`Línea con menos de 4 columnas (equipo, jugador, posición, valor), ignorada: "${linea.trim()}"`);
      continue;
    }

    const [equipo, jugadorBruto, posicionTexto, valorTexto, probabilidadTexto] = columnas;
    const valor = parsearNumeroEntero(valorTexto);
    if (valor === null) {
      // Probablemente la fila de cabecera ("Equipo  Jugador  Posición  Valor") — se ignora sin avisar.
      continue;
    }

    const matchApodo = jugadorBruto.match(RE_APODO);
    const apodo = matchApodo ? matchApodo[1].trim() : null;
    const jugador = (matchApodo ? jugadorBruto.slice(0, matchApodo.index).trim() : jugadorBruto).trim();

    if (!equipo || !jugador) {
      avisos.push(`Línea sin equipo o sin jugador, ignorada: "${linea.trim()}"`);
      continue;
    }

    const posicion = parsearPosicion(posicionTexto);
    if (!posicion) {
      avisos.push(`Posición "${posicionTexto}" no reconocida para ${jugador} (${equipo}) — usa portero/defensa/centrocampista/delantero.`);
    }

    filas.push({
      equipo,
      jugador,
      apodo,
      posicion,
      posicionOrigen: posicionTexto,
      valor,
      probabilidadTitular: probabilidadTexto ? parsearPorcentaje(probabilidadTexto) : null,
    });
  }

  return { filas, avisos };
}
