import type { SupabaseClient } from '@supabase/supabase-js';
import {
  obtenerCuotasOutrightsDataGolf,
  obtenerCampoDataGolf,
  campoDesdeRespuesta,
  infoCampoDesdeRespuesta,
  reordenarNombreDataGolf,
  type CampoDataGolf,
  type DataGolfTour,
} from '@/lib/dataGolf';
import { normalizarNombre } from '@/lib/nombreMatch';
import { calcularPreciosPorCuota, cuotaValida } from '@/lib/precioPorCuota';
import { calcularGrupoPorra } from '@/lib/porraGrupos';
import { generarSalasParaTorneo } from '@/lib/tiposDeSala';

// ============================================================================
// CREACIÓN AUTOMÁTICA DE PORRA + MESAS DE GOLF DESDE DATA GOLF (05/10)
// ============================================================================
// Pedido de Iñi: en cuanto Data Golf publique las cuotas del próximo torneo
// (DP World Tour o PGA Tour), crear sola la porra y las mesas Drafters, en
// BORRADOR (publicada = false: ocultas para todo el mundo y sin correos, ver
// el bloque "CREACIÓN AUTOMÁTICA..." de drafters-schema.sql). Iñi solo marca
// a los españoles y publica, desde /admin/porras-golf.
//
// FORMAS CONFIRMADAS el 05/10 contra respuestas reales:
//  - field-updates (campo, país, fechas, nombre del torneo): ver
//    campoDesdeRespuesta() en lib/dataGolf.ts. País en `country` ("ESP").
//  - betting-tools/outrights: raíz con event_name, market, books_offering,
//    notes, last_updated y `odds`: lista de {dg_id, player_name, datagolf:
//    {baseline, baseline_history_fit}, <casa>: cuota decimal...} — las casas
//    que no ofrecen cuota a un jugador simplemente no aparecen en su objeto.
//
// TRAMPA DESCUBIERTA EN ESA MISMA PRUEBA: ambos endpoints son por TOUR, no
// por torneo, y NO cambian de torneo a la vez — el 05/10 field-updates ya
// devolvía el Open de España mientras outrights seguía devolviendo la
// Dunhill (con notes "Tournament is live"). Por eso aquí NUNCA se usan las
// cuotas si no son del MISMO torneo que el campo (ver mismoTorneo()).

const MIN_JUGADORES_CON_CUOTA = 20; // por debajo de esto se considera "todavía no hay cuotas de verdad"
const PRECIO_ENTRADA_PORRA_POR_DEFECTO = 20; // mismo valor por defecto que el formulario de /admin/porras-golf

type Admin = SupabaseClient;

export type EstadoCreacion = 'creado' | 'sin_cuotas' | 'ya_existe' | 'torneo_empezado' | 'error';

export type ResultadoCreacionTour = {
  tour: DataGolfTour;
  evento: string | null;
  estado: EstadoCreacion;
  detalle: string;
};

type JugadorConCuotaDG = { dgId: number | null; nombre: string; cuota: number };

function aNumero(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Casa de apuestas de la que se toma la cuota (pedido de Iñi, 05/10: "para
 * las cuotas cogeremos las de bet365"). Es la clave tal cual aparece en cada
 * jugador de `odds` (cuota decimal). Un jugador al que bet365 no ofrece
 * precio no tiene cuota -> se le pone el precio mínimo, igual que en el
 * formulario manual (sin mezclar otras casas). */
export const CASA_CUOTAS = 'bet365';

/** Cuota decimal de bet365 para cada jugador de la lista `odds` de
 * betting-tools/outrights (forma confirmada, ver cabecera). */
export function extraerCuotasDeOutrights(data: unknown): { eventName: string | null; jugadores: JugadorConCuotaDG[] } {
  const d = data as any;
  const lista: any[] = Array.isArray(d?.odds) ? d.odds : [];
  const eventName = typeof d?.event_name === 'string' && d.event_name.trim() ? d.event_name.trim() : null;

  const jugadores: JugadorConCuotaDG[] = [];
  for (const j of lista) {
    const nombreRaw = j?.player_name;
    if (typeof nombreRaw !== 'string' || !nombreRaw.trim()) continue;
    const cuota = aNumero(j?.[CASA_CUOTAS]);
    if (cuota === null || !cuotaValida(cuota)) continue;
    jugadores.push({ dgId: aNumero(j?.dg_id), nombre: reordenarNombreDataGolf(nombreRaw), cuota });
  }
  return { eventName, jugadores };
}

/** ¿Las cuotas son del mismo torneo que el campo? Por nombre (uno contenido
 * en el otro, ya normalizados) o, si el nombre no coincide, solo cuando casi
 * todos los jugadores con cuota están en el campo (>= 90%). */
function mismoTorneo(campo: CampoDataGolf, cuotas: { eventName: string | null; jugadores: JugadorConCuotaDG[] }): boolean {
  if (campo.eventName && cuotas.eventName) {
    const a = normalizarNombre(campo.eventName);
    const b = normalizarNombre(cuotas.eventName);
    if (a === b || a.includes(b) || b.includes(a)) return true;
  }
  if (cuotas.jugadores.length === 0) return false;
  const idsCampo = new Set(campo.jugadores.map((j) => j.dgId).filter((x): x is number => x !== null));
  const enCampo = cuotas.jugadores.filter((j) => j.dgId !== null && idsCampo.has(j.dgId)).length;
  return enCampo / cuotas.jugadores.length >= 0.9;
}

async function crearBorrador(
  admin: Admin,
  tour: DataGolfTour,
  nombreTorneo: string,
  campo: CampoDataGolf,
  cuotas: JugadorConCuotaDG[],
  primeraSalida: Date | null
): Promise<string> {
  // El campo (sin aficionados) es la lista de jugadores; la cuota sale de
  // outrights por dg_id (o por nombre normalizado, de respaldo). Sin cuota =
  // precio mínimo, igual que en el formulario manual.
  const cuotaPorId = new Map<number, number>();
  const cuotaPorNombre = new Map<string, number>();
  for (const c of cuotas) {
    if (c.dgId !== null) cuotaPorId.set(c.dgId, c.cuota);
    cuotaPorNombre.set(normalizarNombre(c.nombre), c.cuota);
  }

  const jugadoresCampo = campo.jugadores
    .filter((j) => !j.esAficionado)
    .map((j, i) => ({
      i,
      nombre: j.nombre,
      esEspanol: j.pais === 'ESP',
      cuota: (j.dgId !== null ? cuotaPorId.get(j.dgId) : undefined) ?? cuotaPorNombre.get(normalizarNombre(j.nombre)) ?? null,
    }));

  const conPrecio = calcularPreciosPorCuota(jugadoresCampo.map((j) => ({ nombre: j.nombre, cuota: j.cuota })));

  // Puesto para el grupo de color: primero los que tienen cuota (de menor a
  // mayor), luego el resto en el orden del campo.
  const orden = [...jugadoresCampo].sort((a, b) => {
    const av = cuotaValida(a.cuota);
    const bv = cuotaValida(b.cuota);
    if (av && bv) return (a.cuota as number) - (b.cuota as number);
    if (av) return -1;
    if (bv) return 1;
    return a.i - b.i;
  });
  const puestoPorIndice = new Map<number, number>();
  orden.forEach((j, idx) => puestoPorIndice.set(j.i, idx + 1));

  const numEspanoles = jugadoresCampo.filter((j) => j.esEspanol).length;
  const filas = jugadoresCampo.map((j, idx) => ({
    nombre: j.nombre,
    deporte: 'golf' as const,
    competicion: nombreTorneo,
    precio: conPrecio[idx].precio,
    grupo_porra: calcularGrupoPorra(puestoPorIndice.get(j.i) ?? idx + 1, j.esEspanol, numEspanoles),
    es_espanol: j.esEspanol,
  }));

  const { error: jugadoresError } = await admin.from('jugadores').insert(filas);
  if (jugadoresError) throw new Error(`No se han podido guardar los jugadores: ${jugadoresError.message}`);

  // Cierre de inscripciones: 5 minutos antes de la primera salida si ya se
  // conoce; si no (todavía sin teetimes), null — y se rellena solo cuando la
  // sincronización en vivo la detecte (necesita la fila de torneos_golf_live
  // de abajo).
  const fechaLimiteIso = primeraSalida ? new Date(primeraSalida.getTime() - 5 * 60 * 1000).toISOString() : null;

  const { error: porraError } = await admin.from('porras').insert({
    major: nombreTorneo,
    competicion: nombreTorneo,
    fecha_limite_inscripcion: fechaLimiteIso,
    estado: 'disponible',
    precio: PRECIO_ENTRADA_PORRA_POR_DEFECTO,
    formato: 'clasica',
    publicada: false,
  });
  if (porraError) throw new Error(`No se ha podido crear la porra: ${porraError.message}`);

  const salas = generarSalasParaTorneo({ competicionLabel: nombreTorneo, deporte: 'golf', fechaLimiteIso }).map((s) => ({
    ...s,
    publicada: false,
    // Para las pestañas PGA Tour / DP World Tour de /salas.
    circuito: tour === 'pga' ? 'pga' : 'eur',
  }));
  const { error: salasError } = await admin.from('salas').insert(salas);
  if (salasError) throw new Error(`No se han podido crear las mesas: ${salasError.message}`);

  // Conectar el torneo a la sincronización en vivo (resultados + cierre
  // automático de inscripciones). Si ya hay otro torneo ACTIVO y sin
  // finalizar en ese mismo tour, este se crea desactivado para no mezclar dos
  // torneos sobre las mismas llamadas por tour — se activa a mano en
  // /admin/resultados-golf cuando el anterior termine.
  let avisoSync = '';
  const { data: otrosActivos } = await admin
    .from('torneos_golf_live')
    .select('id')
    .eq('fuente_datos', 'datagolf')
    .eq('tour_datagolf', tour)
    .eq('activo', true)
    .is('finalizado_en', null);
  const hayOtroActivo = (otrosActivos?.length ?? 0) > 0;
  const { error: liveError } = await admin.from('torneos_golf_live').upsert(
    { competicion: nombreTorneo, fuente_datos: 'datagolf', tour_datagolf: tour, activo: !hayOtroActivo },
    { onConflict: 'competicion', ignoreDuplicates: true }
  );
  if (liveError) avisoSync = ` (no se ha podido conectar a resultados en vivo: ${liveError.message})`;
  else if (hayOtroActivo) avisoSync = ' Resultados en vivo creado DESACTIVADO: hay otro torneo de este tour todavía activo — actívalo cuando termine.';

  return `${filas.length} jugadores (${numEspanoles} marcados como españoles por su país, ${filas.filter((_, i) => jugadoresCampo[i].cuota === null).length} sin cuota).${avisoSync}${fechaLimiteIso ? '' : ' Sin fecha límite todavía: se pondrá sola 5 minutos antes de la primera salida en cuanto Data Golf publique las horas.'}`;
}

/** Nombres de torneo ya existentes en la app (porras y mesas) que son el MISMO
 * torneo que `nombreTorneo` aunque estén escritos distinto — p.ej. Iñi crea a
 * mano "Open de España" y Data Golf lo llama "Open de España presented by
 * Madrid". Se consideran el mismo si, ya normalizados, uno contiene al otro
 * (y el más corto tiene al menos 8 caracteres, para no emparejar nombres
 * genéricos por casualidad). Incluye siempre el nombre exacto de Data Golf. */
async function nombresEquivalentesExistentes(admin: Admin, nombreTorneo: string): Promise<string[]> {
  const objetivo = normalizarNombre(nombreTorneo);
  const encontrados = new Set<string>();

  const { data: porras } = await admin.from('porras').select('competicion, major');
  const { data: salas } = await admin.from('salas').select('competicion').eq('deporte', 'golf');
  const candidatos: string[] = [];
  for (const p of (porras as { competicion: string | null; major: string | null }[] | null) ?? []) {
    if (p.competicion) candidatos.push(p.competicion);
    else if (p.major) candidatos.push(p.major);
  }
  for (const sala of (salas as { competicion: string | null }[] | null) ?? []) {
    if (sala.competicion) candidatos.push(sala.competicion);
  }

  for (const c of candidatos) {
    const n = normalizarNombre(c);
    const corto = n.length <= objetivo.length ? n : objetivo;
    if (corto.length < 8) {
      if (n === objetivo) encontrados.add(c);
      continue;
    }
    if (n === objetivo || n.includes(objetivo) || objetivo.includes(n)) encontrados.add(c);
  }
  return Array.from(encontrados);
}

async function procesarTour(admin: Admin, tour: DataGolfTour): Promise<ResultadoCreacionTour> {
  const base = { tour, evento: null as string | null };

  // 1. Campo del torneo actual/próximo del tour (nombre, fechas, países).
  let campo: CampoDataGolf;
  let primeraSalida: Date | null = null;
  try {
    const respuestaCampo = await obtenerCampoDataGolf(tour);
    campo = campoDesdeRespuesta(respuestaCampo);
    primeraSalida = infoCampoDesdeRespuesta(respuestaCampo).primeraSalida;
  } catch (err) {
    return { ...base, estado: 'error', detalle: `No se ha podido pedir el campo: ${(err as Error).message}` };
  }
  if (!campo.eventName || campo.jugadores.length === 0) {
    return { ...base, estado: 'sin_cuotas', detalle: 'field-updates no trae nombre de torneo o campo todavía.' };
  }
  const nombreTorneo = campo.eventName;
  base.evento = nombreTorneo;

  // 1b. CIERRE AUTOMÁTICO DE INSCRIPCIONES (pedido de Iñi, 05/10): en cuanto
  // Data Golf publica la hora de la primera salida, se fija la fecha límite de
  // inscripción de la porra y de las mesas de este torneo 5 minutos antes —
  // sin depender de que la fila de resultados en vivo esté activa. Se hace en
  // cada ciclo, antes de nada y aunque el torneo ya exista o ya esté
  // publicado: la función SQL es idempotente (solo toca filas con
  // fecha_limite_inscripcion todavía vacía, así que nunca pisa una fecha
  // puesta a mano) y si todavía no existe porra/mesas no hace nada — al
  // crearlas más abajo ya llevan la fecha si se conoce.
  // Torneos ya existentes que son este mismo (aunque Iñi los haya llamado
  // distinto, p.ej. "Open de España" a secas): el cierre se aplica a todos, y
  // más abajo su existencia impide crear nada encima (nunca se sobrescribe lo
  // cargado a mano).
  const nombresEquivalentes = await nombresEquivalentesExistentes(admin, nombreTorneo);

  if (primeraSalida) {
    const cierreIso = new Date(primeraSalida.getTime() - 5 * 60 * 1000).toISOString();
    for (const nombre of new Set([nombreTorneo, ...nombresEquivalentes])) {
      await admin.rpc('aplicar_cierre_automatico_inscripciones', { p_competicion: nombre, p_cierre: cierreIso });
    }
  }

  // 2. No crear nada de un torneo que ya ha empezado.
  const hoy = new Date().toISOString().slice(0, 10);
  if ((primeraSalida && primeraSalida.getTime() <= Date.now()) || (campo.fechaInicio && campo.fechaInicio <= hoy)) {
    return { ...base, estado: 'torneo_empezado', detalle: 'El torneo ya ha empezado (o empieza hoy) — no se crea.' };
  }

  // 3. Cuotas — y comprobar que son DE ESTE torneo (ver cabecera).
  let cuotas: { eventName: string | null; jugadores: JugadorConCuotaDG[] };
  try {
    cuotas = extraerCuotasDeOutrights(await obtenerCuotasOutrightsDataGolf(tour, 'win'));
  } catch (err) {
    return { ...base, estado: 'sin_cuotas', detalle: `No se han podido pedir las cuotas: ${(err as Error).message}` };
  }
  if (!mismoTorneo(campo, cuotas)) {
    return { ...base, estado: 'sin_cuotas', detalle: `Las cuotas todavía son de otro torneo ("${cuotas.eventName ?? 'sin nombre'}") — se espera a que Data Golf publique las de "${nombreTorneo}".` };
  }
  const idsCampo = new Set(campo.jugadores.map((j) => j.dgId).filter((x): x is number => x !== null));
  const cuotasDelCampo = cuotas.jugadores.filter((j) => j.dgId !== null && idsCampo.has(j.dgId));
  if (cuotasDelCampo.length < MIN_JUGADORES_CON_CUOTA) {
    return { ...base, estado: 'sin_cuotas', detalle: `Solo ${cuotasDelCampo.length} jugadores del campo con cuota (mínimo ${MIN_JUGADORES_CON_CUOTA}) — todavía no hay cuotas completas.` };
  }

  // 4. Ya existe (creado a mano o por un ciclo anterior, incluso si luego se
  // borró): no se vuelve a crear nunca.
  const clave = `${tour}|${nombreTorneo}`;
  const { data: yaProcesado } = await admin.from('golf_autocreacion_torneos').select('clave').eq('clave', clave).maybeSingle();
  if (yaProcesado) return { ...base, estado: 'ya_existe', detalle: 'Ya procesado en un ciclo anterior.' };

  // Ya hay porra/mesas de este torneo (con el nombre de Data Golf o con otro
  // equivalente cargado a mano) o jugadores con ese nombre: NO se crea nada
  // ni se toca nada — pedido de Iñi (05/10): las cuotas reales de Data Golf
  // nunca deben sobrescribir lo que ya se publicó a mano.
  const { count: jugadoresExistentes } = await admin
    .from('jugadores')
    .select('id', { count: 'exact', head: true })
    .eq('deporte', 'golf')
    .eq('competicion', nombreTorneo);
  if (nombresEquivalentes.length > 0 || (jugadoresExistentes ?? 0) > 0) {
    await admin.from('golf_autocreacion_torneos').upsert({ clave, tour, nombre: nombreTorneo }, { onConflict: 'clave' });
    return { ...base, estado: 'ya_existe', detalle: `Ya existe este torneo en la app${nombresEquivalentes.length > 0 ? ` ("${nombresEquivalentes[0]}")` : ''} — no se crea ni se modifica nada.` };
  }

  // Se reserva la clave ANTES de crear, para que dos ciclos solapados no
  // creen el torneo dos veces (la clave primaria hace de cerrojo).
  const { error: claveError } = await admin.from('golf_autocreacion_torneos').insert({ clave, tour, nombre: nombreTorneo });
  if (claveError) return { ...base, estado: 'ya_existe', detalle: 'Otro ciclo se está encargando de este torneo.' };

  try {
    const resumen = await crearBorrador(admin, tour, nombreTorneo, campo, cuotas.jugadores, primeraSalida);

    // Aviso en la zona de notificaciones para cada admin (pedido de Iñi,
    // 05/10). Si falla, NO se deshace nada: el borrador ya está creado y el
    // aviso es solo un extra.
    try {
      const { data: admins } = await admin.from('perfiles').select('id').eq('rol', 'admin');
      if (admins && admins.length > 0) {
        await admin.from('notificaciones').insert(
          admins.map((a: { id: string }) => ({
            usuario_id: a.id,
            tipo: 'borrador_golf',
            titulo: 'Nuevo torneo de golf listo para revisar',
            mensaje: `Se han creado en borrador la porra y las mesas de "${nombreTorneo}". ${resumen} Revisa los españoles y publícalo cuando quieras: hasta entonces está oculto y no se manda ningún correo.`,
            link: '/admin/porras-golf',
          }))
        );
      }
    } catch {
      // el aviso es opcional
    }

    return { ...base, estado: 'creado', detalle: `Borrador creado: ${resumen} Pendiente de revisar y publicar.` };
  } catch (err) {
    // Se deshace lo que se haya podido crear y se libera la clave, para que
    // el siguiente ciclo lo reintente limpio.
    await admin.from('torneos_golf_live').delete().eq('competicion', nombreTorneo).is('ultima_actualizacion', null);
    await admin.from('salas').delete().eq('competicion', nombreTorneo).eq('publicada', false);
    await admin.from('porras').delete().eq('competicion', nombreTorneo).eq('publicada', false);
    await admin.from('jugadores').delete().eq('deporte', 'golf').eq('competicion', nombreTorneo);
    await admin.from('golf_autocreacion_torneos').delete().eq('clave', clave);
    return { ...base, estado: 'error', detalle: (err as Error).message };
  }
}

/** Un ciclo completo: revisa DP World Tour y PGA Tour. */
export async function crearGolfDesdeDataGolf(admin: Admin): Promise<ResultadoCreacionTour[]> {
  const tours: DataGolfTour[] = ['euro', 'pga'];
  const resultados: ResultadoCreacionTour[] = [];
  for (const tour of tours) {
    resultados.push(await procesarTour(admin, tour));
  }
  return resultados;
}
