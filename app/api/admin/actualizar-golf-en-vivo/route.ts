import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { normalizarNombre } from '@/lib/nombreMatch';
import { obtenerLeaderboardEspn, obtenerHoyosJugadorEspn, conConcurrenciaLimitada, type EspnTour } from '@/lib/espnGolf';
import { tipoResultadoHoyo } from '@/lib/golfScoring';

// Biblioteca de pares de campo (01/10, pedido de Iñi: "si yo lo he puesto a
// mano, pues coges el de a mano, y si no, cuando actualicemos la extracción
// de ESPN, que nos traiga también los pares de cada hoyo") — ver el bloque
// "BIBLIOTECA DE PARES DE CAMPO DE GOLF" en drafters-schema.sql para el
// diseño completo. Aquí solo se rellena sola, nunca se lee para calcular
// nada todavía (eso le toca a la futura integración de Data Golf, que
// reconstruirá el hoyo a hoyo a partir del par guardado aquí).
async function rellenarBibliotecaDesdeEspn(admin: ReturnType<typeof crearClienteAdmin>, competicion: string, campoIds: Set<string | null>) {
  for (const campoId of campoIds) {
    if (!campoId) continue; // torneo de un solo campo sin id (ESPN no siempre lo da) — nada que vincular a un nombre

    const { data: campoLive } = await admin
      .from('campos_golf_live')
      .select('nombre')
      .eq('competicion', competicion)
      .eq('campo_id', campoId)
      .maybeSingle();

    const nombre = (campoLive as { nombre: string } | null)?.nombre;
    if (!nombre) continue; // todavía sin nombre puesto por el admin — no hay con qué vincular la biblioteca

    const { data: paresData } = await admin.rpc('pares_conocidos_campo', { p_competicion: competicion, p_campo_id: campoId });
    const pares = (paresData as (number | null)[] | null) ?? [];
    if (pares.length !== 18 || pares.some((p) => p === null)) continue; // todavía faltan hoyos por completar entre todo el campo

    await admin.rpc('actualizar_par_biblioteca_desde_espn', {
      p_nombre: nombre,
      p_nombre_normalizado: normalizarNombre(nombre),
      p_pares: pares,
    });
  }
}

// ============================================================================
// SINCRONIZACIÓN DE RESULTADOS DE GOLF EN VIVO (28/09, pedido de Iñi)
// ============================================================================
// Ruta de servidor (clave "service role", nunca llega al navegador) que:
//   1. Lee `torneos_golf_live` (torneos activos, con su tour+id de ESPN).
//   2. Por cada uno, pide a ESPN la clasificación completa (UNA llamada) y
//      actualiza el resultado en vivo de cada jugador emparejado por nombre
//      (normalizarNombre() — mismo criterio que el resto de la app: si un
//      nombre no encaja exacto tras normalizar, se descarta en vez de
//      arriesgarse a emparejar mal a dos personas).
//   3. Solo pide el desglose hoyo a hoyo (una llamada A ESPN POR JUGADOR,
//      la parte cara) de los jugadores cuyo "thru" haya avanzado desde la
//      última vez o que empiecen a jugar ahora mismo — así, en vez de
//      pedir el hoyo a hoyo de los 100-150 jugadores del campo cada 5
//      minutos, solo se piden los que de verdad están jugando en este
//      momento (normalmente una fracción del campo).
//
// Se puede llamar de dos formas (ambas comprobadas aquí):
//   - Con la cabecera "x-cron-secret" (la usa el cron de Supabase, ver el
//     bloque final de drafters-schema.sql) — comparada contra la variable
//     de entorno CRON_SECRET.
//   - Con una sesión de administrador ya logueado (la usa el botón
//     "Actualizar ahora" de /admin/resultados-golf) — mismo patrón que
//     /api/admin/sync-jornada-futbol.
export const maxDuration = 60;

// Cuántos jugadores como mucho en marcha a la vez al pedir el hoyo a hoyo —
// ESPN no publica ningún límite, pero conviene no lanzar de golpe una
// petición por cada jugador del campo.
const CONCURRENCIA_HOYOS = 8;

type ResultadoTorneo = {
  competicion: string;
  ok: boolean;
  jugadoresEnCampo: number;
  jugadoresEmparejados: number;
  nombresSinEmparejar: string[];
  hoyosActualizados: number;
  error?: string;
};

async function estaAutorizado(req: NextRequest, admin: ReturnType<typeof crearClienteAdmin>): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const cabeceraCron = req.headers.get('x-cron-secret');
  if (cronSecret && cabeceraCron && cabeceraCron === cronSecret) return true;

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return false;

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return false;

  const { data: perfil } = await admin.from('perfiles').select('rol').eq('id', userData.user.id).single();
  return !!perfil && perfil.rol === 'admin';
}

export async function POST(req: NextRequest) {
  let admin;
  try {
    admin = crearClienteAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  if (!(await estaAutorizado(req, admin))) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const { data: torneosData, error: torneosError } = await admin.from('torneos_golf_live').select('*').eq('activo', true);
  if (torneosError) {
    return NextResponse.json({ error: `No se han podido leer los torneos activos: ${torneosError.message}` }, { status: 500 });
  }

  const torneos = (torneosData as {
    id: string;
    competicion: string;
    tour: EspnTour;
    espn_event_id: string;
    temporada: number;
  }[]) ?? [];

  const resultados: ResultadoTorneo[] = [];

  for (const torneo of torneos) {
    const resultado: ResultadoTorneo = {
      competicion: torneo.competicion,
      ok: false,
      jugadoresEnCampo: 0,
      jugadoresEmparejados: 0,
      nombresSinEmparejar: [],
      hoyosActualizados: 0,
    };

    try {
      const { data: jugadoresData, error: jugadoresError } = await admin
        .from('jugadores')
        .select('id, nombre, resultado_en_vivo_thru')
        .eq('deporte', 'golf')
        .eq('competicion', torneo.competicion);

      if (jugadoresError) throw new Error(`No se han podido leer los jugadores de "${torneo.competicion}": ${jugadoresError.message}`);

      const jugadores = (jugadoresData as { id: string; nombre: string; resultado_en_vivo_thru: number | null }[]) ?? [];
      resultado.jugadoresEnCampo = jugadores.length;

      const jugadorPorNombre = new Map(jugadores.map((j) => [normalizarNombre(j.nombre), j]));

      const competidores = await obtenerLeaderboardEspn(torneo.tour, torneo.espn_event_id);

      const actualizacionesJugadores: {
        id: string;
        resultado_en_vivo_total: number | null;
        resultado_en_vivo_thru: number | null;
        resultado_en_vivo_ronda: number | null;
        resultado_en_vivo_posicion: string | null;
        resultado_en_vivo_actualizado_en: string;
      }[] = [];

      const paraHoyoAHoyo: { jugadorId: string; espnPlayerId: string; thruAnterior: number | null }[] = [];

      const ahora = new Date().toISOString();

      for (const c of competidores) {
        const jugador = jugadorPorNombre.get(normalizarNombre(c.nombre));
        if (!jugador) {
          resultado.nombresSinEmparejar.push(c.nombre);
          continue;
        }
        resultado.jugadoresEmparejados += 1;

        actualizacionesJugadores.push({
          id: jugador.id,
          resultado_en_vivo_total: c.totalVsPar,
          resultado_en_vivo_thru: c.thru,
          resultado_en_vivo_ronda: c.ronda,
          resultado_en_vivo_posicion: c.posicion,
          resultado_en_vivo_actualizado_en: ahora,
        });

        // Solo se pide el hoyo a hoyo si ha avanzado desde la última vez
        // (o si es la primera vez que se le ve con un "thru" real) — así
        // no se gasta una llamada por jugador en cada ciclo, solo en los
        // que de verdad han jugado algo nuevo desde el ciclo anterior.
        const avanzo = c.thru !== null && (jugador.resultado_en_vivo_thru === null || c.thru > jugador.resultado_en_vivo_thru);
        if (avanzo) {
          paraHoyoAHoyo.push({ jugadorId: jugador.id, espnPlayerId: c.espnPlayerId, thruAnterior: jugador.resultado_en_vivo_thru });
        }
      }

      if (actualizacionesJugadores.length > 0) {
        const { error: upsertError } = await admin.from('jugadores').upsert(actualizacionesJugadores, { onConflict: 'id' });
        if (upsertError) throw new Error(`No se ha podido guardar el resultado en vivo: ${upsertError.message}`);
      }

      if (paraHoyoAHoyo.length > 0) {
        const filasHoyo = await conConcurrenciaLimitada(paraHoyoAHoyo, CONCURRENCIA_HOYOS, async (item) => {
          try {
            const hoyos = await obtenerHoyosJugadorEspn(torneo.tour, torneo.espn_event_id, torneo.temporada, item.espnPlayerId);
            return hoyos.map((h) => ({
              jugador_id: item.jugadorId,
              ronda: h.ronda,
              hoyo: h.hoyo,
              par: h.par,
              golpes: h.golpes,
              campo_id: h.campoId,
              tipo_resultado: tipoResultadoHoyo(h.golpes, h.par),
              actualizado_en: ahora,
            }));
          } catch {
            // Un jugador suelto que falle (nombre no encontrado en
            // playersummary, respuesta rara, etc.) no debe tirar abajo el
            // resto del ciclo.
            return [];
          }
        });

        const todasLasFilas = filasHoyo.flat();
        if (todasLasFilas.length > 0) {
          const { error: hoyosError } = await admin
            .from('resultados_golf_hoyo')
            .upsert(todasLasFilas, { onConflict: 'jugador_id,ronda,hoyo' });
          if (hoyosError) throw new Error(`No se ha podido guardar el hoyo a hoyo: ${hoyosError.message}`);
          resultado.hoyosActualizados = todasLasFilas.length;

          // Con el hoyo a hoyo ya guardado, de paso se intenta rellenar sola
          // la biblioteca de pares de campo para los campos de este ciclo
          // que ya tengan nombre puesto — nunca pisa un campo cargado a mano.
          const campoIdsEsteCiclo = new Set(todasLasFilas.map((f) => f.campo_id));
          await rellenarBibliotecaDesdeEspn(admin, torneo.competicion, campoIdsEsteCiclo);
        }
      }

      resultado.ok = true;
      await admin.from('torneos_golf_live').update({ ultima_actualizacion: ahora, ultimo_error: null }).eq('id', torneo.id);
    } catch (err) {
      const mensaje = (err as Error).message;
      resultado.error = mensaje;
      await admin.from('torneos_golf_live').update({ ultimo_error: mensaje }).eq('id', torneo.id);
    }

    resultados.push(resultado);
  }

  return NextResponse.json({ torneosActivos: torneos.length, resultados });
}
