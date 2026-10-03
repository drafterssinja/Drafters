// ============================================================================
// CLIENTE DE LOS ENDPOINTS PÚBLICOS (NO OFICIALES) DE ESPN PARA GOLF (28/09)
// ============================================================================
// Pedido de Iñi: resultados en vivo de PGA Tour y DP World Tour sin coste,
// para que la clasificación de las porras se actualice sola. Se usan los
// endpoints de "site API" de ESPN (site.api.espn.com / site.web.api.espn.com)
// — NO son una API oficial ni documentada por ESPN para terceros, así que:
//   - No hay ninguna garantía de que sigan funcionando igual mañana.
//   - No hay límite de peticiones publicado, pero conviene ser prudentes
//     (de ahí el límite de concurrencia al pedir el hoyo a hoyo, más abajo).
//   - Para Fase 1 (sin dinero real) es un riesgo aceptable — mismo criterio
//     que ya se aplicó a los precios de fútbol, que tampoco vienen de una
//     fuente con licencia. El día que haya dinero real de por medio, la
//     alternativa ya investigada y documentada es Data Golf (30€/mes, con
//     API oficial y soporte) — ver el addendum de este mismo día.
//
// Como la forma exacta de la respuesta de ESPN no está documentada de forma
// oficial (solo verificada de forma independiente por terceros), todo el
// parseo de aquí es defensivo: busca el dato en las rutas más habituales
// del "site API" de ESPN y, si algo no encaja, lo descarta sin romper el
// resto — un fallo en un jugador suelto nunca debe tirar abajo la
// sincronización de todo el torneo.

export type EspnTour = 'pga' | 'eur';

export type CompetidorEnVivo = {
  espnPlayerId: string;
  nombre: string;
  /** Golpes respecto al par acumulados en el torneo — null si no se pudo leer (p.ej. "WD"/"CUT" sin cifra). */
  totalVsPar: number | null;
  /** Hoyo por el que va en la ronda actual (0-18) — null si todavía no ha salido o no se pudo leer. */
  thru: number | null;
  /** Número de ronda actual (1-4 lo habitual) — null si no se pudo leer. */
  ronda: number | null;
  /** Posición tal cual la da ESPN ("T5", "1", "CUT", "WD"...). */
  posicion: string | null;
};

/** Convierte "-5", "+3", "E" o 0 en un número de golpes respecto al par. */
function parsearGolpesVsPar(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const texto = String(valor).trim().toUpperCase();
  if (texto === '' ) return null;
  if (texto === 'E' || texto === 'PAR') return 0;
  const limpio = texto.replace(/^\+/, '');
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

function parsearThru(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const texto = String(valor).trim().toUpperCase();
  if (texto === 'F' || texto === 'FINAL') return 18;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/**
 * Clasificación completa de un torneo en curso — UNA sola llamada a ESPN
 * para todo el campo (barato: se puede pedir cada minuto sin problema).
 *
 * CAMBIO 01/10 (aviso de Iñi, primera prueba real con un torneo del DP
 * World Tour — Alfred Dunhill Links 2026 — ESPN respondió 404 con
 * "leaderboard?tournamentId=..."): como esta API no es oficial ni está
 * documentada por ESPN, no hay ninguna garantía de que todos los tours usen
 * exactamente la misma forma de URL para el mismo dato — de hecho, dentro
 * de este mismo archivo, obtenerHoyosJugadorEspn() ya usaba el id del
 * torneo COMO PARTE DE LA RUTA ("leaderboard/{eventId}/playersummary"), no
 * como parámetro de query, así que es razonable que el leaderboard general
 * también lo acepte así (o incluso lo requiera así) en vez de
 * "?tournamentId=...". Para no depender de adivinar cuál es la única forma
 * correcta, se prueban varias formas conocidas de construir esta URL, en
 * orden, y se usa la primera que responda bien — si ESPN cambia de forma
 * de un tour a otro (o de una semana a otra), esto sigue funcionando sin
 * tener que tocar código cada vez.
 */
// CAMBIO 01/10 (segunda vuelta — aviso de Iñi, con una captura del JSON real
// de ESPN): las 4 formas de arriba (todas con "leaderboard" o "summary" en
// la ruta) daban 404 siempre para este torneo del DP World Tour, aunque el
// id del evento era correcto (Iñi lo confirmó mirando el calendario
// completo de la temporada: "401822704" SÍ es el Alfred Dunhill Links
// Championship, 1-4 de octubre de 2026). La pista la dio el propio Iñi
// pegando el JSON de `.../eur/scoreboard` (el "marcador" general del tour,
// sin ningún id de torneo en la URL): ese mismo JSON trae, de regalo, el
// torneo que esté en juego HOY con su clasificación completa (jugador,
// puntuación, rondas...) dentro de un array `events`. O sea, el endpoint que
// de verdad tiene datos en vivo para el DP World Tour no es "leaderboard",
// es "scoreboard" — que para golf no pide una fecha de un partido suelto
// como en otros deportes, da directamente el torneo que esté activo ese
// día. Se añade como nueva forma a probar (con y sin la fecha de hoy
// explícita, por robustez — por si acaso alguna vez hiciera falta pasarla).
function fechaHoyEspnFormato(): string {
  const hoy = new Date();
  const yyyy = hoy.getUTCFullYear();
  const mm = String(hoy.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(hoy.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function intentarObtenerJsonLeaderboard(tour: EspnTour, eventId: string): Promise<{ data: any; urlUsada: string }> {
  const candidatas = [
    `https://site.api.espn.com/apis/site/v2/sports/golf/${tour}/scoreboard`,
    `https://site.api.espn.com/apis/site/v2/sports/golf/${tour}/scoreboard?dates=${fechaHoyEspnFormato()}`,
    `https://site.api.espn.com/apis/site/v2/sports/golf/${tour}/leaderboard?tournamentId=${encodeURIComponent(eventId)}`,
    `https://site.api.espn.com/apis/site/v2/sports/golf/${tour}/leaderboard/${encodeURIComponent(eventId)}`,
    `https://site.api.espn.com/apis/site/v2/sports/golf/${tour}/summary?event=${encodeURIComponent(eventId)}`,
    `https://site.web.api.espn.com/apis/site/v2/sports/golf/${tour}/leaderboard/${encodeURIComponent(eventId)}`,
  ];

  const errores: string[] = [];
  for (const url of candidatas) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        errores.push(`${res.status} en ${url}`);
        continue;
      }
      const data: any = await res.json();
      // "scoreboard" puede devolver más de un evento del mismo tour a la vez
      // (el día que se solapen dos semanas) — si es así, hace falta
      // comprobar que el que trae de verdad es NUESTRO torneo (mismo id),
      // no asumir que siempre es el primero de la lista.
      if (Array.isArray(data?.events) && data.events.length > 1) {
        const coincide = data.events.some((e: any) => String(e?.id) === String(eventId));
        if (!coincide) {
          errores.push(`scoreboard devolvió ${data.events.length} eventos, ninguno con id=${eventId}, en ${url}`);
          continue;
        }
      }
      return { data, urlUsada: url };
    } catch (e) {
      errores.push(`${(e as Error).message} en ${url}`);
    }
  }
  throw new Error(`ESPN no respondió con ningún formato de URL conocido (tour=${tour}, eventId=${eventId}): ${errores.join(' · ')}`);
}

export async function obtenerLeaderboardEspn(tour: EspnTour, eventId: string): Promise<CompetidorEnVivo[]> {
  const { data } = await intentarObtenerJsonLeaderboard(tour, eventId);

  // Si "scoreboard" ha traído varios eventos a la vez, nos quedamos con el
  // que sea de verdad nuestro torneo (por id) en vez de asumir que es el
  // primero — el resto de formas de pedirlo (leaderboard/summary) solo
  // devuelven un único torneo, así que ahí el id ya coincide siempre.
  const eventos: any[] = Array.isArray(data?.events) ? data.events : [];
  const eventoElegido = eventos.length > 1 ? eventos.find((e) => String(e?.id) === String(eventId)) ?? eventos[0] : eventos[0];

  const competidoresRaw: any[] =
    eventoElegido?.competitions?.[0]?.competitors ?? data?.leaderboard?.[0]?.competitors ?? data?.competitors ?? [];

  const resultado: CompetidorEnVivo[] = [];
  for (const c of competidoresRaw) {
    try {
      const nombre: string | undefined = c?.athlete?.displayName ?? c?.athlete?.fullName ?? c?.displayName;
      const espnPlayerId = c?.athlete?.id ?? c?.id;
      if (!nombre || espnPlayerId === undefined || espnPlayerId === null) continue;

      const totalRaw = c?.score?.displayValue ?? c?.score ?? c?.statistics?.find((s: any) => s?.name === 'scoreToPar')?.displayValue;
      const thruRaw = c?.status?.thru ?? c?.status?.displayValue;
      const rondaRaw = c?.status?.period ?? c?.status?.round;
      const posicionRaw = c?.status?.position?.displayName ?? c?.status?.position?.id ?? c?.status?.position;
      const ronda = Number(rondaRaw);

      resultado.push({
        espnPlayerId: String(espnPlayerId),
        nombre,
        totalVsPar: parsearGolpesVsPar(totalRaw),
        thru: parsearThru(thruRaw),
        ronda: Number.isFinite(ronda) ? ronda : null,
        posicion: posicionRaw !== undefined && posicionRaw !== null ? String(posicionRaw) : null,
      });
    } catch {
      // Un competidor con una forma inesperada se descarta y sigue el resto.
    }
  }
  return resultado;
}

export type HoyoEnVivo = { ronda: number; hoyo: number; par: number; golpes: number; campoId: string | null };

/**
 * Desglose hoyo a hoyo de UN jugador — una llamada por jugador (el motivo de
 * limitar cuántos jugadores se piden en cada ciclo, ver
 * app/api/admin/actualizar-golf-en-vivo/route.ts). Devuelve todas las
 * rondas que ESPN tenga registradas para ese jugador en este torneo.
 */
export async function obtenerHoyosJugadorEspn(tour: EspnTour, eventId: string, season: number, espnPlayerId: string): Promise<HoyoEnVivo[]> {
  const url = `https://site.web.api.espn.com/apis/site/v2/sports/golf/${tour}/leaderboard/${encodeURIComponent(eventId)}/playersummary?season=${season}&player=${encodeURIComponent(espnPlayerId)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`ESPN respondió ${res.status} en playersummary (player=${espnPlayerId})`);
  }
  const data: any = await res.json();
  const rounds: any[] = data?.rounds ?? [];

  const hoyos: HoyoEnVivo[] = [];
  for (const r of rounds) {
    const ronda = Number(r?.period);
    if (!Number.isFinite(ronda)) continue;
    // Torneos con más de un campo (01/10, pedido de Iñi — p.ej. el Alfred
    // Dunhill Links Championship, 3 campos en rotación): ESPN da el campo de
    // CADA ronda en este mismo sitio (playersummary → rounds[].courseId), así
    // que se guarda junto con el resto del hoyo a hoyo. El par de cada hoyo
    // (l.par, más abajo) ya venía correctamente desglosado por ronda incluso
    // antes de esto — lo único que faltaba era poder IDENTIFICAR de qué
    // campo era cada ronda para mostrarlo (ver campos_golf_live en el
    // esquema). Si ESPN no da courseId para este torneo (lo habitual, un
    // solo campo), queda en null y la pantalla simplemente no muestra nombre
    // de campo — sin cambiar nada más.
    const campoIdRaw = r?.courseId;
    const campoId = campoIdRaw !== undefined && campoIdRaw !== null ? String(campoIdRaw) : null;
    const linescores: any[] = r?.linescores ?? [];
    for (const l of linescores) {
      const hoyo = Number(l?.period);
      const par = Number(l?.par);
      const golpes = Number(l?.value);
      if (!Number.isFinite(hoyo) || !Number.isFinite(par) || !Number.isFinite(golpes) || golpes <= 0) continue;
      hoyos.push({ ronda, hoyo, par, golpes, campoId });
    }
  }
  return hoyos;
}

/** Ejecuta `tareas` con como mucho `limite` en marcha a la vez — para no lanzar
 * de golpe una petición por jugador (hasta 150+ en un campo completo) contra
 * un endpoint sin límite publicado pero que pide "ser razonable". */
export async function conConcurrenciaLimitada<T, R>(items: T[], limite: number, tarea: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length);
  let indice = 0;
  async function trabajador() {
    while (indice < items.length) {
      const miIndice = indice++;
      resultados[miIndice] = await tarea(items[miIndice]);
    }
  }
  const trabajadores = Array.from({ length: Math.min(limite, items.length) }, () => trabajador());
  await Promise.all(trabajadores);
  return resultados;
}
