// ============================================================================
// API-FOOTBALL — estadísticas por jugador que ESPN no da (01/11, Iñi)
// ============================================================================
// Pases clave, entradas, intercepciones, tiros bloqueados, duelos (ganados y
// perdidos), regates buenos y la nota del partido (solo para el MVP: el de
// mejor nota). La clave va SOLO en la variable de entorno API_FOOTBALL_KEY de
// Vercel. Plan Pro: 7.500 consultas al día.
//
// Para no gastar de más: el id del partido de API-Football y sus estadísticas
// se guardan en futbol_apif_partido (SQL 76). Se vuelve a pedir:
//   · partido en juego → cada vez que pasa el cron (1 por minuto);
//   · terminado → cada 10 minutos durante las 3 primeras horas (por si
//     corrigen algo); luego se usa lo guardado.
// Si API-Football falla o no hay clave, se sigue puntuando con ESPN (estas
// acciones simplemente no suman).

const BASE = 'https://v3.football.api-sports.io';
export const LIGA_APIF: Record<string, number> = { 'esp.1': 140, 'uefa.champions': 2, 'eng.1': 39 };

export type StatsApifJugador = {
  nombre: string;
  dorsal: string;
  minutos: number;
  nota: number | null;
  pasesClave: number;
  entradas: number;
  intercepciones: number;
  tirosBloqueados: number;
  duelos: number;
  duelosGanados: number;
  regatesBuenos: number;
};
export type StatsApifEquipo = { equipoId: number; equipo: string; jugadores: StatsApifJugador[] };
export type FixtureApif = { id: number; fecha: string; localId: number; local: string; visitanteId: number; visitante: string };

export function claveApif(): string | null {
  return process.env.API_FOOTBALL_KEY || null;
}

async function pedir(ruta: string): Promise<any> {
  const clave = claveApif();
  if (!clave) throw new Error('Sin API_FOOTBALL_KEY');
  const r = await fetch(`${BASE}${ruta}`, { headers: { 'x-apisports-key': clave, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`API-Football ${r.status}`);
  const json = await r.json();
  const err = json?.errors;
  if (err && ((Array.isArray(err) && err.length) || (!Array.isArray(err) && typeof err === 'object' && Object.keys(err).length))) {
    throw new Error(`API-Football: ${JSON.stringify(err).slice(0, 200)}`);
  }
  return json;
}

/** Temporada de API-Football (año en que empieza): 2026-27 → 2026. */
export function temporadaApif(d: Date): number {
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

/** Partidos de una liga en un día (1 consulta). */
export async function partidosApifDelDia(slug: string, dia: Date): Promise<FixtureApif[]> {
  const liga = LIGA_APIF[slug];
  if (!liga) return [];
  const fecha = dia.toISOString().slice(0, 10);
  const json = await pedir(`/fixtures?league=${liga}&season=${temporadaApif(dia)}&date=${fecha}`);
  return ((json?.response ?? []) as any[]).map((f) => ({
    id: Number(f.fixture?.id),
    fecha: String(f.fixture?.date ?? ''),
    localId: Number(f.teams?.home?.id),
    local: String(f.teams?.home?.name ?? ''),
    visitanteId: Number(f.teams?.away?.id),
    visitante: String(f.teams?.away?.name ?? ''),
  }));
}

const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0);

/** Estadísticas por jugador de un partido (1 consulta). */
export async function estadisticasApif(fixtureId: number): Promise<StatsApifEquipo[]> {
  const json = await pedir(`/fixtures/players?fixture=${fixtureId}`);
  return ((json?.response ?? []) as any[]).map((eq) => ({
    equipoId: Number(eq.team?.id),
    equipo: String(eq.team?.name ?? ''),
    jugadores: ((eq.players ?? []) as any[]).map((p) => {
      const s = p.statistics?.[0] ?? {};
      const nota = s.games?.rating === null || s.games?.rating === undefined ? null : Number(s.games.rating);
      return {
        nombre: String(p.player?.name ?? ''),
        dorsal: s.games?.number === null || s.games?.number === undefined ? '' : String(s.games.number),
        minutos: n(s.games?.minutes),
        nota: nota !== null && Number.isFinite(nota) ? nota : null,
        pasesClave: n(s.passes?.key),
        entradas: n(s.tackles?.total),
        intercepciones: n(s.tackles?.interceptions),
        tirosBloqueados: n(s.tackles?.blocks),
        duelos: n(s.duels?.total),
        duelosGanados: n(s.duels?.won),
        regatesBuenos: n(s.dribbles?.success),
      };
    }),
  }));
}

// ----------------------------------------------------------------------------
// Emparejar: equipos y jugadores de ESPN ↔ API-Football
// ----------------------------------------------------------------------------
export function normalizarNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9. -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(s: string): string[] {
  return normalizarNombre(s)
    .replace(/-/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/** ¿Es el mismo jugador? "J. Álvarez" ~ "Julián Álvarez"; "Lee Kang-In" ~ "Kang-in Lee". */
export function mismoNombre(apif: string, espn: string): boolean {
  const a = tokens(apif);
  const e = tokens(espn);
  if (a.length === 0 || e.length === 0) return false;
  if (a.join(' ') === e.join(' ')) return true;
  const completas = a.filter((t) => !t.endsWith('.') && t.length > 1);
  const iniciales = a.filter((t) => t.endsWith('.') || t.length === 1).map((t) => t[0]);
  if (completas.length === 0) return false;
  if (!completas.every((t) => e.includes(t))) return false;
  return iniciales.every((i) => e.some((t) => t[0] === i));
}

type FilaEspnMin = { atletaId: string; nombre: string; nombreCompleto: string; dorsal: string };

/**
 * Empareja los jugadores de API-Football con los de la alineación de ESPN del
 * mismo partido. Primero se decide qué equipo de API-Football es el local
 * (el que más se parece a la alineación local de ESPN) y luego cada jugador
 * por dorsal + nombre, o solo por nombre.
 */
export function emparejarApif(equipos: StatsApifEquipo[], local: FilaEspnMin[], visitante: FilaEspnMin[]): Map<string, StatsApifJugador> {
  const out = new Map<string, StatsApifJugador>();
  if (equipos.length === 0) return out;
  const parecido = (eq: StatsApifEquipo, roster: FilaEspnMin[]) =>
    eq.jugadores.reduce((s, j) => s + (roster.some((f) => (j.dorsal && f.dorsal === j.dorsal) || mismoNombre(j.nombre, f.nombreCompleto) || mismoNombre(j.nombre, f.nombre)) ? 1 : 0), 0);
  let [eqL, eqV] = [equipos[0], equipos[1]];
  if (eqV && parecido(eqV, local) + parecido(eqL, visitante) > parecido(eqL, local) + parecido(eqV, visitante)) [eqL, eqV] = [eqV, eqL];
  const casar = (eq: StatsApifEquipo | undefined, roster: FilaEspnMin[]) => {
    if (!eq) return;
    const libres = new Set(roster.map((f) => f.atletaId));
    // 1) dorsal y nombre; 2) solo nombre; 3) solo dorsal si el nombre no casa con nadie.
    const pasos: ((j: StatsApifJugador, f: FilaEspnMin) => boolean)[] = [
      (j, f) => !!j.dorsal && f.dorsal === j.dorsal && (mismoNombre(j.nombre, f.nombreCompleto) || mismoNombre(j.nombre, f.nombre)),
      (j, f) => mismoNombre(j.nombre, f.nombreCompleto) || mismoNombre(j.nombre, f.nombre),
      (j, f) => !!j.dorsal && f.dorsal === j.dorsal,
    ];
    const pendientes = new Set(eq.jugadores);
    for (const ok of pasos) {
      for (const j of Array.from(pendientes)) {
        const cand = roster.filter((f) => libres.has(f.atletaId) && ok(j, f));
        if (cand.length === 1) {
          out.set(cand[0].atletaId, j);
          libres.delete(cand[0].atletaId);
          pendientes.delete(j);
        }
      }
    }
  };
  casar(eqL, local);
  casar(eqV, visitante);
  return out;
}

/** El partido de API-Football que corresponde a uno de ESPN: misma hora (±3 h) y los equipos que más se parecen. */
export function buscarFixture(candidatos: FixtureApif[], kickoff: Date, localEspn: string, visitanteEspn: string): FixtureApif | null {
  const parecido = (a: string, b: string) => {
    const ta = tokens(a).filter((t) => t.length > 2 && !['club', 'real', 'cf', 'fc', 'de', 'ud', 'cd', 'sc', 'ac', 'rc'].includes(t));
    const tb = tokens(b);
    return ta.some((t) => tb.includes(t)) ? 1 : 0;
  };
  let mejor: FixtureApif | null = null;
  let puntos = 0;
  for (const f of candidatos) {
    const dt = Math.abs(new Date(f.fecha).getTime() - kickoff.getTime());
    if (!(dt <= 3 * 3600 * 1000)) continue;
    const p = parecido(f.local, localEspn) + parecido(f.visitante, visitanteEspn) + (dt <= 20 * 60 * 1000 ? 0.5 : 0);
    if (p > puntos) {
      puntos = p;
      mejor = f;
    }
  }
  return puntos >= 1 ? mejor : null;
}
