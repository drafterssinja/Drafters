import type { crearClienteAdmin } from './supabaseAdmin';
import { normalizarNombre } from '@/lib/nombreMatch';

// ============================================================================
// THE ODDS API (28/10, Iñi) — cuotas de partidos de tenis
// ============================================================================
// Clave en Vercel: ODDS_API_KEY (Secret). Plan gratis: 500 créditos al mes.
//  · /v4/sports es gratis: lista de torneos activos (tennis_atp_*, tennis_wta_*).
//  · /v4/sports/{key}/odds?regions=eu&markets=h2h cuesta 1 crédito.
// Solo cubre Grand Slams, 1000 y 500 (no los 250). Las cuotas de cada torneo
// se guardan en tenis_torneos.odds_cache y se piden como mucho cada 6 horas,
// y solo cuando hace falta poner precio a jugadores (SQL 66).

type Admin = ReturnType<typeof crearClienteAdmin>;
const BASE = 'https://api.the-odds-api.com/v4';
const CADA_HORAS = 6;

export type DeporteOdds = { key: string; group: string; title: string; description: string; active: boolean; has_outrights?: boolean };
export type GanadorOdds = { nombre: string; cuota: number };
type Cache = { ganador?: GanadorOdds[]; partidos?: PartidoOdds[] };
export type PartidoOdds = { a: string; b: string; pa: number; inicio: string | null };

function clave(): string | null {
  return process.env.ODDS_API_KEY || null;
}

async function pedir(ruta: string): Promise<{ json: unknown; restantes: string | null; usados: string | null }> {
  const k = clave();
  if (!k) throw new Error('Falta la variable ODDS_API_KEY en Vercel.');
  const sep = ruta.includes('?') ? '&' : '?';
  const r = await fetch(`${BASE}${ruta}${sep}apiKey=${encodeURIComponent(k)}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const restantes = r.headers.get('x-requests-remaining');
  const usados = r.headers.get('x-requests-used');
  if (!r.ok) throw new Error(`The Odds API respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { json: await r.json(), restantes, usados };
}

/** Torneos de tenis que tiene ahora The Odds API (gratis, no gasta créditos). */
export async function deportesTenis(): Promise<{ deportes: DeporteOdds[]; restantes: string | null; usados: string | null }> {
  const r = await pedir('/sports');
  const lista = ((r.json as DeporteOdds[]) ?? []).filter((d) => d.key.startsWith('tennis_'));
  return { deportes: lista, restantes: r.restantes, usados: r.usados };
}

const GENERICAS = new Set(['atp', 'wta', 'open', 'masters', 'championships', 'championship', 'tennis', 'the', 'de', 'di', 'du', 'cup', 'international', 'internationals', 'tour', 'winner', 'winners', 'outright', 'singles', 'men', 'women', 'mens', 'womens', 'presented', 'by', 'and', 'rolex', 'mutua', 'bnp', 'paribas', 'internazionali', 'bnl', 'italia', 'national', 'bank', 'gonet', 'geneva', 'cinch']);
const palabras = (s: string) => normalizarNombre(s).split(' ').filter((w) => w.length > 1 && !GENERICAS.has(w));

// Nombres de patrocinador de ESPN → ciudad o nombre corto que usa The Odds API.
const ALIAS: [RegExp, string][] = [
  [/erste/i, 'vienna'],
  [/swiss indoors/i, 'basel'],
  [/roland|french/i, 'french'],
  [/internazionali|italian|roma|rome/i, 'italian rome'],
  [/western|cincinnati/i, 'cincinnati'],
  [/canad|montreal|toronto|national bank/i, 'canada canadian'],
  [/indian wells|bnp/i, 'indian wells'],
  [/monte/i, 'monte carlo'],
  [/sabadell|barcelona/i, 'barcelona'],
  [/queen/i, 'queens'],
  [/halle|terra wortmann/i, 'halle'],
  [/shanghai/i, 'shanghai'],
  [/china/i, 'china'],
  [/japan|kinoshita|tokyo/i, 'japan tokyo'],
  [/dubai/i, 'dubai'],
  [/qatar|doha/i, 'qatar doha'],
  [/mexic|acapulco/i, 'mexican acapulco'],
  [/washington|citi|mubadala/i, 'washington'],
  [/paris/i, 'paris'],
  [/madrid/i, 'madrid'],
  [/miami/i, 'miami'],
  [/australian/i, 'australian'],
  [/us open/i, 'us'],
  [/wimbledon/i, 'wimbledon'],
  [/wuhan/i, 'wuhan'],
  [/beijing/i, 'china beijing'],
];
const conAlias = (s: string) => `${s} ${ALIAS.filter(([re]) => re.test(s)).map(([, a]) => a).join(' ')}`;

function esDeLaLiga(d: DeporteOdds, liga: 'atp' | 'wta'): boolean {
  if (!d.key.startsWith('tennis_')) return false;
  if (d.key.startsWith(`tennis_${liga}_`)) return true;
  const t = normalizarNombre(`${d.title} ${d.description} ${d.key.replace(/_/g, ' ')}`);
  if (t.includes(liga)) return true;
  const mujeres = /\bwomen|\bwomens|\bladies/.test(t);
  return liga === 'wta' ? mujeres : /\bmen|\bmens/.test(t) && !mujeres;
}

/** El torneo de The Odds API que corresponde a uno de ESPN (por las palabras del nombre). */
export function emparejarTorneo(deportes: DeporteOdds[], liga: 'atp' | 'wta', nombreEspn: string): DeporteOdds | null {
  const mias = new Set(palabras(conAlias(nombreEspn)));
  let mejor: DeporteOdds | null = null;
  let puntos = 0;
  for (const d of deportes) {
    if (!esDeLaLiga(d, liga)) continue;
    const suyas = new Set([...palabras(d.title), ...palabras(d.key.replace(/^tennis_(atp|wta)_/, '').replace(/_/g, ' '))]);
    let p = 0;
    suyas.forEach((w) => mias.has(w) && p++);
    if (p > puntos) {
      puntos = p;
      mejor = d;
    }
  }
  return puntos > 0 ? mejor : null;
}

/** Cuotas h2h de un torneo (1 crédito): probabilidad de ganar de cada uno (media de las casas, sin margen). */
async function cuotasTorneo(key: string): Promise<{ partidos: PartidoOdds[]; restantes: string | null }> {
  const r = await pedir(`/sports/${key}/odds?regions=eu&markets=h2h&oddsFormat=decimal`);
  const partidos: PartidoOdds[] = [];
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const ev of ((r.json as any[]) ?? [])) {
    const a = String(ev.home_team ?? '');
    const b = String(ev.away_team ?? '');
    if (!a || !b) continue;
    const probs: number[] = [];
    for (const bk of (ev.bookmakers ?? []) as any[]) {
      const m = ((bk.markets ?? []) as any[]).find((x) => x.key === 'h2h');
      const oa = Number(m?.outcomes?.find((o: any) => o.name === a)?.price);
      const ob = Number(m?.outcomes?.find((o: any) => o.name === b)?.price);
      if (oa > 1 && ob > 1) probs.push(1 / oa / (1 / oa + 1 / ob));
    }
    if (probs.length === 0) continue;
    probs.sort((x, y) => x - y);
    const pa = probs[Math.floor(probs.length / 2)];
    partidos.push({ a, b, pa, inicio: ev.commence_time ?? null });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { partidos, restantes: r.restantes };
}

/** Cuotas al GANADOR del torneo (outrights, 1 crédito): la mediana de las casas para cada jugador. */
async function cuotasGanador(key: string): Promise<GanadorOdds[]> {
  const r = await pedir(`/sports/${key}/odds?regions=eu&markets=outrights&oddsFormat=decimal`);
  const porJugador = new Map<string, number[]>();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const ev of ((r.json as any[]) ?? [])) {
    for (const bk of (ev.bookmakers ?? []) as any[]) {
      const m = ((bk.markets ?? []) as any[]).find((x) => x.key === 'outrights');
      for (const o of (m?.outcomes ?? []) as any[]) {
        const c = Number(o?.price);
        if (!o?.name || !(c > 1)) continue;
        const l = porJugador.get(o.name) ?? [];
        l.push(c);
        porJugador.set(o.name, l);
      }
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return Array.from(porJugador.entries()).map(([nombre, cs]) => {
    cs.sort((x, y) => x - y);
    return { nombre, cuota: cs[Math.floor(cs.length / 2)] };
  });
}

/**
 * 28/10 (Iñi): como en golf, lo que manda es la cuota al GANADOR del torneo.
 *  1) Si The Odds API tiene el mercado de ganador (outrights) de ese torneo,
 *     se usa: el precio sale directamente de esas cuotas.
 *  2) Si no, las cuotas de los partidos (h2h) corrigen el precio por ranking.
 *  3) Si tampoco, el precio va por ranking.
 * Se guarda en tenis_torneos y se pide como mucho cada 6 horas (1 crédito).
 */
export async function cuotasParaTorneo(
  admin: Admin,
  competicion: string,
  liga: 'atp' | 'wta',
  nombreEspn: string | null
): Promise<{ ganador: Map<string, number>; partidos: Map<string, { p: number; rival: string }> }> {
  const ganador = new Map<string, number>();
  const partidos = new Map<string, { p: number; rival: string }>();
  const out = { ganador, partidos };
  if (!clave()) return out;
  try {
    const { data } = await admin.from('tenis_torneos').select('nombre_espn,odds_key,odds_cache,odds_en').eq('competicion', competicion).maybeSingle();
    const t = data as { nombre_espn: string | null; odds_key: string | null; odds_cache: Cache | PartidoOdds[] | null; odds_en: string | null } | null;
    let cache: Cache | null = t?.odds_cache ? (Array.isArray(t.odds_cache) ? { partidos: t.odds_cache } : t.odds_cache) : null;
    const viejas = !t?.odds_en || Date.now() - new Date(t.odds_en).getTime() > CADA_HORAS * 3600000;
    if (!cache || viejas) {
      const nombre = nombreEspn ?? t?.nombre_espn ?? competicion;
      const { deportes } = await deportesTenis();
      const activos = deportes.filter((d) => d.active);
      const deGanador = emparejarTorneo(activos.filter((d) => d.has_outrights), liga, nombre);
      const dePartidos = emparejarTorneo(activos.filter((d) => !d.has_outrights), liga, nombre);
      cache = {};
      let key: string | null = null;
      if (deGanador) {
        cache.ganador = await cuotasGanador(deGanador.key);
        key = deGanador.key;
      }
      if ((!cache.ganador || cache.ganador.length === 0) && dePartidos) {
        cache.partidos = (await cuotasTorneo(dePartidos.key)).partidos;
        key = dePartidos.key;
      }
      // Sin nada (p. ej. un 250) también se apunta, para no volver a preguntar en 6 horas.
      await admin.from('tenis_torneos').update({ odds_key: key, odds_cache: cache, odds_en: new Date().toISOString() }).eq('competicion', competicion);
    }
    for (const g of cache.ganador ?? []) ganador.set(normalizarNombre(g.nombre), g.cuota);
    for (const p of cache.partidos ?? []) {
      const a = normalizarNombre(p.a);
      const b = normalizarNombre(p.b);
      partidos.set(a, { p: p.pa, rival: b });
      partidos.set(b, { p: 1 - p.pa, rival: a });
    }
  } catch {
    // sin cuotas: el precio va por ranking
  }
  return out;
}

/** Busca a un jugador en el mapa de cuotas (nombre completo o, si no, apellido + inicial). */
export function buscarCuota<T>(mapa: Map<string, T>, nombre: string): T | null {
  const n = normalizarNombre(nombre);
  const directo = mapa.get(n);
  if (directo) return directo;
  const partes = n.split(' ');
  const apellido = partes[partes.length - 1];
  const inicial = partes[0]?.[0];
  for (const [k, v] of Array.from(mapa.entries())) {
    const kp = k.split(' ');
    if (kp[kp.length - 1] === apellido && kp[0]?.[0] === inicial) return v;
  }
  return null;
}
