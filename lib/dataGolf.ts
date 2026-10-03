// ============================================================================
// CLIENTE DE LA API OFICIAL DE DATA GOLF (02/10 — preparación, sin probar
// todavía contra una clave real)
// ============================================================================
// A diferencia de lib/espnGolf.ts (API no oficial y gratuita de ESPN, ya en
// marcha), esta es la integración DE PAGO que Iñi va a dar de alta — pensada
// sobre todo para el DP World Tour (que ESPN cubre peor que el PGA Tour) y
// como alternativa con soporte oficial para cuando haya dinero real en
// juego. Ver DRAFTERS_Manual_DataGolf_Alta_e_Integracion.md para el alta,
// el pago y qué hace falta mandarme.
//
// POR QUÉ ESTE ARCHIVO NO INTENTA "ENTENDER" LA RESPUESTA TODAVÍA:
// Data Golf documenta sus ENDPOINTS y los parámetros que aceptan, pero en
// ningún sitio público (ni su propia web, ni el repositorio de terceros
// consultado) se ha encontrado la forma exacta del JSON que devuelven —
// nombres de campo como "thru", "position", "start_hole", "current_score"
// no están confirmados en ningún lado. Así que, a propósito, estas
// funciones solo construyen la URL, llaman y devuelven el JSON CRUDO tal
// cual lo manda Data Golf. Nada de mapear eso a los tipos que ya usamos
// para ESPN (CompetidorEnVivo / HoyoEnVivo) hasta que se vea una respuesta
// real — eso es justo lo que hace app/api/admin/probar-data-golf/route.ts,
// pensada para que Iñi pueda pedir cada endpoint desde
// /admin/resultados-golf y pasarme el resultado tal cual.
//
// REQUISITO PERMANENTE a tener en cuenta en cuanto se vea la respuesta real
// (ver DRAFTERS_Requisito_Permanente_Hoyo_Salida_Golf.md, pedido explícito
// de Iñi, vale para cualquier proveedor de datos): aproximadamente el 95% de
// las rondas de golf reparten las salidas entre el hoyo 1 y el hoyo 10 — un
// recuento de "thru" (hoyos completados) SIEMPRE hay que combinarlo con el
// hoyo de salida real (start_hole, 1 o 10) para saber qué hoyos ha jugado de
// verdad alguien. Fórmula ya confirmada por Iñi (ver
// DRAFTERS_Investigacion_01-10_Reconstruccion_Hoyo_a_Hoyo_DataGolf.md):
//   hoyo_completado = ((start_hole - 1 + thru - 1) mod 18) + 1
// NUNCA asumir que todo el mundo sale por el hoyo 1.
//
// La clave de API (DATA_GOLF_API_KEY) sigue la misma regla que la clave
// "service role" de Supabase: SOLO como variable de entorno de servidor en
// Vercel, nunca en .env.local ni escrita en ningún archivo de código.

const BASE_URL = 'https://feeds.datagolf.com';

/** Límite publicado por Data Golf: 45 peticiones/minuto, con suspensión de
 * 5 minutos si se supera. Importado por quien orqueste varias llamadas
 * seguidas (p.ej. una futura sincronización), para no superarlo — igual
 * de criterio que conConcurrenciaLimitada en lib/espnGolf.ts. */
export const DATA_GOLF_LIMITE_POR_MINUTO = 45;

// Tours aceptados según los endpoints documentados (algunos endpoints solo
// aceptan un subconjunto de estos — ver cada función de abajo).
export type DataGolfTour = 'pga' | 'euro' | 'kft' | 'alt' | 'liv' | 'all' | 'opp';

function obtenerApiKey(): string {
  const key = process.env.DATA_GOLF_API_KEY;
  if (!key) {
    throw new Error('Falta la variable de entorno DATA_GOLF_API_KEY (Vercel → Settings → Environment Variables).');
  }
  return key;
}

function construirUrl(ruta: string, params: Record<string, string | undefined>): string {
  const key = obtenerApiKey();
  const query = new URLSearchParams({ key, file_format: 'json' });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) query.set(k, v);
  }
  return `${BASE_URL}/${ruta}?${query.toString()}`;
}

async function pedirJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store' });
  const texto = await res.text();
  let data: unknown;
  try {
    data = texto ? JSON.parse(texto) : null;
  } catch {
    throw new Error(`Data Golf no devolvió JSON válido (status ${res.status}): ${texto.slice(0, 300)}`);
  }
  if (!res.ok) {
    const mensaje = (data as { message?: string } | null)?.message;
    throw new Error(`Data Golf respondió ${res.status}: ${mensaje ?? texto.slice(0, 300)}`);
  }
  return data;
}

/** Calendario de torneos del tour — para encontrar el torneo del DP World Tour que toque esta semana. */
export async function obtenerCalendarioDataGolf(tour: DataGolfTour, soloProximos = false): Promise<unknown> {
  return pedirJson(construirUrl('get-schedule', { tour, upcoming_only: soloProximos ? 'true' : undefined }));
}

/** Campo (jugadores inscritos) del torneo activo de ese tour — la documentación menciona que incluye el hoyo de salida. */
export async function obtenerCampoDataGolf(tour: DataGolfTour): Promise<unknown> {
  return pedirJson(construirUrl('field-updates', { tour }));
}

/** Estadísticas en vivo del torneo en curso (strokes-gained y similares) — documentado sobre todo de cara al PGA Tour. */
export async function obtenerEstadisticasEnVivoDataGolf(
  tour: DataGolfTour,
  ronda: 'event_cumulative' | 'event_avg' | '1' | '2' | '3' | '4' = 'event_cumulative',
  display: 'value' | 'rank' = 'value'
): Promise<unknown> {
  return pedirJson(construirUrl('preds/live-tournament-stats', { tour, round: ronda, display }));
}

/** Predicciones / "in-play" (probabilidades en vivo) del torneo en curso. */
export async function obtenerEnJuegoDataGolf(tour: DataGolfTour, formatoCuota = 'percent'): Promise<unknown> {
  return pedirJson(construirUrl('preds/in-play', { tour, odds_format: formatoCuota }));
}

/** Estadísticas de puntuación por hoyo. OJO (investigación previa del proyecto, pendiente de confirmar con una respuesta real): probablemente son medias de TODO el campo por hoyo, no el hoyo a hoyo de un jugador concreto. */
export async function obtenerEstadisticasHoyoDataGolf(tour: DataGolfTour, ronda: '1' | '2' | '3' | '4' = '1'): Promise<unknown> {
  return pedirJson(construirUrl('preds/live-hole-stats', { tour, round: ronda }));
}

/** Listado completo de jugadores conocidos por Data Golf (ids propios, útil si hiciera falta emparejar por id en vez de por nombre). */
export async function obtenerListaJugadoresDataGolf(): Promise<unknown> {
  return pedirJson(construirUrl('get-player-list', {}));
}
