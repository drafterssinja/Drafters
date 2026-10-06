// ============================================================================
// CREACIÓN AUTOMÁTICA DE JORNADAS DE FÚTBOL DESDE ESPN (06/10)
// ============================================================================
// Pedido de Iñi: que las jornadas de fútbol (La Liga y Champions por ahora)
// se creen solas en cuanto tengamos los horarios confirmados de todos sus
// partidos, aunque la jornada anterior todavía no haya acabado.
//
// Qué da ESPN (comprobado el 06/10 con datos reales):
//   - Calendario: marcador día a día (`scoreboard?dates=YYYYMMDD`).
//   - Horario confirmado: `competitions[0].timeValid` (false = hora provisional).
//   - Cuotas 1X2 (DraftKings, en formato americano) en el resumen de cada
//     partido (`summary?event=ID` → odds[0]), cuando faltan 1-2 semanas.
//   - NO da el número de jornada. Se deduce: una "jornada" son los partidos
//     de una misma ventana de días seguidos (hueco de 2+ días = otra ventana)
//     con el nº de partidos de una jornada completa (10 en La Liga, 18 en la
//     fase de liga de Champions). Un partido aplazado suelto (1 partido solo)
//     no cuenta como jornada. El número se ancla en la tabla
//     `futbol_jornadas_auto` (se rellena sola y al borrar las mesas antiguas)
//     y sigue contando +1 por cada ventana posterior; si una liga no tiene
//     ancla, se cuentan las ventanas completas ya jugadas desde agosto.
//
// Una jornada se crea cuando se cumple TODO esto:
//   1. Ventana completa (nº de partidos esperado, ningún equipo repetido).
//   2. Todos los partidos programados (ninguno empezado/aplazado) y con hora
//      confirmada (`timeValid`).
//   3. Cuotas 1X2 de todos los partidos (si aún no las hay, se espera; solo
//      se crea sin ellas cuando falta menos de 72 h para el primer partido,
//      con precio neutro para esos partidos).
//   4. Quedan más de 30 minutos para el primer partido.
//   5. Hay jugadores cargados (valor de mercado) para todos los equipos.
//   6. No existe ya una jornada con ese nombre.
//
// Al crearla: (a) copia la plantilla de jugadores en filas NUEVAS para esta
// jornada (así varias jornadas pueden estar abiertas a la vez sin pisarse
// puntos ni precios), con el precio calculado por valor de mercado + cuotas
// del partido (mismo cálculo que el cargador manual); (b) guarda las cuotas
// (alimentan la columna de partidos al elegir equipo); (c) crea las mesas
// reducidas de fútbol (ver VARIANTES_FUTBOL en lib/tiposDeSala.ts), con
// fecha límite = inicio del primer partido; (d) anota la jornada en
// `futbol_jornadas_auto`.

import { randomUUID } from 'crypto';
import type { crearClienteAdmin } from './supabaseAdmin';
import { BASE_ESPN, jsonEspn, yyyymmdd, mapaEquiposNuestros, claveNuestraDe } from './sincronizarFutbolEspn';
import { normalizarNombre } from '../nombreMatch';
import { generarSalasParaTorneo } from '../tiposDeSala';
import { calcularPreciosFutbolDetallado, factorPosicion, fuerzaPorEquipo } from '../precioFutbol';
import type { PosicionFutbol } from '../futbolPuntuacion';

type Admin = ReturnType<typeof crearClienteAdmin>;

/** Ligas que se crean solas. Para activar la Premier, descomentar la línea. */
const LIGAS_AUTO: { slug: string; prefijo: string; partidosPorJornada: number }[] = [
  { slug: 'esp.1', prefijo: 'La Liga', partidosPorJornada: 10 },
  { slug: 'uefa.champions', prefijo: 'Champions League', partidosPorJornada: 18 },
  // { slug: 'eng.1', prefijo: 'Premier League', partidosPorJornada: 10 },
];

const HORIZONTE_DIAS = 25;
const MARGEN_MINIMO_MIN = 30;
const HORAS_SIN_CUOTAS = 72;
const TOLERANCIA_ANCLA_H = 36;
const CUOTAS_NEUTRAS = { c1: 2.9, cx: 3.2, c2: 2.9 };

export type ResultadoCreacionFutbol = {
  liga: string;
  jornada: number | null;
  estado: 'creada' | 'ya_existe' | 'esperando' | 'sin_jornadas' | 'error';
  detalle: string;
};

type EventoLiga = {
  id: string;
  kickoff: Date;
  timeValid: boolean;
  programado: boolean; // todavía no ha empezado ni está aplazado
  local: string;
  visitante: string;
};

type Ventana = { eventos: EventoLiga[]; inicio: Date };

function diaUtc(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}

/** Descarga con paralelismo limitado. */
async function enParalelo<T, R>(items: T[], limite: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(items.length);
  let i = 0;
  async function trabajador() {
    while (true) {
      const mi = i++;
      if (mi >= items.length) return;
      salida[mi] = await fn(items[mi]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return salida;
}

async function eventosDelDia(slug: string, dia: Date): Promise<EventoLiga[]> {
  let json: any;
  try {
    json = await jsonEspn(`${BASE_ESPN}/${slug}/scoreboard?dates=${yyyymmdd(dia)}`);
  } catch {
    return [];
  }
  const salida: EventoLiga[] = [];
  for (const ev of json.events ?? []) {
    const comp = ev.competitions?.[0];
    const local = comp?.competitors?.find((c: any) => c.homeAway === 'home');
    const visit = comp?.competitors?.find((c: any) => c.homeAway === 'away');
    if (!local || !visit || !ev.date) continue;
    const tipo = ev.status?.type ?? {};
    const nombre = String(tipo.name ?? '').toUpperCase();
    const aplazado = /POSTPONED|CANCEL|ABANDON|SUSPEND|FORFEIT|DELAY/.test(nombre);
    salida.push({
      id: String(ev.id),
      kickoff: new Date(ev.date),
      timeValid: comp?.timeValid !== false,
      programado: tipo.state === 'pre' && !aplazado,
      local: local.team?.displayName ?? '',
      visitante: visit.team?.displayName ?? '',
    });
  }
  return salida;
}

/** Partidos de la liga entre dos días (ambos incluidos), sin duplicados. */
async function eventosEntre(slug: string, desde: Date, hasta: Date): Promise<EventoLiga[]> {
  const dias: Date[] = [];
  for (let t = Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate()); t <= hasta.getTime(); t += 86400000) dias.push(new Date(t));
  const porDia = await enParalelo(dias, 8, (d) => eventosDelDia(slug, d));
  const porId = new Map<string, EventoLiga>();
  porDia.flat().forEach((e) => porId.set(e.id, e));
  return Array.from(porId.values()).sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
}

/** Agrupa en ventanas: un hueco de 2 o más días sin partidos abre otra ventana. */
function agruparEnVentanas(eventos: EventoLiga[]): Ventana[] {
  const ventanas: Ventana[] = [];
  let actual: Ventana | null = null;
  let ultimoDia = 0;
  for (const e of eventos) {
    const d = diaUtc(e.kickoff);
    if (!actual || d - ultimoDia >= 2) {
      actual = { eventos: [], inicio: e.kickoff };
      ventanas.push(actual);
    }
    actual.eventos.push(e);
    ultimoDia = d;
  }
  return ventanas;
}

function inicioTemporada(hoy: Date): Date {
  const anio = hoy.getUTCMonth() >= 6 ? hoy.getUTCFullYear() : hoy.getUTCFullYear() - 1;
  return new Date(Date.UTC(anio, 7, 1));
}

/** Cuota decimal a partir de una cuota americana ("moneyline"). */
function americanaADecimal(ml: unknown): number | null {
  const n = typeof ml === 'number' ? ml : Number(ml);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

async function cuotasDelPartido(slug: string, eventoId: string): Promise<{ c1: number; cx: number; c2: number } | null> {
  try {
    const json = await jsonEspn(`${BASE_ESPN}/${slug}/summary?event=${eventoId}`);
    const o = (json.odds ?? [])[0];
    if (!o) return null;
    const c1 = americanaADecimal(o.homeTeamOdds?.moneyLine);
    const cx = americanaADecimal(o.drawOdds?.moneyLine);
    const c2 = americanaADecimal(o.awayTeamOdds?.moneyLine);
    if (c1 && cx && c2 && c1 > 1 && cx > 1 && c2 > 1) return { c1, cx, c2 };
    return null;
  } catch {
    return null;
  }
}

export type FichaJugador = {
  id: string;
  nombre: string;
  equipo_real: string | null;
  posicion: PosicionFutbol | null;
  valor_mercado: number | null;
  probabilidad_titular: number | null;
  lesionado: boolean;
  metadata: Record<string, unknown> | null;
  competicion: string;
  updated_at: string | null;
};

/** Plantilla de la liga: la ficha MÁS RECIENTE de cada jugador (nombre + equipo). */
export async function plantillaDeLaLiga(admin: Admin, prefijo: string): Promise<FichaJugador[]> {
  const filas: FichaJugador[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await admin
      .from('jugadores')
      .select('id,nombre,equipo_real,posicion,valor_mercado,probabilidad_titular,lesionado,metadata,competicion,updated_at')
      .eq('deporte', 'futbol')
      .ilike('competicion', `${prefijo}%`)
      .range(desde, desde + 999);
    if (error) throw new Error(`No se han podido leer los jugadores de ${prefijo}: ${error.message}`);
    const lote = (data as FichaJugador[]) ?? [];
    filas.push(...lote);
    if (lote.length < 1000) break;
  }
  const masReciente = new Map<string, FichaJugador>();
  for (const f of filas) {
    const clave = `${normalizarNombre(f.nombre)}|${normalizarNombre(f.equipo_real ?? '')}`;
    const previa = masReciente.get(clave);
    if (!previa || (f.updated_at ?? '') > (previa.updated_at ?? '')) masReciente.set(clave, f);
  }
  return Array.from(masReciente.values());
}

type Ancla = { numero: number; primer_partido: string; creada: boolean };

/** Número de jornada de cada ventana contando los partidos de cada equipo desde
 * el inicio de temporada: en una liga todos los equipos juegan UN partido por
 * jornada, así que el partido nº N de un equipo es de la jornada N. Se toma el
 * valor más repetido entre los equipos de la ventana (así un aplazado suelto no
 * descuadra el número). Necesita los partidos desde el inicio de temporada. */
function numerarPorPartidosDeEquipo(eventos: EventoLiga[], ventanas: Ventana[], esperados: number): (number | null)[] {
  const minimo = Math.ceil(esperados * 0.6);
  const ordenados = [...eventos].sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
  const nDePartido = new Map<string, number>(); // `${idEvento}|${equipo}` → nº de partido del equipo
  const contador = new Map<string, number>();
  for (const e of ordenados) {
    for (const eq of [e.local, e.visitante]) {
      const n = (contador.get(eq) ?? 0) + 1;
      contador.set(eq, n);
      nDePartido.set(`${e.id}|${eq}`, n);
    }
  }
  return ventanas.map((v) => {
    if (v.eventos.length < minimo) return null;
    const votos = new Map<number, number>();
    for (const e of v.eventos) {
      for (const eq of [e.local, e.visitante]) {
        const n = nDePartido.get(`${e.id}|${eq}`);
        if (n !== undefined) votos.set(n, (votos.get(n) ?? 0) + 1);
      }
    }
    let mejor: number | null = null;
    let mejorVotos = 0;
    votos.forEach((c, n) => {
      if (c > mejorVotos) {
        mejor = n;
        mejorVotos = c;
      }
    });
    return mejor;
  });
}

/** Número de jornada de cada ventana (null = no es una jornada, p.ej. un aplazado suelto). */
function numerarVentanas(ventanas: Ventana[], esperados: number, anclas: Ancla[], numeroInicialSinAncla: number): (number | null)[] {
  const minimo = Math.ceil(esperados * 0.6);
  const numeros: (number | null)[] = ventanas.map(() => null);
  const idxJornadas = ventanas.map((v, i) => (v.eventos.length >= minimo ? i : -1)).filter((i) => i >= 0);

  // 1. Ventanas que coinciden con un ancla.
  let hayAncla = false;
  for (const i of idxJornadas) {
    const a = anclas.find((x) => Math.abs(new Date(x.primer_partido).getTime() - ventanas[i].inicio.getTime()) <= TOLERANCIA_ANCLA_H * 3600000);
    if (a) {
      numeros[i] = a.numero;
      hayAncla = true;
    }
  }
  // 2. Si no hay ninguna coincidencia exacta pero sí anclas, se cuenta a
  //    partir de la última ancla anterior a cada ventana.
  if (!hayAncla && anclas.length > 0) {
    const ordenadas = [...anclas].sort((a, b) => new Date(a.primer_partido).getTime() - new Date(b.primer_partido).getTime());
    for (const i of idxJornadas) {
      const previas = ordenadas.filter((a) => new Date(a.primer_partido).getTime() < ventanas[i].inicio.getTime() - TOLERANCIA_ANCLA_H * 3600000);
      if (previas.length === 0) continue;
      const base = previas[previas.length - 1];
      const entre = idxJornadas.filter((j) => ventanas[j].inicio.getTime() > new Date(base.primer_partido).getTime() + TOLERANCIA_ANCLA_H * 3600000 && j <= i).length;
      numeros[i] = base.numero + entre;
    }
    hayAncla = numeros.some((n) => n !== null);
  }
  if (!hayAncla) {
    idxJornadas.forEach((i, k) => {
      numeros[i] = numeroInicialSinAncla + k;
    });
    return numeros;
  }
  // 3. Propagar hacia delante y hacia atrás desde las ventanas ya numeradas.
  const primera = idxJornadas.findIndex((i) => numeros[i] !== null);
  for (let k = primera + 1; k < idxJornadas.length; k++) {
    if (numeros[idxJornadas[k]] === null) numeros[idxJornadas[k]] = (numeros[idxJornadas[k - 1]] as number) + 1;
  }
  for (let k = primera - 1; k >= 0; k--) {
    numeros[idxJornadas[k]] = (numeros[idxJornadas[k + 1]] as number) - 1;
  }
  return numeros;
}

async function crearUnaLiga(admin: Admin, liga: (typeof LIGAS_AUTO)[number], ahora: Date): Promise<ResultadoCreacionFutbol[]> {
  const resultados: ResultadoCreacionFutbol[] = [];
  const nombreLiga = liga.prefijo;

  const { data: anclasData } = await admin.from('futbol_jornadas_auto').select('numero,primer_partido,creada').eq('liga', liga.prefijo);
  const anclas = (anclasData as Ancla[]) ?? [];

  const hasta = new Date(ahora.getTime() + HORIZONTE_DIAS * 86400000);
  const desde = anclas.length > 0 ? new Date(ahora.getTime() - 3 * 86400000) : inicioTemporada(ahora);
  const eventos = await eventosEntre(liga.slug, desde, hasta);
  const ventanas = agruparEnVentanas(eventos);

  // Sin ancla: el número de la primera ventana futura = ventanas completas
  // ya empezadas + 1.
  const minimo = Math.ceil(liga.partidosPorJornada * 0.6);
  const yaJugadas = ventanas.filter((v) => v.eventos.length >= minimo && v.inicio.getTime() < ahora.getTime()).length;
  void yaJugadas;
  // Sin anclas se cuenta partidos por equipo desde el inicio de temporada (ver
  // numerarPorPartidosDeEquipo); con anclas, se numera a partir de ellas.
  const numeros = anclas.length > 0 ? numerarVentanas(ventanas, liga.partidosPorJornada, anclas, 1) : numerarPorPartidosDeEquipo(eventos, ventanas, liga.partidosPorJornada);
  if (anclas.length === 0) {
    // Se guardan como ancla (sin marcar como creada) para no volver a recorrer
    // toda la temporada en cada ejecución.
    const filasAncla = ventanas
      .map((v, i) => ({ v, n: numeros[i] }))
      .filter(({ v, n }) => n !== null && v.inicio.getTime() > ahora.getTime())
      .map(({ v, n }) => ({ liga: liga.prefijo, numero: n as number, primer_partido: v.inicio.toISOString(), competicion: `${liga.prefijo} - Jornada ${n}`, creada: false }));
    if (filasAncla.length > 0) await admin.from('futbol_jornadas_auto').upsert(filasAncla, { onConflict: 'liga,numero', ignoreDuplicates: true });
  }

  const futuras = ventanas.map((v, i) => ({ v, i })).filter(({ v, i }) => numeros[i] !== null && v.inicio.getTime() > ahora.getTime());
  if (futuras.length === 0) {
    return [{ liga: nombreLiga, jornada: null, estado: 'sin_jornadas', detalle: 'No hay jornadas futuras en el calendario de ESPN dentro del horizonte.' }];
  }

  // Plantilla: se carga una sola vez, y solo si hace falta crear algo.
  let plantilla: FichaJugador[] | null = null;

  for (const { v, i } of futuras) {
    const numero = numeros[i] as number;
    const competicion = `${liga.prefijo} - Jornada ${numero}`;

    // ¿Ya creada?
    const { count: existentes } = await admin.from('salas').select('id', { count: 'exact', head: true }).eq('competicion', competicion);
    const ancla = anclas.find((a) => a.numero === numero);
    if ((existentes ?? 0) > 0 || ancla?.creada) {
      resultados.push({ liga: nombreLiga, jornada: numero, estado: 'ya_existe', detalle: 'Ya tiene mesas.' });
      continue;
    }

    // 1. Ventana completa y sin equipos repetidos.
    if (v.eventos.length !== liga.partidosPorJornada) {
      resultados.push({ liga: nombreLiga, jornada: numero, estado: 'esperando', detalle: `La ventana tiene ${v.eventos.length} partidos y una jornada completa son ${liga.partidosPorJornada} (puede faltar calendario o haber aplazados).` });
      continue;
    }
    const nombresEquipos = v.eventos.flatMap((e) => [e.local, e.visitante]);
    if (new Set(nombresEquipos).size !== nombresEquipos.length) {
      resultados.push({ liga: nombreLiga, jornada: numero, estado: 'esperando', detalle: 'Hay un equipo que juega dos veces en la misma ventana; no se puede crear sola.' });
      continue;
    }

    // 2. Todo programado y con hora confirmada.
    const sinConfirmar = v.eventos.filter((e) => !e.timeValid).length;
    if (sinConfirmar > 0 || v.eventos.some((e) => !e.programado)) {
      resultados.push({ liga: nombreLiga, jornada: numero, estado: 'esperando', detalle: sinConfirmar > 0 ? `Faltan por confirmar las horas de ${sinConfirmar} partido(s).` : 'Algún partido ya ha empezado o está aplazado.' });
      continue;
    }

    // 4. Margen para inscribirse.
    const primerPartido = v.eventos.reduce((m, e) => (e.kickoff < m ? e.kickoff : m), v.eventos[0].kickoff);
    if (primerPartido.getTime() - ahora.getTime() < MARGEN_MINIMO_MIN * 60000) {
      resultados.push({ liga: nombreLiga, jornada: numero, estado: 'esperando', detalle: 'Queda menos de media hora para el primer partido: ya no se crea.' });
      continue;
    }

    // 3. Cuotas 1X2.
    const cuotas = await enParalelo(v.eventos, 6, (e) => cuotasDelPartido(liga.slug, e.id));
    const sinCuotas = cuotas.filter((c) => c === null).length;
    const horasHastaPrimero = (primerPartido.getTime() - ahora.getTime()) / 3600000;
    if (sinCuotas > 0 && horasHastaPrimero > HORAS_SIN_CUOTAS) {
      resultados.push({ liga: nombreLiga, jornada: numero, estado: 'esperando', detalle: `Horarios confirmados; esperando las cuotas de ${sinCuotas} partido(s) (se crea sola cuando salgan, o a 72 h del primer partido).` });
      continue;
    }

    // 5. Jugadores.
    try {
      if (!plantilla) plantilla = await plantillaDeLaLiga(admin, liga.prefijo);
      if (plantilla.length === 0) {
        resultados.push({ liga: nombreLiga, jornada: numero, estado: 'esperando', detalle: `No hay jugadores de ${nombreLiga} cargados. Carga antes su valor de mercado en Admin → Mesas Drafters → "Valor de mercado de fútbol".` });
        continue;
      }
      const nuestros = mapaEquiposNuestros(plantilla.map((j) => j.equipo_real));
      const claveAEquipoReal = (nombreEspn: string): string | null => {
        const k = claveNuestraDe(nombreEspn, nuestros);
        return k ? (nuestros.get(k) ?? null) : null;
      };
      const sinEmparejar = Array.from(new Set(nombresEquipos.filter((n) => !claveAEquipoReal(n))));
      if (sinEmparejar.length > 0) {
        resultados.push({ liga: nombreLiga, jornada: numero, estado: 'esperando', detalle: `Equipos sin jugadores cargados o con otro nombre: ${sinEmparejar.join(', ')}. Cárgalos o añade un alias (lib/aliasEquipos.ts).` });
        continue;
      }

      const partidos = v.eventos.map((e, k) => {
        const c = cuotas[k] ?? { c1: CUOTAS_NEUTRAS.c1, cx: CUOTAS_NEUTRAS.cx, c2: CUOTAS_NEUTRAS.c2 };
        return { equipoLocal: claveAEquipoReal(e.local) as string, equipoVisitante: claveAEquipoReal(e.visitante) as string, cuota1: c.c1, cuotaX: c.cx, cuota2: c.c2 };
      });
      const fuerza = fuerzaPorEquipo(partidos);
      const equiposJornada = new Set(partidos.flatMap((p) => [p.equipoLocal, p.equipoVisitante]));
      const fichas = plantilla.filter((j) => j.equipo_real && equiposJornada.has(j.equipo_real) && j.posicion);
      if (fichas.length === 0) {
        resultados.push({ liga: nombreLiga, jornada: numero, estado: 'esperando', detalle: 'Ningún jugador con posición en los equipos de esta jornada.' });
        continue;
      }
      const valores = plantilla.map((j) => j.valor_mercado).filter((x): x is number => typeof x === 'number' && x > 0);
      const rango = valores.length > 0 ? { valorMin: Math.min(...valores), valorMax: Math.max(...valores) } : undefined;

      const nuevosIds = fichas.map(() => randomUUID());
      const entrada = fichas.map((j, k) => {
        const f = fuerza.get(j.equipo_real as string);
        return { id: nuevosIds[k], posicion: j.posicion as PosicionFutbol, valorMercado: j.valor_mercado, factorPartido: f !== undefined ? factorPosicion(f, j.posicion as PosicionFutbol) : 1 };
      });
      const calculo = calcularPreciosFutbolDetallado(entrada, {}, rango);
      const precioPorId = new Map(calculo.precios.map((p) => [p.id, p]));

      const filas = fichas.map((j, k) => {
        const p = precioPorId.get(nuevosIds[k]);
        return {
          id: nuevosIds[k],
          nombre: j.nombre,
          deporte: 'futbol',
          competicion,
          equipo_real: j.equipo_real,
          posicion: j.posicion,
          precio: p?.precio ?? 0,
          valor_mercado: j.valor_mercado,
          valor_a_revisar: p?.sinValor ?? false,
          probabilidad_titular: j.probabilidad_titular,
          lesionado: j.lesionado,
          baja: false,
          metadata: { ...(j.metadata ?? {}), origen_jugador_id: j.id, creada_automaticamente: true },
        };
      });

      // Jugadores que ya hubiera con esta misma etiqueta (p.ej. los de una
      // jornada creada a mano antes y cuyas mesas se borraron): se retiran al
      // final, una vez creado todo lo nuevo, para no dejar jugadores duplicados.
      const { data: antiguos } = await admin.from('jugadores').select('id').eq('competicion', competicion);
      const idsAntiguos = ((antiguos as { id: string }[] | null) ?? []).map((x) => x.id);

      // Escritura: jugadores → cuotas → mesas. Si algo falla, se deshace lo anterior.
      for (let d = 0; d < filas.length; d += 500) {
        const { error } = await admin.from('jugadores').insert(filas.slice(d, d + 500));
        if (error) {
          await admin.from('jugadores').delete().in('id', nuevosIds);
          throw new Error(`jugadores: ${error.message}`);
        }
      }
      const filasCuotas = partidos.map((p) => ({ competicion, equipo_local: p.equipoLocal, equipo_visitante: p.equipoVisitante, cuota_1: p.cuota1, cuota_x: p.cuotaX, cuota_2: p.cuota2 }));
      const { error: errCuotas } = await admin.from('cuotas_partido_futbol').upsert(filasCuotas, { onConflict: 'competicion,equipo_local,equipo_visitante' });
      if (errCuotas) {
        await admin.from('jugadores').delete().in('id', nuevosIds);
        throw new Error(`cuotas: ${errCuotas.message}`);
      }
      const salas = generarSalasParaTorneo({ competicionLabel: competicion, deporte: 'futbol', fechaLimiteIso: primerPartido.toISOString() });
      const { error: errSalas } = await admin.from('salas').insert(salas);
      if (errSalas) {
        await admin.from('jugadores').delete().in('id', nuevosIds);
        await admin.from('cuotas_partido_futbol').delete().eq('competicion', competicion);
        throw new Error(`mesas: ${errSalas.message}`);
      }
      for (let d = 0; d < idsAntiguos.length; d += 200) {
        await admin.from('jugadores').delete().in('id', idsAntiguos.slice(d, d + 200));
      }
      await admin.from('futbol_jornadas_auto').upsert({ liga: liga.prefijo, numero, primer_partido: primerPartido.toISOString(), competicion, creada: true }, { onConflict: 'liga,numero' });

      resultados.push({
        liga: nombreLiga,
        jornada: numero,
        estado: 'creada',
        detalle: `${filas.length} jugadores con precio, ${salas.length} mesas, primer partido ${primerPartido.toISOString()}${sinCuotas > 0 ? ` (${sinCuotas} partido(s) sin cuotas: precio neutro)` : ''}.`,
      });
    } catch (err) {
      resultados.push({ liga: nombreLiga, jornada: numero, estado: 'error', detalle: (err as Error).message });
    }
  }
  return resultados;
}

export async function crearJornadasFutbolAutomaticas(admin: Admin): Promise<ResultadoCreacionFutbol[]> {
  const ahora = new Date();
  const todos: ResultadoCreacionFutbol[] = [];
  for (const liga of LIGAS_AUTO) {
    try {
      todos.push(...(await crearUnaLiga(admin, liga, ahora)));
    } catch (err) {
      todos.push({ liga: liga.prefijo, jornada: null, estado: 'error', detalle: (err as Error).message });
    }
  }
  return todos;
}
