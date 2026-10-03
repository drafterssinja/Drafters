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

// ============================================================================
// PARSEO TIPADO (03/10 — ya confirmado contra respuestas reales con la
// clave de Iñi, ver DRAFTERS_Investigacion_01-10_Reconstruccion_Hoyo_a_Hoyo_DataGolf.md
// y los distintos DRAFTERS_Investigacion_01-10_*.md de ese mismo día).
// A partir de aquí ya no se devuelve JSON crudo: estas funciones son las
// que de verdad usa app/api/admin/actualizar-golf-en-vivo/route.ts para la
// rama de Data Golf (separada de la de ESPN).
// ============================================================================

/** "Apellido, Nombre" (formato de Data Golf) -> "Nombre Apellido" (formato
 * que usa el resto de la app) — imprescindible para que normalizarNombre()
 * (que NO reordena palabras, solo quita acentos/puntuación) pueda emparejar
 * con el nombre que Iñi cargó en `jugadores`. Si no tiene coma (formato
 * inesperado), se devuelve tal cual en vez de intentar adivinar. */
export function reordenarNombreDataGolf(nombre: string): string {
  const partes = nombre.split(',');
  if (partes.length !== 2) return nombre.trim();
  const apellido = partes[0].trim();
  const nombrePila = partes[1].trim();
  if (!apellido || !nombrePila) return nombre.trim();
  return `${nombrePila} ${apellido}`;
}

/** REQUISITO PERMANENTE (ver cabecera de este archivo): el 95% de las
 * rondas salen por el hoyo 1 o el 10. Data Golf no da el hoyo de salida
 * directamente en `in-play`, pero sí da `end_hole` (en qué hoyo termina la
 * ronda de hoy) — y como una ronda siempre juega los 18 hoyos seguidos en
 * orden circular, el hoyo de salida se deduce sin ambigüedad: si termina en
 * el 18, ha salido por el 1; si termina en el 9, ha salido por el 10. */
export function startHoleDesdeEndHole(endHole: number | null): number | null {
  if (endHole === 18) return 1;
  if (endHole === 9) return 10;
  return null;
}

/** Convierte un valor crudo de Data Golf (número, "E"/"PAR", "+3", "-2"...) en golpes respecto al par. */
function parsearGolpesVsPar(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const texto = String(valor).trim().toUpperCase();
  if (texto === '') return null;
  if (texto === 'E' || texto === 'PAR') return 0;
  const limpio = texto.replace(/^\+/, '');
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

function parsearEntero(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const n = typeof valor === 'number' ? valor : Number(String(valor).trim());
  return Number.isFinite(n) ? n : null;
}

export type EnJuegoDataGolf = {
  dgId: number | null;
  /** Ya reordenado a "Nombre Apellido" — listo para normalizarNombre(). */
  nombre: string;
  /** Código del campo donde juega la ronda ACTUAL ("SA", "CN", "KB"...) — puede cambiar de ronda en ronda en torneos con varios campos. */
  courseCode: string | null;
  /** Tal cual la da Data Golf ("T2", "1", "WD"...). */
  posicion: string | null;
  /** current_score: acumulado de TODO el torneo, respecto al par. */
  resultadoTotal: number | null;
  ronda: number | null;
  /** Hoyos completados en la ronda actual. */
  thru: number | null;
  /** today: SOLO la ronda actual, respecto al par. */
  resultadoHoy: number | null;
  /** En qué hoyo termina la ronda de hoy (9 o 18) — de aquí se deduce el hoyo de salida, ver startHoleDesdeEndHole(). */
  endHole: number | null;
};

export type EnJuegoDataGolfParseado = {
  eventName: string | null;
  rondaActual: number | null;
  jugadores: EnJuegoDataGolf[];
};

/** Versión tipada de obtenerEnJuegoDataGolf() — ya parseada y con el nombre reordenado. */
export async function obtenerEnJuegoDataGolfParseado(tour: DataGolfTour): Promise<EnJuegoDataGolfParseado> {
  const data = (await obtenerEnJuegoDataGolf(tour)) as any;
  const lista: any[] = Array.isArray(data?.data) ? data.data : [];

  const jugadores: EnJuegoDataGolf[] = [];
  for (const j of lista) {
    try {
      const nombreRaw = j?.player_name;
      if (!nombreRaw || typeof nombreRaw !== 'string') continue;
      jugadores.push({
        dgId: parsearEntero(j?.dg_id),
        nombre: reordenarNombreDataGolf(nombreRaw),
        courseCode: j?.course !== undefined && j?.course !== null ? String(j.course) : null,
        posicion: j?.current_pos !== undefined && j?.current_pos !== null ? String(j.current_pos) : null,
        resultadoTotal: parsearGolpesVsPar(j?.current_score),
        ronda: parsearEntero(j?.round),
        thru: parsearEntero(j?.thru),
        resultadoHoy: parsearGolpesVsPar(j?.today),
        endHole: parsearEntero(j?.end_hole),
      });
    } catch {
      // Un jugador suelto con forma inesperada se descarta sin tirar el resto.
    }
  }

  return {
    eventName: typeof data?.info?.event_name === 'string' ? data.info.event_name : null,
    rondaActual: parsearEntero(data?.info?.current_round),
    jugadores,
  };
}

/** Par de cada hoyo (índice 0 = hoyo 1 ... índice 17 = hoyo 18), por código
 * de campo — el par de un hoyo es fijo durante todo el torneo, así que
 * basta con la primera ronda de ese campo que ya traiga datos. */
export async function obtenerParesPorCampoDataGolf(
  tour: DataGolfTour,
  ronda: '1' | '2' | '3' | '4' = '1'
): Promise<Map<string, (number | null)[]>> {
  const data = (await obtenerEstadisticasHoyoDataGolf(tour, ronda)) as any;
  const cursosRaw: any[] = Array.isArray(data?.courses) ? data.courses : [];

  const resultado = new Map<string, (number | null)[]>();
  for (const curso of cursosRaw) {
    const courseCode = curso?.course_code;
    if (courseCode === undefined || courseCode === null) continue;
    const rondas: any[] = Array.isArray(curso?.rounds) ? curso.rounds : [];
    for (const r of rondas) {
      const holes: any[] = Array.isArray(r?.holes) ? r.holes : [];
      if (holes.length === 0) continue;
      const pares: (number | null)[] = new Array(18).fill(null);
      for (const h of holes) {
        const hoyo = parsearEntero(h?.hole);
        const par = parsearEntero(h?.par);
        if (hoyo !== null && hoyo >= 1 && hoyo <= 18 && par !== null) {
          pares[hoyo - 1] = par;
        }
      }
      if (pares.some((p) => p !== null)) {
        resultado.set(String(courseCode), pares);
        break; // ya tenemos este campo — el par no cambia de una ronda a otra
      }
    }
  }
  return resultado;
}

/** Nombre real de cada campo (p.ej. "SA" -> "St Andrews (Old Course)"),
 * leído de field-updates — a diferencia de ESPN, Data Golf SÍ da el nombre
 * completo junto al código, así que no hace falta que el admin lo escriba
 * a mano (ver campos_golf_live en drafters-schema.sql). */
export async function obtenerNombresCampoDataGolf(tour: DataGolfTour): Promise<Map<string, string>> {
  const data = (await obtenerCampoDataGolf(tour)) as any;
  const field: any[] = Array.isArray(data?.field) ? data.field : [];

  const resultado = new Map<string, string>();
  for (const jugador of field) {
    const teetimes: any[] = Array.isArray(jugador?.teetimes) ? jugador.teetimes : [];
    for (const t of teetimes) {
      const code = t?.course_code;
      const nombre = t?.course_name;
      if (code !== undefined && code !== null && typeof nombre === 'string' && nombre.trim() && !resultado.has(String(code))) {
        resultado.set(String(code), nombre.trim());
      }
    }
  }
  return resultado;
}
