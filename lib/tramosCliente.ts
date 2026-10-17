import { supabase } from '@/lib/supabaseClient';
import { claveEquipoLaLiga } from '@/lib/futbolLaLiga';
import { diaDeTramo, esTramoCorte, fechaMadrid, type Tramo } from '@/lib/tramos';

// ---------------------------------------------------------------------------
// Jugadores y partidos disponibles en un tramo (pantalla de hacer equipo)
// ---------------------------------------------------------------------------
type JugadorBase = { id: string; precio: number; equipo_real: string | null };
type PartidoBase = { equipo_local: string; equipo_visitante: string };

export async function aplicarTramo<J extends JugadorBase, P extends PartidoBase>(
  deporte: string,
  competicion: string,
  tramo: Tramo | undefined,
  jugadores: J[],
  partidos: P[]
): Promise<{ jugadores: J[]; partidos: P[] }> {
  if (!tramo) return { jugadores, partidos };
  const dia = diaDeTramo(tramo);
  if (deporte === 'futbol' && dia) {
    const { data } = await supabase.from('futbol_partidos_jornada').select('clave_local,clave_visitante,kickoff,descartado,estado').eq('competicion', competicion);
    const claves = new Set<string>();
    for (const p of (data as { clave_local: string; clave_visitante: string; kickoff: string | null; descartado: boolean | null; estado: string }[] | null) ?? []) {
      if (!p.kickoff || p.descartado || p.estado === 'aplazado' || fechaMadrid(p.kickoff) !== dia) continue;
      claves.add(p.clave_local);
      claves.add(p.clave_visitante);
    }
    const vale = (equipo: string | null) => !!equipo && claves.has(claveEquipoLaLiga(equipo));
    return { jugadores: jugadores.filter((j) => vale(j.equipo_real)), partidos: partidos.filter((p) => vale(p.equipo_local) && vale(p.equipo_visitante)) };
  }
  if (deporte === 'golf' && esTramoCorte(tramo)) {
    const precios = new Map<string, number>();
    for (let desde = 0; ; desde += 1000) {
      const { data } = await supabase.from('precios_corte').select('jugador_id,precio').eq('competicion', competicion).range(desde, desde + 999);
      const filas = (data as { jugador_id: string; precio: number }[] | null) ?? [];
      filas.forEach((f) => precios.set(f.jugador_id, Number(f.precio)));
      if (filas.length < 1000) break;
    }
    const lista = jugadores.filter((j) => precios.has(j.id)).map((j) => ({ ...j, precio: precios.get(j.id) as number }));
    lista.sort((a, b) => b.precio - a.precio);
    return { jugadores: lista, partidos };
  }
  return { jugadores, partidos };
}
