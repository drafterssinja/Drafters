import type { crearClienteAdmin } from './supabaseAdmin';
import { calcularPreciosPorCuota } from '@/lib/precioPorCuota';
import { normalizarNombre } from '@/lib/nombreMatch';
import { detectarBreaks, puntuarPartidoTenis, type EstadoPartido } from '@/lib/tenisPuntuacion';
import type { LineaDesglose } from '@/lib/futbolPuntuacion';
import { buscarCuota, cuotasParaTorneo } from './oddsApi';
import { cuotasGanadorSimuladas, type PartidoSim } from '@/lib/tenisSimulacion';

// ============================================================================
// TENIS EN DIRECTO CON ESPN (27/10, Iñi) — gratis
// ============================================================================
// ESPN (site.api.espn.com/.../tennis/{atp|wta}/scoreboard) da, por partido:
// juegos de cada set (linescores), quién saca (possession), estado y ganador.
// Con eso: torneos de la semana, alta del torneo en Drafters (jugadores con
// precio, salas) y sincronización cada minuto (desde el cron de
// notificaciones): partidos, breaks (con quién sacaba) y puntos de cada
// jugador (tenis_puntos_jugador). Aces y dobles faltas: no los da ESPN.

type Admin = ReturnType<typeof crearClienteAdmin>;
export type LigaTenis = 'atp' | 'wta';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
// 28/10 (Iñi): de momento solo ATP (la WTA, más adelante: añadir 'wta' aquí).
export const LIGAS_ACTIVAS: LigaTenis[] = ['atp'];

export type JugadorEspn = { espn: string; nombre: string; pais: string | null };
export type PartidoEspn = {
  id: string;
  ronda: string | null;
  inicio: string | null;
  estado: EstadoPartido;
  detalle: string | null;
  retirada: boolean;
  j1: JugadorEspn | null;
  j2: JugadorEspn | null;
  juegos1: number[];
  juegos2: number[];
  sirve: 1 | 2 | null;
  ganador: 1 | 2 | null;
  // 28/10: cuotas del partido (decimales) si ESPN las da.
  cuota1: number | null;
  cuota2: number | null;
};
export type EventoEspn = { id: string; nombre: string; liga: LigaTenis; inicio: string | null; fin: string | null; partidos: PartidoEspn[] };

async function pedirJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`ESPN respondió ${r.status} (${url})`);
  return r.json();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function jugador(c: any): JugadorEspn | null {
  const a = c?.athlete;
  if (!a || !c?.id) return null;
  return { espn: String(c.id), nombre: String(a.displayName ?? a.fullName ?? ''), pais: a.flag?.alt ?? null };
}

function cuotaDecimal(lado: any): number | null {
  if (!lado || typeof lado !== 'object') return null;
  const desdeAmericana = (ml: unknown): number | null => {
    if (typeof ml === 'string' && /^even$/i.test(ml.trim())) return 2;
    const n = typeof ml === 'number' ? ml : Number(String(ml ?? '').replace(/[^0-9.+-]/g, ''));
    if (!Number.isFinite(n) || n === 0 || (n > -100 && n < 100)) return null;
    return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
  };
  const a = desdeAmericana(lado.moneyLine);
  if (a) return a;
  for (const k of ['current', 'close', 'open']) {
    const ml = lado[k]?.moneyLine;
    if (!ml) continue;
    const d = Number(ml.decimal);
    if (Number.isFinite(d) && d > 1) return d;
    const b = desdeAmericana(ml.american ?? ml.value);
    if (b) return b;
  }
  return null;
}
function cuotasPartido(c: any): { c1: number | null; c2: number | null } {
  for (const o of (Array.isArray(c?.odds) ? c.odds : []) as any[]) {
    const c1 = cuotaDecimal(o?.homeTeamOdds ?? o?.homeAthleteOdds);
    const c2 = cuotaDecimal(o?.awayTeamOdds ?? o?.awayAthleteOdds);
    if (c1 && c2) return { c1, c2 };
  }
  return { c1: null, c2: null };
}

function partido(c: any): PartidoEspn | null {
  const slug = String(c?.type?.slug ?? '');
  if (!slug.endsWith('singles')) return null;
  // 28/10: la previa (Qualifying) no cuenta: ni jugadores, ni puntos, ni cierre.
  if (/qualif/i.test(String(c?.round?.displayName ?? ''))) return null;
  const comps: any[] = Array.isArray(c?.competitors) ? c.competitors : [];
  if (comps.length < 2) return null;
  const home = comps.find((x) => x.homeAway === 'home') ?? comps[0];
  const away = comps.find((x) => x !== home) ?? comps[1];
  const st = c?.status?.type ?? {};
  const estado: EstadoPartido = st.state === 'in' ? 'in' : st.state === 'post' ? 'post' : 'pre';
  const texto = `${st.name ?? ''} ${st.description ?? ''} ${st.detail ?? ''} ${(c?.notes ?? []).map((n: any) => n?.text ?? '').join(' ')}`;
  const juegos = (x: any): number[] => (Array.isArray(x?.linescores) ? x.linescores.map((l: any) => Number(l?.value) || 0) : []);
  return {
    id: String(c.id),
    ronda: c?.round?.displayName ?? null,
    inicio: c?.startDate ?? c?.date ?? null,
    estado,
    detalle: st.detail ?? st.description ?? null,
    retirada: /retir|walkover|\bret\b|w\/o/i.test(texto),
    j1: jugador(home),
    j2: jugador(away),
    juegos1: juegos(home),
    juegos2: juegos(away),
    sirve: home?.possession === true ? 1 : away?.possession === true ? 2 : null,
    ganador: home?.winner === true ? 1 : away?.winner === true ? 2 : null,
    cuota1: cuotasPartido(c).c1,
    cuota2: cuotasPartido(c).c2,
  };
}

export async function leerEventos(liga: LigaTenis, fechas?: string): Promise<EventoEspn[]> {
  const json: any = await pedirJson(`${BASE}/${liga}/scoreboard${fechas ? `?dates=${fechas}` : ''}`);
  const out: EventoEspn[] = [];
  for (const e of (json?.events ?? []) as any[]) {
    const comps: any[] = [...(e.competitions ?? []), ...((e.groupings ?? []) as any[]).flatMap((g) => g.competitions ?? [])];
    const partidos = comps.map(partido).filter((p): p is PartidoEspn => !!p);
    out.push({ id: String(e.id), nombre: String(e.name ?? e.shortName ?? 'Torneo'), liga, inicio: e.date ?? null, fin: e.endDate ?? null, partidos });
  }
  return out;
}

const yyyymmdd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

/**
 * 28/10 (Iñi): los torneos de esta semana y de los próximos días (en cuanto
 * sale el cuadro, ESPN ya da los partidos de primera ronda con los inscritos).
 * Se juntan el marcador de hoy y el de los próximos 10 días.
 */
export async function leerEventosProximos(liga: LigaTenis): Promise<EventoEspn[]> {
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - 86400000);
  const hasta = new Date(hoy.getTime() + 10 * 86400000);
  const [a, b] = await Promise.all([
    leerEventos(liga).catch(() => [] as EventoEspn[]),
    leerEventos(liga, `${yyyymmdd(desde)}-${yyyymmdd(hasta)}`).catch(() => [] as EventoEspn[]),
  ]);
  const porId = new Map<string, EventoEspn>();
  for (const e of [...a, ...b]) {
    const ya = porId.get(e.id);
    if (!ya) porId.set(e.id, e);
    else {
      // Mismo torneo en las dos lecturas: se juntan sus partidos (sin repetir).
      const vistos = new Set(ya.partidos.map((p) => p.id));
      ya.partidos.push(...e.partidos.filter((p) => !vistos.has(p.id)));
    }
  }
  return Array.from(porId.values());
}

// Ranking: primero el de ESPN (si lo da); si no, el pegado en Admin → Rankings.
/** Ranking de ESPN (gratis, sin cargar nada): nombre → puesto. Exportado para el diagnóstico del admin. */
export async function rankingEspn(liga: LigaTenis): Promise<Map<string, { nombre: string; puesto: number }>> {
  const m = new Map<string, { nombre: string; puesto: number }>();
  const recorrer = (x: any) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(recorrer);
    const nombre = x.athlete?.displayName ?? x.athlete?.fullName;
    const rank = Number(x.current ?? x.rank);
    if (nombre && rank > 0 && !m.has(normalizarNombre(nombre))) m.set(normalizarNombre(nombre), { nombre, puesto: rank });
    Object.values(x).forEach((v) => typeof v === 'object' && recorrer(v));
  };
  for (const url of [`${BASE}/${liga}/rankings`, `https://site.web.api.espn.com/apis/site/v2/sports/tennis/${liga}/rankings`]) {
    try {
      recorrer(await pedirJson(url));
      if (m.size >= 20) break;
    } catch {
      // siguiente
    }
  }
  return m;
}

async function rankingTenis(admin: Admin, liga: LigaTenis): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  (await rankingEspn(liga)).forEach((v, k) => m.set(k, v.puesto));
  if (m.size < 20) {
    const { data } = await admin.from('rankings_mundiales').select('nombre,puesto').eq('deporte', 'tenis');
    for (const r of (data as { nombre: string; puesto: number }[] | null) ?? []) if (!m.has(normalizarNombre(r.nombre))) m.set(normalizarNombre(r.nombre), r.puesto);
  }
  return m;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Precio: el algoritmo de golf/tenis (v3, por cuota) con una "cuota" sacada
// del ranking mundial de cada uno (sin ranking = como el 400º).
// 28/10: si ESPN da la cuota de su próximo partido, el peso se corrige con lo
// que dicen las casas de apuestas frente a lo que diría el ranking.
function preciosPorRanking(nombres: string[], ranking: Map<string, number>, ajuste: Map<string, number> = new Map()): Map<string, number> {
  const pesos = nombres.map((n) => (1 / Math.pow(ranking.get(normalizarNombre(n)) ?? 400, 1.25)) * (ajuste.get(n) ?? 1));
  const total = pesos.reduce((s, x) => s + x, 0);
  const precios = calcularPreciosPorCuota(nombres.map((n, i) => ({ nombre: n, cuota: Math.round((total / pesos[i]) * 100) / 100 })));
  return new Map(nombres.map((n, i) => [n, precios[i].precio]));
}

export function nombreCompeticionTenis(ev: { nombre: string; liga: LigaTenis; inicio: string | null }): string {
  const anio = ev.inicio ? new Date(ev.inicio).getUTCFullYear() : new Date().getUTCFullYear();
  return `${ev.liga.toUpperCase()} · ${ev.nombre} ${anio}`;
}

// Jugadores que siguen vivos (no han perdido ningún partido acabado).
function jugadoresVivos(ev: EventoEspn): JugadorEspn[] {
  const fuera = new Set<string>();
  const todos = new Map<string, JugadorEspn>();
  for (const p of ev.partidos) {
    for (const j of [p.j1, p.j2]) if (j && j.nombre) todos.set(j.espn, j);
    if (p.estado === 'post' && p.ganador) {
      const perdedor = p.ganador === 1 ? p.j2 : p.j1;
      if (perdedor) fuera.add(perdedor.espn);
    }
  }
  return Array.from(todos.values()).filter((j) => !fuera.has(j.espn));
}

// 28/10 (Iñi): solo se abren (mesas, amistosos y liga) los torneos que empiezan
// en los próximos 6 días: si el cuadro empieza un lunes, desde el martes anterior.
export const DIAS_ANTES_APERTURA = 6;

/** Cuándo empieza el cuadro principal (el primer partido que no es de la previa). */
export function inicioCuadro(ev: EventoEspn): Date | null {
  const fechas = ev.partidos.map((p) => (p.inicio ? new Date(p.inicio).getTime() : NaN)).filter((x) => Number.isFinite(x));
  if (fechas.length > 0) return new Date(Math.min(...fechas));
  return inicioEstimado(ev);
}

/** Sin partidos todavía: la fecha del evento (suele ser el sábado de la previa) → el lunes a las 10:00 UTC. */
function inicioEstimado(ev: EventoEspn): Date | null {
  if (!ev.inicio) return null;
  const d = new Date(ev.inicio);
  const sumar = d.getUTCDay() === 6 ? 2 : d.getUTCDay() === 0 ? 1 : 0;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + sumar, 10, 0));
}

/** ¿Ha salido ya el cuadro (hay jugadores en los partidos)? */
export function hayCuadro(ev: EventoEspn): boolean {
  return ev.partidos.some((p) => !!(p.j1 || p.j2));
}

/** ¿Está ya en su ventana (6 días antes de empezar) y todavía no ha terminado? */
export function enVentana(ev: EventoEspn, ahora = Date.now()): boolean {
  const ini = inicioCuadro(ev);
  if (!ini) return false;
  const abre = Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth(), ini.getUTCDate()) - DIAS_ANTES_APERTURA * 86400000;
  const terminado = ev.fin ? new Date(ev.fin).getTime() < ahora : false;
  return ahora >= abre && !terminado;
}

export type TorneoSemana = { liga: LigaTenis; id: string; nombre: string; inicio: string | null; fin: string | null; jugadores: number; vivos: number; pre: number; en_juego: number; terminados: number; competicion: string | null };

export async function listarTorneosSemana(admin: Admin): Promise<TorneoSemana[]> {
  const { data } = await admin.from('tenis_torneos').select('competicion,espn_event_id');
  const creados = new Map(((data as { competicion: string; espn_event_id: string }[] | null) ?? []).map((t) => [t.espn_event_id, t.competicion]));
  const out: TorneoSemana[] = [];
  for (const liga of LIGAS_ACTIVAS) {
    let evs: EventoEspn[] = [];
    try {
      evs = await leerEventosProximos(liga);
    } catch {
      continue;
    }
    for (const e of evs) {
      if (!enVentana(e)) continue; // 28/10: también sin cuadro todavía
      const nombres = new Set<string>();
      e.partidos.forEach((p) => [p.j1, p.j2].forEach((j) => j && nombres.add(j.espn)));
      out.push({
        liga,
        id: e.id,
        nombre: e.nombre,
        inicio: e.inicio,
        fin: e.fin,
        jugadores: nombres.size,
        vivos: jugadoresVivos(e).length,
        pre: e.partidos.filter((p) => p.estado === 'pre').length,
        en_juego: e.partidos.filter((p) => p.estado === 'in').length,
        terminados: e.partidos.filter((p) => p.estado === 'post').length,
        competicion: creados.get(e.id) ?? null,
      });
    }
  }
  return out;
}

/** Factor por cuotas: (prob. de ganar su partido según las casas) / (según el ranking), entre 0,5 y 2. */
function ajustePorCuotas(ev: EventoEspn | undefined, ranking: Map<string, number>): Map<string, number> {
  const m = new Map<string, number>();
  if (!ev) return m;
  const peso = (n: string) => 1 / Math.pow(ranking.get(normalizarNombre(n)) ?? 400, 1.25);
  for (const p of ev.partidos) {
    if (p.estado !== 'pre' || !p.j1 || !p.j2 || !p.cuota1 || !p.cuota2) continue;
    const i1 = 1 / p.cuota1;
    const i2 = 1 / p.cuota2;
    const q1 = i1 / (i1 + i2);
    const w1 = peso(p.j1.nombre);
    const w2 = peso(p.j2.nombre);
    const r1 = w1 / (w1 + w2);
    const lim = (x: number) => Math.min(2, Math.max(0.5, x));
    m.set(p.j1.nombre, lim(q1 / r1));
    m.set(p.j2.nombre, lim((1 - q1) / (1 - r1)));
  }
  return m;
}

async function anadirJugadores(admin: Admin, competicion: string, liga: LigaTenis, nuevos: JugadorEspn[], ev?: EventoEspn) {
  if (nuevos.length === 0) return 0;
  const { data: ya } = await admin.from('jugadores').select('nombre,metadata').eq('deporte', 'tenis').eq('competicion', competicion);
  const existentes = ((ya as { nombre: string; metadata: { espn_id?: string } | null }[] | null) ?? []);
  const espnYa = new Set(existentes.map((j) => j.metadata?.espn_id).filter(Boolean) as string[]);
  const aMeter = nuevos.filter((j) => !espnYa.has(j.espn));
  if (aMeter.length === 0) return 0;
  const ranking = await rankingTenis(admin, liga);
  // El precio de los nuevos se calcula con todo el cuadro (los de antes no cambian).
  const todos = [...existentes.map((j) => j.nombre), ...aMeter.map((j) => j.nombre)];
  // 28/10 (Iñi): en tenis la mesa es del TORNEO entero, así que el precio sale,
  // como en golf, de la cuota de cada uno a GANAR EL TORNEO:
  //  1) la de las casas de apuestas (The Odds API), si la hay;
  //  2) si no, calculada: se juega el cuadro 20.000 veces (lib/tenisSimulacion.ts)
  //     con la fuerza de cada uno por ranking y, en la primera ronda, la cuota
  //     de ese partido si existe (solo como dato para el cálculo).
  const odds = await cuotasParaTorneo(admin, competicion, liga, ev?.nombre ?? null);
  let cuotas: Map<string, number>;
  let origen: 'casas' | 'calculada';
  if (odds.ganador.size > 0) {
    origen = 'casas';
    const encontradas = todos.map((n) => buscarCuota(odds.ganador, n));
    const peor = Math.max(...encontradas.filter((c): c is number => c !== null), 2);
    cuotas = new Map(todos.map((n, i) => [n, encontradas[i] ?? Math.round(peor * 1.5 * 100) / 100]));
  } else {
    origen = 'calculada';
    const vivos = new Set(todos);
    const primeraRonda: PartidoSim[] = [];
    for (const p of ev?.partidos ?? []) {
      if (p.estado !== 'pre' || !p.j1 || !p.j2 || !vivos.has(p.j1.nombre) || !vivos.has(p.j2.nombre)) continue;
      // Probabilidad del partido si hay cuota (The Odds API o ESPN).
      const c = buscarCuota(odds.partidos, p.j1.nombre);
      let pA: number | null = c ? c.p : null;
      if (pA === null && p.cuota1 && p.cuota2) pA = 1 / p.cuota1 / (1 / p.cuota1 + 1 / p.cuota2);
      primeraRonda.push({ a: p.j1.nombre, b: p.j2.nombre, pA });
    }
    cuotas = cuotasGanadorSimuladas(todos.map((n) => ({ nombre: n, ranking: ranking.get(normalizarNombre(n)) ?? null })), primeraRonda);
  }
  const calc = calcularPreciosPorCuota(todos.map((n) => ({ nombre: n, cuota: cuotas.get(n) ?? 500 })));
  const precios = new Map(todos.map((n, i) => [n, calc[i].precio]));
  const filas = aMeter.map((j) => ({
    nombre: j.nombre,
    deporte: 'tenis',
    competicion,
    precio: precios.get(j.nombre) ?? 4000,
    es_espanol: j.pais === 'Spain',
    metadata: { espn_id: j.espn, ranking: ranking.get(normalizarNombre(j.nombre)) ?? null, pais: j.pais, cuota_ganador: cuotas.get(j.nombre) ?? null, origen_cuota: origen },
  }));
  const { error } = await admin.from('jugadores').insert(filas);
  if (error) throw new Error(`No se han podido guardar los jugadores: ${error.message}`);
  return filas.length;
}

export async function crearTorneoTenis(admin: Admin, liga: LigaTenis, eventId: string): Promise<{ competicion: string; jugadores: number; cierre: string }> {
  const ev = (await leerEventosProximos(liga)).find((e) => e.id === eventId);
  if (!ev) throw new Error('ESPN ya no devuelve ese torneo.');
  if (!enVentana(ev)) throw new Error(`Todavía no: los torneos se abren ${DIAS_ANTES_APERTURA} días antes de empezar el cuadro.`);
  const { data: ya } = await admin.from('tenis_torneos').select('competicion').eq('espn_event_id', eventId).maybeSingle();
  if (ya) throw new Error('Este torneo ya está creado.');
  const ahora = Date.now();
  const competicion = nombreCompeticionTenis(ev);
  let cierre: string;
  let vivos: JugadorEspn[] = [];
  if (hayCuadro(ev)) {
    const proximos = ev.partidos.filter((p) => p.estado === 'pre' && p.inicio && new Date(p.inicio).getTime() > ahora + 5 * 60000);
    if (proximos.length === 0) throw new Error('No quedan partidos por empezar en este torneo.');
    cierre = new Date(Math.min(...proximos.map((p) => new Date(p.inicio as string).getTime())) - 5 * 60000).toISOString();
    vivos = jugadoresVivos(ev);
    if (vivos.length < 6) throw new Error('Quedan muy pocos jugadores en el torneo.');
  } else {
    // 28/10 (Iñi): se abre 6 días antes aunque no haya cuadro. Cierre provisional
    // (el lunes del cuadro); se corrige solo en cuanto ESPN publique los partidos.
    const est = inicioEstimado(ev);
    if (!est || est.getTime() - 5 * 60000 < ahora + 3600000) throw new Error('No se sabe cuándo empieza el cuadro.');
    cierre = new Date(est.getTime() - 5 * 60000).toISOString();
  }

  const { error: e1 } = await admin.from('tenis_torneos').insert({ competicion, liga, espn_event_id: ev.id, nombre_espn: ev.nombre, desde: cierre });
  if (e1) throw new Error(`No se ha podido crear el torneo: ${e1.message}`);
  try {
    const n = await anadirJugadores(admin, competicion, liga, vivos, ev);
    // Una mesa interna (oculta) para que el torneo tenga su hora de cierre,
    // como las jornadas de fútbol y los torneos de golf. Los amistosos la usan.
    const { error: e2 } = await admin.from('salas').insert({
      nombre: 'Tenis · interna',
      deporte: 'tenis',
      competicion,
      tipo: 'doble_o_nada',
      aforo: 2,
      buy_in: 0,
      estado: 'abierta',
      fecha_limite_inscripcion: cierre,
      publicada: false,
      version: 1,
      circuito: liga,
    });
    if (e2) throw new Error(`No se ha podido crear la mesa interna: ${e2.message}`);
    await admin.rpc('v2_asegurar_salas_sistema');
    await sincronizarTenis(admin, competicion);
    return { competicion, jugadores: n, cierre };
  } catch (err) {
    await admin.from('jugadores').delete().eq('deporte', 'tenis').eq('competicion', competicion);
    await admin.from('salas').delete().eq('competicion', competicion);
    await admin.from('tenis_torneos').delete().eq('competicion', competicion);
    throw err;
  }
}

type FilaPartido = { espn_id: string; estado: string; juegos1: number[]; juegos2: number[]; sirve: number | null; breaks1: number; breaks2: number };
type Torneo = { competicion: string; liga: LigaTenis; espn_event_id: string; desde: string | null; finalizado_en: string | null; cuadro_en: string | null };

/** Sincroniza los torneos de tenis activos (o solo uno). Rápido si no hay ninguno. */
export async function sincronizarTenis(admin: Admin, soloCompeticion?: string): Promise<{ torneos: number; partidos: number; jugadores: number; finalizados: string[] }> {
  let q = admin.from('tenis_torneos').select('competicion,liga,espn_event_id,desde,finalizado_en,cuadro_en').eq('activo', true).is('finalizado_en', null);
  if (soloCompeticion) q = q.eq('competicion', soloCompeticion);
  const { data: tds } = await q;
  const torneos = (tds as Torneo[] | null) ?? [];
  const res = { torneos: torneos.length, partidos: 0, jugadores: 0, finalizados: [] as string[] };
  if (torneos.length === 0) return res;

  const porLiga = new Map<LigaTenis, EventoEspn[]>();
  for (const liga of Array.from(new Set(torneos.map((t) => t.liga)))) {
    try {
      porLiga.set(liga, await leerEventosProximos(liga));
    } catch {
      porLiga.set(liga, []);
    }
  }

  for (const t of torneos) {
    const ev = (porLiga.get(t.liga) ?? []).find((e) => e.id === t.espn_event_id);
    if (!ev) continue;

    // Jugadores que aparecen nuevos (p. ej. los que entraban con bye) mientras la inscripción sigue abierta.
    if (!t.desde || new Date(t.desde).getTime() > Date.now()) {
      try {
        const n = await anadirJugadores(admin, t.competicion, t.liga, jugadoresVivos(ev), ev);
        res.jugadores += n;
        // 28/10: el cuadro acaba de salir → aviso a los de las salas (notificacionesPush).
        if (n > 0 && !t.cuadro_en) await admin.from('tenis_torneos').update({ cuadro_en: new Date().toISOString() }).eq('competicion', t.competicion);
      } catch {
        // no bloquea la sincronización
      }
      // Hora de cierre de verdad: 5 minutos antes del primer partido del cuadro.
      if (hayCuadro(ev)) {
        const proximos = ev.partidos.filter((p) => p.estado === 'pre' && (p.j1 || p.j2) && p.inicio && new Date(p.inicio).getTime() > Date.now() + 5 * 60000);
        if (proximos.length > 0) {
          const real = new Date(Math.min(...proximos.map((p) => new Date(p.inicio as string).getTime())) - 5 * 60000).toISOString();
          if (!t.desde || Math.abs(new Date(real).getTime() - new Date(t.desde).getTime()) > 60000) {
            await admin.from('tenis_torneos').update({ desde: real }).eq('competicion', t.competicion);
            await admin.from('salas').update({ fecha_limite_inscripcion: real }).eq('competicion', t.competicion).eq('deporte', 'tenis').is('tramo', null);
            t.desde = real;
          }
        }
      }
    }

    // Partidos: guardar y contar breaks con quién sacaba en la lectura anterior.
    const { data: prevData } = await admin.from('tenis_partidos').select('espn_id,estado,juegos1,juegos2,sirve,breaks1,breaks2').eq('competicion', t.competicion);
    const prev = new Map(((prevData as FilaPartido[] | null) ?? []).map((p) => [p.espn_id, p]));
    const filas = ev.partidos.map((p) => {
      const a = prev.get(p.id);
      let b1 = a?.breaks1 ?? 0;
      let b2 = a?.breaks2 ?? 0;
      if (a && a.estado === 'in' && p.estado !== 'pre') {
        const d = detectarBreaks({ j1: a.juegos1 ?? [], j2: a.juegos2 ?? [], sirve: a.sirve }, { j1: p.juegos1, j2: p.juegos2 });
        b1 += d.b1;
        b2 += d.b2;
      }
      return {
        espn_id: p.id,
        competicion: t.competicion,
        ronda: p.ronda,
        inicio: p.inicio,
        estado: p.estado,
        detalle: p.detalle,
        retirada: p.retirada,
        j1_espn: p.j1?.espn ?? null,
        j1_nombre: p.j1?.nombre ?? null,
        j2_espn: p.j2?.espn ?? null,
        j2_nombre: p.j2?.nombre ?? null,
        juegos1: p.juegos1,
        juegos2: p.juegos2,
        sirve: p.sirve,
        ganador: p.ganador,
        breaks1: b1,
        breaks2: b2,
        actualizado_en: new Date().toISOString(),
      };
    });
    if (filas.length) {
      const { error } = await admin.from('tenis_partidos').upsert(filas, { onConflict: 'espn_id' });
      if (error) throw new Error(`tenis_partidos: ${error.message}`);
      res.partidos += filas.length;
    }

    // Puntos de cada jugador del torneo (solo partidos desde el cierre de inscripción).
    const { data: jugsData } = await admin.from('jugadores').select('id,nombre,metadata').eq('deporte', 'tenis').eq('competicion', t.competicion);
    const jugs = (jugsData as { id: string; nombre: string; metadata: { espn_id?: string } | null }[] | null) ?? [];
    const desde = t.desde ? new Date(t.desde).getTime() - 10 * 60000 : 0;
    const validos = filas.filter((f) => !f.inicio || new Date(f.inicio).getTime() >= desde);
    const puntos = jugs.map((j) => {
      const id = j.metadata?.espn_id;
      const mios = validos.filter((f) => id && (f.j1_espn === id || f.j2_espn === id)).sort((x, y) => String(x.inicio).localeCompare(String(y.inicio)));
      const desglose = new Map<string, LineaDesglose>();
      let total = 0;
      let jugados = 0;
      for (const f of mios) {
        const soy1 = f.j1_espn === id;
        const r = puntuarPartidoTenis({
          estado: f.estado,
          mios: soy1 ? f.juegos1 : f.juegos2,
          rival: soy1 ? f.juegos2 : f.juegos1,
          gane: f.ganador ? f.ganador === (soy1 ? 1 : 2) : null,
          rivalRetirado: f.retirada && f.ganador === (soy1 ? 1 : 2),
          breaks: soy1 ? f.breaks1 : f.breaks2,
        });
        if (f.estado !== 'pre') jugados++;
        total += r.total;
        for (const l of r.desglose) {
          const x = desglose.get(l.clave);
          if (x) {
            x.cantidad += l.cantidad;
            x.puntos = Math.round((x.puntos + l.puntos) * 100) / 100;
          } else desglose.set(l.clave, { ...l });
        }
      }
      const ultimo = [...mios].reverse().find((f) => f.estado !== 'pre') ?? null;
      const proximo = mios.find((f) => f.estado === 'pre') ?? null;
      const enJuego = mios.find((f) => f.estado === 'in') ?? null;
      const rivalDe = (f: (typeof filas)[number]) => (f.j1_espn === id ? f.j2_nombre : f.j1_nombre) ?? 'por decidir';
      const marcador = (f: (typeof filas)[number]) => {
        const a = f.j1_espn === id ? f.juegos1 : f.juegos2;
        const b = f.j1_espn === id ? f.juegos2 : f.juegos1;
        return a.map((x, i) => `${x}-${b[i] ?? 0}`).join(' ');
      };
      let estado_texto: string | null = null;
      if (enJuego) estado_texto = `● vs ${rivalDe(enJuego)} · ${marcador(enJuego)}${enJuego.sirve === (enJuego.j1_espn === id ? 1 : 2) ? ' · al saque' : ''}`;
      else if (ultimo && ultimo.ganador && ultimo.ganador !== (ultimo.j1_espn === id ? 1 : 2)) estado_texto = `Eliminado por ${rivalDe(ultimo)} · ${marcador(ultimo)}`;
      else if (proximo) estado_texto = `Próximo: vs ${rivalDe(proximo)}${proximo.ronda ? ` · ${proximo.ronda}` : ''}`;
      else if (ultimo) estado_texto = `${ultimo.ganador ? 'Ganó' : ''} vs ${rivalDe(ultimo)} · ${marcador(ultimo)}`.trim();
      return {
        jugador_id: j.id,
        competicion: t.competicion,
        puntos_total: Math.round(total * 100) / 100,
        desglose: Array.from(desglose.values()),
        partidos: jugados,
        en_juego: !!enJuego,
        estado_texto,
        actualizado_en: new Date().toISOString(),
      };
    });
    if (puntos.length) {
      const { error } = await admin.from('tenis_puntos_jugador').upsert(puntos, { onConflict: 'jugador_id' });
      if (error) throw new Error(`tenis_puntos_jugador: ${error.message}`);
    }

    // Terminado: la final (o el último partido) acabado y nada pendiente ni en juego.
    const hayFinal = ev.partidos.some((p) => p.estado === 'post' && /final/i.test(p.ronda ?? '') && !/semi|quarter|cuartos/i.test(p.ronda ?? ''));
    const pendientes = ev.partidos.some((p) => p.estado !== 'post');
    if (hayFinal && !pendientes) {
      await admin.from('tenis_torneos').update({ finalizado_en: new Date().toISOString() }).eq('competicion', t.competicion);
      res.finalizados.push(t.competicion);
    }
  }
  return res;
}

// ============================================================================
// 28/10 (Iñi): como en fútbol y golf, los torneos se crean SOLOS en cuanto
// ESPN publica el cuadro (los inscritos), con su precio por ranking y cuotas.
// Lo llama el cron cada 15 minutos. Solo cuadros de individuales con al menos
// 8 jugadores, con partidos por empezar y sin que se haya jugado medio cuadro.
// ============================================================================
export type ResultadoTenisAuto = { liga: LigaTenis; torneo: string; estado: 'creado' | 'ya_existe' | 'esperando' | 'error'; detalle: string };

export async function crearTorneosTenisAutomaticos(admin: Admin): Promise<ResultadoTenisAuto[]> {
  const { data } = await admin.from('tenis_torneos').select('espn_event_id');
  const ya = new Set(((data as { espn_event_id: string }[] | null) ?? []).map((t) => t.espn_event_id));
  const out: ResultadoTenisAuto[] = [];
  for (const liga of LIGAS_ACTIVAS) {
    let evs: EventoEspn[] = [];
    try {
      evs = await leerEventosProximos(liga);
    } catch (e) {
      out.push({ liga, torneo: '—', estado: 'error', detalle: (e as Error).message });
      continue;
    }
    for (const ev of evs) {
      if (ya.has(ev.id)) {
        out.push({ liga, torneo: ev.nombre, estado: 'ya_existe', detalle: 'Ya está en Drafters.' });
        continue;
      }
      if (!enVentana(ev)) {
        const ini = inicioCuadro(ev);
        if (ini && ini.getTime() > Date.now()) out.push({ liga, torneo: ev.nombre, estado: 'esperando', detalle: `Empieza el ${ini.toISOString().slice(0, 10)}: se abre ${DIAS_ANTES_APERTURA} días antes.` });
        continue;
      }
      const jugadores = new Set<string>();
      ev.partidos.forEach((p) => [p.j1, p.j2].forEach((j) => j && jugadores.add(j.espn)));
      const pre = ev.partidos.filter((p) => p.estado === 'pre' && p.inicio && new Date(p.inicio).getTime() > Date.now() + 30 * 60000).length;
      const jugados = ev.partidos.filter((p) => p.estado === 'post').length;
      if (jugadores.size > 0 && jugadores.size < 8) {
        out.push({ liga, torneo: ev.nombre, estado: 'esperando', detalle: `Solo ${jugadores.size} jugadores en el cuadro.` });
        continue;
      }
      // Sin cuadro todavía también se abre (los jugadores llegan cuando salga).
      if (jugadores.size > 0 && (pre === 0 || jugados > ev.partidos.length / 2)) {
        out.push({ liga, torneo: ev.nombre, estado: 'esperando', detalle: 'Ya va muy avanzado: no se crea.' });
        continue;
      }
      try {
        const r = await crearTorneoTenis(admin, liga, ev.id);
        ya.add(ev.id);
        out.push({ liga, torneo: ev.nombre, estado: 'creado', detalle: `${r.competicion}: ${r.jugadores} jugadores, cierra ${r.cierre}.` });
      } catch (e) {
        out.push({ liga, torneo: ev.nombre, estado: 'error', detalle: (e as Error).message });
      }
    }
  }
  return out;
}
