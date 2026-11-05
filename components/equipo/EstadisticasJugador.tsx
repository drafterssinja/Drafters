'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { claveEquipoFutbol } from '@/lib/futbolLaLiga';
import IconoAusencia, { TEXTO_AUSENCIA, type Ausencia } from '@/components/equipo/IconoAusencia';

// ============================================================================
// ESTADÍSTICAS DEL JUGADOR AL HACER EL EQUIPO (04/11, Iñi)
// ============================================================================
// "A la derecha del nombre, un botoncito de estadísticas. Al pulsarlo, una
// mini ventana sin salir de la pantalla con los puntos de sus últimos 4
// partidos, y un botón para ver más: el histórico de todas las semanas con
// los puntos y el valor Drafters. Al volver atrás, sigues con tu equipo tal
// cual lo tenías." En LaLiga los de LaLiga y en la Champions los de la
// Champions; en golf y tenis, torneo a torneo (SQL 96, jugador_historial).
//  · Mini ventana: hoja desde abajo.
//  · Todas sus estadísticas: pantalla completa POR ENCIMA de la de hacer el
//    equipo (no se sale de ella), así no se pierde nada de lo elegido.
//  · El "atrás" del móvil cierra primero la pantalla y luego la hoja.

export type JugadorStats = { id: string; nombre: string; equipo_real: string | null; posicion?: string | null; precio: number; ausencia?: Ausencia; ausencia_motivo?: string | null; lesionado?: boolean };
type Fila = { competicion: string; fecha: string | null; precio: number | null; valor_mercado: number | null; equipo_real: string | null; puntos: number | null; jugo: boolean; minutos: number; estado: string; es_esta: boolean };
type Partido = { competicion: string; equipo_local: string; equipo_visitante: string; clave_local: string | null; clave_visitante: string | null };

const AZUL = '#5CC8FF';
const VERDE = '#3DDC84';
const ORO = '#F0B94D';
const POS: Record<string, string> = { portero: 'Portero', defensa: 'Defensa', centrocampista: 'Centrocampista', delantero: 'Delantero' };
const eur = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(Number(x)).toLocaleString('es-ES')} €`);
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString('es-ES');

function etiquetaCorta(c: string, deporte: string): string {
  if (deporte === 'futbol') return `J${c.match(/Jornada\s*(\d+)/i)?.[1] ?? '?'}`;
  return c.replace(/^(ATP|WTA)\s*·\s*/i, '').replace(/\s+\d{4}$/, '');
}
function etiquetaLarga(c: string, deporte: string): string {
  if (deporte === 'futbol') return `Jornada ${c.match(/Jornada\s*(\d+)/i)?.[1] ?? '?'}`;
  return etiquetaCorta(c, deporte);
}
function numJornada(c: string): number {
  return Number(c.match(/Jornada\s*(\d+)/i)?.[1] ?? 0);
}
function abreviar(n: string): string {
  const t = n.replace(/^(FC|CF|AC|AS|SL|SC|RC|RCD|CD|UD|SD)\s+/i, '').trim();
  return t.length <= 12 ? t : t.slice(0, 11) + '.';
}

export function BotonEstadisticas({ onClick }: { onClick: () => void }) {
  return (
    <span
      role="button"
      aria-label="Ver estadísticas"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(92,200,255,0.12)', border: '1px solid rgba(92,200,255,0.45)', cursor: 'pointer', pointerEvents: 'auto', opacity: 1 }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={AZUL} strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
        <path d="M5 20V12M12 20V5M19 20v-9" />
      </svg>
    </span>
  );
}

function useHistorial(jugador: JugadorStats, deporte: string) {
  const [filas, setFilas] = useState<(Fila & { rival: string | null })[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error: e } = await supabase.rpc('jugador_historial', { p_jugador: jugador.id });
      if (!vivo) return;
      if (e) {
        setError(true);
        setFilas([]);
        return;
      }
      const lista = ((data as Fila[]) ?? []).map((f) => ({ ...f, precio: f.precio === null ? null : Number(f.precio), puntos: f.puntos === null ? null : Number(f.puntos) }));
      // Rival de cada jornada (fútbol).
      const rivales = new Map<string, string>();
      if (deporte === 'futbol' && lista.length > 0) {
        const { data: ps } = await supabase
          .from('futbol_partidos_jornada')
          .select('competicion,equipo_local,equipo_visitante,clave_local,clave_visitante')
          .in('competicion', lista.map((f) => f.competicion));
        for (const f of lista) {
          const k = claveEquipoFutbol(f.equipo_real ?? jugador.equipo_real);
          const p = ((ps as Partido[]) ?? []).find((x) => x.competicion === f.competicion && (x.clave_local === k || x.clave_visitante === k || claveEquipoFutbol(x.equipo_local) === k || claveEquipoFutbol(x.equipo_visitante) === k));
          if (p) rivales.set(f.competicion, claveEquipoFutbol(p.equipo_local) === k || p.clave_local === k ? p.equipo_visitante : p.equipo_local);
        }
      }
      if (!vivo) return;
      // De la más antigua a la más reciente.
      lista.sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '') || numJornada(a.competicion) - numJornada(b.competicion));
      setFilas(lista.map((f) => ({ ...f, rival: rivales.get(f.competicion) ?? null })));
    })();
    return () => {
      vivo = false;
    };
  }, [jugador.id, jugador.equipo_real, deporte]);
  return { filas, error };
}

export default function EstadisticasJugador({
  jugador,
  deporte,
  seleccionado,
  puedeElegir,
  sinPrecio = false,
  onElegir,
  onCerrar,
}: {
  jugador: JugadorStats;
  deporte: string;
  seleccionado: boolean;
  puedeElegir: boolean;
  sinPrecio?: boolean;
  onElegir: () => void;
  onCerrar: () => void;
}) {
  const { filas, error } = useHistorial(jugador, deporte);
  const [pantalla, setPantalla] = useState(false);
  const pantallaRef = useRef(false);
  pantallaRef.current = pantalla;
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;

  // El "atrás" del móvil: cierra primero la pantalla completa y luego la hoja.
  useEffect(() => {
    // Se copia el estado actual (el paso de hacer el equipo) para que la pantalla
    // de debajo no cambie de paso al volver atrás.
    window.history.pushState({ ...((window.history.state as object | null) ?? {}), drafStats: 1 }, '');
    const alVolver = () => {
      if (pantallaRef.current) setPantalla(false);
      else cerrarRef.current();
    };
    window.addEventListener('popstate', alVolver);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', alVolver);
      document.body.style.overflow = prev;
    };
  }, []);
  const atras = () => window.history.back();
  const abrirPantalla = () => {
    window.history.pushState({ ...((window.history.state as object | null) ?? {}), drafStats: 2 }, '');
    setPantalla(true);
  };

  const jugadas = useMemo(() => (filas ?? []).filter((f) => f.estado !== 'pendiente' && f.puntos !== null), [filas]);
  const ultimas = jugadas.slice(-4);
  const media = jugadas.length ? jugadas.reduce((s, f) => s + Number(f.puntos), 0) / jugadas.length : null;
  const mejor = jugadas.length ? Math.max(...jugadas.map((f) => Number(f.puntos))) : null;
  const conJuego = jugadas.filter((f) => f.jugo).length;
  const precios = (filas ?? []).filter((f) => f.precio !== null);
  const precioAhora = precios.length ? precios[precios.length - 1].precio! : jugador.precio;
  const precioAntes = precios.length >= 2 ? precios[Math.max(0, precios.length - 5)].precio! : null;
  const tendencia = precioAntes && precioAntes > 0 ? (precioAhora / precioAntes - 1) * 100 : null;
  const precioInicio = precios.length >= 2 ? precios[0].precio! : null;
  const tendenciaTotal = precioInicio && precioInicio > 0 ? (precioAhora / precioInicio - 1) * 100 : null;
  const nombreComp = deporte === 'futbol' ? (filas?.find((f) => f.es_esta)?.competicion ?? '').split(' - ')[0].replace('La Liga', 'LaLiga').replace('Champions League', 'Champions') : deporte === 'golf' ? 'torneos' : 'torneos';
  const subtitulo = [jugador.equipo_real, POS[jugador.posicion ?? ''] ?? null].filter(Boolean).join(' · ');

  const kpi = (v: string, t: string, color = S.TEXT) => (
    <div key={t} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 0', borderRadius: 10, background: '#0E1311', border: '1px solid #1E2723' }}>
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color }}>{v}</span>
      <span style={{ fontSize: 10.5, color: S.MUTED_2 }}>{t}</span>
    </div>
  );

  const barras = (xs: (Fila & { rival: string | null })[]) => {
    const max = Math.max(10, ...xs.map((f) => Number(f.puntos ?? 0)));
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120, padding: '0 4px' }}>
        {xs.map((f) => {
          const p = Number(f.puntos ?? 0);
          return (
            <div key={f.competicion} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: p >= 10 ? VERDE : p > 0 ? S.TEXT : S.MUTED_2 }}>{n1(p)}</span>
              <div style={{ width: '100%', height: Math.max(4, (Math.max(0, p) / max) * 70), borderRadius: '6px 6px 2px 2px', background: p >= 10 ? VERDE : '#2E4A3C' }} />
              <span style={{ fontSize: 10, color: S.MUTED_2, textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {etiquetaCorta(f.competicion, deporte)}
                {f.rival ? (
                  <>
                    <br />
                    vs {abreviar(f.rival)}
                  </>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const grafica = () => {
    const xs = filas ?? [];
    if (xs.length === 0) return null;
    const W = 340;
    const H = 150;
    const paso = xs.length > 1 ? (W - 40) / (xs.length - 1) : 0;
    const x = (i: number) => (xs.length > 1 ? 20 + i * paso : W / 2);
    const ps = xs.map((f) => (f.precio === null ? null : Number(f.precio)));
    const vals = ps.filter((v): v is number => v !== null);
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 1;
    const yP = (v: number) => H - 24 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - 60);
    const maxP = Math.max(10, ...xs.map((f) => Number(f.puntos ?? 0)));
    const ancho = Math.max(6, Math.min(22, paso * 0.6 || 22));
    const linea = xs
      .map((f, i) => (ps[i] !== null ? `${x(i)},${yP(ps[i] as number)}` : null))
      .filter(Boolean)
      .join(' ');
    const cadaEtiqueta = Math.ceil(xs.length / 8);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {xs.map((f, i) => {
          const p = f.estado === 'pendiente' || f.puntos === null ? null : Math.max(0, Number(f.puntos));
          const h = p === null ? 0 : Math.max(2, (p / maxP) * (H - 50));
          return (
            <g key={f.competicion}>
              {p !== null && <rect x={x(i) - ancho / 2} y={H - 24 - h} width={ancho} height={h} rx={4} fill={p >= 10 ? VERDE : '#2E4A3C'} />}
              {i % cadaEtiqueta === 0 || i === xs.length - 1 ? (
                <text x={x(i)} y={H - 8} fill={S.MUTED_2} fontSize={10} textAnchor="middle">
                  {etiquetaCorta(f.competicion, deporte).slice(0, 8)}
                </text>
              ) : null}
            </g>
          );
        })}
        {linea && <polyline points={linea} fill="none" stroke={ORO} strokeWidth={2.5} />}
        {xs.map((f, i) => (ps[i] !== null ? <circle key={`c${f.competicion}`} cx={x(i)} cy={yP(ps[i] as number)} r={3.5} fill={ORO} /> : null))}
      </svg>
    );
  };

  const cargando = filas === null;
  const sinDatos = !cargando && jugadas.length === 0;

  return (
    <>
      {/* Mini ventana */}
      <div onClick={atras} style={{ position: 'fixed', inset: 0, zIndex: 280, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <style>{'@keyframes ej-sube{from{transform:translateY(100%)}}'}</style>
        <div
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={`Estadísticas de ${jugador.nombre}`}
          style={{ width: '100%', maxWidth: 520, background: '#111715', borderTop: `2px solid ${AZUL}`, borderRadius: '20px 20px 0 0', padding: '12px 16px calc(18px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12, animation: 'ej-sube .3s cubic-bezier(.2,.9,.3,1)' }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 9, background: S.BORDER, alignSelf: 'center' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT, lineHeight: 1.1 }}>{jugador.nombre}</span>
              {subtitulo && <span style={{ fontSize: 12, color: S.MUTED_2 }}>{subtitulo}</span>}
            </span>
            {!sinPrecio && (
              <span style={{ textAlign: 'right', flexShrink: 0 }}>
                <span style={{ display: 'block', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: ORO }}>{eur(jugador.precio)}</span>
                {tendencia !== null && Math.abs(tendencia) >= 0.5 && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: tendencia > 0 ? VERDE : '#FF6B6B' }}>
                    {tendencia > 0 ? '▲' : '▼'} {n1(Math.abs(tendencia))} % últimas jornadas
                  </span>
                )}
              </span>
            )}
          </div>
          {/* 05/11 (Iñi): si está de baja o es duda, se dice aquí con su motivo. */}
          {(() => {
            const t = jugador.ausencia ?? (jugador.lesionado ? 'lesion' : null);
            if (!t) return null;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: t === 'duda' ? 'rgba(240,185,77,0.1)' : 'rgba(229,56,59,0.1)', border: `1px solid ${t === 'duda' ? 'rgba(240,185,77,0.45)' : 'rgba(229,56,59,0.45)'}` }}>
                <IconoAusencia tipo={t} size={18} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: S.TEXT }}>
                  {TEXTO_AUSENCIA[t]}
                  {jugador.ausencia_motivo ? <span style={{ fontWeight: 500, color: S.MUTED }}> · {jugador.ausencia_motivo}</span> : null}
                </span>
              </div>
            );
          })()}
          <span style={{ fontSize: 10.5, fontWeight: 700, color: S.MUTED_3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {deporte === 'futbol' ? `Últimos ${Math.min(4, Math.max(1, ultimas.length))} partidos${nombreComp ? ` de ${nombreComp}` : ''}` : `Últimos ${Math.min(4, Math.max(1, ultimas.length))} torneos`}
          </span>
          {cargando ? (
            <span style={{ fontSize: 12.5, color: S.MUTED_3, padding: '20px 0', textAlign: 'center' }}>Cargando…</span>
          ) : error ? (
            <span style={{ fontSize: 12.5, color: S.MUTED_3, padding: '20px 0', textAlign: 'center' }}>Las estadísticas todavía no están disponibles.</span>
          ) : sinDatos ? (
            <span style={{ fontSize: 12.5, color: S.MUTED_3, padding: '20px 0', textAlign: 'center' }}>Todavía no tiene {deporte === 'futbol' ? 'partidos jugados' : 'torneos jugados'} con Drafters.</span>
          ) : (
            barras(ultimas)
          )}
          {!cargando && !sinDatos && (
            <div style={{ display: 'flex', gap: 6 }}>
              {kpi(media === null ? '—' : n1(media), 'media pts')}
              {kpi(`${conJuego}/${jugadas.length}`, deporte === 'futbol' ? 'jugados' : 'con puntos')}
              {kpi(mejor === null ? '—' : n1(mejor), 'mejor')}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={abrirPantalla} disabled={cargando || (filas?.length ?? 0) === 0} style={{ flex: '1 1 0', width: 'auto', minWidth: 0, padding: 12, borderRadius: 12, border: `1.5px solid ${AZUL}`, background: 'transparent', color: AZUL, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, textTransform: 'uppercase', cursor: 'pointer', opacity: cargando || (filas?.length ?? 0) === 0 ? 0.5 : 1 }}>
              Ver todas sus estadísticas
            </button>
            {(seleccionado || puedeElegir) && (
              <button
                type="button"
                onClick={() => {
                  onElegir();
                  atras();
                }}
                style={{ flex: '0 0 auto', width: 'auto', padding: '12px 16px', borderRadius: 12, border: seleccionado ? `1.5px solid ${S.BORDER}` : 'none', background: seleccionado ? 'transparent' : VERDE, color: seleccionado ? S.MUTED : '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, textTransform: 'uppercase', cursor: 'pointer' }}
              >
                {seleccionado ? '− Quitar' : '+ Elegir'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Todas sus estadísticas: por encima de la pantalla de hacer el equipo */}
      {pantalla && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 290, background: S.BG, overflowY: 'auto' }}>
          <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 16px calc(28px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" onClick={atras} aria-label="Volver a tu equipo" style={{ width: 36, height: 36, border: 'none', background: 'transparent', color: VERDE, fontSize: 22, cursor: 'pointer', padding: 0 }}>
                ←
              </button>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 24, color: S.TEXT, lineHeight: 1.1 }}>{jugador.nombre}</span>
                <span style={{ fontSize: 12, color: S.MUTED_2 }}>{[subtitulo, deporte === 'futbol' ? (filas?.find((f) => f.es_esta)?.competicion ?? '').split(' - ')[0] : null].filter(Boolean).join(' · ')}</span>
              </span>
              {!sinPrecio && <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: ORO, flexShrink: 0 }}>{eur(jugador.precio)}</span>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {kpi(media === null ? '—' : n1(media), 'media pts')}
              {kpi(`${conJuego}/${jugadas.length}`, deporte === 'futbol' ? 'jugados' : 'con puntos')}
              {kpi(mejor === null ? '—' : n1(mejor), 'mejor')}
              {tendenciaTotal !== null && kpi(`${tendenciaTotal > 0 ? '+' : ''}${n1(tendenciaTotal)} %`, 'precio', tendenciaTotal > 0 ? VERDE : tendenciaTotal < 0 ? '#FF6B6B' : S.TEXT)}
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 11, color: S.MUTED_2 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: VERDE }} /> Puntos
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 14, height: 3, background: ORO }} /> Precio Drafters
              </span>
            </div>
            <div style={{ borderRadius: 14, background: '#111715', border: '1px solid #1E2723', padding: '10px 6px' }}>{grafica()}</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'grid', gridTemplateColumns: deporte === 'futbol' ? '1fr 1fr 40px 46px 84px' : '1fr 54px 84px', gap: 6, fontSize: 10.5, fontWeight: 700, color: S.MUTED_3, textTransform: 'uppercase', padding: '4px 2px' }}>
                <span>{deporte === 'futbol' ? 'Jornada' : 'Torneo'}</span>
                {deporte === 'futbol' && <span style={{ textAlign: 'right' }}>Rival</span>}
                {deporte === 'futbol' && <span style={{ textAlign: 'right' }}>Min</span>}
                <span style={{ textAlign: 'right' }}>Pts</span>
                <span style={{ textAlign: 'right' }}>Precio</span>
              </div>
              {[...(filas ?? [])].reverse().map((f) => {
                const pend = f.estado === 'pendiente' || f.puntos === null;
                const p = Number(f.puntos ?? 0);
                return (
                  <div key={f.competicion} style={{ display: 'grid', gridTemplateColumns: deporte === 'futbol' ? '1fr 1fr 40px 46px 84px' : '1fr 54px 84px', gap: 6, alignItems: 'center', fontSize: 12.5, padding: '8px 2px', borderTop: '1px solid #1E2723' }}>
                    <span style={{ color: f.es_esta ? AZUL : S.TEXT, fontWeight: f.es_esta ? 800 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {etiquetaLarga(f.competicion, deporte)}
                    </span>
                    {deporte === 'futbol' && <span style={{ textAlign: 'right', color: S.MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.rival ? abreviar(f.rival) : '—'}</span>}
                    {deporte === 'futbol' && <span style={{ textAlign: 'right', color: S.MUTED }}>{pend ? '—' : `${f.minutos}'`}</span>}
                    <span style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: pend ? S.MUTED_3 : p >= 10 ? VERDE : S.TEXT }}>{pend ? (f.estado === 'en_juego' ? '…' : '—') : n1(p)}</span>
                    <span style={{ textAlign: 'right', color: ORO }}>{sinPrecio ? '—' : eur(f.precio)}</span>
                  </div>
                );
              })}
            </div>
            <span style={{ fontSize: 11, color: S.MUTED_3 }}>En azul, {deporte === 'futbol' ? 'la jornada' : 'el torneo'} para {deporte === 'futbol' ? 'la' : 'el'} que estás haciendo el equipo. Al volver atrás sigues con tu equipo tal cual lo tenías.</span>
          </div>
        </div>
      )}
    </>
  );
}
