import { supabase } from './supabaseClient';

// ============================================================================
// FAVORITOS DE EQUIPO (nuevo, 02/10)
// ============================================================================
// Pedido de Iñi: en la clasificación de las porras y de los maratones, poder
// marcar como favorito cualquier equipo (no solo el propio) para seguirlo
// más de cerca — una estrellita al lado de cada equipo y un filtro de "solo
// favoritos". Es un favorito por usuario sobre cualquier equipo de cualquier
// porra/maratón (tabla equipos_favoritos, ver drafters-schema.sql), sin
// límite de cuántos se pueden marcar. Se usa igual desde
// app/porras/[id]/clasificacion/page.tsx y
// app/salas/[id]/clasificacion/page.tsx (esta última solo para sala.tipo
// === 'maraton' — el resto de mesas no tienen esta función).

/** IDs de equipo que el usuario tiene marcados como favoritos, de cualquier porra o maratón. */
export async function cargarFavoritos(usuarioId: string): Promise<Set<string>> {
  const { data } = await supabase.from('equipos_favoritos').select('equipo_id').eq('usuario_id', usuarioId);
  return new Set(((data as { equipo_id: string }[]) ?? []).map((f) => f.equipo_id));
}

/** Marca o desmarca un equipo como favorito del usuario (según `estabaMarcado`, el estado ANTES de pulsar). */
export async function alternarFavoritoEquipo(usuarioId: string, equipoId: string, estabaMarcado: boolean): Promise<void> {
  if (estabaMarcado) {
    await supabase.from('equipos_favoritos').delete().eq('usuario_id', usuarioId).eq('equipo_id', equipoId);
  } else {
    await supabase.from('equipos_favoritos').insert({ usuario_id: usuarioId, equipo_id: equipoId });
  }
}
