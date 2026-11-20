// ============================================================================
// MENSAJES DE ERROR ENTENDIBLES (20/11, Iñi)
// ============================================================================
// "Todo ese tipo de fallos tiene que aparecer con un mensaje entendible para
// el usuario." Ejemplo: al guardar un equipo salía
//   function public.v2_max_2_por_equipo(uuid[]) does not exist
// Ahora:
//  · Los mensajes nuestros (los que escribimos en español en la base de datos,
//    como "No te quedan créditos…") se enseñan tal cual.
//  · Los técnicos (en inglés, de Postgres, de Supabase o de la red) se cambian
//    por uno claro, y el error de verdad se guarda en errores_app (SQL 109)
//    para que el admin lo vea.

import { supabase } from '@/lib/supabaseClient';

const TECNICO =
  /does not exist|function |relation |column |syntax error|violates|permission denied|jwt|pgrst|null value|duplicate key|invalid input|could not|operator|schema|record "|unexpected|undefined|cannot |is not|requires a where|internal server error|bad request|status code|\bat character\b/i;
const RED = /failed to fetch|network|fetch failed|load failed|timeout|timed out|aborted|502|503|504|402|quota|restricted|paused|service unavailable|econn/i;

export const TEXTO_ERROR_TECNICO = 'Ha habido un problema técnico y no se ha podido hacer. Ya nos ha llegado el aviso: inténtalo de nuevo en unos minutos.';
export const TEXTO_ERROR_RED = 'Ahora mismo no podemos conectar con Drafters. Revisa tu conexión e inténtalo de nuevo en unos minutos.';

/** ¿Parece un mensaje escrito por nosotros en español (y no un error técnico)? */
function esMensajeNuestro(m: string): boolean {
  if (TECNICO.test(m) || RED.test(m)) return false;
  return /[áéíóúñ¿¡]|\b(no|el|la|los|las|tu|tus|ya|que|para|con|una?|equipo|sala|liga|jugador|jornada|cr[eé]dito)\b/i.test(m);
}

const yaAvisados = new Set<string>();
function avisar(original: string, donde?: string) {
  const k = `${donde ?? ''}|${original}`;
  if (yaAvisados.has(k)) return;
  yaAvisados.add(k);
  try {
    console.error('[Drafters] Error técnico:', donde ?? '', original);
    void supabase
      .rpc('registrar_error_app', { p_mensaje: original.slice(0, 1000), p_donde: (donde ?? (typeof window !== 'undefined' ? window.location.pathname : '')).slice(0, 200) })
      .then(() => undefined, () => undefined);
  } catch {
    // nunca rompe nada
  }
}

/** Texto para enseñar al usuario a partir de un error (de Supabase, de fetch o un texto). */
export function errorAmigable(e: unknown, donde?: string): string {
  const crudo =
    typeof e === 'string' ? e : e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message ?? '') : e ? String(e) : '';
  const m = crudo.replace(/^ERROR:\s*/i, '').trim();
  if (!m) return TEXTO_ERROR_TECNICO;
  if (esMensajeNuestro(m)) return m;
  if (RED.test(m)) return TEXTO_ERROR_RED;
  avisar(m, donde);
  return TEXTO_ERROR_TECNICO;
}
