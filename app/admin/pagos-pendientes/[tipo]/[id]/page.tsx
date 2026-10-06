'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { formatEuros, parteParaPremios } from '@/lib/salaShared';
import { calcularTramosPorInscritos, calcularReparto, repartirPremiosConEmpates, ClasificacionEntrada, ReparteEuros, TipoSala } from '@/lib/repartoPremios';
import { formatGolfScore, calcularBonosPodio } from '@/lib/golfScoring';
import { PorraFormato, PORRA_FORMATO_LABELS } from '@/lib/porraFormato';

// ============================================================================
// FICHA DE LIQUIDACIÓN de una sala o porra concreta (nuevo, 29/09)
// ============================================================================
// Propone el reparto de premios (con empates ya resueltos, ver
// lib/repartoPremios.ts) y, al confirmar, llama a liquidar_evento()
// (drafters-schema.sql) para repartirlo de verdad en una sola transacción.
//
// La clasificación se calcula sola cuando hay datos reales para hacerlo:
//   - Porra de golf ('clasica'/'presupuesto'): suma de golpes respecto al
//     par en vivo (jugadores.resultado_en_vivo_total) de los jugadores de
//     cada equipo, con el bono de podio siempre restado (02/10: regla fija
//     de toda porra de golf, ya no es una opción por porra — ver
//     lib/golfScoring.ts).
//   - Porra de fútbol ('futbol_jornada'): aciertos sobre los partidos ya
//     resueltos (futbol_porra_clasificacion(), drafters-schema.sql).
// Para todo lo demás (salas de fútbol/tenis/golf: no hay motor de
// puntuación real todavía, confirmado al diseñar esto) el admin escribe a
// mano la posición final de cada equipo — con eso basta para aplicar el
// mismo reparto por tramos y el mismo criterio de empates.

type Tipo = 'sala' | 'porra';

type PorraRow = { id: string; major: string; formato: PorraFormato; precio: number; competicion: string | null };
type SalaRow = { id: string; nombre: string; tipo: TipoSala; aforo: number | null; buy_in: number };
type EquipoRow = { id: string; nombre_equipo: string | null; usuario_id: string; jugadores: string[] };
// CAMBIO 03/10 (pedido de Iñi): el desempate del bono de podio ya no mira el
// grupo del jugador, mira su precio — ver lib/golfScoring.ts.
type JugadorLive = { id: string; resultado_en_vivo_total: number | null; resultado_en_vivo_posicion: string | null; precio: number };
type FutbolClasificacionFila = { equipo_id: string; nombre_equipo: string; aciertos: number; partidos_resueltos: number; total_partidos: number };

export default function AdminLiquidarPage() {
  const router = useRouter();
  const params = useParams();
  const tipo = params?.tipo as Tipo;
  const itemId = params?.id as string;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [porra, setPorra] = useState<PorraRow | null>(null);
  const [sala, setSala] = useState<SalaRow | null>(null);
  const [equipos, setEquipos] = useState<EquipoRow[]>([]);
  const [jugadoresLive, setJugadoresLive] = useState<Map<string, JugadorLive>>(new Map());
  const [futbolClasificacion, setFutbolClasificacion] = useState<FutbolClasificacionFila[]>([]);
  const [posicionesManual, setPosicionesManual] = useState<Map<string, string>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [avisoDatos, setAvisoDatos] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;

    async function cargar() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      const { data: perfilData } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single();
      if (!activo) return;
      const p = perfilData as Perfil | null;
      if (!p || p.rol !== 'admin') {
        router.push('/cuenta');
        return;
      }
      setPerfil(p);
      setAutorizado(true);

      if (tipo === 'porra') {
        const { data: porraData } = await supabase
          .from('porras')
          .select('id, major, formato, precio, competicion')
          .eq('id', itemId)
          .single();
        if (!activo) return;
        if (!porraData) {
          setError('No se ha encontrado esta porra.');
          setCargando(false);
          return;
        }
        const porraRow = porraData as PorraRow;
        setPorra(porraRow);

        const { data: equiposData } = await supabase
          .from('equipos')
          .select('id, nombre_equipo, usuario_id, jugadores, inscripciones(estado)')
          .eq('porra_id', itemId);
        const equiposActivos = ((equiposData as (EquipoRow & { inscripciones: { estado: string }[] })[]) ?? []).filter((e) =>
          e.inscripciones.some((i) => i.estado !== 'reembolsada')
        );
        setEquipos(equiposActivos);

        if (porraRow.formato === 'futbol_jornada') {
          const { data: clasificacionData } = await supabase.rpc('futbol_porra_clasificacion', { p_porra_id: itemId });
          if (!activo) return;
          const filas = (clasificacionData as FutbolClasificacionFila[]) ?? [];
          setFutbolClasificacion(filas);
          if (filas.length > 0 && filas.some((f) => f.partidos_resueltos < f.total_partidos)) {
            setAvisoDatos(`Todavía no se han marcado los resultados de todos los partidos (${filas[0].partidos_resueltos}/${filas[0].total_partidos}) — la clasificación puede cambiar.`);
          }
        } else if (porraRow.competicion) {
          const { data: jugData } = await supabase
            .from('jugadores')
            .select('id, resultado_en_vivo_total, resultado_en_vivo_posicion, precio')
            .eq('deporte', 'golf')
            .eq('competicion', porraRow.competicion);
          if (!activo) return;
          const mapa = new Map<string, JugadorLive>();
          ((jugData as JugadorLive[]) ?? []).forEach((j) => mapa.set(j.id, j));
          setJugadoresLive(mapa);
          const idsUsados = equiposActivos.flatMap((e) => e.jugadores ?? []);
          if (idsUsados.some((id) => mapa.get(id)?.resultado_en_vivo_total == null)) {
            setAvisoDatos('Algún jugador todavía no tiene resultado en vivo — revisa /admin/resultados-golf antes de liquidar, o continúa si el torneo ya ha terminado y el resultado es el definitivo.');
          }
        }
      } else {
        const { data: salaData } = await supabase.from('salas').select('id, nombre, tipo, aforo, buy_in').eq('id', itemId).single();
        if (!activo) return;
        if (!salaData) {
          setError('No se ha encontrado esta sala.');
          setCargando(false);
          return;
        }
        setSala(salaData as SalaRow);

        const { data: equiposData } = await supabase
          .from('equipos')
          .select('id, nombre_equipo, usuario_id, jugadores, inscripciones(estado)')
          .eq('sala_id', itemId);
        const equiposActivos = ((equiposData as (EquipoRow & { inscripciones: { estado: string }[] })[]) ?? []).filter((e) =>
          e.inscripciones.some((i) => i.estado !== 'reembolsada')
        );
        setEquipos(equiposActivos);
        setAvisoDatos('Esta sala no tiene un motor de puntuación automático todavía — escribe a mano la posición final de cada equipo.');
      }

      setCargando(false);
    }

    if (tipo && itemId) cargar();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tipo, itemId]);

  // Nombre de equipo para mostrar (fútbol/porras usan nombre_equipo directo;
  // salas normales no siempre lo tienen — se cae al id abreviado).
  function nombreDe(equipoId: string): string {
    const eq = equipos.find((e) => e.id === equipoId);
    return eq?.nombre_equipo ?? `Equipo ${equipoId.slice(0, 8)}`;
  }

  const esGolf = tipo === 'porra' && porra && porra.formato !== 'futbol_jornada';
  const esFutbolPorra = tipo === 'porra' && porra?.formato === 'futbol_jornada';
  const esSala = tipo === 'sala';

  // Valor de cada equipo, según de qué se trate — ver el comentario largo
  // de arriba. Golf: menor es mejor (orden='asc'). Fútbol/manual: mayor es
  // mejor (orden='desc' para aciertos; para la posición manual se usa
  // 'asc' porque 1º es el número más bajo).
  // Bono de podio de cada jugador del campo (reglas de empate — ver
  // lib/golfScoring.ts), calculado sobre el campo completo (todos los
  // jugadores de la competición, no solo los de un equipo) porque el
  // desempate necesita comparar a TODOS los jugadores empatados.
  const mapaBonosPodio = useMemo(() => {
    if (!esGolf) return new Map<string, number>();
    return calcularBonosPodio(Array.from(jugadoresLive.values()));
  }, [esGolf, jugadoresLive]);

  const golfValorPorEquipo = useMemo(() => {
    if (!esGolf) return new Map<string, number>();
    const mapa = new Map<string, number>();
    equipos.forEach((e) => {
      const total = (e.jugadores ?? []).reduce((suma, id) => {
        const j = jugadoresLive.get(id);
        if (!j) return suma;
        const bono = mapaBonosPodio.get(id) ?? 0;
        return suma + (j.resultado_en_vivo_total ?? 0) + bono;
      }, 0);
      mapa.set(e.id, total);
    });
    return mapa;
  }, [esGolf, equipos, jugadoresLive, mapaBonosPodio]);

  const clasificacion: ClasificacionEntrada[] = useMemo(() => {
    if (esGolf) {
      return equipos.map((e) => ({ equipoId: e.id, valor: golfValorPorEquipo.get(e.id) ?? 0 }));
    }
    if (esFutbolPorra) {
      return futbolClasificacion.map((f) => ({ equipoId: f.equipo_id, valor: f.aciertos }));
    }
    // Sala: posición manual — vacío cuenta como "sin rellenar" (número muy
    // alto, para que quede el último y no se mezcle con los que sí tienen
    // posición mientras el admin todavía está rellenando).
    return equipos.map((e) => {
      const texto = posicionesManual.get(e.id);
      const num = texto ? parseInt(texto, 10) : NaN;
      return { equipoId: e.id, valor: Number.isFinite(num) && num > 0 ? num : 999999 };
    });
  }, [esGolf, esFutbolPorra, equipos, golfValorPorEquipo, futbolClasificacion, posicionesManual]);

  const inscritos = tipo === 'porra' ? equipos.length : equipos.length;
  const precio = tipo === 'porra' ? porra?.precio ?? 0 : sala?.buy_in ?? 0;
  const bote = parteParaPremios(precio) * inscritos;
  const tramos = useMemo(() => {
    if (tipo === 'porra') return calcularTramosPorInscritos(inscritos);
    if (sala) return calcularReparto(sala.tipo, sala.aforo, inscritos);
    return [];
  }, [tipo, inscritos, sala]);

  const reparto: ReparteEuros[] = useMemo(
    () => repartirPremiosConEmpates(clasificacion, tramos, bote, esGolf ? 'asc' : esFutbolPorra ? 'desc' : 'asc'),
    [clasificacion, tramos, bote, esGolf, esFutbolPorra]
  );
  const repartoOrdenado = useMemo(() => [...reparto].sort((a, b) => a.posicion - b.posicion), [reparto]);

  const todasPosicionesManualRellenas = !esSala || equipos.every((e) => {
    const texto = posicionesManual.get(e.id);
    const num = texto ? parseInt(texto, 10) : NaN;
    return Number.isFinite(num) && num > 0;
  });
  const puedeConfirmar = equipos.length > 0 && todasPosicionesManualRellenas;

  async function confirmarYRepartir() {
    if (!window.confirm('¿Repartir los premios con este reparto? Esta acción mueve dinero de verdad (simulado) y no se puede deshacer.')) return;
    setConfirmando(true);
    setError(null);
    const p_reparto = reparto.map((r) => ({ equipo_id: r.equipoId, posicion: r.posicion, importe: r.importe }));
    const { error: rpcError } = await supabase.rpc('liquidar_evento', { p_tipo: tipo, p_id: itemId, p_reparto });
    setConfirmando(false);
    if (rpcError) {
      setError(rpcError.message.replace(/^ERROR:\s*/i, ''));
      return;
    }
    router.push('/admin/pagos-pendientes');
  }

  if (autorizado === null || !perfil || cargando) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader sinVolver />
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.MUTED }}>Cargando...</p>
          </div>
        </div>
      </main>
    );
  }

  if (error && equipos.length === 0 && !porra && !sala) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader sinVolver saldoLabel={`${perfil.saldo_simulado.toFixed(2)} €`} accountInitials={S.iniciales(perfil.nombre, perfil.apellido)} />
          <div style={{ padding: '40px 20px' }}>
            <p style={{ fontSize: 14, color: S.ERROR }}>{error}</p>
          </div>
        </div>
      </main>
    );
  }

  const titulo = tipo === 'porra' ? porra?.major : sala?.nombre;

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader sinVolver saldoLabel={`${perfil.saldo_simulado.toFixed(2)} €`} accountInitials={S.iniciales(perfil.nombre, perfil.apellido)} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link href="/admin/pagos-pendientes" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>
              ← Pagos pendientes
            </Link>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>{titulo}</h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>
              {equipos.length} equipo{equipos.length === 1 ? '' : 's'} · Bote {formatEuros(bote)}
              {tipo === 'porra' && porra && ` · ${PORRA_FORMATO_LABELS[porra.formato]}`}
              {esGolf && ' · Bono de podio activo'}
            </p>
          </div>

          {error && <p style={S.errorText}>{error}</p>}
          {avisoDatos && <p style={{ fontSize: 12, color: '#F0B94D', lineHeight: 1.5, margin: 0 }}>⚠️ {avisoDatos}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={S.sectionLabel}>Reparto propuesto</span>
            {equipos.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>No hay equipos inscritos.</p>}
            {repartoOrdenado.map((r) => (
              <div key={r.equipoId} style={{ display: 'flex', alignItems: 'center', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
                <span style={{ flexShrink: 0, width: 34, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: r.importe > 0 ? '#F0B94D' : S.MUTED_3 }}>
                  {r.posicion}º
                </span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 13, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {nombreDe(r.equipoId)}
                </span>
                {esGolf && (
                  <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: S.MUTED_2 }}>{formatGolfScore(golfValorPorEquipo.get(r.equipoId) ?? 0)}</span>
                )}
                {esFutbolPorra && (
                  <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: S.MUTED_2 }}>
                    {futbolClasificacion.find((f) => f.equipo_id === r.equipoId)?.aciertos ?? 0} aciertos
                  </span>
                )}
                {esSala && (
                  <input
                    type="number"
                    min={1}
                    value={posicionesManual.get(r.equipoId) ?? ''}
                    onChange={(e) => setPosicionesManual((prev) => new Map(prev).set(r.equipoId, e.target.value))}
                    placeholder="Puesto"
                    style={{ ...S.input, width: 60, flexShrink: 0, padding: '6px 8px', fontSize: 12, textAlign: 'center' }}
                  />
                )}
                <span style={{ flexShrink: 0, width: 70, textAlign: 'right', fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 13, color: r.importe > 0 ? '#3DDC84' : S.MUTED_3 }}>
                  {formatEuros(r.importe)}
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled={!puedeConfirmar || confirmando}
            onClick={confirmarYRepartir}
            style={{ ...S.primaryButton, marginTop: 0, opacity: !puedeConfirmar || confirmando ? 0.6 : 1 }}
          >
            {confirmando ? 'Repartiendo...' : esSala && !todasPosicionesManualRellenas ? 'Rellena el puesto de todos los equipos' : 'Confirmar y repartir'}
          </button>
        </div>
      </div>
    </main>
  );
}
