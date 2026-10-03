import { crearClienteAdmin } from '@/lib/server/supabaseAdmin';
import { calcularTramosPorInscritos, repartirPremiosConEmpates, type ClasificacionEntrada } from '@/lib/repartoPremios';
import { parteParaPremios } from '@/lib/salaShared';
import { calcularBonosPodio, type JugadorParaBonoPodio } from '@/lib/golfScoring';

// ============================================================================
// LIQUIDACIÓN AUTOMÁTICA DE PORRAS DE GOLF (nuevo, 03/10)
// ============================================================================
// Reproduce EXACTAMENTE el mismo cálculo que ya hace a mano
// app/admin/pagos-pendientes/[tipo]/[id]/page.tsx para una porra de golf
// ('clasica'/'presupuesto', nunca 'futbol_jornada') — clasificación por
// golpes en vivo con el bono de podio ya restado (desempate por precio del
// jugador, ver lib/golfScoring.ts), reparto por tramos con empates
// (lib/repartoPremios.ts) — pero llamado por la ruta de sincronización en
// vez de por un clic del admin. Solo porras: las Mesas Drafters (salas) NO
// tienen motor de puntuación automático todavía (confirmado al diseñar la
// liquidación manual, 29/09) y siguen liquidándose siempre a mano.
//
// Quién decide CUÁNDO llamar a esto: app/api/admin/actualizar-golf-en-vivo/
// route.ts, cuando detecta que el torneo lleva 1 hora "listo para liquidar"
// (ver el bloque "CIERRE AUTOMÁTICO..." en drafters-schema.sql) — este
// archivo solo calcula y aplica, no decide el momento.

type PorraGolfRow = { id: string; formato: string; precio: number; competicion: string };
type EquipoRow = { id: string; jugadores: string[] };

export type ResultadoLiquidacionPorra = { porraId: string; ok: boolean; motivo: string };

export async function liquidarPorrasGolfDeCompeticion(
  admin: ReturnType<typeof crearClienteAdmin>,
  competicion: string
): Promise<ResultadoLiquidacionPorra[]> {
  const { data: porrasData, error: porrasError } = await admin
    .from('porras')
    .select('id, formato, precio, competicion')
    .eq('competicion', competicion)
    .neq('formato', 'futbol_jornada')
    .neq('estado', 'finalizada');
  if (porrasError) throw new Error(`No se han podido leer las porras de "${competicion}": ${porrasError.message}`);

  const porras = (porrasData as PorraGolfRow[]) ?? [];
  if (porras.length === 0) return [];

  const { data: jugData, error: jugError } = await admin
    .from('jugadores')
    .select('id, resultado_en_vivo_total, resultado_en_vivo_posicion, precio')
    .eq('deporte', 'golf')
    .eq('competicion', competicion);
  if (jugError) throw new Error(`No se han podido leer los jugadores de "${competicion}": ${jugError.message}`);

  const jugadoresLive = (jugData as JugadorParaBonoPodio[]) ?? [];
  const jugadoresPorId = new Map(jugadoresLive.map((j) => [j.id, j]));
  const mapaBonosPodio = calcularBonosPodio(jugadoresLive);

  const resultados: ResultadoLiquidacionPorra[] = [];

  for (const porra of porras) {
    try {
      const { data: equiposData, error: equiposError } = await admin
        .from('equipos')
        .select('id, jugadores, inscripciones(estado)')
        .eq('porra_id', porra.id);
      if (equiposError) throw new Error(equiposError.message);

      const equipos = ((equiposData as (EquipoRow & { inscripciones: { estado: string }[] })[]) ?? []).filter((e) =>
        e.inscripciones.some((i) => i.estado !== 'reembolsada')
      );

      if (equipos.length === 0) {
        resultados.push({ porraId: porra.id, ok: false, motivo: 'Sin equipos inscritos — no se liquida.' });
        continue;
      }

      const clasificacion: ClasificacionEntrada[] = equipos.map((e) => {
        const valor = (e.jugadores ?? []).reduce((suma, id) => {
          const j = jugadoresPorId.get(id);
          if (!j) return suma;
          const bono = mapaBonosPodio.get(id) ?? 0;
          return suma + (j.resultado_en_vivo_total ?? 0) + bono;
        }, 0);
        return { equipoId: e.id, valor };
      });

      const inscritos = equipos.length;
      const bote = parteParaPremios(porra.precio) * inscritos;
      const tramos = calcularTramosPorInscritos(inscritos);
      const reparto = repartirPremiosConEmpates(clasificacion, tramos, bote, 'asc');
      const p_reparto = reparto.map((r) => ({ equipo_id: r.equipoId, posicion: r.posicion, importe: r.importe }));

      const { error: rpcError } = await admin.rpc('liquidar_evento', { p_tipo: 'porra', p_id: porra.id, p_reparto });
      if (rpcError) throw new Error(rpcError.message);

      resultados.push({ porraId: porra.id, ok: true, motivo: 'Liquidada automáticamente.' });
    } catch (err) {
      resultados.push({ porraId: porra.id, ok: false, motivo: (err as Error).message });
    }
  }

  return resultados;
}
