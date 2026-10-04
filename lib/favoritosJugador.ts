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

// ============================================================================
// FAVORITOS POR DEFECTO AL CREAR UN EQUIPO (nuevo, 04/10)
// ============================================================================
// Pedido explícito de Iñi: "los jugadores que haya construido uno en su
// equipo, por defecto, cuando empiece la clasificación, van a aparecer como
// favoritos... si luego el participante quiere quitar los favoritos de sus
// jugadores, pues los quita, pero por defecto tiene que aparecer como
// favoritos" — en golf y en tenis (excluido explícitamente fútbol), tanto en
// porras como en mesas Drafters (Maratón, Doble o Nada...).
//
// Se llama SOLO al crear un equipo nuevo (inscripción), nunca al editar uno
// ya inscrito — a propósito: si se volviera a llamar también al editar,
// cada vez que alguien guardara cambios en su equipo se le reaparecerían
// como favoritos jugadores que hubiera quitado a propósito en otro momento
// (jugadores_favoritos no distingue "nunca marcado" de "marcado y luego
// quitado" — son la misma ausencia de fila), justo lo contrario de lo que
// ha pedido Iñi. Ver app/porras/[id]/crear-equipo y
// app/salas/[id]/crear-equipo, donde se llama justo después de que la
// inscripción se confirme con éxito.
export async function marcarFavoritosPorDefecto(usuarioId: string, jugadorIds: string[]): Promise<void> {
  if (jugadorIds.length === 0) return;
  const filas = jugadorIds.map((jugador_id) => ({ usuario_id: usuarioId, jugador_id }));
  // ignoreDuplicates: por si algún jugador se repitiera en la lista (no
  // debería, pero más vale no reventar la inscripción ya confirmada por un
  // conflicto de clave primaria) — nunca sobrescribe nada, solo inserta lo
  // que todavía no existe.
  const { error } = await supabase.from('jugadores_favoritos').upsert(filas, { onConflict: 'usuario_id,jugador_id', ignoreDuplicates: true });
  if (error) {
    // No debe poder deshacer ni bloquear la inscripción, que ya se ha
    // confirmado — solo se deja constancia para poder diagnosticarlo.
    // eslint-disable-next-line no-console
    console.error('No se han podido marcar como favoritos los jugadores del equipo recién creado:', error.message);
  }
}
