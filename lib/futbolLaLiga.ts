// ============================================================================
// FÚTBOL — claves de equipo, emparejado de nombres y utilidades (LaLiga y más)
// ============================================================================
// Funciones puras (sin red ni base de datos) para poder probarlas aparte.
//
// HISTORIA: hasta el 06/10 este archivo leía los puntos de LaLiga Fantasy de
// futbolfantasy.com. Ese día Iñi cambió la puntuación a las tablas propias de
// Drafters calculadas con ESPN (ver lib/futbolPuntuacion.ts), así que el
// lector de la tabla y los bonus de victoria/empate se han quitado. Se
// mantiene aquí lo que sigue siendo útil: la clave de equipo común entre
// fuentes y el emparejado por nombre (jugadores de ESPN ↔ nuestra ficha).

import { normalizarNombre } from './nombreMatch';
import { normalizarEquipo, canonicoEquipo } from './aliasEquipos';

/** Un jugador "externo" a emparejar con nuestra ficha (p.ej. de ESPN). */
export type FilaFantasy = {
  slug: string;
  nombre: string;
  equipo: string;
  posicion: string;
  partidos: number;
  puntos: number;
};

const REGLAS_EQUIPO: [string, RegExp][] = [
  ['alaves', /alaves/],
  ['athletic', /athletic/],
  ['espanyol', /espanyol|espanol/],
  ['atletico', /atletico|atleti\b/],
  ['barcelona', /barcelona|barca\b/],
  ['betis', /betis/],
  ['celta', /celta/],
  ['elche', /elche/],
  ['getafe', /getafe/],
  ['levante', /levante/],
  ['malaga', /malaga/],
  ['osasuna', /osasuna/],
  ['racing', /racing/],
  ['rayo', /rayo/],
  ['real madrid', /real madrid/],
  ['real sociedad', /sociedad|la real\b/],
  ['sevilla', /sevilla/],
  ['valencia', /valencia/],
  ['villarreal', /villarreal/],
  ['deportivo', /deportivo|depor\b|coruna/],
];

export function claveEquipoLaLiga(nombre: string | null | undefined): string {
  // Primero el alias conocido ("Bayern Munich" de ESPN → nombre de
  // football-data.org) para que todas las fuentes den la misma clave.
  const n = canonicoEquipo(nombre ?? '');
  if (!n) return '';
  for (const [clave, re] of REGLAS_EQUIPO) {
    if (re.test(n)) return clave;
  }
  // Club que no está en las reglas (ascensos futuros): su propio nombre sin
  // palabras vacías, así al menos coincide consigo mismo entre fuentes.
  return n
    .split(' ')
    .filter((t) => t && !['fc', 'cf', 'cd', 'sd', 'ud', 'rcd', 'rc', 'club', 'de', 'la', 'el', 'real'].includes(t))
    .join(' ');
}

/** Clave de equipo común entre fuentes (válida para cualquier liga). */
export const claveEquipoFutbol = claveEquipoLaLiga;

// ----------------------------------------------------------------------------
// Emparejar jugadores de nuestra ficha con las filas de la tabla
// ----------------------------------------------------------------------------
export type JugadorFicha = { id: string; nombre: string; equipo_real: string | null };

export type ResultadoEmparejamiento = {
  emparejados: Map<string, FilaFantasy>; // jugador_id → fila
  sinEmparejarFicha: JugadorFicha[];
  sinEmparejarTabla: FilaFantasy[]; // filas de equipos de la jornada que nadie ha reclamado
};

function nombresDeFicha(nombre: string): string[] {
  const apodo = /\(([^)]+)\)\s*$/.exec(nombre)?.[1];
  const principal = nombre.replace(/\([^)]*\)\s*$/, '');
  return [normalizarNombre(principal), apodo ? normalizarNombre(apodo) : ''].filter(Boolean);
}

function tokens(n: string): string[] {
  return n.split(' ').filter(Boolean);
}

// ¿Todos los tokens del nombre corto están en el largo? Solo se acepta si el
// corto tiene 2+ palabras o una palabra de 5+ letras (evita "Pedro" ⊂ "Pedro
// González López" cuando hay varios Pedros — de eso se encarga la unicidad).
function contenido(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (corto.length === 0) return false;
  if (corto.length === 1 && corto[0].length < 4) return false;
  return corto.every((t) => largo.includes(t));
}

/** `alias`: nombre normalizado en futbolfantasy → nombre normalizado en
 * nuestra ficha (tabla alias_nombres_jugador, deporte 'futbol'). */
export function emparejarJugadoresConTabla(
  jugadores: JugadorFicha[],
  filas: FilaFantasy[],
  alias: Map<string, string>
): ResultadoEmparejamiento {
  const equiposFicha = new Set(jugadores.map((j) => claveEquipoLaLiga(j.equipo_real)).filter(Boolean));
  const filasRelevantes = filas.filter((f) => equiposFicha.has(claveEquipoLaLiga(f.equipo)));

  const nombresDeFila = (f: FilaFantasy): string[] => {
    const base = [normalizarNombre(f.nombre), normalizarNombre(f.slug.replace(/-/g, ' '))].filter(Boolean);
    const extra = base.map((n) => alias.get(n)).filter((x): x is string => !!x);
    return [...base, ...extra];
  };
  const nombresFila = new Map<FilaFantasy, string[]>(filasRelevantes.map((f) => [f, nombresDeFila(f)]));
  const filasPorEquipo = new Map<string, FilaFantasy[]>();
  for (const f of filasRelevantes) {
    const k = claveEquipoLaLiga(f.equipo);
    const l = filasPorEquipo.get(k) ?? [];
    l.push(f);
    filasPorEquipo.set(k, l);
  }

  const usadas = new Set<FilaFantasy>();
  const emparejados = new Map<string, FilaFantasy>();

  // Vueltas de más a menos estricto; cada una solo acepta coincidencias únicas.
  type Criterio = (nombresJ: string[], f: FilaFantasy) => boolean;
  const exacto: Criterio = (nj, f) => nj.some((n) => nombresFila.get(f)!.includes(n));
  const parcial: Criterio = (nj, f) => nj.some((n) => nombresFila.get(f)!.some((nf) => contenido(n, nf)));

  const pendientes = new Map<string, JugadorFicha>(jugadores.map((j) => [j.id, j]));

  const vuelta = (criterio: Criterio, global: boolean) => {
    for (const j of Array.from(pendientes.values())) {
      const nj = nombresDeFicha(j.nombre);
      const clave = claveEquipoLaLiga(j.equipo_real);
      const candidatas = (global || !clave ? filasRelevantes : (filasPorEquipo.get(clave) ?? [])).filter((f) => !usadas.has(f));
      const coinciden = candidatas.filter((f) => criterio(nj, f));
      if (coinciden.length === 1) {
        emparejados.set(j.id, coinciden[0]);
        usadas.add(coinciden[0]);
        pendientes.delete(j.id);
      }
    }
  };
  vuelta(exacto, false);
  vuelta(parcial, false);
  vuelta(exacto, true);

  return {
    emparejados,
    sinEmparejarFicha: Array.from(pendientes.values()),
    sinEmparejarTabla: filasRelevantes.filter((f) => !usadas.has(f)),
  };
}

// ----------------------------------------------------------------------------
// Resultado del partido → bonus
// ----------------------------------------------------------------------------
export type ResultadoEquipo = 'G' | 'E' | 'P';

// Escudos de LaLiga (ESPN CDN, ids de equipo de esp.1) por clave de equipo —
// 06/10, pedido de Iñi: en la elección de jugadores los partidos se ven como
// "escudo vs escudo". Independiente de que ya haya marcadores cargados.
const ESCUDOS_ESPN: Record<string, number> = {
  alaves: 96, athletic: 93, atletico: 1068, barcelona: 83, celta: 85, deportivo: 90, elche: 3751, espanyol: 88,
  getafe: 2922, levante: 1538, malaga: 99, osasuna: 97, racing: 87, rayo: 101, betis: 244, 'real madrid': 86,
  'real sociedad': 89, sevilla: 243, valencia: 94, villarreal: 102,
};
export function escudoLaLiga(nombreEquipo: string | null | undefined): string | null {
  const id = ESCUDOS_ESPN[claveEquipoLaLiga(nombreEquipo ?? '')];
  return id ? `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` : null;
}

export function resultadoDeEquipo(golesPropios: number, golesRival: number): ResultadoEquipo {
  if (golesPropios > golesRival) return 'G';
  if (golesPropios < golesRival) return 'P';
  return 'E';
}

/** Formato de puntos para pantalla: sin decimales si es entero, coma si no. */
export function formatPuntos(n: number): string {
  const redondeado = Math.round(n * 100) / 100;
  return Number.isInteger(redondeado) ? String(redondeado) : String(redondeado).replace('.', ',');
}
