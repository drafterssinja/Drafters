import type { crearClienteAdmin } from './supabaseAdmin';
import { calcularReparto, repartirPremiosConEmpates, type TipoSala } from '@/lib/repartoPremios';
import { parteParaPremios } from '@/lib/salaShared';

// ============================================================================
// LIQUIDAR TODAS LAS MESAS DE UNA JORNADA / TORNEO DE GOLPE (12/10)
// ============================================================================
// Pedido de Iñi: en Pagos pendientes, antes del listado mesa a mesa, un
// bloque por competición ("LaLiga - Jornada 8 pendiente de liquidar") con un
// botón que liquida TODAS sus mesas a la vez, con la misma regla que la
// ficha individual:
//   - Solo cuentan las mesas que se han jugado: con al menos un equipo con
//     inscripción no reembolsada (las vacías no tienen nada que repartir).
//   - Fútbol: total del equipo = suma de puntos de futbol_puntos_jugador.
//   - Golf:   total del equipo = suma de puntos de golf_puntos_jugador.
//   - Más puntos = mejor; empatados reparten (repartirPremiosConEmpates).
//   - Bote = parte para premios del buy-in × equipos; tramos por tipo/aforo.
// Antes de repartir comprueba que la competición haya terminado (todos los
// partidos finalizados / torneo de golf dado por terminado). Si no, devuelve
// el motivo y solo liquida si el admin lo fuerza.

type Admin = ReturnType<typeof crearClienteAdmin>;

type SalaRow = { id: string; nombre: string; tipo: TipoSala; aforo: number | null; buy_in: number; deporte: string; competicion: string };
type EquipoRow = { id: string; sala_id: string; jugadores: string[] | null; inscripciones: { estado: string }[] };

export type ResultadoMesa = { salaId: string; nombre: string; ok: boolean; motivo: string };
export type ResultadoCompeticion = {
  listo: boolean;
  motivoNoListo: string | null;
  mesasJugadas: number;
  equipos: number;
  liquidadas: number;
  resultados: ResultadoMesa[];
};

async function todasLasFilas<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta(desde, desde + 999);
    if (error) throw new Error(error.message);
    const lote = (data as T[]) ?? [];
    filas.push(...lote);
    if (lote.length < 1000) break;
  }
  return filas;
}

export async function mesasJugadasPendientes(admin: Admin, competicion: string) {
  const salas = await todasLasFilas<SalaRow>((d, h) =>
    admin.from('salas').select('id,nombre,tipo,aforo,buy_in,deporte,competicion').eq('competicion', competicion).range(d, h)
  );
  const liquidadas = await todasLasFilas<{ sala_id: string }>((d, h) =>
    admin.from('liquidaciones').select('sala_id').eq('tipo', 'sala').not('sala_id', 'is', null).range(d, h)
  );
  const yaLiquidadas = new Set(liquidadas.map((l) => l.sala_id));
  const pendientes = salas.filter((s) => !yaLiquidadas.has(s.id));
  if (pendientes.length === 0) return { mesas: [] as { sala: SalaRow; equipos: EquipoRow[] }[] };

  const equipos: EquipoRow[] = [];
  for (let i = 0; i < pendientes.length; i += 150) {
    const ids = pendientes.slice(i, i + 150).map((s) => s.id);
    const lote = await todasLasFilas<EquipoRow>((d, h) =>
      admin.from('equipos').select('id,sala_id,jugadores,inscripciones(estado)').in('sala_id', ids).range(d, h)
    );
    equipos.push(...lote);
  }
  const activosPorSala = new Map<string, EquipoRow[]>();
  for (const e of equipos) {
    if (!e.inscripciones.some((ins) => ins.estado !== 'reembolsada')) continue;
    const lista = activosPorSala.get(e.sala_id) ?? [];
    lista.push(e);
    activosPorSala.set(e.sala_id, lista);
  }
  const mesas = pendientes
    .filter((s) => (activosPorSala.get(s.id) ?? []).length > 0)
    .map((s) => ({ sala: s, equipos: activosPorSala.get(s.id) as EquipoRow[] }));
  return { mesas };
}

async function comprobarTerminada(admin: Admin, deporte: string, competicion: string): Promise<string | null> {
  if (deporte === 'futbol') {
    const partidos = await todasLasFilas<{ estado: string; actualizado: boolean; descartado: boolean | null }>((d, h) =>
      admin.from('futbol_partidos_jornada').select('estado,actualizado,descartado').eq('competicion', competicion).range(d, h)
    );
    if (partidos.length === 0) return 'No hay partidos cargados para esta jornada.';
    // 12/10: los aplazados para más tarde quedan "descartados" (0 puntos) al
    // terminar la jornada; hasta entonces cuentan como pendientes.
    const faltan = partidos.filter((p) => !p.descartado && !(p.estado === 'finalizado' && p.actualizado)).length;
    return faltan > 0 ? `Faltan ${faltan} de ${partidos.length} partidos por terminar o por tener los puntos definitivos.` : null;
  }
  if (deporte === 'golf') {
    const { data: torneo } = await admin.from('torneos_golf_live').select('finalizado_en').eq('competicion', competicion).maybeSingle();
    if (torneo && (torneo as { finalizado_en: string | null }).finalizado_en) return null;
    return 'El torneo todavía no se ha dado por terminado (faltan rondas o la confirmación de cierre).';
  }
  return 'Este deporte todavía no tiene puntuación automática: liquida sus mesas una a una.';
}

async function puntosPorJugador(admin: Admin, deporte: string, competicion: string): Promise<Map<string, number>> {
  const tabla = deporte === 'golf' ? 'golf_puntos_jugador' : 'futbol_puntos_jugador';
  const filas = await todasLasFilas<{ jugador_id: string; puntos_total: number }>((d, h) =>
    admin.from(tabla).select('jugador_id,puntos_total').eq('competicion', competicion).range(d, h)
  );
  return new Map(filas.map((f) => [f.jugador_id, Number(f.puntos_total) || 0]));
}

export async function liquidarMesasDeCompeticion(
  admin: Admin,
  competicion: string,
  opciones: { soloComprobar?: boolean; forzar?: boolean } = {}
): Promise<ResultadoCompeticion> {
  const { mesas } = await mesasJugadasPendientes(admin, competicion);
  const deporte = mesas[0]?.sala.deporte ?? '';
  const equiposTotales = mesas.reduce((a, m) => a + m.equipos.length, 0);
  const motivoNoListo = mesas.length === 0 ? 'No hay mesas jugadas pendientes de liquidar.' : await comprobarTerminada(admin, deporte, competicion);
  const base: ResultadoCompeticion = { listo: motivoNoListo === null, motivoNoListo, mesasJugadas: mesas.length, equipos: equiposTotales, liquidadas: 0, resultados: [] };

  const sinMotor = deporte !== 'futbol' && deporte !== 'golf';
  if (opciones.soloComprobar || mesas.length === 0 || sinMotor || (motivoNoListo && !opciones.forzar)) return base;

  const puntos = await puntosPorJugador(admin, deporte, competicion);
  for (const { sala, equipos } of mesas) {
    try {
      const clasificacion = equipos.map((e) => ({
        equipoId: e.id,
        valor: Math.round((e.jugadores ?? []).reduce((a, id) => a + (puntos.get(id) ?? 0), 0) * 100) / 100,
      }));
      const tramos = calcularReparto(sala.tipo, sala.aforo, equipos.length);
      const bote = parteParaPremios(Number(sala.buy_in)) * equipos.length;
      const reparto = repartirPremiosConEmpates(clasificacion, tramos, bote, 'desc');
      const p_reparto = reparto.map((r) => ({ equipo_id: r.equipoId, posicion: r.posicion, importe: r.importe }));
      const { error } = await admin.rpc('liquidar_evento', { p_tipo: 'sala', p_id: sala.id, p_reparto });
      if (error) {
        base.resultados.push({ salaId: sala.id, nombre: sala.nombre, ok: false, motivo: error.message.replace(/^ERROR:\s*/i, '') });
      } else {
        base.liquidadas += 1;
        base.resultados.push({ salaId: sala.id, nombre: sala.nombre, ok: true, motivo: 'Liquidada' });
      }
    } catch (err) {
      base.resultados.push({ salaId: sala.id, nombre: sala.nombre, ok: false, motivo: (err as Error).message });
    }
  }
  return base;
}
