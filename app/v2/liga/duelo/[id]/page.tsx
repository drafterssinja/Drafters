'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import * as S from '@/lib/mockupStyles';
import { supabase } from '@/lib/supabaseClient';
import MarcoV2, { Panel } from '@/components/v2/MarcoV2';
import { useSesionV2 } from '@/components/v2/useSesionV2';
import Cargando from '@/components/Cargando';
import { jornadaBonita } from '@/components/v2/LigaDuelos';
import { mensajeError } from '@/lib/v2';

// ============================================================================
// LIGA DRAFTERS — UN ENFRENTAMIENTO (27/10, Iñi)
// ============================================================================
// Quién contra quién, el marcador y el equipo de cada uno con los puntos de
// cada jugador y de dónde salen. El equipo del rival se ve cuando la jornada
// ya ha empezado (SQL 61).

type Linea = { clave: string; etiqueta: string; cantidad: number; puntos: number };
type Jugador = { id: string; nombre: string; posicion: string; equipo_real: string | null; precio: number; puntos: number; jugo: boolean; minutos: number; partido_estado: string; desglose: Linea[] };
type Lado = { id: string; nombre: string; soy_yo: boolean; tiene_equipo: boolean; visible: boolean; total: number | null; alineacion: string | null; jugadores: Jugador[] | null } | null;
type Detalle = { id: string; competicion: string; tipo: string; estado: 'pendiente' | 'en_juego' | 'terminada'; cierre: string | null; division: string; local: Lado; visitante: Lado };

const VERDE = '#3DDC84';
const ROJO = '#FF8A8A';
const POS: Record<string, { c: string; t: string }> = {
  portero: { c: '#F0B94D', t: 'POR' },
  defensa: { c: '#4FA3FF', t: 'DEF' },
  centrocampista: { c: '#3DDC84', t: 'MED' },
  delantero: { c: '#FF7A7A', t: 'DEL' },
};
const n1 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : String(Math.round(Number(x) * 10) / 10));

export default function DueloPagina() {
  const { id } = useParams<{ id: string }>();
  const { perfil, estado } = useSesionV2();
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lado, setLado] = useState<'local' | 'visitante'>('local');

  useEffect(() => {
    if (estado !== 'ok') return;
    const cargar = () =>
      supabase.rpc('duelos_partido_detalle', { p_partido: id }).then(({ data, error: e }) => {
        if (e) return setError(mensajeError(e));
        const det = data as Detalle;
        setD(det);
        setLado((l) => (det.visitante?.soy_yo ? (l === 'local' && !det.local?.soy_yo ? 'visitante' : l) : l));
      });
    void cargar();
    const t = setInterval(cargar, 60000);
    return () => clearInterval(t);
  }, [estado, id]);

  const total = (l: Lado) => (l && l.tiene_equipo && d?.estado !== 'pendiente' ? Number(l.total ?? 0) : null);
  const tl = d ? total(d.local) : null;
  const tv = d ? total(d.visitante) : null;
  // Igual que en la base de datos: Descanso = gana; sin equipo = pierde (aunque el otro tampoco tenga).
  const resultado = (yo: Lado, otro: Lado, tYo: number | null, tOtro: number | null): 'G' | 'E' | 'P' | null => {
    if (d?.estado !== 'terminada' || !yo) return null;
    if (!otro) return 'G';
    if (!yo.tiene_equipo) return 'P';
    if (!otro.tiene_equipo) return 'G';
    return (tYo ?? 0) > (tOtro ?? 0) ? 'G' : (tYo ?? 0) === (tOtro ?? 0) ? 'E' : 'P';
  };
  const resL = d ? resultado(d.local, d.visitante, tl, tv) : null;
  const resV = d ? resultado(d.visitante, d.local, tv, tl) : null;
  const ganaLocal = resL === 'G';
  const ganaVisit = resV === 'G';
  const visto = d ? (lado === 'local' ? d.local : d.visitante) : null;

  return (
    <MarcoV2 perfil={perfil} estado={estado} deporte="futbol" volverA="/v2/futbol?modo=liga">
      {error && <p style={S.errorText}>{error}</p>}
      {!d && !error && <Cargando compacto />}
      {d && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: d.tipo === 'champions' ? '#7FB2FF' : VERDE }}>
              🏆 Liga Drafters · {d.division} división
            </span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color: S.TEXT }}>
              {d.tipo === 'champions' ? '⭐ ' : ''}
              {jornadaBonita(d.competicion)}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: d.estado === 'en_juego' ? VERDE : S.MUTED_2 }}>{d.estado === 'terminada' ? 'Terminada' : d.estado === 'en_juego' ? '● En juego · puntos en directo' : 'Todavía no ha empezado'}</span>
          </div>

          {/* Marcador */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, padding: 16, borderRadius: 16, background: 'linear-gradient(160deg, #15241C 0%, #111614 70%)', border: '1px solid rgba(61,220,132,0.35)' }}>
            {[d.local, null, d.visitante].map((l, i) =>
              i === 1 ? (
                <span key="vs" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: S.MUTED_3 }}>VS</span>
              ) : (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <span style={{ maxWidth: '100%', fontWeight: 800, fontSize: 15, color: l?.soy_yo ? VERDE : S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l ? (l.soy_yo ? `${l.nombre} (tú)` : l.nombre) : 'Descanso'}</span>
                  <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 38, lineHeight: 1, color: (i === 0 ? ganaLocal : ganaVisit) ? VERDE : S.TEXT }}>{l ? (l.tiene_equipo ? (d.estado === 'pendiente' ? '–' : n1(l.total)) : '–') : ''}</span>
                  {l && !l.tiene_equipo && <span style={{ fontSize: 11, color: ROJO }}>{d.estado === 'pendiente' ? 'Aún sin equipo' : 'Sin equipo'}</span>}
                  {d.estado === 'terminada' && l && <span style={{ fontSize: 11.5, fontWeight: 800, color: (i === 0 ? ganaLocal : ganaVisit) ? VERDE : S.MUTED_2 }}>{{ G: 'Gana · +3', E: 'Empate · +1', P: 'Pierde' }[(i === 0 ? resL : resV) ?? 'P']}</span>}
                </div>
              )
            )}
          </div>

          {/* Equipos */}
          {(d.local || d.visitante) && (
            <div style={{ display: 'flex', background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 4, gap: 4 }}>
              {(['local', 'visitante'] as const).map((k) => {
                const l = d[k];
                if (!l) return null;
                return (
                  <button key={k} type="button" onClick={() => setLado(k)} style={{ flex: 1, padding: '9px 6px', borderRadius: 9, border: 'none', cursor: 'pointer', background: lado === k ? S.ACCENT : 'transparent', color: lado === k ? '#0B0F0E' : S.MUTED, fontWeight: 800, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {l.soy_yo ? 'Tu equipo' : `Equipo de ${l.nombre}`}
                  </button>
                );
              })}
            </div>
          )}

          {visto && (
            <Panel style={{ padding: 12, gap: 6 }}>
              {!visto.tiene_equipo ? (
                <span style={{ fontSize: 13, color: S.MUTED_2 }}>{d.estado === 'pendiente' ? 'Todavía no ha hecho su equipo.' : 'No hizo equipo en esta jornada.'}</span>
              ) : !visto.visible || !visto.jugadores ? (
                <span style={{ fontSize: 13, color: S.MUTED_2 }}>🔒 El equipo de tu rival se verá cuando empiece la jornada.</span>
              ) : (
                <>
                  <span style={{ fontSize: 12, color: S.MUTED_2 }}>
                    Alineación {visto.alineacion ?? ''} · toca un jugador para ver de dónde salen sus puntos
                  </span>
                  {visto.jugadores.map((j) => (
                    <FilaJugador key={j.id} j={j} pendiente={d.estado === 'pendiente'} />
                  ))}
                  {d.estado !== 'pendiente' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 4px 0', borderTop: '1px solid #1A221E', fontWeight: 800, color: S.TEXT }}>
                      <span>Total</span>
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20 }}>{n1(visto.total)}</span>
                    </div>
                  )}
                </>
              )}
            </Panel>
          )}
        </>
      )}
    </MarcoV2>
  );
}

function FilaJugador({ j, pendiente }: { j: Jugador; pendiente: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const p = POS[j.posicion] ?? { c: S.MUTED, t: '' };
  const estado = j.partido_estado === 'en_juego' ? '● en juego' : j.partido_estado === 'finalizado' ? (j.jugo ? `${j.minutos}'` : 'no jugó') : j.partido_estado === 'aplazado' ? 'aplazado' : 'por jugar';
  return (
    <div style={{ borderTop: '1px solid #1A221E' }}>
      <button type="button" onClick={() => setAbierto(!abierto)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ flexShrink: 0, width: 34, fontSize: 10, fontWeight: 800, color: p.c }}>{p.t}</span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 800, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.nombre}</span>
          <span style={{ fontSize: 11, color: S.MUTED_3 }}>
            {j.equipo_real ?? ''} · <span style={{ color: j.partido_estado === 'en_juego' ? VERDE : S.MUTED_3 }}>{estado}</span>
          </span>
        </span>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 19, color: pendiente ? S.MUTED_3 : j.puntos > 0 ? VERDE : j.puntos < 0 ? ROJO : S.TEXT }}>{pendiente ? '–' : n1(j.puntos)}</span>
        <span style={{ color: S.MUTED_3, fontSize: 11 }}>{abierto ? '▾' : '▸'}</span>
      </button>
      {abierto && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '0 6px 10px 42px' }}>
          {j.desglose.length === 0 ? (
            <span style={{ fontSize: 12, color: S.MUTED_3 }}>{pendiente || j.partido_estado === 'pendiente' ? 'Todavía no ha jugado.' : 'Sin puntos.'}</span>
          ) : (
            j.desglose.map((l) => (
              <div key={l.clave} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: S.MUTED }}>
                <span>
                  {l.etiqueta}
                  {l.cantidad > 1 ? ` ×${l.cantidad}` : ''}
                </span>
                <span style={{ fontWeight: 800, color: l.puntos > 0 ? VERDE : l.puntos < 0 ? ROJO : S.MUTED }}>{l.puntos > 0 ? `+${n1(l.puntos)}` : n1(l.puntos)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
