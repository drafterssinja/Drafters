/**
 * Convierte la tabla de valores de mercado que se pega en /admin (una línea
 * por jugador, "Equipo<TAB>Jugador<TAB>Valor[<TAB>% titular]") en filas
 * listas para emparejar contra los jugadores ya sincronizados.
 *
 * ENCARGO_precios_futbol_y_correccion_golf_tenis.md, A.4.
 *
 *   "Real Madrid	Kylian Mbappé	153.400.000"
 *   "Sevilla	Rafa Garrido (Rafita)	1.200.000	62%"
 *
 * Acepta los números con separadores de miles en cualquiera de los dos
 * estilos (158,927,883 o 158.927.883) — nunca llevan decimales, así que
 * basta con quitar todo lo que no sea dígito. Si viene la cabecera
 * ("Equipo  Jugador  Valor"), se ignora sola: su columna de valor no
 * parsea como número, así que esa línea se descarta sin avisar.
 *
 * Un nombre con un apodo entre paréntesis al final ("Alfonso González
 * (Alfon)") se separa en nombre principal + apodo — el emparejador
 * (app/admin/page.tsx, usando lib/nombreMatch.ts) prueba los dos.
 */

export type FilaValorMercado = {
  equipo: string;
  jugador: string;
  apodo: string | null;
  valor: number;
  probabilidadTitular: number | null;
};

export type ResultadoParseoValores = { filas: FilaValorMercado[]; avisos: string[] };

const RE_APODO = /\(([^)]+)\)\s*$/;

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

    if (columnas.length < 3) {
      avisos.push(`Línea con menos de 3 columnas, ignorada: "${linea.trim()}"`);
      continue;
    }

    const [equipo, jugadorBruto, valorTexto, probabilidadTexto] = columnas;
    const valor = parsearNumeroEntero(valorTexto);
    if (valor === null) {
      // Probablemente la fila de cabecera ("Equipo  Jugador  Valor") — se ignora sin avisar.
      continue;
    }

    const matchApodo = jugadorBruto.match(RE_APODO);
    const apodo = matchApodo ? matchApodo[1].trim() : null;
    const jugador = (matchApodo ? jugadorBruto.slice(0, matchApodo.index).trim() : jugadorBruto).trim();

    if (!equipo || !jugador) {
      avisos.push(`Línea sin equipo o sin jugador, ignorada: "${linea.trim()}"`);
      continue;
    }

    filas.push({
      equipo,
      jugador,
      apodo,
      valor,
      probabilidadTitular: probabilidadTexto ? parsearPorcentaje(probabilidadTexto) : null,
    });
  }

  return { filas, avisos };
}
