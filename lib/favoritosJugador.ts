import { supabase } from './supabaseClient';

// ============================================================================
// FAVORITOS DE JUGADOR (nuevo, 03/10)
// ============================================================================
// Mismo mecanismo que lib/favoritosEquipo.ts, pero sobre jugadores
// individuales — pedido de Iñi: "me gustaría que los jugadores también
// tuviesen... la estrellita para poder seleccionar los jugadores
// favoritos". Es un favorito por usuario sobre cualquier jugador de
// cualquier porra, sin límite de cuántos se pueden marcar (tabla
// jugadores_favoritos, ver drafters-schema.sql).

/** IDs de jugador que el usuario tiene marcados como favoritos, de cualquier porra. */
export async function cargarFavoritosJugador(usuarioId: string): Promise<Set<string>> {
  const { data } = await supabase.from('jugadores_favoritos').select('jugador_id').eq('usuario_id', usuarioId);
  return new Set(((data as { jugador_id: string }[]) ?? []).map((f) => f.jugador_id));
}

/** Marca o desmarca un jugador como favorito del usuario (según `estabaMarcado`, el estado ANTES de pulsar). */
export async function alternarFavoritoJugador(usuarioId: string, jugadorId: string, estabaMarcado: boolean): Promise<void> {
  if (estabaMarcado) {
    await supabase.from('jugadores_favoritos').delete().eq('usuario_id', usuarioId).eq('jugador_id', jugadorId);
  } else {
    await supabase.from('jugadores_favoritos').insert({ usuario_id: usuarioId, jugador_id: jugadorId });
  }
}
