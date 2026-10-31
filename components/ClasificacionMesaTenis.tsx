'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { formatPuntos } from '@/lib/futbolLaLiga';
import { etiquetasPosicion } from '@/lib/posicionesEmpate';
import { puntuarPartidoTenis, type EstadoPartido } from '@/lib/tenisPuntuacion';
import type { LineaDesglose } from '@/lib/futbolPuntuacion';
import Cargando from '@/components/Cargando';
import { NivelBadge, useFichaUsuario, useNiveles } from '@/components/v2/Nivel';

// ============================================================================
// CLASIFICACIÓN DE TENIS (28/10, Iñi) — exactamente como fútbol y golf
// ============================================================================
// Equipos a la izquierda, jugadores del equipo elegido a la derecha y, al
// pulsar un jugador, de dónde salen sus puntos: cada partido del torneo con su
// resultado (sets) y los puntos de ese partido, más el desglose total.
// Pestañas: Mesa · Torneo (todos los jugadores) · Premios (la clasificación
// de la sala con el reparto). Se actualiza sola cada 30 segundos.

export type EquipoExternoTenis = { equipoId: string; nombre: string; jugadores: string[]; createdAt: string };
type Jugador = { id: string; nombre: string; metadata: { espn_id?: string; ranking?: number | null } | null };
type Puntos = { jugador_id: string; puntos_total: number; desglose: LineaDesglose[] | null; estado_texto: string | null; en_juego: boolean };
type Partido = {
  espn_id: string;
  ronda: string | null;
  inicio: string | null;
  estado: EstadoPartido;
  retirada: boolean;
  j1_espn: string | null;
  j1_nombre: string | null;
  j2_espn: string | null;
  j2_nombre: string | null;
  juegos1: number[];
  juegos2: number[];
  sirve: number | null;
  ganador: number | null;
  breaks1: number;
  breaks2: number;
};
type Vista = 'mesa' | 'torneo' | 'premios';

const RONDA_CORTA: Record<string, string> = { 'Round 1': '1ª ronda', 'Round 2': '2ª ronda', 'Round 3': '3ª ronda', 'Round of 16': 'Octavos', Quarterfinal: 'Cuartos', Quarterfinals: 'Cuartos', Semifinal: 'Semifinal', Semifinals: 'Semifinal', Final: 'Final' };
const signo = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatPuntos(Math.abs(n))}`;

export default function ClasificacionMesaTenis({
  competicion,
  terminada,
  externo,
  premios,
}: {
  competicion: string;
  terminada: boolean;
  externo: { equipos: EquipoExternoTenis[]; misJugadores: string[] };
  premios?: ReactNode;
}) {
  const [jugadores, setJugadores] = useState<Map<string, Jugador>>(new Map());
  const [puntos, setPuntos] = useState<Map<string, Puntos>>(new Map());
  const [partidos, setPartidos] = useState<Partido[]>([]);
  const [desde, setDesde] = useState<number>(0);
  const [cargado, setCargado] = useState(false);
  const [vista, setVista] = useState<Vista>('mesa'); // 01/11 (Iñi): siempre se entra al detalle.
  const [equipoId, setEquipoId] = useState<string | null>(null);
  // 01/11 (Iñi): un segundo toque en el equipo (o en su nombre) abre la ficha del usuario: nivel y vuestro historial.
  const { abrirFicha, ficha } = useFichaUsuario();
  const nivelesExt = useNiveles(externo.equipos.map((e) => e.equipoId));
  const [foco, setFoco] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      const [{ data: js }, { data: ps }, { data: pts }, { data: tor }] = await Promise.all([
        supabase.from('jugadores').select('id,nombre,metadata').eq('deporte', 'tenis').eq('competicion', competicion).range(0, 999),
        supabase.from('tenis_puntos_jugador').select('jugador_id,puntos_total,desglose,estado_texto,en_juego').eq('competicion', competicion).range(0, 999),
        supabase.from('tenis_partidos').select('espn_id,ronda,inicio,estado,retirada,j1_espn,j1_nombre,j2_espn,j2_nombre,juegos1,juegos2,sirve,ganador,breaks1,breaks2').eq('competicion', competicion).range(0, 999),
        supabase.from('tenis_torneos').select('desde').eq('competicion', competicion).maybeSingle(),
      ]);
      if (!activo) return;
      setJugadores(new Map(((js as Jugador[]) ?? []).map((j) => [j.id, j])));
      setPuntos(new Map(((ps as Puntos[]) ?? []).map((p) => [p.jugador_id, p])));
      setPartidos(((pts as Partido[]) ?? []).sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? '')));
      const d = (tor as { desde: string | null } | null)?.desde;
      setDesde(d ? new Date(d).getTime() - 10 * 60000 : 0);
      setCargado(true);
    }
    void cargar();
    const t = window.setInterval(() => void cargar(), 30000);
    return () => {
      activo = false;
      window.clearInterval(t);
    };
  }, [competicion]);

  const puntosDe = (id: string) => Number(puntos.get(id)?.puntos_total ?? 0);
  const totalEquipo = (ids: string[]) => ids.reduce((s, id) => s + puntosDe(id), 0);
  const equipos = useMemo(() => [...externo.equipos].sort((a, b) => totalEquipo(b.jugadores) - totalEquipo(a.jugadores)), [externo.equipos, puntos]); // eslint-disable-line react-hooks/exhaustive-deps
  const rangos = etiquetasPosicion(equipos, (e) => totalEquipo(e.jugadores));
  const elegido = equipos.find((e) => e.equipoId === equipoId) ?? equipos.find((e) => e.jugadores.some((j) => externo.misJugadores.includes(j))) ?? equipos[0];
  const campo = useMemo(() => Array.from(jugadores.values()).sort((a, b) => puntosDe(b.id) - puntosDe(a.id) || a.nombre.localeCompare(b.nombre)), [jugadores, puntos]); // eslint-disable-line react-hooks/exhaustive-deps
  const rangosCampo = etiquetasPosicion(campo, (j) => puntosDe(j.id));

  /** Partidos de un jugador, con sus puntos (mismas reglas que el servidor). */
  function partidosDe(j: Jugador) {
    const espn = j.metadata?.espn_id;
    if (!espn) return [];
    return partidos
      .filter((p) => p.j1_espn === espn || p.j2_espn === espn)
      .map((p) => {
        const soy1 = p.j1_espn === espn;
        const mios = soy1 ? p.juegos1 : p.juegos2;
        const rival = soy1 ? p.juegos2 : p.juegos1;
        const gane = p.estado === 'post' && p.ganador ? (p.ganador === 1) === soy1 : null;
        const cuenta = !p.inicio || new Date(p.inicio).getTime() >= desde;
        const r = puntuarPartidoTenis({ estado: p.estado, mios, rival, gane, rivalRetirado: !!gane && p.retirada, breaks: soy1 ? p.breaks1 : p.breaks2 });
        return {
          p,
          rivalNombre: (soy1 ? p.j2_nombre : p.j1_nombre) ?? 'Por decidir',
          marcador: mios.map((x, i) => `${x}-${rival[i] ?? 0}`).join(' '),
          gane,
          cuenta,
          total: cuenta ? r.total : 0,
          desglose: cuenta ? r.desglose : [],
          alSaque: p.estado === 'in' && p.sirve === (soy1 ? 1 : 2),
        };
      });
  }

  function detalleJugador(j: Jugador) {
    const lista = partidosDe(j);
    const fila = puntos.get(j.id);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid #1E2723', borderRadius: 10 }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Partidos de {j.nombre}</span>
        {lista.length === 0 && <span style={{ fontSize: 11.5, color: S.MUTED }}>Todavía no ha jugado ningún partido.</span>}
        {lista.map((x) => (
          <div key={x.p.espn_id} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', borderRadius: 8, background: x.p.estado === 'in' ? 'rgba(61,220,132,0.06)' : 'transparent', border: `1px solid ${x.p.estado === 'in' ? 'rgba(61,220,132,0.3)' : '#1A221E'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: S.MUTED_3 }}>
                {RONDA_CORTA[x.p.ronda ?? ''] ?? x.p.ronda ?? ''}
                <span style={{ marginLeft: 6, color: x.p.estado === 'in' ? '#3DDC84' : x.gane === true ? '#3DDC84' : x.gane === false ? '#FF8A8A' : S.MUTED_3 }}>
                  {x.p.estado === 'in' ? `● En juego${x.alSaque ? ' · al saque' : ''}` : x.gane === true ? (x.p.retirada ? 'Ganó (retirada)' : 'Ganó') : x.gane === false ? (x.p.retirada ? 'Perdió (retirada)' : 'Perdió') : x.p.estado === 'pre' ? 'Por jugar' : ''}
                </span>
              </span>
              <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: x.total < 0 ? S.ERROR : '#F0B94D' }}>
                {x.p.estado === 'pre' ? '–' : x.cuenta ? `${signo(x.total)} pts` : 'No cuenta'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: S.TEXT }}>vs {x.rivalNombre}</span>
              {x.p.estado !== 'pre' && (
                <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: '0.02em', color: x.gane === true ? '#3DDC84' : x.gane === false ? S.MUTED_2 : S.TEXT }}>{x.marcador || '—'}</span>
              )}
            </div>
            {x.desglose.length > 0 && (
              <span style={{ fontSize: 10.5, color: S.MUTED_2, lineHeight: 1.45 }}>
                {x.desglose.map((l) => `${l.etiqueta}${l.cantidad > 1 ? ` ×${l.cantidad}` : ''} ${signo(l.puntos)}`).join(' · ')}
              </span>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTop: '1px solid #1E2723', paddingTop: 5, marginTop: 2 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: S.TEXT }}>Total del torneo</span>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: S.TEXT }}>{formatPuntos(puntosDe(j.id))}</span>
        </div>
        {(fila?.desglose ?? []).length > 0 && (
          <details>
            <summary style={{ fontSize: 10.5, color: S.MUTED_3, cursor: 'pointer' }}>Desglose total</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
              {(fila?.desglose ?? []).map((l) => (
                <div key={l.clave} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: S.MUTED }}>
                    {l.etiqueta}
                    {l.cantidad > 1 ? ` ×${l.cantidad}` : ''}
                  </span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, color: l.puntos < 0 ? S.ERROR : '#F0B94D' }}>{signo(l.puntos)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
        <span style={{ fontSize: 9.5, color: S.MUTED_3, lineHeight: 1.4 }}>Aces y dobles faltas: próximamente (todavía no puntúan).</span>
      </div>
    );
  }

  function filaJugador(j: Jugador, rango?: string) {
    const fila = puntos.get(j.id);
    return (
      <motion.div layout transition={{ type: 'spring', stiffness: 420, damping: 38 }} key={j.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setFoco((prev) => (prev === j.id ? null : j.id));
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', background: foco === j.id ? 'rgba(61,220,132,0.1)' : S.PANEL, border: `1px solid ${foco === j.id ? 'rgba(61,220,132,0.4)' : '#1E2723'}`, borderRadius: 9, textDecoration: 'none' }}
        >
          {rango && <span style={{ flexShrink: 0, minWidth: 20, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 11, color: S.MUTED_2 }}>{rango}</span>}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
            {fila?.estado_texto && <span style={{ fontSize: 9, color: fila.en_juego ? '#3DDC84' : S.MUTED_3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fila.estado_texto}</span>}
          </div>
          <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 13, color: S.MUTED_2 }}>{formatPuntos(puntosDe(j.id))}</span>
        </a>
        {foco === j.id && detalleJugador(j)}
      </motion.div>
    );
  }

  if (!cargado) return <Cargando compacto />;

  const pill = (activa: boolean) => ({ ...S.pill(activa), width: 'auto' as const });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {ficha}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setVista('mesa')} style={pill(vista === 'mesa')}>
          Mesa
        </button>
        <button type="button" onClick={() => setVista('torneo')} style={pill(vista === 'torneo')}>
          Torneo
        </button>
        <button type="button" onClick={() => setVista('premios')} style={pill(vista === 'premios')}>
          {terminada ? 'Clasificación final' : 'Premios'}
        </button>
      </div>

      {vista === 'mesa' &&
        (equipos.length === 0 || !elegido ? (
          <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Todavía no hay equipos.</p>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0, width: 150, display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 420, overflowY: 'auto' }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Equipos ({equipos.length})</span>
              <span style={{ fontSize: 9, fontWeight: 600, color: S.MUTED_3, lineHeight: 1.3 }}>Pulsa otra vez un equipo para ver vuestro cara a cara</span>
              {equipos.map((eq, i) => {
                const activo = eq.equipoId === elegido.equipoId;
                return (
                  <motion.a
                    layout
                    transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                    key={eq.equipoId}
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (activo) return abrirFicha(eq.equipoId, e.currentTarget);
                      setEquipoId(eq.equipoId);
                      setFoco(null);
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 8, background: activo ? 'rgba(61,220,132,0.1)' : S.PANEL, border: `1px solid ${activo ? 'rgba(61,220,132,0.4)' : '#1E2723'}`, borderRadius: 9, textDecoration: 'none' }}
                  >
                    <span style={{ flexShrink: 0, minWidth: 16, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 11, color: S.MUTED_2 }}>{rangos[i]}</span>
                    <NivelBadge nivel={nivelesExt.get(eq.equipoId)} size={15} />
                    <span style={{ flex: 1, minWidth: 0, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 10.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{eq.nombre}</span>
                    <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 12, color: S.MUTED_2 }}>{formatPuntos(totalEquipo(eq.jugadores))}</span>
                  </motion.a>
                );
              })}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: S.PANEL, border: '1px solid #1E2723', borderRadius: 10 }}>
                <button type="button" onClick={(e) => abrirFicha(elegido.equipoId, e.currentTarget)} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                  <NivelBadge nivel={nivelesExt.get(elegido.equipoId)} size={18} />
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.25)', textUnderlineOffset: 3 }}>{elegido.nombre}</span>
                </button>
                <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: S.MUTED_2 }}>{formatPuntos(totalEquipo(elegido.jugadores))} pts</span>
              </div>
              {[...elegido.jugadores]
                .map((id) => jugadores.get(id))
                .filter((j): j is Jugador => !!j)
                .sort((a, b) => puntosDe(b.id) - puntosDe(a.id))
                .map((j) => filaJugador(j))}
            </div>
          </div>
        ))}

      {vista === 'torneo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 520, overflowY: 'auto' }}>
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: S.MUTED_3 }}>Todos los jugadores ({campo.length})</span>
          {campo.map((j, i) => filaJugador(j, rangosCampo[i]))}
        </div>
      )}

      {vista === 'premios' && premios}

      <span style={{ fontSize: 10.5, color: S.MUTED_3, lineHeight: 1.4 }}>
        *Clasificación en directo, se actualiza sola. Pulsa un jugador para ver cada partido con su resultado y los puntos de ese partido.
      </span>
    </div>
  );
}
