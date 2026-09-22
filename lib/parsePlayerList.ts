// ============================================================================
// IMPORTADOR DE "PEGAR Y LISTO" para golf y tenis
// ============================================================================
// No hay ninguna API gratuita (ni scraping fiable/legal) de las webs de PGA
// Tour, DP World Tour, ATP o WTA, así que en vez de automatizarlo del todo,
// esto interpreta lo que Iñi pega directamente desde la web del circuito
// (la lista de inscritos o el ranking) y lo convierte en una lista de
// jugadores editable, sin que tenga que teclear nada a mano.
//
// Es deliberadamente tolerante: cada sitio pega el texto con un formato algo
// distinto (con o sin número de orden, con país entre paréntesis, con
// columnas separadas por tabulador o por varios espacios...). El resultado
// siempre se muestra en una tabla editable antes de confirmar nada, así que
// un fallo de interpretación en una línea suelta no bloquea el resto.
// ============================================================================

export type JugadorParseado = {
  nombre: string;
  rank: number;
};

export function parseListaJugadores(texto: string): JugadorParseado[] {
  const lineas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const resultado: JugadorParseado[] = [];

  lineas.forEach((linea, i) => {
    // Quita un número de orden inicial si lo trae: "1", "1.", "1)", "#1".
    const conRank = linea.match(/^#?(\d{1,4})[.)]?\s+(.*)$/);
    const rank = conRank ? Number(conRank[1]) : i + 1;
    let resto = conRank ? conRank[2] : linea;

    // Si la línea tiene varias columnas (nombre, país, puntos, T-póscición...)
    // separadas por tabulador o por 2+ espacios, nos quedamos con la primera.
    resto = resto.split(/\t| {2,}/)[0].trim();

    // Quita un país/circuito entre paréntesis al final, tipo "(ESP)" o "(a)".
    resto = resto.replace(/\s*\([A-Za-z.\s]{1,24}\)\s*$/, '').trim();

    // Quita una coma final suelta o guiones sueltos que a veces vienen de
    // tablas mal copiadas.
    resto = resto.replace(/[,-]\s*$/, '').trim();

    if (resto.length > 0 && resto.length < 60) {
      resultado.push({ nombre: resto, rank });
    }
  });

  return resultado;
}
