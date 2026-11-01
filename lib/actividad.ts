'use client';

import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// REGISTRO DE ACTIVIDAD: VER UNA CLASIFICACIÓN (01/11, Iñi)
// ============================================================================
// "Tiene que quedar registrado cuando entran a ver cualquier clasificación de
// una mesa, entren como entren." Se apunta una vez por clasificación y usuario
// cada 10 minutos (al cambiar de pestaña o de jornada no se repite). Nunca
// rompe nada si falla.

const MINUTOS = 10;

export type ModoClasificacion = 'sala' | 'liga_privada' | 'liga_drafters' | 'duelo' | 'partida' | 'mesa' | 'porra';

export function registrarVistaClasificacion(clave: string, detalle: { modo: ModoClasificacion; nombre: string; deporte?: string; competicion?: string }): void {
  try {
    const k = `drafters_vista_clasif:${clave}`;
    const antes = Number(sessionStorage.getItem(k) ?? 0);
    if (Date.now() - antes < MINUTOS * 60000) return;
    sessionStorage.setItem(k, String(Date.now()));
  } catch {
    // sin almacenamiento: se apunta igualmente
  }
  void supabase.rpc('registrar_evento_actividad', { p_tipo: 'clasificacion', p_detalle: detalle }).then(
    () => undefined,
    () => undefined
  );
}
