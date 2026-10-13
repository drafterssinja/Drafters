// ============================================================================
// REPARAR JORNADAS DE FÚTBOL CREADAS SIN LOS JUGADORES DE ALGÚN EQUIPO (07/10)
// ============================================================================
// Bug de Iñi: la jornada de La Liga creada sola no traía jugadores de Real
// Sociedad ni de Celta. Causa: "Celta Fortuna" y "Real Sociedad B" (filiales de
// Segunda) compartían la clave de equipo con el primer equipo, y la jornada se
// quedaba con el nombre del filial (ver lib/aliasEquipos.ts → esEquipoFilial).
//
// Esta reparación, para cada jornada ya creada:
//   1. Corrige los nombres de equipo de sus cuotas ("Celta Fortuna" → "Celta").
//   2. Añade los jugadores que faltan del primer equipo, con precio calculado
//      igual que al crearla (valor de mercado + cuotas del partido).
//   3. Si nadie se ha apuntado a sus mesas, recalcula también el precio de los
//      que ya había (el cálculo depende del conjunto completo); si ya hay
//      equipos apuntados, los precios existentes NO se tocan.
//   4. Quita de la jornada los jugadores del filial, salvo que alguien los haya
//      elegido ya en su equipo.
// Se puede ejecutar varias veces: no duplica nada.

import { randomUUID } from 'crypto';
import type { crearClienteAdmin } from './supabaseAdmin';
import { mapaEquiposNuestros, claveNuestraDe } from './sincronizarFutbolEspn';
import { plantillaDeLaLiga } from './crearFutbolAutomatico';
import { normalizarNombre } from '../nombreMatch';
import { calcularPreciosFutbolDetallado, crearAjusteValorPorPosicion, factorPosicion, fuerzaPorEquipo } from '../precioFutbol';
import { esEquipoFilial, nombrePrimerEquipo } from '../aliasEquipos';
import { claveEquipoFutbol } from '../futbolLaLiga';
import type { PosicionFutbol } from '../futbolPuntuacion';

type Admin = ReturnType<typeof crearClienteAdmin>;

export type ResultadoReparacion = { competicion: string; estado: 'reparada' | 'sin_cambios' | 'error'; detalle: string };

const PREFIJOS = ['La Liga', 'Champions League', 'Premier League'];

type FilaCuota = { equipo_local: string; equipo_visitante: string; cuota_1: number; cuota_x: number; cuota_2: number };
type FilaJugadorJornada = { id: string; nombre: string; equipo_real: string | null };

async function repararUna(admin: Admin, competicion: string, prefijo: string, forzarPrecios = false): Promise<ResultadoReparacion> {
  const { data: cuotasData, error: errCuotas } = await admin
    .from('cuotas_partido_futbol')
    .select('equipo_local,equipo_visitante,cuota_1,cuota_x,cuota_2')
    .eq('competicion', competicion);
  if (errCuotas) throw new Error(`cuotas: ${errCuotas.message}`);
  const cuotas = (cuotasData as FilaCuota[]) ?? [];
  if (cuotas.length === 0) return { competicion, estado: 'sin_cambios', detalle: 'Sin cuotas guardadas: no hay nada que reparar.' };

  let plantilla = await plantillaDeLaLiga(admin, prefijo);
  const avisos: string[] = [];

  // 0. Equipos de la jornada que no tienen NINGÚN jugador del primer equipo en la
  //    base: lo normal es que sus jugadores se cargaran con el nombre del filial
  //    ("Celta Fortuna") al pegar el valor de mercado. En La Liga el primer equipo
  //    nunca puede quedarse a cero, así que se les devuelve el nombre del primer
  //    equipo (solo cambia la etiqueta de equipo; los ids no se tocan).
  {
    const claves = (ps: typeof plantilla) => new Set(ps.filter((j) => !esEquipoFilial(j.equipo_real ?? '')).map((j) => claveEquipoFutbol(j.equipo_real)));
    const tienen = claves(plantilla);
    const nombresCuotas = Array.from(new Set(cuotas.flatMap((c) => [c.equipo_local, c.equipo_visitante])));
    const claveJornada = new Map<string, string>(); // clave del primer equipo → nombre sin filial
    for (const n of nombresCuotas) {
      const base = esEquipoFilial(n) ? nombrePrimerEquipo(n) : n;
      const k = claveEquipoFutbol(base);
      if (k && !tienen.has(k)) claveJornada.set(k, base);
    }
    let reasignados = 0;
    for (const [k, base] of Array.from(claveJornada.entries())) {
      const nombresFilial = Array.from(new Set(plantilla.filter((j) => esEquipoFilial(j.equipo_real ?? '') && claveEquipoFutbol(nombrePrimerEquipo(j.equipo_real ?? '')) === k).map((j) => j.equipo_real as string)));
      for (const nf of nombresFilial) {
        const { data: tocados, error } = await admin.from('jugadores').update({ equipo_real: base }).eq('deporte', 'futbol').ilike('competicion', `${prefijo}%`).eq('equipo_real', nf).select('id');
        if (error) throw new Error(`jugadores: ${error.message}`);
        reasignados += tocados?.length ?? 0;
        avisos.push(`"${nf}" no tenía equivalente del primer equipo: ${tocados?.length ?? 0} jugadores pasan a llamarse "${base}"`);
      }
    }
    if (reasignados > 0) plantilla = await plantillaDeLaLiga(admin, prefijo);
  }

  const nuestros = mapaEquiposNuestros(plantilla.filter((j) => !esEquipoFilial(j.equipo_real ?? '')).map((j) => j.equipo_real));
  const nombreCorrecto = (n: string): string | null => {
    const base = esEquipoFilial(n) ? nombrePrimerEquipo(n) : n;
    const k = claveNuestraDe(base, nuestros);
    return k ? (nuestros.get(k) ?? null) : null;
  };

  // 1. Cuotas con el nombre del primer equipo. Si un equipo no existe ni así en
  //    la base se deja como está y se avisa (antes se abortaba toda la jornada).
  const corregidas: FilaCuota[] = [];
  const equiposSinJugadores = new Set<string>();
  let cuotasCambiadas = 0;
  for (const c of cuotas) {
    const locOk = nombreCorrecto(c.equipo_local);
    const visOk = nombreCorrecto(c.equipo_visitante);
    if (!locOk) equiposSinJugadores.add(c.equipo_local);
    if (!visOk) equiposSinJugadores.add(c.equipo_visitante);
    const loc = locOk ?? c.equipo_local;
    const vis = visOk ?? c.equipo_visitante;
    if (loc !== c.equipo_local || vis !== c.equipo_visitante) {
      const { error } = await admin
        .from('cuotas_partido_futbol')
        .update({ equipo_local: loc, equipo_visitante: vis })
        .eq('competicion', competicion)
        .eq('equipo_local', c.equipo_local)
        .eq('equipo_visitante', c.equipo_visitante);
      if (error) throw new Error(`cuotas: ${error.message}`);
      cuotasCambiadas++;
    }
    corregidas.push({ ...c, equipo_local: loc, equipo_visitante: vis });
  }
  // Los marcadores guardados con la clave del filial ya no sirven: se recalculan solos.
  await admin.from('futbol_partidos_jornada').delete().eq('competicion', competicion).or('clave_local.like.filial*,clave_visitante.like.filial*');

  // 2. Fichas que deberían estar en la jornada y precio de cada una.
  const partidos = corregidas.map((c) => ({ equipoLocal: c.equipo_local, equipoVisitante: c.equipo_visitante, cuota1: c.cuota_1, cuotaX: c.cuota_x, cuota2: c.cuota_2 }));
  const fuerza = fuerzaPorEquipo(partidos);
  const equiposJornada = new Set(partidos.flatMap((p) => [p.equipoLocal, p.equipoVisitante]));
  const fichas = plantilla.filter((j) => j.equipo_real && !esEquipoFilial(j.equipo_real) && equiposJornada.has(j.equipo_real) && j.posicion);
  const valores = plantilla.map((j) => j.valor_mercado).filter((x): x is number => typeof x === 'number' && x > 0);
  const rango = valores.length > 0 ? { valorMin: Math.min(...valores), valorMax: Math.max(...valores) } : undefined;
  const ids = fichas.map(() => randomUUID());
  // 11/10: en la Champions se regulan defensas y porteros (ver crearAjusteValorPorPosicion).
  const ajustarValor = crearAjusteValorPorPosicion(competicion, plantilla.map((j) => ({ posicion: j.posicion, valor: j.valor_mercado })));
  const entrada = fichas.map((j, k) => {
    const f = fuerza.get(j.equipo_real as string);
    return { id: ids[k], posicion: j.posicion as PosicionFutbol, valorMercado: ajustarValor(j.posicion, j.valor_mercado), factorPartido: f !== undefined ? factorPosicion(f, j.posicion as PosicionFutbol) : 1 };
  });
  const calculo = calcularPreciosFutbolDetallado(entrada, {}, rango, competicion);
  const precioPorId = new Map(calculo.precios.map((p) => [p.id, p]));

  // 3. Jugadores que ya tiene la jornada.
  //    (13/10: paginado — Supabase devuelve como mucho 1.000 filas por
  //    consulta y una jornada de Champions puede pasar de ahí; sin esto se
  //    duplicarían los que quedaban fuera).
  const actuales: FilaJugadorJornada[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data: lote, error: errAct } = await admin.from('jugadores').select('id,nombre,equipo_real').eq('competicion', competicion).order('id').range(desde, desde + 999);
    if (errAct) throw new Error(`jugadores: ${errAct.message}`);
    actuales.push(...((lote as FilaJugadorJornada[]) ?? []));
    if (!lote || lote.length < 1000) break;
  }
  const clave = (nombre: string, equipo: string | null) => `${normalizarNombre(nombre)}|${normalizarNombre(equipo ?? '')}`;
  const yaEsta = new Map(actuales.filter((a) => !esEquipoFilial(a.equipo_real ?? '')).map((a) => [clave(a.nombre, a.equipo_real), a.id]));

  // ¿Hay equipos apuntados a las mesas de esta jornada?
  const { data: salasData } = await admin.from('salas').select('id').eq('competicion', competicion);
  const salaIds = ((salasData as { id: string }[] | null) ?? []).map((s) => s.id);
  const elegidos = new Set<string>();
  let hayEquipos = false;
  if (salaIds.length > 0) {
    const { data: eqData } = await admin.from('equipos').select('jugadores').in('sala_id', salaIds);
    for (const e of (eqData as { jugadores: unknown }[] | null) ?? []) {
      hayEquipos = true;
      if (Array.isArray(e.jugadores)) for (const id of e.jugadores) if (typeof id === 'string') elegidos.add(id);
    }
  }

  const nuevas = fichas
    .map((j, k) => ({ j, k }))
    .filter(({ j }) => !yaEsta.has(clave(j.nombre, j.equipo_real)))
    .map(({ j, k }) => {
      const p = precioPorId.get(ids[k]);
      return {
        id: ids[k],
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
        metadata: { ...(j.metadata ?? {}), origen_jugador_id: j.id, creada_automaticamente: true, reparada: true },
      };
    });
  for (let d = 0; d < nuevas.length; d += 500) {
    const { error } = await admin.from('jugadores').insert(nuevas.slice(d, d + 500));
    if (error) throw new Error(`jugadores: ${error.message}`);
  }

  // 4. Precios de los que ya estaban (solo si nadie se ha apuntado todavía,
  //    o si el admin pide recalcularlos expresamente — 12/10, Iñi: la jornada
  //    de Champions se creó antes del ajuste de defensas/porteros y ya tenía
  //    equipos; los equipos ya hechos se quedan como están).
  let reprecios = 0;
  if (!hayEquipos || forzarPrecios) {
    // 13/10: en bloques de 500 (antes uno a uno: con ~900 jugadores de
    // Champions la ruta pasaba de 60 s y Vercel la cortaba). El upsert por id
    // solo cambia las columnas enviadas; nombre/deporte/competición van porque
    // son obligatorias, con el mismo valor que ya tienen.
    const actualPorId = new Map(actuales.map((a) => [a.id, a]));
    const filas: { id: string; nombre: string; deporte: string; competicion: string; precio: number; valor_a_revisar: boolean }[] = [];
    for (let k = 0; k < fichas.length; k++) {
      const idExistente = yaEsta.get(clave(fichas[k].nombre, fichas[k].equipo_real));
      const p = precioPorId.get(ids[k]);
      if (!idExistente || !p) continue;
      const actual = actualPorId.get(idExistente);
      filas.push({ id: idExistente, nombre: actual?.nombre ?? fichas[k].nombre, deporte: 'futbol', competicion, precio: p.precio, valor_a_revisar: p.sinValor ?? false });
    }
    for (let d = 0; d < filas.length; d += 500) {
      const lote = filas.slice(d, d + 500);
      const { error } = await admin.from('jugadores').upsert(lote, { onConflict: 'id' });
      if (error) throw new Error(`precios: ${error.message}`);
      reprecios += lote.length;
    }
  }

  // 5. Fuera los jugadores del filial (si nadie los ha elegido).
  const filiales = actuales.filter((a) => esEquipoFilial(a.equipo_real ?? ''));
  const aBorrar = filiales.filter((a) => !elegidos.has(a.id)).map((a) => a.id);
  for (let d = 0; d < aBorrar.length; d += 200) {
    await admin.from('jugadores').delete().in('id', aBorrar.slice(d, d + 200));
  }
  const filialesConservados = filiales.length - aBorrar.length;

  // Diagnóstico final: jugadores por equipo en la jornada.
  const { data: finalData } = await admin.from('jugadores').select('equipo_real').eq('competicion', competicion);
  const porEquipoFinal = new Map<string, number>();
  for (const f of (finalData as { equipo_real: string | null }[] | null) ?? []) {
    const k = claveEquipoFutbol(f.equipo_real);
    if (k) porEquipoFinal.set(k, (porEquipoFinal.get(k) ?? 0) + 1);
  }
  const pocos = Array.from(equiposJornada)
    .map((n) => ({ n, k: claveEquipoFutbol(n), c: porEquipoFinal.get(claveEquipoFutbol(n)) ?? 0 }))
    .filter((x) => x.c < 15)
    .map((x) => `${x.n} (${x.c})`);
  for (const n of Array.from(equiposSinJugadores)) avisos.push(`FALTA: no hay ningún jugador cargado de "${n}" en ${prefijo}. Vuelve a pegar el valor de mercado de esa liga con ese equipo.`);
  if (pocos.length > 0) avisos.push(`Equipos de la jornada con pocos jugadores: ${pocos.join(', ')}`);

  const cambios = nuevas.length + cuotasCambiadas + aBorrar.length + reprecios + (avisos.length > 0 ? 1 : 0);
  const detalle =
    `${nuevas.length} jugadores añadidos, ${cuotasCambiadas} partido(s) con el nombre de equipo corregido, ${aBorrar.length} jugador(es) de filial retirados` +
    (filialesConservados > 0 ? ` (${filialesConservados} conservado(s) porque alguien ya los eligió)` : '') +
    (hayEquipos && !forzarPrecios ? '; ya hay equipos apuntados: los precios de los jugadores que ya estaban no se han tocado' : `; precios recalculados de ${reprecios} jugadores${hayEquipos ? ' (los equipos ya creados no cambian)' : ''}`) +
    '.' +
    (avisos.length > 0 ? `\n   · ${avisos.join('\n   · ')}` : '');
  return { competicion, estado: cambios > 0 ? 'reparada' : 'sin_cambios', detalle };
}

/** Repara las jornadas creadas solas que todavía no han terminado (o una concreta). */
export async function repararJornadasFutbol(admin: Admin, competicion?: string, opciones: { forzarPrecios?: boolean } = {}): Promise<ResultadoReparacion[]> {
  let competiciones: string[];
  if (competicion) {
    competiciones = [competicion];
  } else {
    const desde = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data, error } = await admin.from('futbol_jornadas_auto').select('competicion').eq('creada', true).gte('primer_partido', desde);
    if (error) throw new Error(error.message);
    competiciones = ((data as { competicion: string }[] | null) ?? []).map((x) => x.competicion);
    // Jornadas creadas a mano / antes de la tabla: también las que tienen mesas abiertas.
    const { data: salas } = await admin.from('salas').select('competicion').eq('deporte', 'futbol').gte('fecha_limite_inscripcion', desde);
    for (const s of (salas as { competicion: string }[] | null) ?? []) if (!competiciones.includes(s.competicion)) competiciones.push(s.competicion);
  }
  // 13/10: las jornadas se procesan a la vez (antes una detrás de otra) para
  // no pasar del tiempo máximo de la ruta.
  const procesar = async (c: string): Promise<ResultadoReparacion | null> => {
    const prefijo = PREFIJOS.find((p) => c.startsWith(p));
    if (!prefijo) return null;
    let forzar = false;
    if (opciones.forzarPrecios) {
      const { data: primera } = await admin.from('salas').select('fecha_limite_inscripcion').eq('competicion', c).order('fecha_limite_inscripcion', { ascending: true }).limit(1);
      const inicio = (primera as { fecha_limite_inscripcion: string | null }[] | null)?.[0]?.fecha_limite_inscripcion;
      if (!inicio || new Date(inicio).getTime() <= Date.now()) return { competicion: c, estado: 'sin_cambios', detalle: 'Ya ha empezado: sus precios no se tocan.' };
      forzar = true;
    }
    try {
      return await repararUna(admin, c, prefijo, forzar);
    } catch (err) {
      return { competicion: c, estado: 'error', detalle: (err as Error).message };
    }
  };
  const resultados = (await Promise.all(Array.from(new Set(competiciones)).map(procesar))).filter((r): r is ResultadoReparacion => r !== null);
  return resultados;
}
