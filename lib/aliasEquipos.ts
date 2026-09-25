// ============================================================================
// ALIAS DE NOMBRES DE EQUIPO DE FÚTBOL
// ============================================================================
// Empareja el nombre de un equipo tal y como lo escribe una fuente externa
// (el fantasy oficial al pegar valores de mercado, o Iñi al pegar las cuotas
// 1X2 de la jornada) contra el nombre que ya tenemos guardado en
// `jugadores.equipo_real`, que viene de football-data.org — cada fuente lo
// escribe de forma distinta: "Atlético" (fantasy) vs "Club Atlético de
// Madrid" (football-data.org), "Barça" vs "FC Barcelona", etc.
//
// Mismo principio que lib/nombreMatch.ts: mejor "no encontrado" (se corrige
// a mano en la vista previa, con los tres bloques del ENCARGO — emparejados,
// no emparejados, sin valor) que arriesgarse a cruzar dos equipos distintos.
// Por eso se prueba en este orden, parando en el primero que dé una
// respuesta inequívoca:
//
//   1. Coincidencia exacta tras normalizar (acentos/mayúsculas/espacios).
//   2. Alias conocido (tabla ALIAS_EQUIPOS de abajo), en cualquiera de los
//      dos sentidos.
//   3. Como último recurso, contención de palabras significativas (fuera
//      "fc", "cf", "club", "de", "real", etc.): si el nombre corto, una vez
//      quitadas esas palabras, aparece entero dentro de uno — y solo uno —
//      de los candidatos, se acepta. Si hay más de un candidato posible
//      (p.ej. "Madrid" solo, que podría ser Real Madrid, Atlético de Madrid
//      o Rayo Vallecano de Madrid), no se arriesga: queda sin emparejar.
//
// ALIAS_EQUIPOS está pensado para ampliarse: cuando la vista previa de un
// cargador muestre un equipo real "no emparejado" que en realidad sí está
// en la plantilla (solo que con un nombre distinto), añadir aquí la línea
// que falte — el valor de la derecha debe ser el nombre exacto tal cual lo
// da football-data.org (el que ya se ve en `equipo_real` en /admin).
//
// La Liga y Premier League están bien cubiertas (son las ligas con datos ya
// disponibles). Champions League es un conjunto más reducido, de los
// equipos más conocidos — a completar según haga falta cuando Iñi cargue
// esos valores (ver ENCARGO_precios_futbol_y_correccion_golf_tenis.md, A.8).

function normalizarEquipo(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos/diacríticos (incluida la cedilla de "Barça")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // fuera puntuación y símbolos ("&", "-", etc.)
    .replace(/\s+/g, ' ')
    .trim();
}

const PALABRAS_VACIAS_EQUIPO = new Set([
  'fc', 'cf', 'afc', 'cd', 'sd', 'ud', 'rcd', 'rc', 'ac', 'ca', 'ssc', 'sc', 'kv', 'sl',
  'club', 'de', 'la', 'el', 'los', 'real',
]);

function tokensSignificativos(nombre: string): string[] {
  return normalizarEquipo(nombre)
    .split(' ')
    .filter((t) => t.length > 0 && !PALABRAS_VACIAS_EQUIPO.has(t));
}

// Clave: alias normalizado (como lo escribe la fuente externa).
// Valor: nombre normalizado EXACTO tal y como lo da football-data.org.
const ALIAS_EQUIPOS: Record<string, string> = {
  // --- La Liga ---
  barcelona: 'fc barcelona',
  barca: 'fc barcelona',
  atletico: 'club atletico de madrid',
  'atletico de madrid': 'club atletico de madrid',
  atleti: 'club atletico de madrid',
  athletic: 'athletic club',
  'athletic bilbao': 'athletic club',
  'real sociedad': 'real sociedad de futbol',
  'la real': 'real sociedad de futbol',
  betis: 'real betis balompie',
  'real betis': 'real betis balompie',
  villarreal: 'villarreal cf',
  valencia: 'valencia cf',
  sevilla: 'sevilla fc',
  celta: 'rc celta de vigo',
  'celta de vigo': 'rc celta de vigo',
  getafe: 'getafe cf',
  osasuna: 'ca osasuna',
  girona: 'girona fc',
  rayo: 'rayo vallecano de madrid',
  'rayo vallecano': 'rayo vallecano de madrid',
  mallorca: 'rcd mallorca',
  alaves: 'deportivo alaves',
  espanyol: 'rcd espanyol de barcelona',
  espanol: 'rcd espanyol de barcelona', // por si se escribe sin la "ñ" catalana
  oviedo: 'real oviedo',
  elche: 'elche cf',
  levante: 'levante ud',

  // --- Premier League ---
  arsenal: 'arsenal fc',
  'aston villa': 'aston villa fc',
  bournemouth: 'afc bournemouth',
  brentford: 'brentford fc',
  brighton: 'brighton hove albion fc',
  burnley: 'burnley fc',
  chelsea: 'chelsea fc',
  'crystal palace': 'crystal palace fc',
  palace: 'crystal palace fc',
  everton: 'everton fc',
  fulham: 'fulham fc',
  leeds: 'leeds united fc',
  'leeds united': 'leeds united fc',
  liverpool: 'liverpool fc',
  'manchester city': 'manchester city fc',
  'man city': 'manchester city fc',
  'manchester united': 'manchester united fc',
  'man united': 'manchester united fc',
  'man utd': 'manchester united fc',
  newcastle: 'newcastle united fc',
  'newcastle united': 'newcastle united fc',
  'nottingham forest': 'nottingham forest fc',
  forest: 'nottingham forest fc',
  sunderland: 'sunderland afc',
  tottenham: 'tottenham hotspur fc',
  spurs: 'tottenham hotspur fc',
  'west ham': 'west ham united fc',
  'west ham united': 'west ham united fc',
  wolves: 'wolverhampton wanderers fc',
  wolverhampton: 'wolverhampton wanderers fc',

  // --- Champions League (conjunto reducido, ampliar según haga falta) ---
  bayern: 'fc bayern munchen',
  'bayern munich': 'fc bayern munchen',
  'bayern munchen': 'fc bayern munchen',
  psg: 'paris saint germain fc',
  'paris saint germain': 'paris saint germain fc',
  'paris sg': 'paris saint germain fc',
  inter: 'fc internazionale milano',
  'inter milan': 'fc internazionale milano',
  milan: 'ac milan',
  'ac milan': 'ac milan',
  juventus: 'juventus fc',
  juve: 'juventus fc',
  dortmund: 'borussia dortmund',
  'borussia dortmund': 'borussia dortmund',
  bvb: 'borussia dortmund',
  leverkusen: 'bayer 04 leverkusen',
  'bayer leverkusen': 'bayer 04 leverkusen',
  leipzig: 'rb leipzig',
  'rb leipzig': 'rb leipzig',
  sporting: 'sporting clube de portugal',
  'sporting cp': 'sporting clube de portugal',
  'sporting lisboa': 'sporting clube de portugal',
  benfica: 'sl benfica',
  porto: 'fc porto',
  ajax: 'afc ajax',
  psv: 'psv eindhoven',
  feyenoord: 'feyenoord rotterdam',
  brujas: 'club brugge kv',
  'club brugge': 'club brugge kv',
  bruges: 'club brugge kv',
  galatasaray: 'galatasaray sk',
  napoli: 'ssc napoli',
  atalanta: 'atalanta bc',
  marsella: 'olympique de marseille',
  marseille: 'olympique de marseille',
  monaco: 'as monaco fc',
};

/**
 * Empareja el nombre de un equipo (tal y como lo escribe una fuente
 * externa) contra la lista de nombres reales candidatos (normalmente los
 * `equipo_real` distintos de los jugadores ya sincronizados para esa
 * competición/jornada). Devuelve el nombre EXACTO del candidato elegido
 * (tal cual venía en `candidatos`, sin normalizar), o null si no hay una
 * coincidencia clara — para que la vista previa lo marque como "no
 * emparejado" y lo resuelva Iñi a mano.
 */
export function emparejarEquipo(nombreOrigen: string, candidatos: string[]): string | null {
  const normOrigen = normalizarEquipo(nombreOrigen);
  if (!normOrigen) return null;

  // 1. Coincidencia exacta tras normalizar.
  const exacto = candidatos.find((c) => normalizarEquipo(c) === normOrigen);
  if (exacto) return exacto;

  // 2. Alias conocido, en cualquiera de los dos sentidos (por si algún día
  //    la lista de candidatos también trajera una forma corta).
  const aliasDeOrigen = ALIAS_EQUIPOS[normOrigen];
  if (aliasDeOrigen) {
    const porAlias = candidatos.find((c) => normalizarEquipo(c) === aliasDeOrigen);
    if (porAlias) return porAlias;
  }
  const porAliasInverso = candidatos.find((c) => ALIAS_EQUIPOS[normalizarEquipo(c)] === normOrigen);
  if (porAliasInverso) return porAliasInverso;

  // 3. Contención de palabras significativas, solo si es inequívoca.
  const tokensOrigen = tokensSignificativos(nombreOrigen);
  if (tokensOrigen.length === 0) return null;
  const posibles = candidatos.filter((c) => {
    const tokensCand = tokensSignificativos(c);
    const [cortos, largos] = tokensOrigen.length <= tokensCand.length ? [tokensOrigen, tokensCand] : [tokensCand, tokensOrigen];
    return cortos.length > 0 && cortos.every((t) => largos.includes(t));
  });
  return posibles.length === 1 ? posibles[0] : null;
}

// Exportado por si algún cargador necesita normalizar dos nombres sueltos
// para compararlos sin pasar por la lista de candidatos (p.ej. detectar que
// dos filas del mismo pegado se refieren al mismo equipo).
export { normalizarEquipo };
