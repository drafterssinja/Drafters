import { NextRequest, NextResponse } from 'next/server';
import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { normalizarNombre } from '@/lib/nombreMatch';
import { obtenerLeaderboardEspn, obtenerHoyosJugadorEspn, conConcurrenciaLimitada, type EspnTour } from '@/lib/espnGolf';
import {
  obtenerEnJuegoDataGolfParseado,
  obtenerParesPorCampoDataGolf,
  obtenerInfoCampoDataGolf,
  startHoleDesdeEndHole,
  type DataGolfTour,
  type EnJuegoDataGolf,
} from '@/lib/dataGolf';
import { tipoResultadoHoyo, sigueCompitiendo } from '@/lib/golfScoring';
import { liquidarPorrasGolfDeCompeticion } from '@/lib/liquidacionGolfAutomatica';

// Cuánto hay que esperar, UNA VEZ que todos los jugadores que siguen
// compitiendo llevan thru=18 en la última ronda del torneo, antes de dar
// el torneo por terminado de verdad y liquidar las porras de golf solas —
// pedido explícito de Iñi (03/10, segunda vuelta): si hay empate en el
// primer puesto puede haber un playoff (hoyos de muerte súbita) que
// Data Golf no distingue con ningún campo propio ("no sé si esto Data
// Golf... de alguna forma te lo devuelve... habría que buscar eso, pero
// igual lanzar la clasificación final una hora después de que todos los
// jugadores tengan el thru 18"). Al cumplirse la espera, el reparto se
// calcula con los datos de ESE momento (no con los de hace una hora), así
// que si hubo playoff debería estar ya resuelto en current_score/
// current_pos. Ver el bloque "CIERRE AUTOMÁTICO..." en
// drafters-schema.sql para el diseño completo.
const ESPERA_LIQUIDACION_MS = 60 * 60 * 1000;

// Biblioteca de pares de campo (01/10, pedido de Iñi: "si yo lo he puesto a
// mano, pues coges el de a mano, y si no, cuando actualicemos la extracción
// de ESPN, que nos traiga también los pares de cada hoyo") — ver el bloque
// "BIBLIOTECA DE PARES DE CAMPO DE GOLF" en drafters-schema.sql para el
// diseño completo. Aquí se rellena sola a partir de lo que YA se ha
// acumulado en resultados_golf_hoyo (hace falta que algún jugador haya
// completado cada uno de los 18 hoyos). La rama de Data Golf (más abajo)
// NO usa esta función: Data Golf da el par de los 18 hoyos de golpe, desde
// el principio del torneo, sin tener que esperar a que se acumule nada.
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
  // 03/10: para que el admin, al guardar un alias desde un nombre sin
  // emparejar, pueda marcarlo con la fuente real (antes se guardaba
  // siempre como 'espn', aunque el nombre viniera de Data Golf).
  fuenteDatos: 'espn' | 'datagolf';
  ok: boolean;
  jugadoresEnCampo: number;
  jugadoresEmparejados: number;
  nombresSinEmparejar: string[];
  hoyosActualizados: number;
  error?: string;
  // 06/10: aviso (no es un error) cuando Data Golf todavía devuelve OTRO
  // torneo del tour — no se toca ningún jugador. Ver nombreTorneoCoincide().
  aviso?: string;
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

/** ¿El evento que devuelve Data Golf en vivo es esta competición? Compara los
 * nombres normalizados (uno contenido en el otro, el más corto de al menos 8
 * caracteres). Si Data Golf no manda nombre no se puede comprobar y se deja
 * pasar, para no bloquear nada por un dato que falte. */
function nombreTorneoCoincide(competicion: string, eventName: string | null): boolean {
  if (!eventName || !eventName.trim()) return true;
  const a = normalizarNombre(competicion);
  const b = normalizarNombre(eventName);
  if (!a || !b) return true;
  const corto = a.length <= b.length ? a : b;
  const largo = a.length <= b.length ? b : a;
  return corto.length >= 8 && largo.includes(corto);
}

/** Rama ESPN — lógica original de esta ruta (28/09), sin cambios de
 * comportamiento: solo se ha movido a su propia función para poder convivir
 * con la rama de Data Golf de más abajo. Muta `resultado` directamente (en
 * vez de devolverlo) para que el error parcial se vea igual que antes si
 * falla a mitad de camino. */
async function procesarTorneoEspn(
  admin: ReturnType<typeof crearClienteAdmin>,
  torneo: { id: string; competicion: string; tour: EspnTour; espnEventId: string; temporada: number },
  aliasPorNombreOrigen: Map<string, string>,
  resultado: ResultadoTorneo
): Promise<void> {
  const { data: jugadoresData, error: jugadoresError } = await admin
    .from('jugadores')
    .select('id, nombre, resultado_en_vivo_thru')
    .eq('deporte', 'golf')
    .eq('competicion', torneo.competicion);

  if (jugadoresError) throw new Error(`No se han podido leer los jugadores de "${torneo.competicion}": ${jugadoresError.message}`);

  const jugadores = (jugadoresData as { id: string; nombre: string; resultado_en_vivo_thru: number | null }[]) ?? [];
  resultado.jugadoresEnCampo = jugadores.length;

  const jugadorPorNombre = new Map(jugadores.map((j) => [normalizarNombre(j.nombre), j]));

  const competidores = await obtenerLeaderboardEspn(torneo.tour, torneo.espnEventId);

  // CAMBIO 01/10 (tercera vuelta — aviso de Iñi: "null value in column
  // 'nombre' of relation 'jugadores' violates not-null constraint"):
  // el upsert de más abajo solo mandaba el id y los campos de
  // resultado en vivo, dando por hecho que como el id ya existía sería
  // un UPDATE sin más. Pero PostgREST traduce upsert(...) en
  // "INSERT ... ON CONFLICT (id) DO UPDATE SET ...", y Postgres exige
  // que el INSERT que construye por dentro cumpla ya las columnas
  // obligatorias (nombre/deporte/competicion, sin valor por defecto)
  // ANTES de llegar a comprobar el conflicto de id — aunque el
  // resultado final vaya a ser un simple UPDATE. Es exactamente el
  // mismo fallo, en el mismo sitio (un upsert con columnas parciales),
  // que ya se corrigió para fútbol el 25/09 (ver sección 11.11 de
  // DRAFTERS_Arquitectura_Tecnica.md) — aquí no se había aplicado
  // porque esta ruta es más reciente. Arreglado incluyendo también esos
  // tres campos (ya los teníamos en memoria, no hace falta otra
  // consulta) en cada fila del upsert.
  const actualizacionesJugadores: {
    id: string;
    nombre: string;
    deporte: 'golf';
    competicion: string;
    resultado_en_vivo_total: number | null;
    resultado_en_vivo_thru: number | null;
    resultado_en_vivo_ronda: number | null;
    resultado_en_vivo_posicion: string | null;
    resultado_en_vivo_actualizado_en: string;
  }[] = [];

  const paraHoyoAHoyo: { jugadorId: string; espnPlayerId: string; thruAnterior: number | null }[] = [];

  const ahora = new Date().toISOString();

  for (const c of competidores) {
    const nombreNormOrigen = normalizarNombre(c.nombre);
    // 1. Coincidencia exacta tras normalizar. 2. Si no, alias guardado
    // a mano por Iñi desde /admin/resultados-golf (ver más arriba).
    const jugador = jugadorPorNombre.get(nombreNormOrigen) ?? (() => {
      const destino = aliasPorNombreOrigen.get(nombreNormOrigen);
      return destino ? jugadorPorNombre.get(destino) : undefined;
    })();
    if (!jugador) {
      resultado.nombresSinEmparejar.push(c.nombre);
      continue;
    }
    resultado.jugadoresEmparejados += 1;

    actualizacionesJugadores.push({
      id: jugador.id,
      nombre: jugador.nombre,
      deporte: 'golf',
      competicion: torneo.competicion,
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
        const hoyos = await obtenerHoyosJugadorEspn(torneo.tour, torneo.espnEventId, torneo.temporada, item.espnPlayerId);
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
}

// ============================================================================
// PENALIZACIÓN DE JUGADORES QUE NO PASAN EL CORTE (04/10, pedido de Iñi) —
// ver el comentario completo junto a golf_jugadores_corte/golf_max_vuelta_dia
// en drafters-schema.sql para el diseño entero. Resumen: en cuanto un
// jugador aparece con posición 'CUT', se guarda UNA VEZ su resultado real
// hasta ese momento; a partir de ahí, cada ciclo, su resultado en vivo pasa
// a ser ese valor guardado más, por cada ronda que no juega, "la vuelta más
// alta que se está produciendo ese día" + 1 golpe — recalculado en cada
// ciclo, también con la ronda todavía sin terminar.
// ============================================================================
async function aplicarPenalizacionCorte(
  admin: ReturnType<typeof crearClienteAdmin>,
  competicion: string,
  enJuego: EnJuegoDataGolf[],
  rondaActual: number | null,
  jugadores: {
    id: string;
    nombre: string;
    resultado_en_vivo_total: number | null;
    resultado_en_vivo_ronda: number | null;
    resultado_en_vivo_posicion: string | null;
  }[],
  aliasPorNombreOrigen: Map<string, string>,
  ahora: string
): Promise<void> {
  const jugadorPorNombre = new Map(jugadores.map((j) => [normalizarNombre(j.nombre), j]));
  const yaCapturados = new Set<string>();

  // 1. Capturar, solo la primera vez que se ve a cada jugador con posición
  //    'CUT', su resultado real hasta ese momento (total_base) y en qué
  //    ronda se quedó (ronda_corte). Dos fuentes, por este orden:
  //      a) Este ciclo, en vivo (enJuego) — la más fiable, si todavía está.
  //      b) Lo último guardado en la base de datos (jugadores, leído al
  //         principio de procesarTorneoDataGolf, ANTES de los cambios de
  //         este ciclo) — necesaria porque Data Golf puede dejar de mandar
  //         a un jugador cortado en `in-play` según avanza el torneo (muy
  //         probable en rondas ya avanzadas): si ya se le vio 'CUT' en
  //         algún ciclo anterior y quedó guardado, no hace falta volver a
  //         verlo en vivo para empezar a aplicarle la penalización.
  //    `ignoreDuplicates` hace que, si ya existe una fila para ese jugador,
  //    esta llamada no la toque — así el valor capturado nunca se
  //    contamina con la propia penalización de ciclos posteriores.
  const capturas: { jugador_id: string; competicion: string; ronda_corte: number; total_base: number }[] = [];
  for (const c of enJuego) {
    if (!c.posicion || c.posicion.trim().toUpperCase() !== 'CUT') continue;
    if (c.resultadoTotal === null || c.ronda === null) continue; // todavía sin datos fiables de ese jugador — se captura en un ciclo posterior
    const nombreNorm = normalizarNombre(c.nombre);
    const jugador =
      jugadorPorNombre.get(nombreNorm) ??
      (() => {
        const destino = aliasPorNombreOrigen.get(nombreNorm);
        return destino ? jugadorPorNombre.get(destino) : undefined;
      })();
    if (!jugador) continue; // nombre sin emparejar — ya se reporta en resultado.nombresSinEmparejar desde el bucle principal
    capturas.push({ jugador_id: jugador.id, competicion, ronda_corte: c.ronda, total_base: c.resultadoTotal });
    yaCapturados.add(jugador.id);
  }
  for (const j of jugadores) {
    if (yaCapturados.has(j.id)) continue; // ya capturado en vivo arriba, en este mismo ciclo
    if (!j.resultado_en_vivo_posicion || j.resultado_en_vivo_posicion.trim().toUpperCase() !== 'CUT') continue;
    if (j.resultado_en_vivo_total === null || j.resultado_en_vivo_ronda === null) continue;
    capturas.push({ jugador_id: j.id, competicion, ronda_corte: j.resultado_en_vivo_ronda, total_base: j.resultado_en_vivo_total });
  }
  if (capturas.length > 0) {
    const { error: capturaError } = await admin
      .from('golf_jugadores_corte')
      .upsert(capturas, { onConflict: 'jugador_id', ignoreDuplicates: true });
    if (capturaError) throw new Error(`No se ha podido guardar la base de corte: ${capturaError.message}`);
  }

  // 2. Releer TODOS los jugadores con corte ya conocido de esta competición
  //    — no solo los vistos en este ciclo: Data Golf puede dejar de mandar
  //    a un jugador cortado en ciclos siguientes, pero su penalización
  //    tiene que seguir actualizándose igual mientras el torneo avanza.
  const { data: cortesData, error: cortesError } = await admin
    .from('golf_jugadores_corte')
    .select('jugador_id, ronda_corte, total_base')
    .eq('competicion', competicion);
  if (cortesError) throw new Error(`No se han podido leer los jugadores con corte: ${cortesError.message}`);
  const cortes = (cortesData ?? []) as { jugador_id: string; ronda_corte: number; total_base: number }[];
  if (cortes.length === 0 || rondaActual === null) return;

  // 3. Qué rondas hacen falta en total (unión de todas las rondas
  //    posteriores al corte de cada jugador, hasta la ronda actual del
  //    torneo) — una sola consulta por ronda distinta, nunca una por
  //    jugador, aunque haya decenas de jugadores cortados.
  const rondasNecesarias = new Set<number>();
  for (const c of cortes) {
    for (let r = c.ronda_corte + 1; r <= rondaActual; r++) rondasNecesarias.add(r);
  }
  if (rondasNecesarias.size === 0) return;

  const maxPorRonda = new Map<number, number>();
  for (const r of rondasNecesarias) {
    const { data: maxData, error: maxError } = await admin.rpc('golf_max_vuelta_dia', { p_competicion: competicion, p_ronda: r });
    if (maxError) throw new Error(`No se ha podido calcular la vuelta más alta de la ronda ${r}: ${maxError.message}`);
    if (typeof maxData === 'number') maxPorRonda.set(r, maxData);
  }

  // 4. jugadores.nombre/deporte/competicion son NOT NULL — el upsert de
  //    abajo necesita mandarlos aunque no cambien, igual que ya hace el
  //    resto de esta ruta.
  const idsConCorte = cortes.map((c) => c.jugador_id);
  const { data: nombresData, error: nombresError } = await admin.from('jugadores').select('id, nombre').in('id', idsConCorte);
  if (nombresError) throw new Error(`No se han podido leer los nombres de los jugadores con corte: ${nombresError.message}`);
  const nombrePorId = new Map(((nombresData ?? []) as { id: string; nombre: string }[]).map((j) => [j.id, j.nombre]));

  // 5. Desglose día a día (04/10, segunda vuelta — pedido de Iñi: "indicar
  //    cuánto suman en cada vuelta", tanto en la tarjeta del jugador como en
  //    un número al lado de su nombre). Se construye a la vez que el total,
  //    con los mismos maxPorRonda ya calculados arriba, y se guarda en
  //    golf_penalizacion_corte_dia (sí con lectura pública, a diferencia de
  //    golf_jugadores_corte) para que la pantalla de clasificación lo pueda
  //    leer directamente.
  const desgloseDias: { jugador_id: string; ronda: number; golpes_sumados: number; actualizado_en: string }[] = [];

  const actualizaciones = cortes
    .map((c) => {
      const nombre = nombrePorId.get(c.jugador_id);
      if (!nombre) return null; // no debería pasar nunca (clave foránea a jugadores) — red de seguridad
      let penalizacion = 0;
      for (let r = c.ronda_corte + 1; r <= rondaActual; r++) {
        const maxDia = maxPorRonda.get(r);
        // Esa ronda concreta todavía no tiene ni un hoyo jugado por nadie —
        // se penaliza en cuanto lo tenga, en un ciclo posterior.
        if (maxDia === undefined) continue;
        const golpesEseDia = maxDia + 1;
        penalizacion += golpesEseDia;
        desgloseDias.push({ jugador_id: c.jugador_id, ronda: r, golpes_sumados: golpesEseDia, actualizado_en: ahora });
      }
      return {
        id: c.jugador_id,
        nombre,
        deporte: 'golf' as const,
        competicion,
        resultado_en_vivo_total: c.total_base + penalizacion,
        resultado_en_vivo_actualizado_en: ahora,
      };
    })
    .filter((fila): fila is NonNullable<typeof fila> => fila !== null);

  if (actualizaciones.length > 0) {
    const { error: aplicarError } = await admin.from('jugadores').upsert(actualizaciones, { onConflict: 'id' });
    if (aplicarError) throw new Error(`No se ha podido aplicar la penalización de corte: ${aplicarError.message}`);
  }

  if (desgloseDias.length > 0) {
    const { error: desgloseError } = await admin.from('golf_penalizacion_corte_dia').upsert(desgloseDias, { onConflict: 'jugador_id,ronda' });
    if (desgloseError) throw new Error(`No se ha podido guardar el desglose día a día de la penalización de corte: ${desgloseError.message}`);
  }
}

// ============================================================================
// Rama Data Golf (03/10, pedido explícito de Iñi) — el hoyo a hoyo NO viene
// dado por la API (ver cabecera de drafters-schema.sql, bloque "INTEGRACIÓN
// DATA GOLF"): se CALCULA a partir de cuánto cambia el resultado de SOLO la
// ronda de hoy ("today") entre un ciclo de sincronización y el siguiente,
// combinado con el hoyo exacto que se dedujo de "thru" + el hoyo de salida.
// ============================================================================
async function procesarTorneoDataGolf(
  admin: ReturnType<typeof crearClienteAdmin>,
  torneo: {
    id: string;
    competicion: string;
    tourDataGolf: DataGolfTour;
    primeraSalidaEn: string | null;
    rondasTotales: number | null;
    listoParaLiquidarDesde: string | null;
    finalizadoEn: string | null;
  },
  aliasPorNombreOrigen: Map<string, string>,
  resultado: ResultadoTorneo
): Promise<void> {
  const { data: jugadoresData, error: jugadoresError } = await admin
    .from('jugadores')
    // resultado_en_vivo_posicion (04/10) se añade aquí para poder detectar
    // jugadores con corte directamente desde lo último guardado en la base
    // de datos (ver aplicarPenalizacionCorte) — hace falta por si Data Golf
    // deja de mandar a un jugador cortado en el ciclo de `in-play` de este
    // ciclo (lo cual es bastante probable en rondas avanzadas): su último
    // 'CUT' guardado sigue aquí aunque ya no venga en la respuesta en vivo.
    .select('id, nombre, resultado_en_vivo_total, resultado_en_vivo_thru, resultado_en_vivo_ronda, resultado_en_vivo_hoy, resultado_en_vivo_posicion')
    .eq('deporte', 'golf')
    .eq('competicion', torneo.competicion);

  if (jugadoresError) throw new Error(`No se han podido leer los jugadores de "${torneo.competicion}": ${jugadoresError.message}`);

  const jugadores =
    (jugadoresData as {
      id: string;
      nombre: string;
      resultado_en_vivo_total: number | null;
      resultado_en_vivo_thru: number | null;
      resultado_en_vivo_ronda: number | null;
      resultado_en_vivo_hoy: number | null;
      resultado_en_vivo_posicion: string | null;
    }[]) ?? [];
  resultado.jugadoresEnCampo = jugadores.length;

  const jugadorPorNombre = new Map(jugadores.map((j) => [normalizarNombre(j.nombre), j]));

  const enVivoDG = await obtenerEnJuegoDataGolfParseado(torneo.tourDataGolf);

  // PROTECCIÓN CONTRA MEZCLA DE TORNEOS (06/10, aviso de Iñi: "igual me está
  // mezclando y me está transportando jugadores de un torneo a otro").
  // `in-play` está pedido por TOUR, no por torneo: mientras el torneo que
  // acaba de terminar (p.ej. la Dunhill) siga siendo el "en vivo" de Data
  // Golf, devuelve SUS resultados, y como los jugadores se emparejan por
  // nombre, los que repiten en el torneo siguiente (Open de España, aún sin
  // empezar) recibían los resultados del torneo anterior. Ahora solo se
  // actualizan jugadores si el nombre del evento que devuelve Data Golf
  // coincide con esta competición; si no, se salta (sin tocar nada) y se
  // avisa con el nombre que devuelve Data Golf.
  const coincideTorneoEnVivo = nombreTorneoCoincide(torneo.competicion, enVivoDG.eventName);
  if (!coincideTorneoEnVivo) {
    resultado.aviso = `Data Golf todavía devuelve en vivo otro torneo ("${enVivoDG.eventName ?? 'sin nombre'}"), no "${torneo.competicion}" — no se ha actualizado ningún jugador. Se actualizará solo en cuanto Data Golf devuelva este torneo (si no es cuestión de esperar, comprueba que el nombre de la competición coincide con el del torneo en Data Golf).`;
  }
  const enJuego = coincideTorneoEnVivo ? enVivoDG.jugadores : [];
  const rondaActual = coincideTorneoEnVivo ? enVivoDG.rondaActual : null;

  // El par de cada hoyo, por campo — hace falta la ronda en curso para
  // pedirlo (preds/live-hole-stats pide un número de ronda), pero el par en
  // sí es fijo durante todo el torneo. Si todavía no se sabe la ronda
  // actual (torneo recién empezado, antes del primer tee time), se pide la
  // ronda 1 como mejor opción por defecto.
  const paresPorCampo = coincideTorneoEnVivo
    ? await obtenerParesPorCampoDataGolf(torneo.tourDataGolf, (String(rondaActual ?? 1) as '1' | '2' | '3' | '4'))
    : new Map<string, (number | null)[]>();

  // Nombre real de cada campo (Data Golf SÍ lo da, a diferencia de ESPN) —
  // se guarda en campos_golf_live sin que el admin tenga que escribir nada
  // (ver el comentario de esa tabla en drafters-schema.sql). De la MISMA
  // llamada a field-updates sale también la hora de la primera salida del
  // torneo y su nº de rondas (ver obtenerInfoCampoDataGolf) — se usan más
  // abajo para el cierre automático de inscripciones.
  let nombresPorCampo: Map<string, string>;
  let primeraSalidaDetectada: Date | null = null;
  let rondasTotalesDetectadas: number | null = null;
  try {
    const info = await obtenerInfoCampoDataGolf(torneo.tourDataGolf);
    nombresPorCampo = info.nombresPorCampo;
    primeraSalidaDetectada = info.primeraSalida;
    rondasTotalesDetectadas = info.rondasTotales;
  } catch {
    nombresPorCampo = new Map(); // si falla, se sigue sin nombre — nunca debe tirar abajo el resto del ciclo
  }
  if (nombresPorCampo.size > 0) {
    const filasCampo = Array.from(nombresPorCampo.entries()).map(([campo_id, nombre]) => ({
      competicion: torneo.competicion,
      campo_id,
      nombre,
    }));
    await admin.from('campos_golf_live').upsert(filasCampo, { onConflict: 'competicion,campo_id' });
  }

  const actualizacionesJugadores: {
    id: string;
    nombre: string;
    deporte: 'golf';
    competicion: string;
    resultado_en_vivo_total: number | null;
    resultado_en_vivo_thru: number | null;
    resultado_en_vivo_ronda: number | null;
    resultado_en_vivo_posicion: string | null;
    resultado_en_vivo_hoy: number | null;
    resultado_en_vivo_actualizado_en: string;
  }[] = [];

  const filasHoyo: {
    jugador_id: string;
    ronda: number;
    hoyo: number;
    par: number;
    golpes: number;
    campo_id: string | null;
    tipo_resultado: string;
    actualizado_en: string;
  }[] = [];

  const ahora = new Date().toISOString();

  for (const c of enJuego) {
    const nombreNormOrigen = normalizarNombre(c.nombre);
    // 1. Coincidencia exacta tras normalizar. 2. Si no, alias guardado a
    // mano por Iñi desde /admin/resultados-golf (misma tabla que ESPN —
    // alias_nombres_jugador no distingue de qué fuente viene el nombre de
    // origen).
    const jugador = jugadorPorNombre.get(nombreNormOrigen) ?? (() => {
      const destino = aliasPorNombreOrigen.get(nombreNormOrigen);
      return destino ? jugadorPorNombre.get(destino) : undefined;
    })();
    if (!jugador) {
      resultado.nombresSinEmparejar.push(c.nombre);
      continue;
    }
    resultado.jugadoresEmparejados += 1;

    actualizacionesJugadores.push({
      id: jugador.id,
      nombre: jugador.nombre,
      deporte: 'golf',
      competicion: torneo.competicion,
      resultado_en_vivo_total: c.resultadoTotal,
      resultado_en_vivo_thru: c.thru,
      resultado_en_vivo_ronda: c.ronda,
      resultado_en_vivo_posicion: c.posicion,
      resultado_en_vivo_hoy: c.resultadoHoy,
      resultado_en_vivo_actualizado_en: ahora,
    });

    // Intento de atribuir el hoyo jugado desde el último ciclo — ver la
    // cabecera de esta función y el bloque "INTEGRACIÓN DATA GOLF" en
    // drafters-schema.sql para las condiciones exactas. Cualquier cosa que
    // no encaje EXACTAMENTE con "se ha completado un único hoyo nuevo,
    // dentro de la misma ronda, con datos previos fiables" se descarta sin
    // atribuir ningún hoyo (pero el estado del jugador se guarda igual,
    // arriba, para poder comparar en el siguiente ciclo).
    const mismaRonda = c.ronda !== null && jugador.resultado_en_vivo_ronda !== null && c.ronda === jugador.resultado_en_vivo_ronda;
    if (!mismaRonda) continue;

    const thruAnterior = jugador.resultado_en_vivo_thru;
    const hoyAnterior = jugador.resultado_en_vivo_hoy;
    if (c.thru === null || thruAnterior === null || c.resultadoHoy === null || hoyAnterior === null) continue;

    const deltaThru = c.thru - thruAnterior;
    if (deltaThru !== 1) continue; // 0 (nada nuevo) o 2+ (no se puede repartir sin inventar datos) — se descarta

    const startHole = startHoleDesdeEndHole(c.endHole);
    if (startHole === null) continue; // end_hole no era ni 9 ni 18 — formato inesperado, mejor no arriesgar

    const hoyoCompletado = ((startHole - 1 + c.thru - 1) % 18) + 1;
    const pares = c.courseCode ? paresPorCampo.get(c.courseCode) : undefined;
    const par = pares ? pares[hoyoCompletado - 1] : null;
    if (par === null || par === undefined) continue; // todavía no se sabe el par de ESE hoyo concreto

    const golpes = par + (c.resultadoHoy - hoyAnterior);
    filasHoyo.push({
      jugador_id: jugador.id,
      ronda: c.ronda as number,
      hoyo: hoyoCompletado,
      par,
      golpes,
      campo_id: c.courseCode,
      tipo_resultado: tipoResultadoHoyo(golpes, par),
      actualizado_en: ahora,
    });
  }

  if (actualizacionesJugadores.length > 0) {
    const { error: upsertError } = await admin.from('jugadores').upsert(actualizacionesJugadores, { onConflict: 'id' });
    if (upsertError) throw new Error(`No se ha podido guardar el resultado en vivo: ${upsertError.message}`);
  }

  if (filasHoyo.length > 0) {
    const { error: hoyosError } = await admin.from('resultados_golf_hoyo').upsert(filasHoyo, { onConflict: 'jugador_id,ronda,hoyo' });
    if (hoyosError) throw new Error(`No se ha podido guardar el hoyo a hoyo calculado: ${hoyosError.message}`);
    resultado.hoyosActualizados = filasHoyo.length;
  }

  // ==========================================================================
  // PENALIZACIÓN DE JUGADORES QUE NO PASAN EL CORTE (04/10, pedido de Iñi —
  // ver el comentario largo junto a golf_jugadores_corte/golf_max_vuelta_dia
  // en drafters-schema.sql para el diseño completo). Va DESPUÉS de guardar
  // filasHoyo de arriba a propósito, para que golf_max_vuelta_dia() vea ya
  // el hoyo a hoyo de este mismo ciclo al calcular la vuelta más alta de la
  // ronda en curso.
  // ==========================================================================
  await aplicarPenalizacionCorte(admin, torneo.competicion, enJuego, rondaActual, jugadores, aliasPorNombreOrigen, ahora);

  // A diferencia de ESPN, aquí el par de los 18 hoyos de un campo puede
  // conocerse de golpe (sin esperar a que ningún jugador los haya jugado
  // todos) — en cuanto paresPorCampo tiene los 18 completos para un campo
  // ya nombrado, se guarda directo en la biblioteca.
  for (const [campoId, pares] of paresPorCampo) {
    if (pares.length !== 18 || pares.some((p) => p === null)) continue;
    const nombre = nombresPorCampo.get(campoId);
    if (!nombre) continue;
    await admin.rpc('actualizar_par_biblioteca_desde_datagolf', {
      p_nombre: nombre,
      p_nombre_normalizado: normalizarNombre(nombre),
      p_pares: pares,
    });
  }

  // ==========================================================================
  // CIERRE AUTOMÁTICO DE INSCRIPCIONES (ver drafters-schema.sql, bloque
  // "CIERRE AUTOMÁTICO..."): en cuanto se conoce la hora de la primera
  // salida, se cierra (si no estaba ya cerrada a mano) la inscripción de
  // toda porra/mesa de esta competición, 5 minutos antes. Se llama cada
  // ciclo que haya primeraSalidaDetectada — es idempotente (la función SQL
  // solo toca filas con fecha_limite_inscripcion todavía null), así que no
  // hace falta guardar un "ya se aplicó" aparte.
  // BUG encontrado el 04/10 (Iñi: "el torneo de la dunhill ya ha acabado
  // hace horas" y seguía sin marcarse finalizado): `field-updates` está
  // pedido por TOUR (p.ej. "euro"), no por torneo concreto — Data Golf no
  // tiene forma de pedirle "el campo DE ESTE torneo", así que en cuanto el
  // torneo en curso termina, esa misma llamada puede empezar a devolver el
  // campo del SIGUIENTE torneo del tour (con sus propios teetimes, casi
  // siempre arrancando solo con la ronda 1 publicada). Si eso pasa,
  // `rondasTotalesDetectadas` de ESTE ciclo deja de ser 4 (las rondas del
  // torneo que nos importa) y pasa a ser 1 (las del torneo que viene) —
  // y como antes se usaba "lo detectado ahora, o si no lo guardado"
  // (`rondasTotalesDetectadas ?? torneo.rondasTotales`), ese 1 contaminado
  // ganaba y el check de "todos a thru 18 en la última ronda" dejaba de
  // cumplirse para siempre (nadie va a estar en "ronda 1" si ya jugaron
  // las 4), reseteando además el reloj de la espera de liquidación cada
  // ciclo. Arreglo: una vez que se conoce el nº de rondas de ESTE torneo no
  // se vuelve a bajar nunca — ni al guardarlo en la base de datos ni al
  // usarlo aquí mismo — solo puede confirmarse o subir (torneos con
  // amateurs, tipo Dunhill, donde se va descubriendo poco a poco quién
  // juega 4 rondas y quién menos).
  const rondasTotalesParaGuardar =
    rondasTotalesDetectadas !== null && (torneo.rondasTotales === null || rondasTotalesDetectadas > torneo.rondasTotales)
      ? rondasTotalesDetectadas
      : torneo.rondasTotales;

  if (primeraSalidaDetectada && torneo.rondasTotales === null) {
    // La hora de la primera salida, en cambio, solo hace falta fijarla UNA
    // vez (se usa solo para calcular el cierre automático de inscripciones,
    // que ya es idempotente en la propia función SQL) — en cuanto ya se
    // conocen las rondas de este torneo, no hay que seguir recalculándola
    // ciclo a ciclo (y así tampoco se arriesga a que un field-updates ya
    // contaminado con el torneo siguiente la pise).
    await admin
      .from('torneos_golf_live')
      .update({ primera_salida_en: primeraSalidaDetectada.toISOString(), rondas_totales: rondasTotalesParaGuardar })
      .eq('id', torneo.id);

    const cierre = new Date(primeraSalidaDetectada.getTime() - 5 * 60 * 1000);
    await admin.rpc('aplicar_cierre_automatico_inscripciones', {
      p_competicion: torneo.competicion,
      p_cierre: cierre.toISOString(),
    });
  } else if (rondasTotalesParaGuardar !== torneo.rondasTotales) {
    // Solo ha cambiado (subido) el nº de rondas detectadas — no hace falta
    // tocar primera_salida_en, que ya está fijada.
    await admin.from('torneos_golf_live').update({ rondas_totales: rondasTotalesParaGuardar }).eq('id', torneo.id);
  }

  // ==========================================================================
  // DETECCIÓN DE "TORNEO TERMINADO" Y LIQUIDACIÓN AUTOMÁTICA (solo porras
  // de golf — ver lib/liquidacionGolfAutomatica.ts y el comentario largo de
  // ESPERA_LIQUIDACION_MS, arriba del todo de este archivo).
  const rondasTotalesEfectivo = rondasTotalesParaGuardar;
  if (rondasTotalesEfectivo !== null && torneo.finalizadoEn === null) {
    // Estado de cada jugador tras ESTE ciclo: el de la base de datos, con
    // los que se han actualizado ahora mismo (actualizacionesJugadores) por
    // encima — sin otra consulta aparte.
    const actualizacionesPorId = new Map(actualizacionesJugadores.map((a) => [a.id, a]));
    const estadoActual = jugadores.map((j) => {
      const act = actualizacionesPorId.get(j.id);
      return {
        posicion: act ? act.resultado_en_vivo_posicion : null,
        total: act ? act.resultado_en_vivo_total : j.resultado_en_vivo_total,
        ronda: act ? act.resultado_en_vivo_ronda : j.resultado_en_vivo_ronda,
        thru: act ? act.resultado_en_vivo_thru : j.resultado_en_vivo_thru,
      };
    });

    // 06/10: el nº de rondas guardado nunca puede ser menor que la ronda más
    // alta que ya se ha visto jugar a alguien. Si por la contaminación de
    // field-updates (ver más arriba) se hubiera guardado un valor demasiado
    // bajo (p.ej. 1), el torneo no se daba por terminado NUNCA, porque nadie
    // estaba "en la ronda 1" con thru 18 (caso de la Alfred Dunhill, que
    // seguía sin cerrarse dos días después de acabar).
    const maxRondaVista = estadoActual.reduce((m, j) => (j.ronda !== null && j.ronda > m ? j.ronda : m), 0);
    const rondasFinal = Math.max(rondasTotalesEfectivo, maxRondaVista);
    if (rondasFinal !== rondasTotalesEfectivo) {
      await admin.from('torneos_golf_live').update({ rondas_totales: rondasFinal }).eq('id', torneo.id);
    }

    // 06/10: se ignora a quien tiene resultado pero NINGÚN dato de ronda/hoyo
    // (ronda y thru vacíos, posición vacía): Data Golf lo ha dejado sin
    // estado (típico de una retirada) y nunca va a "terminar" la ronda, lo
    // que bloqueaba el cierre de la Dunhill (un solo jugador, Follett-Smith,
    // con ronda/hoyo/posición vacíos, impedía que se diera por acabado).
    const activos = estadoActual.filter((j) => j.total !== null && j.ronda !== null && sigueCompitiendo(j.posicion));
    const todosListos = activos.length > 0 && activos.every((j) => j.ronda === rondasFinal && j.thru === 18);

    if (todosListos) {
      if (!torneo.listoParaLiquidarDesde) {
        await admin.from('torneos_golf_live').update({ listo_para_liquidar_desde: new Date().toISOString() }).eq('id', torneo.id);
      } else {
        const transcurrido = Date.now() - new Date(torneo.listoParaLiquidarDesde).getTime();
        if (transcurrido >= ESPERA_LIQUIDACION_MS) {
          await liquidarPorrasGolfDeCompeticion(admin, torneo.competicion);
          await admin.from('torneos_golf_live').update({ finalizado_en: new Date().toISOString() }).eq('id', torneo.id);
        }
      }
    } else if (torneo.listoParaLiquidarDesde) {
      // Ya no están todos a thru=18 en la última ronda (dato que había
      // cambiado, o un ciclo raro) — se descarta el reloj, nunca se liquida
      // con un "listo" que resultó no serlo.
      await admin.from('torneos_golf_live').update({ listo_para_liquidar_desde: null }).eq('id', torneo.id);
    }
  }
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

  // 05/10: un torneo ya finalizado (finalizado_en puesto) NO se vuelve a
  // sincronizar. Las llamadas de Data Golf son por TOUR: en cuanto empieza el
  // torneo siguiente, seguir sincronizando el anterior le pisaría su
  // clasificación final con los resultados del nuevo (los jugadores que
  // repiten se emparejan por nombre).
  const { data: torneosData, error: torneosError } = await admin.from('torneos_golf_live').select('*').eq('activo', true).is('finalizado_en', null);
  if (torneosError) {
    return NextResponse.json({ error: `No se han podido leer los torneos activos: ${torneosError.message}` }, { status: 500 });
  }

  const torneos = (torneosData as {
    id: string;
    competicion: string;
    fuente_datos: 'espn' | 'datagolf';
    tour: EspnTour | null;
    espn_event_id: string | null;
    temporada: number | null;
    tour_datagolf: DataGolfTour | null;
    rondas_totales: number | null;
    listo_para_liquidar_desde: string | null;
    finalizado_en: string | null;
  }[]) ?? [];

  const resultados: ResultadoTorneo[] = [];

  // Alias de nombre de jugador (nuevo, 01/10 — pedido de Iñi: "hay que
  // buscar la forma de que de los que no encuentre [se puedan emparejar]").
  // Se cargan una sola vez para todos los torneos de este ciclo (no cambian
  // de un torneo a otro): ver el bloque "ALIAS DE NOMBRES DE JUGADOR" en
  // drafters-schema.sql para el porqué de guardar nombre->nombre en vez de
  // nombre->jugador_id. nombre_normalizado_origen -> nombre_normalizado_destino.
  const { data: aliasData } = await admin
    .from('alias_nombres_jugador')
    .select('nombre_normalizado_origen, nombre_normalizado_destino')
    .eq('deporte', 'golf');
  const aliasPorNombreOrigen = new Map(
    ((aliasData as { nombre_normalizado_origen: string; nombre_normalizado_destino: string }[]) ?? []).map((a) => [
      a.nombre_normalizado_origen,
      a.nombre_normalizado_destino,
    ])
  );

  for (const torneo of torneos) {
    const resultado: ResultadoTorneo = {
      competicion: torneo.competicion,
      fuenteDatos: torneo.fuente_datos,
      ok: false,
      jugadoresEnCampo: 0,
      jugadoresEmparejados: 0,
      nombresSinEmparejar: [],
      hoyosActualizados: 0,
    };

    try {
      if (torneo.fuente_datos === 'datagolf') {
        if (!torneo.tour_datagolf) throw new Error('Torneo marcado como fuente_datos=datagolf sin tour_datagolf.');
        await procesarTorneoDataGolf(
          admin,
          {
            id: torneo.id,
            competicion: torneo.competicion,
            tourDataGolf: torneo.tour_datagolf,
            primeraSalidaEn: null, // no se necesita leer el valor guardado: cada ciclo lo vuelve a calcular (y a guardar) desde field-updates
            rondasTotales: torneo.rondas_totales,
            listoParaLiquidarDesde: torneo.listo_para_liquidar_desde,
            finalizadoEn: torneo.finalizado_en,
          },
          aliasPorNombreOrigen,
          resultado
        );
      } else {
        if (!torneo.tour || !torneo.espn_event_id || torneo.temporada === null) {
          throw new Error('Torneo marcado como fuente_datos=espn sin tour/espn_event_id/temporada.');
        }
        await procesarTorneoEspn(
          admin,
          { id: torneo.id, competicion: torneo.competicion, tour: torneo.tour, espnEventId: torneo.espn_event_id, temporada: torneo.temporada },
          aliasPorNombreOrigen,
          resultado
        );
      }

      resultado.ok = true;
      await admin
        .from('torneos_golf_live')
        .update({ ultima_actualizacion: new Date().toISOString(), ultimo_error: null })
        .eq('id', torneo.id);
    } catch (err) {
      const mensaje = (err as Error).message;
      resultado.error = mensaje;
      await admin.from('torneos_golf_live').update({ ultimo_error: mensaje }).eq('id', torneo.id);
    }

    resultados.push(resultado);
  }

  return NextResponse.json({ torneosActivos: torneos.length, resultados });
}
