import type { crearClienteAdmin } from './supabaseAdmin';
import { calcularPreciosPorCuota } from '@/lib/precioPorCuota';
import { normalizarNombre } from '@/lib/nombreMatch';
import { detectarBreaks, puntuarPartidoTenis, type EstadoPartido } from '@/lib/tenisPuntuacion';
import type { LineaDesglose } from '@/lib/futbolPuntuacion';

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

function partido(c: any): PartidoEspn | null {
  const slug = String(c?.type?.slug ?? '');
  if (!slug.endsWith('singles')) return null;
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
  };
}

export async function leerEventos(liga: LigaTenis): Promise<EventoEspn[]> {
  const json: any = await pedirJson(`${BASE}/${liga}/scoreboard`);
  const out: EventoEspn[] = [];
  for (const e of (json?.events ?? []) as any[]) {
    const comps: any[] = [...(e.competitions ?? []), ...((e.groupings ?? []) as any[]).flatMap((g) => g.competitions ?? [])];
    const partidos = comps.map(partido).filter((p): p is PartidoEspn => !!p);
    out.push({ id: String(e.id), nombre: String(e.name ?? e.shortName ?? 'Torneo'), liga, inicio: e.date ?? null, fin: e.endDate ?? null, partidos });
  }
  return out;
}

// Ranking: primero el de ESPN (si lo da); si no, el pegado en Admin → Rankings.
async function rankingTenis(admin: Admin, liga: LigaTenis): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  try {
    const json = await pedirJson(`${BASE}/${liga}/rankings`);
    const recorrer = (x: any) => {
      if (!x || typeof x !== 'object') return;
      if (Array.isArray(x)) return x.forEach(recorrer);
      const nombre = x.athlete?.displayName;
      const rank = Number(x.current ?? x.rank);
      if (nombre && rank > 0) m.set(normalizarNombre(nombre), rank);
      Object.values(x).forEach((v) => typeof v === 'object' && recorrer(v));
    };
    recorrer(json);
  } catch {
    // sin ranking de ESPN
  }
  if (m.size < 20) {
    const { data } = await admin.from('rankings_mundiales').select('nombre,puesto').eq('deporte', 'tenis');
    for (const r of (data as { nombre: string; puesto: number }[] | null) ?? []) if (!m.has(normalizarNombre(r.nombre))) m.set(normalizarNombre(r.nombre), r.puesto);
  }
  return m;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Precio: el algoritmo de golf/tenis (v3, por cuota) con una "cuota" sacada
// del ranking mundial de cada uno (sin ranking = como el 400º).
function preciosPorRanking(nombres: string[], ranking: Map<string, number>): Map<string, number> {
  const pesos = nombres.map((n) => 1 / Math.pow(ranking.get(normalizarNombre(n)) ?? 400, 1.25));
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

export type TorneoSemana = { liga: LigaTenis; id: string; nombre: string; inicio: string | null; fin: string | null; jugadores: number; vivos: number; pre: number; en_juego: number; terminados: number; competicion: string | null };

export async function listarTorneosSemana(admin: Admin): Promise<TorneoSemana[]> {
  const { data } = await admin.from('tenis_torneos').select('competicion,espn_event_id');
  const creados = new Map(((data as { competicion: string; espn_event_id: string }[] | null) ?? []).map((t) => [t.espn_event_id, t.competicion]));
  const out: TorneoSemana[] = [];
  for (const liga of ['atp', 'wta'] as LigaTenis[]) {
    let evs: EventoEspn[] = [];
    try {
      evs = await leerEventos(liga);
    } catch {
      continue;
    }
    for (const e of evs) {
      if (e.partidos.length === 0) continue;
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

async function anadirJugadores(admin: Admin, competicion: string, liga: LigaTenis, nuevos: JugadorEspn[]) {
  if (nuevos.length === 0) return 0;
  const { data: ya } = await admin.from('jugadores').select('nombre,metadata').eq('deporte', 'tenis').eq('competicion', competicion);
  const existentes = ((ya as { nombre: string; metadata: { espn_id?: string } | null }[] | null) ?? []);
  const espnYa = new Set(existentes.map((j) => j.metadata?.espn_id).filter(Boolean) as string[]);
  const aMeter = nuevos.filter((j) => !espnYa.has(j.espn));
  if (aMeter.length === 0) return 0;
  const ranking = await rankingTenis(admin, liga);
  // El precio de los nuevos se calcula con todo el cuadro (los de antes no cambian).
  const todos = [...existentes.map((j) => j.nombre), ...aMeter.map((j) => j.nombre)];
  const precios = preciosPorRanking(todos, ranking);
  const filas = aMeter.map((j) => ({
    nombre: j.nombre,
    deporte: 'tenis',
    competicion,
    precio: precios.get(j.nombre) ?? 4000,
    es_espanol: j.pais === 'Spain',
    metadata: { espn_id: j.espn, ranking: ranking.get(normalizarNombre(j.nombre)) ?? null, pais: j.pais },
  }));
  const { error } = await admin.from('jugadores').insert(filas);
  if (error) throw new Error(`No se han podido guardar los jugadores: ${error.message}`);
  return filas.length;
}

export async function crearTorneoTenis(admin: Admin, liga: LigaTenis, eventId: string): Promise<{ competicion: string; jugadores: number; cierre: string }> {
  const ev = (await leerEventos(liga)).find((e) => e.id === eventId);
  if (!ev) throw new Error('ESPN ya no devuelve ese torneo.');
  const { data: ya } = await admin.from('tenis_torneos').select('competicion').eq('espn_event_id', eventId).maybeSingle();
  if (ya) throw new Error('Este torneo ya está creado.');
  const ahora = Date.now();
  const proximos = ev.partidos.filter((p) => p.estado === 'pre' && p.inicio && new Date(p.inicio).getTime() > ahora + 5 * 60000);
  if (proximos.length === 0) throw new Error('No quedan partidos por empezar en este torneo.');
  const cierre = new Date(Math.min(...proximos.map((p) => new Date(p.inicio as string).getTime())) - 5 * 60000).toISOString();
  const competicion = nombreCompeticionTenis(ev);
  const vivos = jugadoresVivos(ev);
  if (vivos.length < 6) throw new Error('Quedan muy pocos jugadores en el torneo.');

  const { error: e1 } = await admin.from('tenis_torneos').insert({ competicion, liga, espn_event_id: ev.id, nombre_espn: ev.nombre, desde: cierre });
  if (e1) throw new Error(`No se ha podido crear el torneo: ${e1.message}`);
  try {
    const n = await anadirJugadores(admin, competicion, liga, vivos);
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
type Torneo = { competicion: string; liga: LigaTenis; espn_event_id: string; desde: string | null; finalizado_en: string | null };

/** Sincroniza los torneos de tenis activos (o solo uno). Rápido si no hay ninguno. */
export async function sincronizarTenis(admin: Admin, soloCompeticion?: string): Promise<{ torneos: number; partidos: number; jugadores: number; finalizados: string[] }> {
  let q = admin.from('tenis_torneos').select('competicion,liga,espn_event_id,desde,finalizado_en').eq('activo', true).is('finalizado_en', null);
  if (soloCompeticion) q = q.eq('competicion', soloCompeticion);
  const { data: tds } = await q;
  const torneos = (tds as Torneo[] | null) ?? [];
  const res = { torneos: torneos.length, partidos: 0, jugadores: 0, finalizados: [] as string[] };
  if (torneos.length === 0) return res;

  const porLiga = new Map<LigaTenis, EventoEspn[]>();
  for (const liga of Array.from(new Set(torneos.map((t) => t.liga)))) {
    try {
      porLiga.set(liga, await leerEventos(liga));
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
        res.jugadores += await anadirJugadores(admin, t.competicion, t.liga, jugadoresVivos(ev));
      } catch {
        // no bloquea la sincronización
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
