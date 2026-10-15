// ============================================================================
// CALENDARIO DE JORNADAS DE FÚTBOL (La Liga y Champions) — 15/10
// ============================================================================
// Pedido de Iñi: al crear una temporada de la liga de fútbol, solo se puede
// empezar el primer día de una jornada (de Liga o de Champions) y terminar el
// último día de una jornada (lunes si es de Liga, miércoles si es de
// Champions). Y en la información de la liga se dice qué jornadas cuentan.
// Aquí se baja de ESPN el calendario de toda la temporada (por meses, con el
// marcador por rango de fechas), se agrupa en jornadas y se numeran contando
// los partidos de cada equipo (como en crearFutbolAutomatico). Se guarda en
// la tabla futbol_calendario (SQL 38).

import type { crearClienteAdmin } from './supabaseAdmin';
import { BASE_ESPN, jsonEspn, yyyymmdd } from './sincronizarFutbolEspn';

type Admin = ReturnType<typeof crearClienteAdmin>;

const LIGAS: { slug: string; prefijo: string; partidosPorJornada: number }[] = [
  { slug: 'esp.1', prefijo: 'La Liga', partidosPorJornada: 10 },
  { slug: 'uefa.champions', prefijo: 'Champions League', partidosPorJornada: 18 },
];

type Evento = { id: string; kickoff: Date; local: string; visitante: string };
export type JornadaCalendario = { liga: string; numero: number; competicion: string; inicio: string; fin: string; partidos: number };

function diaUtc(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}

async function eventosRango(slug: string, desde: Date, hasta: Date): Promise<Evento[]> {
  let json: any;
  try {
    json = await jsonEspn(`${BASE_ESPN}/${slug}/scoreboard?dates=${yyyymmdd(desde)}-${yyyymmdd(hasta)}&limit=1000`, 20000);
  } catch {
    return [];
  }
  const salida: Evento[] = [];
  for (const ev of json?.events ?? []) {
    const comp = ev.competitions?.[0];
    const local = comp?.competitors?.find((c: any) => c.homeAway === 'home');
    const visit = comp?.competitors?.find((c: any) => c.homeAway === 'away');
    if (!local || !visit || !ev.date) continue;
    salida.push({ id: String(ev.id), kickoff: new Date(ev.date), local: local.team?.displayName ?? '', visitante: visit.team?.displayName ?? '' });
  }
  return salida;
}

/** Toda la temporada (agosto → junio), pedida mes a mes en paralelo. */
async function eventosTemporada(slug: string, ahora: Date): Promise<Evento[]> {
  const anio = ahora.getUTCMonth() >= 6 ? ahora.getUTCFullYear() : ahora.getUTCFullYear() - 1;
  const meses: [Date, Date][] = [];
  for (let m = 0; m < 11; m++) {
    const ini = new Date(Date.UTC(anio, 7 + m, 1));
    const fin = new Date(Date.UTC(anio, 8 + m, 0));
    meses.push([ini, fin]);
  }
  const porMes = await Promise.all(meses.map(([a, b]) => eventosRango(slug, a, b)));
  const porId = new Map<string, Evento>();
  porMes.flat().forEach((e) => porId.set(e.id, e));
  return Array.from(porId.values()).sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
}

/** Un hueco de 2 o más días sin partidos separa jornadas; el número sale de
 *  contar los partidos de cada equipo desde el inicio de la temporada. */
function jornadasDe(eventos: Evento[], prefijo: string, esperados: number): JornadaCalendario[] {
  const ventanas: Evento[][] = [];
  let ultimo = -10;
  for (const e of eventos) {
    const d = diaUtc(e.kickoff);
    if (ventanas.length === 0 || d - ultimo >= 2) ventanas.push([]);
    ventanas[ventanas.length - 1].push(e);
    ultimo = d;
  }
  const nDePartido = new Map<string, number>();
  const contador = new Map<string, number>();
  for (const e of eventos) {
    for (const eq of [e.local, e.visitante]) {
      const n = (contador.get(eq) ?? 0) + 1;
      contador.set(eq, n);
      nDePartido.set(`${e.id}|${eq}`, n);
    }
  }
  const minimo = Math.ceil(esperados * 0.6);
  const salida: JornadaCalendario[] = [];
  const vistos = new Set<number>();
  for (const v of ventanas) {
    if (v.length < minimo) continue;
    const votos = new Map<number, number>();
    v.forEach((e) => [e.local, e.visitante].forEach((eq) => {
      const n = nDePartido.get(`${e.id}|${eq}`);
      if (n !== undefined) votos.set(n, (votos.get(n) ?? 0) + 1);
    }));
    let numero = 0;
    let max = 0;
    votos.forEach((c, n) => {
      if (c > max) {
        max = c;
        numero = n;
      }
    });
    if (!numero || vistos.has(numero)) continue;
    vistos.add(numero);
    salida.push({
      liga: prefijo,
      numero,
      competicion: `${prefijo} - Jornada ${numero}`,
      inicio: v[0].kickoff.toISOString(),
      fin: v[v.length - 1].kickoff.toISOString(),
      partidos: v.length,
    });
  }
  return salida;
}

export async function actualizarCalendarioFutbol(admin: Admin): Promise<{ jornadas: number; porLiga: Record<string, number>; error?: string }> {
  const ahora = new Date();
  const porLiga: Record<string, number> = {};
  const todas: JornadaCalendario[] = [];
  const resultados = await Promise.all(LIGAS.map(async (l) => jornadasDe(await eventosTemporada(l.slug, ahora), l.prefijo, l.partidosPorJornada)));
  resultados.forEach((js, i) => {
    porLiga[LIGAS[i].prefijo] = js.length;
    todas.push(...js);
  });
  if (todas.length === 0) return { jornadas: 0, porLiga, error: 'ESPN no ha devuelto partidos. Prueba otra vez en un rato.' };
  const { error } = await admin.from('futbol_calendario').upsert(
    todas.map((j) => ({ ...j, actualizado_en: ahora.toISOString() })),
    { onConflict: 'liga,numero' }
  );
  if (error) return { jornadas: 0, porLiga, error: error.message };
  return { jornadas: todas.length, porLiga };
}
