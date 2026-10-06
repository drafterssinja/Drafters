// ============================================================================
// SINCRONIZACIÓN DE FÚTBOL CON ESPN — puntos Drafters en vivo (06/10)
// ============================================================================
// Pedido de Iñi (06/10): las mesas de fútbol puntúan con las tablas propias
// de Drafters ("Cómo puntúan los jugadores"), calculadas con las estadísticas
// por jugador que da ESPN, en tiempo real, para LaLiga y Champions.
// Sustituye a lib/server/sincronizarFutbolLaLiga.ts (LaLiga Fantasy).
//
// Por cada competición de fútbol con mesas abiertas ("La Liga - Jornada N",
// "Champions League - Jornada N"):
//   1. Busca los partidos de la jornada en el marcador de ESPN (día a día) y
//      los casa con nuestros equipos (clave de equipo común entre fuentes).
//   2. Guarda el marcador de cada partido (estado, minuto, escudos).
//   3. Para cada partido en juego (o recién terminado) pide el resumen del
//      partido (UNA llamada): alineaciones con estadísticas por jugador,
//      goles con asistente, cambios, tarjetas y penaltis.
//   4. Empareja los jugadores de ESPN con los de nuestra ficha (nombre +
//      equipo + alias), calcula los puntos con lib/futbolPuntuacion.ts y los
//      guarda con su desglose.
//   5. Un partido pasa a "actualizado" (nombre en verde, 0 definitivo) en
//      cuanto ESPN lo da por terminado; se sigue recalculando unas horas por
//      si ESPN corrige alguna estadística y luego se congela.
//
// Todo cuesta 0 € (API pública de ESPN) y se llama desde el cron cada minuto.

import { crearClienteAdmin } from './supabaseAdmin';
import { normalizarNombre } from '../nombreMatch';
import { emparejarEquipo } from '../aliasEquipos';
import { claveEquipoFutbol, emparejarJugadoresConTabla, resultadoDeEquipo, type FilaFantasy, type ResultadoEquipo } from '../futbolLaLiga';
import { estadisticasVacias, puntuarJugador, type EstadisticasJugador, type LineaDesglose } from '../futbolPuntuacion';

type Admin = ReturnType<typeof crearClienteAdmin>;

const BASE_ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const HORAS_ANTES_DE_EMPEZAR = 12;
const HORAS_RECALCULO_TRAS_FINAL = 4;
const DIAS_VENTANA_PARTIDOS = 6;

type EstadoPartido = 'pendiente' | 'en_juego' | 'finalizado' | 'aplazado';

export type GolDetalle = {
  minuto: string; // "53'" / "90'+6'"
  equipo: 'local' | 'visitante';
  jugador: string;
  asistente: string | null;
  tipo: 'normal' | 'penalti' | 'propia';
};

type LadoPartido = { id: string; nombre: string; clave: string; goles: number; logo: string | null };
type PartidoEspn = {
  espnId: string;
  kickoff: Date;
  estado: EstadoPartido;
  reloj: string | null;
  periodo: number | null;
  local: LadoPartido;
  visitante: LadoPartido;
};

/** Liga de ESPN a la que corresponde el nombre de una competición nuestra. */
export function ligaEspnDeCompeticion(competicion: string): { slug: string; nombre: string } | null {
  const c = competicion.trim();
  if (/^la liga\b/i.test(c)) return { slug: 'esp.1', nombre: 'La Liga' };
  if (/^champions\b/i.test(c)) return { slug: 'uefa.champions', nombre: 'Champions League' };
  if (/^premier\b/i.test(c)) return { slug: 'eng.1', nombre: 'Premier League' };
  return null;
}

export type ResultadoCompeticionFutbol = {
  competicion: string;
  ok: boolean;
  estado: 'sincronizada' | 'pendiente_de_empezar' | 'completa' | 'no_soportada' | 'error';
  jugadoresEnFicha: number;
  jugadoresEmparejados: number;
  nombresFichaSinEmparejar: { id: string; nombre: string; equipo: string | null }[];
  /** Jugadores de ESPN que han jugado y no se han podido casar con nuestra ficha. */
  jugadoresEspnSinEmparejar: { nombre: string; equipo: string }[];
  /** Equipos nuestros que no se han podido casar con un equipo de ESPN. */
  equiposSinEmparejar: string[];
  partidosEncontrados: number;
  partidosFinalizados: number;
  equiposSinPartido: string[];
  partidos: {
    local: string;
    visitante: string;
    kickoff: string | null;
    estado: EstadoPartido;
    marcador: string | null;
    actualizado: boolean;
  }[];
  aviso?: string;
  error?: string;
};

export type OpcionesSincronizacion = {
  /** Solo informa del emparejamiento (equipos y jugadores); no escribe nada. */
  soloComprobar?: boolean;
  /** Sincroniza aunque la jornada esté lejos o ya completada. */
  forzar?: boolean;
  /** Limita a una competición concreta. */
  competicion?: string;
};

async function fetchConTiempo(url: string, ms: number): Promise<Response> {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), ms);
  try {
    // Sin cabecera User-Agent propia: ESPN devolvía 403 a las llamadas del
    // servidor con "DraftersBot" (06/10). Las de golf, que no mandan ninguna,
    // funcionan, así que se hace igual.
    return await fetch(url, { headers: { Accept: 'application/json' }, signal: control.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

const BASE_ESPN_ALTERNATIVA = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer';

/** GET a ESPN con reintento por el otro dominio de la API (como en golf) si
 * el primero responde con error (p.ej. 403). */
async function jsonEspn(url: string, ms = 15000): Promise<any> {
  const res = await fetchConTiempo(url, ms);
  if (res.ok) return res.json();
  const primero = res.status;
  if (url.startsWith(BASE_ESPN)) {
    const alt = await fetchConTiempo(url.replace(BASE_ESPN, BASE_ESPN_ALTERNATIVA), ms).catch(() => null);
    if (alt && alt.ok) return alt.json();
    throw new Error(`ESPN respondió ${primero}${alt ? ` y ${alt.status} (dominio alternativo)` : ''} (${url.replace(BASE_ESPN, '')})`);
  }
  throw new Error(`ESPN respondió ${primero} (${url})`);
}

function yyyymmdd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function estadoEspn(ev: any): EstadoPartido {
  const tipo = ev?.status?.type ?? {};
  const nombre = String(tipo.name ?? '').toUpperCase();
  if (/POSTPONED|CANCEL|ABANDON|SUSPEND|FORFEIT|DELAY/.test(nombre) && tipo.state !== 'in') return 'aplazado';
  if (tipo.state === 'in') return 'en_juego';
  if (tipo.state === 'post') return 'finalizado';
  return 'pendiente';
}

// ----------------------------------------------------------------------------
// Equipos: casar los de ESPN con los nuestros
// ----------------------------------------------------------------------------
type MapaEquipos = Map<string, string>; // clave de equipo → nombre nuestro (equipo_real)

function mapaEquiposNuestros(nombres: (string | null)[]): MapaEquipos {
  const m: MapaEquipos = new Map();
  for (const n of nombres) {
    if (!n) continue;
    const k = claveEquipoFutbol(n);
    if (k && !m.has(k)) m.set(k, n);
  }
  return m;
}

/** Clave de NUESTRO equipo que corresponde a un nombre de ESPN ('' si no hay). */
function claveNuestraDe(nombreEspn: string | undefined | null, nuestros: MapaEquipos): string {
  if (!nombreEspn) return '';
  const k = claveEquipoFutbol(nombreEspn);
  if (k && nuestros.has(k)) return k;
  const candidato = emparejarEquipo(nombreEspn, Array.from(nuestros.values()));
  return candidato ? claveEquipoFutbol(candidato) : '';
}

// ----------------------------------------------------------------------------
// Marcador
// ----------------------------------------------------------------------------
async function partidosEspnDelDia(slug: string, dia: Date, nuestros: MapaEquipos): Promise<PartidoEspn[]> {
  const json = await jsonEspn(`${BASE_ESPN}/${slug}/scoreboard?dates=${yyyymmdd(dia)}`);
  const salida: PartidoEspn[] = [];
  for (const ev of json.events ?? []) {
    const comp = ev.competitions?.[0];
    const local = comp?.competitors?.find((c: any) => c.homeAway === 'home');
    const visit = comp?.competitors?.find((c: any) => c.homeAway === 'away');
    if (!local || !visit || !ev.date) continue;
    const tipoEstado = ev.status?.type ?? {};
    const enDescanso = /HALFTIME/i.test(String(tipoEstado.name ?? ''));
    salida.push({
      espnId: String(ev.id),
      kickoff: new Date(ev.date),
      estado: estadoEspn(ev),
      reloj: tipoEstado.state === 'in' ? (enDescanso ? 'HT' : (ev.status?.displayClock ?? null)) : null,
      periodo: typeof ev.status?.period === 'number' ? ev.status.period : null,
      local: { id: String(local.team?.id ?? ''), nombre: local.team?.displayName ?? '', clave: claveNuestraDe(local.team?.displayName, nuestros), goles: Number(local.score ?? 0) || 0, logo: local.team?.logo ?? null },
      visitante: { id: String(visit.team?.id ?? ''), nombre: visit.team?.displayName ?? '', clave: claveNuestraDe(visit.team?.displayName, nuestros), goles: Number(visit.score ?? 0) || 0, logo: visit.team?.logo ?? null },
    });
  }
  return salida;
}

async function partidosDeLaJornada(slug: string, desde: Date, nuestros: MapaEquipos, diasConocidos: Date[] | null): Promise<PartidoEspn[]> {
  const todos: PartidoEspn[] = [];
  const inicioDia = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate()));
  const dias: Date[] = diasConocidos && diasConocidos.length > 0 ? diasConocidos : Array.from({ length: DIAS_VENTANA_PARTIDOS }, (_, i) => new Date(inicioDia.getTime() + i * 86400000));
  let primero = true;
  for (const dia of dias) {
    try {
      todos.push(...(await partidosEspnDelDia(slug, dia, nuestros)));
    } catch (err) {
      if (primero && !diasConocidos) throw err; // sin el primer día no hay jornada que construir
    }
    primero = false;
  }
  todos.sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
  // Cada equipo juega una vez por jornada: se queda con el primer partido de
  // cada equipo (y solo si los dos equipos están en nuestra ficha).
  const yaTienePartido = new Set<string>();
  const elegidos: PartidoEspn[] = [];
  const margen = desde.getTime() - 3 * 3600 * 1000;
  for (const p of todos) {
    if (p.kickoff.getTime() < margen) continue;
    if (!p.local.clave || !p.visitante.clave) continue;
    if (yaTienePartido.has(p.local.clave) || yaTienePartido.has(p.visitante.clave)) continue;
    yaTienePartido.add(p.local.clave);
    yaTienePartido.add(p.visitante.clave);
    elegidos.push(p);
  }
  return elegidos;
}

// ----------------------------------------------------------------------------
// Resumen del partido: goles, alineaciones con estadísticas, cambios...
// ----------------------------------------------------------------------------
type FilaRoster = {
  atletaId: string;
  nombre: string; // displayName
  nombreCompleto: string; // fullName
  titular: boolean;
  entro: boolean;
  salio: boolean;
  stats: Record<string, number>;
};

type ResumenPartido = {
  goles: GolDetalle[];
  roster: { local: FilaRoster[]; visitante: FilaRoster[] };
  entra: Map<string, number>; // atletaId → minuto en que entró
  sale: Map<string, number>; // atletaId → minuto en que salió (cambio o expulsión)
  penaltisFallados: Map<string, number>; // atletaId del lanzador → n
  /** Cada penalti fallado (parado o no): lanzador y minuto. El punto de
   * "penalti parado" va al portero rival que estaba en el campo. */
  fallosPenalti: { lanzadorId: string; minuto: number }[];
};

function minutoDe(texto: unknown): number {
  const m = /(\d+)/.exec(String(texto ?? ''));
  return m ? Number(m[1]) : 0;
}

async function resumenDelPartido(slug: string, p: PartidoEspn): Promise<ResumenPartido> {
  const json = await jsonEspn(`${BASE_ESPN}/${slug}/summary?event=${p.espnId}`);

  const goles: GolDetalle[] = [];
  const entra = new Map<string, number>();
  const sale = new Map<string, number>();
  const penaltisFallados = new Map<string, number>();
  const fallosPenalti: { lanzadorId: string; minuto: number }[] = [];

  for (const k of json.keyEvents ?? []) {
    const tipoTexto = String(k.type?.text ?? '');
    const minuto = minutoDe(k.clock?.displayValue);
    const equipoId = String(k.team?.id ?? '');
    if (k.shootout) continue;

    if (k.scoringPlay) {
      const propia = /own goal/i.test(tipoTexto);
      const penalti = /penalty/i.test(tipoTexto);
      const jugador = k.participants?.[0]?.athlete?.displayName;
      if (!jugador) continue;
      goles.push({
        minuto: String(k.clock?.displayValue ?? ''),
        equipo: equipoId === p.visitante.id ? 'visitante' : 'local',
        jugador,
        asistente: propia || penalti ? null : (k.participants?.[1]?.athlete?.displayName ?? null),
        tipo: propia ? 'propia' : penalti ? 'penalti' : 'normal',
      });
      continue;
    }
    if (/^substitution/i.test(tipoTexto)) {
      const dentro = k.participants?.[0]?.athlete?.id;
      const fuera = k.participants?.[1]?.athlete?.id;
      if (dentro) entra.set(String(dentro), minuto);
      if (fuera) sale.set(String(fuera), minuto);
      continue;
    }
    if (/red card/i.test(tipoTexto)) {
      const id = k.participants?.[0]?.athlete?.id;
      if (id) sale.set(String(id), minuto);
      continue;
    }
    // Penalti fallado: "Penalty - Saved" (parado), "Penalty - Missed",
    // "Penalty - Hit Woodwork"... (cualquiera que no sea gol). El lanzador es
    // participants[0]. Decisión de Iñi (06/10): todo penalti fallado cuenta
    // como "penalti parado" para el portero rival que estaba en el campo.
    if (/penalty/i.test(tipoTexto) && !/scored/i.test(tipoTexto)) {
      const lanzador = k.participants?.[0]?.athlete?.id;
      if (lanzador) {
        penaltisFallados.set(String(lanzador), (penaltisFallados.get(String(lanzador)) ?? 0) + 1);
        fallosPenalti.push({ lanzadorId: String(lanzador), minuto });
      }
    }
  }

  const leerRoster = (r: any): FilaRoster[] =>
    (r?.roster ?? []).map((x: any) => {
      const stats: Record<string, number> = {};
      for (const s of x.stats ?? []) {
        const n = Number(s.value);
        if (s.name && Number.isFinite(n)) stats[s.name] = n;
      }
      return {
        atletaId: String(x.athlete?.id ?? ''),
        nombre: String(x.athlete?.displayName ?? ''),
        nombreCompleto: String(x.athlete?.fullName ?? x.athlete?.displayName ?? ''),
        titular: !!x.starter,
        entro: !!x.subbedIn,
        salio: !!x.subbedOut,
        stats,
      };
    });
  const rosters: any[] = json.rosters ?? [];
  const delLado = (lado: LadoPartido) => rosters.find((r) => String(r.team?.id ?? '') === lado.id);
  return {
    goles,
    roster: { local: leerRoster(delLado(p.local)), visitante: leerRoster(delLado(p.visitante)) },
    entra,
    sale,
    penaltisFallados,
    fallosPenalti,
  };
}

/** Estadísticas de un jugador de ESPN → las que usa la puntuación Drafters. */
function estadisticasDe(f: FilaRoster, r: ResumenPartido, finalizado: boolean, penaltisParados: number): EstadisticasJugador {
  const jugo = (f.stats.appearances ?? 0) > 0 || f.titular || f.entro;
  const st = estadisticasVacias();
  if (!jugo) return st;
  const entrada = f.titular ? 0 : (r.entra.get(f.atletaId) ?? 0);
  let salida = r.sale.get(f.atletaId);
  if (salida === undefined && f.salio) salida = 60; // cambio sin evento: se asume al menos 60'
  st.jugo = true;
  st.minutos = Math.max(0, (salida ?? 90) - entrada);
  st.partidoCompleto = finalizado && f.titular && salida === undefined;
  st.goles = f.stats.totalGoals ?? 0;
  st.asistencias = f.stats.goalAssists ?? 0;
  st.golesPropiaPuerta = f.stats.ownGoals ?? 0;
  st.tirosAPuerta = f.stats.shotsOnTarget ?? 0;
  st.tirosTotales = f.stats.totalShots ?? 0;
  st.faltasCometidas = f.stats.foulsCommitted ?? 0;
  st.amarillas = f.stats.yellowCards ?? 0;
  st.rojas = f.stats.redCards ?? 0;
  st.paradas = f.stats.saves ?? 0;
  st.golesEncajados = f.stats.goalsConceded ?? 0;
  st.penaltisFallados = r.penaltisFallados.get(f.atletaId) ?? 0;
  st.penaltisParados = penaltisParados;
  return st;
}

// ----------------------------------------------------------------------------
// Emparejar jugadores de ESPN con los de nuestra ficha
// ----------------------------------------------------------------------------
type JugadorNuestro = { id: string; nombre: string; equipo_real: string | null; posicion: string | null };

function filaDeEspn(nombre: string, nombreCompleto: string, equipoNuestro: string): FilaFantasy {
  return { slug: nombreCompleto, nombre, equipo: equipoNuestro, posicion: '', partidos: 0, puntos: 0 };
}

// ----------------------------------------------------------------------------
// Guardado
// ----------------------------------------------------------------------------
type FilaPuntosBD = { jugador_id: string; puntos_total: number; partido_estado: string; actualizado: boolean; desglose: LineaDesglose[] | null };
type FilaPartidoBD = { clave_local: string; clave_visitante: string; kickoff: string | null; estado: string; finalizado_visto_en: string | null; actualizado: boolean; actualizado_en: string | null; goles_detalle: GolDetalle[] | null };

function vacio(competicion: string, estado: ResultadoCompeticionFutbol['estado'], extra: Partial<ResultadoCompeticionFutbol> = {}): ResultadoCompeticionFutbol {
  return {
    competicion,
    ok: estado !== 'error',
    estado,
    jugadoresEnFicha: 0,
    jugadoresEmparejados: 0,
    nombresFichaSinEmparejar: [],
    jugadoresEspnSinEmparejar: [],
    equiposSinEmparejar: [],
    partidosEncontrados: 0,
    partidosFinalizados: 0,
    equiposSinPartido: [],
    partidos: [],
    ...extra,
  };
}

async function cargarAlias(admin: Admin): Promise<Map<string, string>> {
  const { data } = await admin.from('alias_nombres_jugador').select('nombre_normalizado_origen,nombre_normalizado_destino').eq('deporte', 'futbol');
  return new Map(((data as { nombre_normalizado_origen: string; nombre_normalizado_destino: string }[]) ?? []).map((a) => [a.nombre_normalizado_origen, a.nombre_normalizado_destino]));
}

async function guardarEscudos(admin: Admin, liga: string, equipos: { nombre: string; logo: string | null }[]): Promise<void> {
  const filas = equipos
    .filter((e) => e.logo && e.nombre)
    .map((e) => ({ clave: claveEquipoFutbol(e.nombre), nombre: e.nombre, logo: e.logo as string, liga, updated_at: new Date().toISOString() }))
    .filter((f) => f.clave);
  if (filas.length === 0) return;
  const unicas = Array.from(new Map(filas.map((f) => [f.clave, f])).values());
  await admin.from('futbol_escudos').upsert(unicas, { onConflict: 'clave' });
}

/** Descarga los escudos de todos los equipos de LaLiga, Champions y Premier
 * (lista de equipos de ESPN) y los guarda — para verlos en la elección de
 * jugadores antes de que haya marcadores. */
export async function sincronizarEscudos(admin: Admin): Promise<{ liga: string; equipos: number; error?: string }[]> {
  const salida: { liga: string; equipos: number; error?: string }[] = [];
  for (const slug of ['esp.1', 'uefa.champions', 'eng.1']) {
    try {
      const json = await jsonEspn(`${BASE_ESPN}/${slug}/teams?limit=100`);
      const equipos: { nombre: string; logo: string | null }[] = (json.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t: any) => ({
        nombre: String(t.team?.displayName ?? ''),
        logo: t.team?.logos?.[0]?.href ?? null,
      }));
      await guardarEscudos(admin, slug, equipos);
      salida.push({ liga: slug, equipos: equipos.length });
    } catch (err) {
      salida.push({ liga: slug, equipos: 0, error: (err as Error).message });
    }
  }
  return salida;
}

// ----------------------------------------------------------------------------
// Sincronización de una competición
// ----------------------------------------------------------------------------
async function sincronizarCompeticion(admin: Admin, competicion: string, slug: string, fechaLimite: Date | null, alias: Map<string, string>, opciones: OpcionesSincronizacion): Promise<ResultadoCompeticionFutbol> {
  const ahora = new Date();

  const { data: fichas, error: errFichas } = await admin.from('jugadores').select('id,nombre,equipo_real,posicion').eq('deporte', 'futbol').eq('competicion', competicion);
  if (errFichas) throw new Error(errFichas.message);
  const jugadores = (fichas as JugadorNuestro[]) ?? [];
  if (jugadores.length === 0) return vacio(competicion, 'error', { ok: false, error: 'No hay jugadores cargados para esta competición.' });

  const nuestros = mapaEquiposNuestros(jugadores.map((j) => j.equipo_real));
  const jugadoresPorEquipo = new Map<string, JugadorNuestro[]>();
  for (const j of jugadores) {
    const k = claveEquipoFutbol(j.equipo_real);
    if (!k) continue;
    const l = jugadoresPorEquipo.get(k) ?? [];
    l.push(j);
    jugadoresPorEquipo.set(k, l);
  }

  if (opciones.soloComprobar) return comprobarEmparejamiento(competicion, slug, jugadores, nuestros, jugadoresPorEquipo, alias);

  const [{ data: partidosBD }, { data: puntosBD }] = await Promise.all([
    admin.from('futbol_partidos_jornada').select('clave_local,clave_visitante,kickoff,estado,finalizado_visto_en,actualizado,actualizado_en,goles_detalle').eq('competicion', competicion),
    admin.from('futbol_puntos_jugador').select('jugador_id,puntos_total,partido_estado,actualizado,desglose').eq('competicion', competicion),
  ]);
  const partidosGuardados = (partidosBD as FilaPartidoBD[]) ?? [];
  const puntosGuardados = new Map(((puntosBD as FilaPuntosBD[]) ?? []).map((f) => [f.jugador_id, f]));
  const congelado = (p: FilaPartidoBD) => p.estado === 'finalizado' && p.actualizado && !!p.finalizado_visto_en && ahora.getTime() - new Date(p.finalizado_visto_en).getTime() > HORAS_RECALCULO_TRAS_FINAL * 3600 * 1000;

  if (!opciones.forzar) {
    if (fechaLimite && ahora.getTime() < fechaLimite.getTime() - HORAS_ANTES_DE_EMPEZAR * 3600 * 1000) {
      return vacio(competicion, 'pendiente_de_empezar', { jugadoresEnFicha: jugadores.length, aviso: 'La jornada empieza en más de 12 horas; todavía no se sincroniza.' });
    }
    if (partidosGuardados.length > 0 && partidosGuardados.length * 2 >= nuestros.size - 1 && partidosGuardados.every(congelado)) {
      return vacio(competicion, 'completa', { jugadoresEnFicha: jugadores.length, partidosEncontrados: partidosGuardados.length, partidosFinalizados: partidosGuardados.length });
    }
  }

  // Partidos de la jornada. Con la jornada ya montada solo se repasan los
  // días de sus partidos (el barrido completo de 6 días cada 10 minutos, por
  // si hay aplazados o cambios de fecha).
  const completa = partidosGuardados.length > 0 && partidosGuardados.length * 2 >= nuestros.size - 1;
  const barridoCompleto = opciones.forzar || !completa || ahora.getUTCMinutes() % 10 === 0;
  const diasConocidos = barridoCompleto
    ? null
    : Array.from(new Set(partidosGuardados.filter((p) => p.kickoff).map((p) => yyyymmdd(new Date(p.kickoff as string))))).map((s) => new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))));
  const partidos = await partidosDeLaJornada(slug, fechaLimite ?? ahora, nuestros, diasConocidos);
  const guardadoPorPartido = new Map(partidosGuardados.map((p) => [`${p.clave_local}|${p.clave_visitante}`, p]));
  await guardarEscudos(admin, slug, partidos.flatMap((p) => [{ nombre: p.local.nombre, logo: p.local.logo }, { nombre: p.visitante.nombre, logo: p.visitante.logo }]));

  const partidoPorEquipo = new Map<string, { p: PartidoEspn; esLocal: boolean }>();
  for (const p of partidos) {
    partidoPorEquipo.set(p.local.clave, { p, esLocal: true });
    partidoPorEquipo.set(p.visitante.clave, { p, esLocal: false });
  }

  const filasPuntos: Record<string, unknown>[] = [];
  const filasPartido: Record<string, unknown>[] = [];
  const sinEmparejarEspn: { nombre: string; equipo: string }[] = [];
  const fichasSinPareja = new Map<string, { id: string; nombre: string; equipo: string | null }>();
  let emparejadosTotal = 0;

  for (const p of partidos) {
    const k = `${p.local.clave}|${p.visitante.clave}`;
    const prev = guardadoPorPartido.get(k);
    const finalizadoVistoEn = p.estado === 'finalizado' ? (prev?.finalizado_visto_en ?? ahora.toISOString()) : null;
    const yaCongelado = !!prev && congelado(prev) && p.estado === 'finalizado' && !opciones.forzar;

    let detalle: GolDetalle[] = prev?.goles_detalle ?? [];
    let resumen: ResumenPartido | null = null;
    if (!yaCongelado && (p.estado === 'en_juego' || p.estado === 'finalizado')) {
      try {
        resumen = await resumenDelPartido(slug, p);
        if (resumen.goles.length > 0 || p.local.goles + p.visitante.goles === 0) detalle = resumen.goles;
      } catch {
        /* se reintenta en la siguiente pasada */
      }
    }
    const finalizado = p.estado === 'finalizado';

    filasPartido.push({
      competicion,
      clave_local: p.local.clave,
      clave_visitante: p.visitante.clave,
      espn_id: p.espnId,
      kickoff: p.kickoff.toISOString(),
      equipo_local: p.local.nombre,
      equipo_visitante: p.visitante.nombre,
      logo_local: p.local.logo,
      logo_visitante: p.visitante.logo,
      goles_local: p.estado === 'pendiente' ? null : p.local.goles,
      goles_visitante: p.estado === 'pendiente' ? null : p.visitante.goles,
      estado: p.estado,
      reloj: p.reloj,
      periodo: p.periodo,
      goles_detalle: detalle,
      finalizado_visto_en: finalizadoVistoEn,
      actualizado: finalizado,
      actualizado_en: finalizado ? (prev?.actualizado ? (prev.actualizado_en ?? ahora.toISOString()) : ahora.toISOString()) : null,
      updated_at: ahora.toISOString(),
    });

    if (yaCongelado) continue;

    // Puntos de los jugadores de los dos equipos.
    for (const lado of ['local', 'visitante'] as const) {
      const mio = lado === 'local' ? p.local : p.visitante;
      const rival = lado === 'local' ? p.visitante : p.local;
      const nuestrosDelEquipo = jugadoresPorEquipo.get(mio.clave) ?? [];
      const nombreEquipoNuestro = nuestros.get(mio.clave) ?? mio.nombre;
      const filasRoster = resumen ? resumen.roster[lado] : [];

      // Emparejar (solo los que figuran en la alineación del partido).
      const filas = filasRoster.map((f) => filaDeEspn(f.nombre, f.nombreCompleto, nombreEquipoNuestro));
      const emp = emparejarJugadoresConTabla(nuestrosDelEquipo, filas, alias);
      const filaPorNuestro = new Map<string, FilaRoster>();
      emp.emparejados.forEach((fila, idNuestro) => {
        const idx = filas.indexOf(fila);
        if (idx >= 0) filaPorNuestro.set(idNuestro, filasRoster[idx]);
      });
      emparejadosTotal += filaPorNuestro.size;
      if (resumen) {
        let hayProblema = false;
        for (const f of emp.sinEmparejarTabla) {
          const fr = filasRoster[filas.indexOf(f)];
          if (fr && ((fr.stats.appearances ?? 0) > 0 || fr.titular)) {
            sinEmparejarEspn.push({ nombre: fr.nombreCompleto, equipo: nombreEquipoNuestro });
            hayProblema = true;
          }
        }
        // Para poder enlazarlos a mano, se ofrecen los jugadores nuestros de
        // ese equipo que no han encontrado pareja.
        if (hayProblema) for (const j of emp.sinEmparejarFicha) fichasSinPareja.set(j.id, { id: j.id, nombre: j.nombre, equipo: j.equipo_real });
      }

      const resultado: ResultadoEquipo | null = finalizado ? resultadoDeEquipo(mio.goles, rival.goles) : null;

      // Penaltis fallados por el rival → "penalti parado" para mi portero
      // que estaba en el campo en ese minuto (decisión de Iñi, 06/10).
      const paradosPor = new Map<string, number>(); // atletaId → n
      if (resumen) {
        const idsRival = new Set(resumen.roster[lado === 'local' ? 'visitante' : 'local'].map((f) => f.atletaId));
        const mios = nuestrosDelEquipo.filter((j) => j.posicion === 'portero').map((j) => filaPorNuestro.get(j.id)).filter((f): f is FilaRoster => !!f && ((f.stats.appearances ?? 0) > 0 || f.titular || f.entro));
        for (const fallo of resumen.fallosPenalti.filter((e) => idsRival.has(e.lanzadorId))) {
          const enCampo = mios.find((f) => {
            const entrada = f.titular ? 0 : (resumen.entra.get(f.atletaId) ?? 999);
            const salida = resumen.sale.get(f.atletaId) ?? (f.salio ? 60 : 999);
            return entrada <= fallo.minuto && fallo.minuto <= salida;
          });
          if (enCampo) paradosPor.set(enCampo.atletaId, (paradosPor.get(enCampo.atletaId) ?? 0) + 1);
        }
      }
      for (const j of nuestrosDelEquipo) {
        const fr = filaPorNuestro.get(j.id);
        const st = fr && resumen ? estadisticasDe(fr, resumen, finalizado, paradosPor.get(fr.atletaId) ?? 0) : estadisticasVacias();
        const { total, desglose } = puntuarJugador(j.posicion, st, { finalizado, golesContraEquipo: rival.goles, equipoGana: resultado === 'G' });
        const previo = puntosGuardados.get(j.id);
        const mismo = previo && Number(previo.puntos_total) === total && previo.partido_estado === p.estado && previo.actualizado === finalizado && JSON.stringify(previo.desglose ?? []) === JSON.stringify(desglose);
        if (mismo) continue;
        filasPuntos.push({
          jugador_id: j.id,
          competicion,
          puntos_total: total,
          jugo: st.jugo,
          minutos: st.jugo ? st.minutos : 0,
          espn_atleta_id: fr?.atletaId ?? null,
          resultado_equipo: resultado,
          partido_estado: p.estado,
          actualizado: finalizado,
          desglose,
          actualizado_en: ahora.toISOString(),
        });
      }
    }
  }

  // Jugadores de equipos sin partido encontrado.
  const equiposSinPartido = Array.from(nuestros.keys()).filter((c) => !partidoPorEquipo.has(c));
  for (const c of equiposSinPartido) {
    for (const j of jugadoresPorEquipo.get(c) ?? []) {
      const previo = puntosGuardados.get(j.id);
      if (previo && previo.partido_estado === 'sin_partido') continue;
      filasPuntos.push({ jugador_id: j.id, competicion, puntos_total: 0, jugo: false, minutos: 0, espn_atleta_id: null, resultado_equipo: null, partido_estado: 'sin_partido', actualizado: false, desglose: [], actualizado_en: ahora.toISOString() });
    }
  }

  for (let i = 0; i < filasPuntos.length; i += 300) {
    const { error } = await admin.from('futbol_puntos_jugador').upsert(filasPuntos.slice(i, i + 300), { onConflict: 'jugador_id' });
    if (error) throw new Error(`Guardando puntos: ${error.message}`);
  }
  if (filasPartido.length > 0) {
    const { error } = await admin.from('futbol_partidos_jornada').upsert(filasPartido, { onConflict: 'competicion,clave_local,clave_visitante' });
    if (error) throw new Error(`Guardando partidos: ${error.message}`);
  }

  return vacio(competicion, 'sincronizada', {
    jugadoresEnFicha: jugadores.length,
    jugadoresEmparejados: emparejadosTotal,
    jugadoresEspnSinEmparejar: sinEmparejarEspn,
    nombresFichaSinEmparejar: Array.from(fichasSinPareja.values()),
    partidosEncontrados: partidos.length,
    partidosFinalizados: partidos.filter((p) => p.estado === 'finalizado').length,
    equiposSinPartido,
    partidos: partidos.map((p) => ({
      local: p.local.nombre,
      visitante: p.visitante.nombre,
      kickoff: p.kickoff.toISOString(),
      estado: p.estado,
      marcador: p.estado === 'pendiente' ? null : `${p.local.goles}-${p.visitante.goles}`,
      actualizado: p.estado === 'finalizado',
    })),
    aviso: equiposSinPartido.length > 0 ? 'Hay equipos sin partido en el marcador (jornada con aplazados o jornada aún no publicada).' : undefined,
  });
}

/** Comprobación previa (no escribe nada): ¿se casan nuestros equipos con los
 * de ESPN y nuestros jugadores con las plantillas de ESPN? */
async function comprobarEmparejamiento(
  competicion: string,
  slug: string,
  jugadores: JugadorNuestro[],
  nuestros: MapaEquipos,
  jugadoresPorEquipo: Map<string, JugadorNuestro[]>,
  alias: Map<string, string>
): Promise<ResultadoCompeticionFutbol> {
  const teams = await jsonEspn(`${BASE_ESPN}/${slug}/teams?limit=100`);
  const equiposEspn: { id: string; nombre: string }[] = (teams.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t: any) => ({ id: String(t.team?.id), nombre: String(t.team?.displayName ?? '') }));

  const equiposSinEmparejar: string[] = [];
  const porClave = new Map<string, { id: string; nombre: string }>();
  for (const e of equiposEspn) {
    const k = claveNuestraDe(e.nombre, nuestros);
    if (k && !porClave.has(k)) porClave.set(k, e);
  }
  for (const [k, nombre] of Array.from(nuestros.entries())) if (!porClave.has(k)) equiposSinEmparejar.push(nombre);

  const sinEmparejarFicha: { id: string; nombre: string; equipo: string | null }[] = [];
  let emparejados = 0;
  const entradas = Array.from(porClave.entries());
  for (let i = 0; i < entradas.length; i += 8) {
    await Promise.all(
      entradas.slice(i, i + 8).map(async ([clave, e]) => {
        try {
          const json = await jsonEspn(`${BASE_ESPN}/${slug}/teams/${e.id}/roster`);
          const plantilla: any[] = json.athletes ?? [];
          const filas = plantilla.map((a) => filaDeEspn(String(a.displayName ?? a.fullName ?? ''), String(a.fullName ?? a.displayName ?? ''), nuestros.get(clave) ?? e.nombre));
          const nuestrosDelEquipo = jugadoresPorEquipo.get(clave) ?? [];
          const emp = emparejarJugadoresConTabla(nuestrosDelEquipo, filas, alias);
          emparejados += emp.emparejados.size;
          for (const j of emp.sinEmparejarFicha) sinEmparejarFicha.push({ id: j.id, nombre: j.nombre, equipo: j.equipo_real });
        } catch {
          for (const j of jugadoresPorEquipo.get(clave) ?? []) sinEmparejarFicha.push({ id: j.id, nombre: j.nombre, equipo: j.equipo_real });
        }
      })
    );
  }
  // Jugadores de equipos que ni siquiera se han podido casar.
  for (const nombre of equiposSinEmparejar) {
    for (const j of jugadoresPorEquipo.get(claveEquipoFutbol(nombre)) ?? []) sinEmparejarFicha.push({ id: j.id, nombre: j.nombre, equipo: j.equipo_real });
  }

  return vacio(competicion, 'sincronizada', {
    jugadoresEnFicha: jugadores.length,
    jugadoresEmparejados: emparejados,
    nombresFichaSinEmparejar: sinEmparejarFicha,
    equiposSinEmparejar,
    aviso: 'Comprobación contra las plantillas de ESPN (los jugadores que no estén en una plantilla de ESPN aparecen sin emparejar).',
  });
}

export async function sincronizarFutbol(admin: Admin, opciones: OpcionesSincronizacion = {}): Promise<{ resultados: ResultadoCompeticionFutbol[]; mensaje?: string; escudos?: { liga: string; equipos: number; error?: string }[] }> {
  const { data: salas, error } = await admin.from('salas').select('competicion,fecha_limite_inscripcion,estado').eq('deporte', 'futbol').neq('estado', 'finalizada');
  if (error) throw new Error(error.message);

  const porCompeticion = new Map<string, Date | null>();
  for (const s of (salas as { competicion: string; fecha_limite_inscripcion: string | null }[]) ?? []) {
    if (opciones.competicion && s.competicion !== opciones.competicion) continue;
    const f = s.fecha_limite_inscripcion ? new Date(s.fecha_limite_inscripcion) : null;
    const previa = porCompeticion.get(s.competicion);
    if (previa === undefined) porCompeticion.set(s.competicion, f);
    else if (f && (!previa || f < previa)) porCompeticion.set(s.competicion, f);
  }
  if (porCompeticion.size === 0) return { resultados: [], mensaje: 'No hay mesas de fútbol activas.' };

  const resultados: ResultadoCompeticionFutbol[] = [];
  const alias = await cargarAlias(admin);
  for (const [competicion, fechaLimite] of Array.from(porCompeticion.entries())) {
    const liga = ligaEspnDeCompeticion(competicion);
    if (!liga) {
      resultados.push(vacio(competicion, 'no_soportada', { aviso: 'Competición no soportada (solo La Liga, Champions League y Premier League).' }));
      continue;
    }
    try {
      resultados.push(await sincronizarCompeticion(admin, competicion, liga.slug, fechaLimite, alias, opciones));
    } catch (err) {
      resultados.push(vacio(competicion, 'error', { ok: false, error: (err as Error).message }));
    }
  }

  // Escudos: si todavía no hay ninguno guardado (o se fuerza), se descargan.
  let escudos: { liga: string; equipos: number; error?: string }[] | undefined;
  if (!opciones.soloComprobar) {
    const { count } = await admin.from('futbol_escudos').select('clave', { count: 'exact', head: true });
    if (opciones.forzar || (count ?? 0) < 20) escudos = await sincronizarEscudos(admin);
  }
  return { resultados, escudos };
}

// Reexportado para la pantalla de admin (guardar alias con el mismo formato).
export { normalizarNombre };
