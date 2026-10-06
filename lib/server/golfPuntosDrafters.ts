// ============================================================================
// PUNTOS DRAFTERS DE GOLF — cálculo y guardado (07/10)
// ============================================================================
// Para cada jugador de una competición de golf, calcula sus puntos Drafters
// (lib/golfPuntuacion.ts) con el hoyo a hoyo guardado en resultados_golf_hoyo
// y su posición, y lo guarda en golf_puntos_jugador. Lo llama la
// sincronización de Data Golf cada minuto y, una última vez con
// `torneoTerminado = true`, justo antes de dar el torneo por finalizado (así
// los puntos por posición final quedan fijados).
import type { crearClienteAdmin } from './supabaseAdmin';
import { puntuarGolfJugador, type HoyoGolf } from '../golfPuntuacion';

type Admin = ReturnType<typeof crearClienteAdmin>;

export type ResumenPuntosGolf = { jugadores: number; escritos: number; avisos: string[] };

export async function recalcularPuntosGolfCompeticion(admin: Admin, competicion: string, torneoTerminado: boolean): Promise<ResumenPuntosGolf> {
  const { data: jugData, error: jugError } = await admin
    .from('jugadores')
    .select('id,nombre,resultado_en_vivo_posicion,resultado_en_vivo_ronda,resultado_en_vivo_thru')
    .eq('deporte', 'golf')
    .eq('competicion', competicion);
  if (jugError) throw new Error(`Puntos golf: no se han podido leer los jugadores: ${jugError.message}`);
  const jugadores = (jugData as { id: string; nombre: string; resultado_en_vivo_posicion: string | null; resultado_en_vivo_ronda: number | null; resultado_en_vivo_thru: number | null }[]) ?? [];
  if (jugadores.length === 0) return { jugadores: 0, escritos: 0, avisos: [] };

  // Hoyo a hoyo de todo el campo (por lotes de jugadores y páginas de 1000 filas).
  const hoyosPorJugador = new Map<string, HoyoGolf[]>();
  const ids = jugadores.map((j) => j.id);
  for (let i = 0; i < ids.length; i += 60) {
    const lote = ids.slice(i, i + 60);
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await admin
        .from('resultados_golf_hoyo')
        .select('jugador_id,ronda,hoyo,par,golpes,actualizado_en')
        .in('jugador_id', lote)
        .order('jugador_id', { ascending: true })
        .order('ronda', { ascending: true })
        .order('hoyo', { ascending: true })
        .range(desde, desde + 999);
      if (error) throw new Error(`Puntos golf: no se ha podido leer el hoyo a hoyo: ${error.message}`);
      const filas = (data as (HoyoGolf & { jugador_id: string })[]) ?? [];
      for (const f of filas) {
        const l = hoyosPorJugador.get(f.jugador_id) ?? [];
        l.push({ ronda: f.ronda, hoyo: f.hoyo, par: f.par, golpes: f.golpes, actualizado_en: f.actualizado_en });
        hoyosPorJugador.set(f.jugador_id, l);
      }
      if (filas.length < 1000) break;
    }
  }

  // Lo ya guardado, para escribir solo lo que cambia.
  const previos = new Map<string, { puntos_total: number; desglose: unknown; avisos: unknown; torneo_terminado: boolean }>();
  for (let desde = 0; ; desde += 1000) {
    const { data } = await admin.from('golf_puntos_jugador').select('jugador_id,puntos_total,desglose,avisos,torneo_terminado').eq('competicion', competicion).range(desde, desde + 999);
    const filas = (data as { jugador_id: string; puntos_total: number; desglose: unknown; avisos: unknown; torneo_terminado: boolean }[]) ?? [];
    for (const f of filas) previos.set(f.jugador_id, f);
    if (filas.length < 1000) break;
  }

  const ahora = new Date().toISOString();
  const aEscribir: Record<string, unknown>[] = [];
  const avisos: string[] = [];
  for (const j of jugadores) {
    const r = puntuarGolfJugador({
      hoyos: hoyosPorJugador.get(j.id) ?? [],
      posicion: j.resultado_en_vivo_posicion,
      torneoTerminado,
      rondaActual: j.resultado_en_vivo_ronda,
      thruActual: j.resultado_en_vivo_thru,
    });
    for (const a of r.avisos) avisos.push(`${j.nombre}: ${a}`);
    const p = previos.get(j.id);
    const igual = p && Number(p.puntos_total) === r.total && p.torneo_terminado === torneoTerminado && JSON.stringify(p.desglose ?? []) === JSON.stringify(r.desglose) && JSON.stringify(p.avisos ?? []) === JSON.stringify(r.avisos);
    if (igual) continue;
    aEscribir.push({ jugador_id: j.id, competicion, puntos_total: r.total, desglose: r.desglose, avisos: r.avisos, hoyos_contados: r.hoyosContados, torneo_terminado: torneoTerminado, actualizado_en: ahora });
  }
  for (let i = 0; i < aEscribir.length; i += 300) {
    const { error } = await admin.from('golf_puntos_jugador').upsert(aEscribir.slice(i, i + 300), { onConflict: 'jugador_id' });
    if (error) throw new Error(`Puntos golf: no se han podido guardar: ${error.message}`);
  }
  return { jugadores: jugadores.length, escritos: aEscribir.length, avisos };
}
