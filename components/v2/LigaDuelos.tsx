'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { Panel } from '@/components/v2/MarcoV2';
import Cargando from '@/components/Cargando';
import { IconoCredito } from '@/components/v2/IconosV2';
import { mensajeError } from '@/lib/v2';

// ============================================================================
// LIGA DRAFTERS DE FÚTBOL — DUELOS 1 CONTRA 1 POR DIVISIONES (26/10, Iñi)
// ============================================================================
// Temporada = una vuelta de LaLiga. En tu división te enfrentas una vez a cada
// uno (calendario sorteado), con equipo con presupuesto: ganar 3, empatar 1,
// perder 0. Las jornadas de Champions son jornadas extra con rival sorteado.
// Al final suben y bajan (5 de 20). Cada jornada cuesta 1 crédito al hacer el
// equipo. Ver SQL 60.

type Ronda = {
  partido_id?: string;
  ronda_id: string;
  orden: number;
  competicion: string;
  tipo: 'liga' | 'champions';
  estado: 'pendiente' | 'en_juego' | 'terminada';
  rival_id: string | null;
  rival_nombre: string | null;
  mio: number | null;
  rival: number | null;
  resultado: 'G' | 'E' | 'P' | null;
  cierre: string | null;
  tengo_equipo: boolean;
  rival_tiene_equipo: boolean;
};
type Info = {
  apuntado: boolean;
  apuntados: number;
  temporada: { id: string; nombre: string; estado: 'inscripcion' | 'en_juego' | 'terminada'; desde: number; hasta: number; tam: number; ascensos: number; descensos: number; jornadas: number; primera_cierre: string | null } | null;
  division: { id: string; nombre: string; nivel: number } | null;
  divisiones: { id: string; nombre: string; nivel: number; jugadores: number }[];
  ronda: Ronda | null;
  calendario: Ronda[];
};
type LadoJ = { id: string; nombre: string; total: number | null; equipo: boolean; soy_yo: boolean } | null;
type JornadaDiv = { ronda_id: string; orden: number; competicion: string; tipo: 'liga' | 'champions'; estado: 'pendiente' | 'en_juego' | 'terminada'; cierre: string | null; partidos: { id: string; local: LadoJ; visitante: LadoJ; resultado_local: 'G' | 'E' | 'P' | null; resultado_visitante: 'G' | 'E' | 'P' | null }[] };
type DivMiembros = { id: string; nombre: string; nivel: number; miembros: { id: string; nombre: string; soy_yo: boolean }[] };
type Fila = { usuario_id: string; nombre: string; pj: number; g: number; e: number; p: number; pts: number; a_favor: number; en_contra: number; soy_yo: boolean };

const VERDE = '#3DDC84';
const ROJO = '#FF8A8A';
const ORO = '#F0B94D';

export function jornadaBonita(c: string): string {
  const n = c.match(/Jornada\s*(\d+)/i)?.[1];
  if (/champions/i.test(c)) return `Champions · J${n ?? ''}`;
  return `LaLiga · J${n ?? ''}`;
}
function fecha(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(iso));
}
function pts(x: number | null): string {
  if (x === null || x === undefined) return '–';
  return String(Math.round(Number(x) * 10) / 10);
}
// Cuántos suben / bajan en una división (como en la base de datos).
function movimientos(n: number, tam: number, asc: number): number {
  if (n >= tam) return asc;
  return n >= 4 ? Math.max(1, Math.round(n * 0.25)) : 0;
}

export default function LigaDuelos() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [divVista, setDivVista] = useState<string | null>(null);
  const [tabla, setTabla] = useState<Fila[] | null>(null);
  const [jornadas, setJornadas] = useState<JornadaDiv[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [divs, setDivs] = useState<DivMiembros[] | null>(null);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('duelos_mi_liga');
    if (e) return setError(mensajeError(e));
    const i = data as Info;
    setInfo(i);
    setDivVista((d) => d ?? i.division?.id ?? i.divisiones[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), 60000);
    return () => clearInterval(t);
  }, [cargar]);

  useEffect(() => {
    if (!divVista) return setTabla(null);
    void supabase.rpc('duelos_clasificacion', { p_division: divVista }).then(({ data }) => setTabla((data as Fila[]) ?? []));
    void supabase.rpc('duelos_jornadas_division', { p_division: divVista }).then(({ data }) => {
      const js = (data as JornadaDiv[]) ?? [];
      setJornadas(js);
      // Abierta de serie: la jornada en juego o, si no, la última terminada.
      setAbierta((a) => a ?? (js.find((j) => j.estado === 'en_juego') ?? [...js].reverse().find((j) => j.estado === 'terminada'))?.ronda_id ?? null);
    });
  }, [divVista, info]);

  useEffect(() => {
    if (!info?.temporada?.id || info.divisiones.length === 0) return;
    void supabase.rpc('duelos_divisiones_miembros', { p_temporada: info.temporada.id }).then(({ data }) => setDivs((data as DivMiembros[]) ?? []));
  }, [info?.temporada?.id, info?.divisiones.length]);

  function verDivision(id: string) {
    setDivVista(id);
    setAbierta(null);
    window.setTimeout(() => document.getElementById('clasificacion-liga')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  async function apuntarse(si: boolean) {
    setOcupado(true);
    setError(null);
    const { error: e } = await supabase.rpc(si ? 'duelos_apuntarse' : 'duelos_desapuntarse');
    setOcupado(false);
    if (e) return setError(mensajeError(e));
    void cargar();
  }

  if (!info) return error ? <p style={S.errorText}>{error}</p> : <Cargando compacto />;

  const t = info.temporada;
  const enJuego = t?.estado === 'en_juego';
  const juego = !!info.division && enJuego;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Cabecera */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 24, color: S.TEXT, lineHeight: 1.1 }}>🏆 Liga Drafters</span>
        <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>
          {t ? t.nombre : 'Duelos 1 contra 1 por divisiones'}
          {info.division ? ` · ${info.division.nombre} división` : ''}
        </span>
      </div>

      {/* Mi duelo de la jornada */}
      {juego && info.ronda && <MiDuelo r={info.ronda} />}
      {juego && !info.ronda && (
        <Panel>
          <span style={{ fontWeight: 800, color: S.TEXT }}>Has jugado todas las jornadas de esta temporada.</span>
          <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Al cerrar la temporada se ve quién sube y quién baja.</span>
        </Panel>
      )}

      {/* Apuntarse / explicación */}
      {!juego && (
        <Panel style={{ gap: 12 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>Así funciona</span>
          {[
            ['⚔️', 'Cada jornada, un duelo 1 contra 1 con un rival de tu división.'],
            ['📋', 'Equipo con presupuesto de 100.000 €, como siempre.'],
            ['🔁', 'En una temporada (una vuelta de LaLiga) juegas una vez contra cada uno de tu división.'],
            ['⭐', 'Las jornadas de Champions son jornadas extra, con rival sorteado.'],
            ['3️⃣', 'Ganar 3 puntos · empatar 1 · perder 0. Si no haces equipo, pierdes.'],
            ['⬆️', `Al final de la temporada suben y bajan los ${t?.ascensos && t.tam >= 20 ? t.ascensos : 5} primeros y últimos de cada división.`],
          ].map(([i, x]) => (
            <div key={x} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 17, lineHeight: 1.2 }}>{i}</span>
              <span style={{ fontSize: 13, color: S.MUTED, lineHeight: 1.45 }}>{x}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: S.MUTED }}>
            <IconoCredito size={16} /> Cada jornada cuesta 1 crédito de fútbol (al hacer tu equipo).
          </div>
          {info.apuntado ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 12, background: 'rgba(61,220,132,0.08)', border: '1px solid rgba(61,220,132,0.4)' }}>
              <span style={{ fontWeight: 800, color: VERDE }}>✓ Estás apuntado</span>
              <span style={{ fontSize: 12.5, color: S.MUTED_2, lineHeight: 1.45 }}>
                {t && t.estado === 'inscripcion'
                  ? `Empiezas en la ${t.nombre}${t.primera_cierre ? ` (${fecha(t.primera_cierre)})` : ''}. Las divisiones se forman al empezar.`
                  : enJuego
                    ? 'La temporada ya está en marcha: entras en la próxima.'
                    : 'Entrarás en cuanto empiece la próxima temporada.'}
              </span>
              <button type="button" disabled={ocupado} onClick={() => void apuntarse(false)} style={{ alignSelf: 'flex-start', width: 'auto', background: 'none', border: 'none', padding: 0, color: S.MUTED_3, fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>
                Desapuntarme
              </button>
            </div>
          ) : (
            <button type="button" disabled={ocupado} onClick={() => void apuntarse(true)} style={{ ...S.primaryButton, opacity: ocupado ? 0.6 : 1 }}>
              {ocupado ? 'Apuntando…' : 'Apuntarme a la liga'}
            </button>
          )}
          <span style={{ fontSize: 12, color: S.MUTED_3 }}>{info.apuntados} {info.apuntados === 1 ? 'apuntado' : 'apuntados'}</span>
          {error && <p style={S.errorText}>{error}</p>}
        </Panel>
      )}

      {/* Mi calendario */}
      {juego && info.calendario.length > 0 && (
        <Panel style={{ padding: 14, gap: 6 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>Tus equipos y duelos</span>
          {info.calendario.map((r) => (
            <Link key={r.ronda_id} href={r.partido_id ? `/v2/liga/duelo/${r.partido_id}` : '#'} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #1A221E', textDecoration: 'none' }}>
              <span style={{ width: 104, flexShrink: 0, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 800, color: r.tipo === 'champions' ? '#7FB2FF' : S.MUTED }}>{jornadaBonita(r.competicion)}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.rival_id ? `vs ${r.rival_nombre ?? 'Alguien'}` : 'Descanso'}</span>
              {r.estado === 'terminada' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {r.rival_id && <span style={{ fontSize: 12, color: S.MUTED_2 }}>{pts(r.mio)}–{pts(r.rival)}</span>}
                  <span style={{ width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, background: r.resultado === 'G' ? 'rgba(61,220,132,0.2)' : r.resultado === 'E' ? 'rgba(240,185,77,0.2)' : 'rgba(255,92,92,0.2)', color: r.resultado === 'G' ? VERDE : r.resultado === 'E' ? ORO : ROJO }}>{r.resultado}</span>
                </span>
              ) : r.estado === 'en_juego' ? (
                <span style={{ fontSize: 12, fontWeight: 800, color: VERDE }}>
                  ● {pts(r.mio)}–{pts(r.rival)}
                </span>
              ) : (
                <span style={{ fontSize: 11.5, color: r.tengo_equipo ? VERDE : S.MUTED_3 }}>{r.tengo_equipo ? '✓ equipo' : r.cierre ? fecha(r.cierre) : 'sin publicar'}</span>
              )}
              <span style={{ color: S.MUTED_3, fontSize: 14 }}>›</span>
            </Link>
          ))}
        </Panel>
      )}
      {/* Clasificación */}
      {t && info.divisiones.length > 0 && (
        <Panel style={{ padding: 14, scrollMarginTop: 12 }}>
          <div id="clasificacion-liga" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>Clasificación</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: S.MUTED_2 }}>{info.divisiones.find((x) => x.id === divVista)?.nombre} división</span>
          </div>
          {info.divisiones.length > 1 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {info.divisiones.map((d) => (
                <button key={d.id} type="button" onClick={() => { setDivVista(d.id); setAbierta(null); }} style={{ ...S.pill(divVista === d.id), width: 'auto', flexShrink: 0 }}>
                  {d.nombre}
                  {info.division?.id === d.id ? ' · tú' : ''}
                </button>
              ))}
            </div>
          )}
          {tabla === null ? (
            <Cargando compacto />
          ) : (
            (() => {
              const d = info.divisiones.find((x) => x.id === divVista);
              const n = tabla.length;
              const mov = movimientos(n, t.tam, t.ascensos);
              const ultimo = Math.max(...info.divisiones.map((x) => x.nivel));
              return (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '26px 1fr 26px 26px 26px 26px 36px', gap: 2, padding: '4px 6px', fontSize: 10.5, fontWeight: 800, color: S.MUTED_3, textTransform: 'uppercase' }}>
                    <span>#</span>
                    <span>Jugador</span>
                    <span style={{ textAlign: 'center' }}>PJ</span>
                    <span style={{ textAlign: 'center' }}>G</span>
                    <span style={{ textAlign: 'center' }}>E</span>
                    <span style={{ textAlign: 'center' }}>P</span>
                    <span style={{ textAlign: 'right' }}>Pts</span>
                  </div>
                  {tabla.map((f, i) => {
                    const sube = d && d.nivel > 1 && i < mov;
                    const baja = d && d.nivel < ultimo && i >= n - mov;
                    return (
                      <div
                        key={f.usuario_id}
                        style={{ display: 'grid', gridTemplateColumns: '26px 1fr 26px 26px 26px 26px 36px', gap: 2, alignItems: 'center', padding: '8px 6px', borderTop: '1px solid #1A221E', background: f.soy_yo ? 'rgba(61,220,132,0.08)' : 'transparent', borderLeft: `3px solid ${sube ? VERDE : baja ? ROJO : 'transparent'}` }}
                      >
                        <span style={{ fontWeight: 800, fontSize: 13, color: i === 0 && d?.nivel === 1 ? ORO : S.MUTED }}>{i + 1}</span>
                        <span style={{ fontWeight: 800, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.nombre}</span>
                        <span style={{ textAlign: 'center', fontSize: 12.5, color: S.MUTED }}>{f.pj}</span>
                        <span style={{ textAlign: 'center', fontSize: 12.5, color: S.MUTED }}>{f.g}</span>
                        <span style={{ textAlign: 'center', fontSize: 12.5, color: S.MUTED }}>{f.e}</span>
                        <span style={{ textAlign: 'center', fontSize: 12.5, color: S.MUTED }}>{f.p}</span>
                        <span style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: S.TEXT }}>{f.pts}</span>
                      </div>
                    );
                  })}
                  {mov > 0 && (
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 11.5, color: S.MUTED_2 }}>
                      {d && d.nivel > 1 && (
                        <span>
                          <span style={{ color: VERDE }}>■</span> Suben {mov}
                        </span>
                      )}
                      {d && d.nivel < ultimo && (
                        <span>
                          <span style={{ color: ROJO }}>■</span> Bajan {mov}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </Panel>
      )}

      {/* Histórico de jornadas de la división que se está viendo */}
      {t && jornadas && jornadas.length > 0 && (
        <Panel style={{ padding: 14, gap: 8 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>Jornadas</span>
          {[...jornadas].reverse().map((j) => {
            const open = abierta === j.ronda_id;
            return (
              <div key={j.ronda_id} style={{ borderTop: '1px solid #1A221E' }}>
                <button type="button" onClick={() => setAbierta(open ? null : j.ronda_id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 800, color: j.tipo === 'champions' ? '#7FB2FF' : S.TEXT }}>
                    {j.tipo === 'champions' ? '⭐ ' : ''}
                    {jornadaBonita(j.competicion)}
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: j.estado === 'en_juego' ? VERDE : S.MUTED_3 }}>{j.estado === 'terminada' ? 'Terminada' : j.estado === 'en_juego' ? '● En juego' : j.cierre ? fecha(j.cierre) : 'Sin publicar'}</span>
                  <span style={{ color: S.MUTED_3, fontSize: 12 }}>{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10 }}>
                    {j.partidos.map((p) => (
                      <Link key={p.id} href={`/v2/liga/duelo/${p.id}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr 12px', alignItems: 'center', gap: 8, padding: '10px 10px', borderRadius: 10, background: p.local?.soy_yo || p.visitante?.soy_yo ? 'rgba(61,220,132,0.08)' : '#111614', border: `1px solid ${S.CARD_BORDER}`, textDecoration: 'none' }}>
                        <NombreDuelo lado={p.local} res={p.resultado_local} />
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 17, color: S.TEXT, whiteSpace: 'nowrap' }}>
                          {j.estado === 'pendiente' ? 'vs' : `${p.local ? (p.local.equipo ? pts(p.local.total) : '0') : '·'} – ${p.visitante ? (p.visitante.equipo ? pts(p.visitante.total) : '0') : '·'}`}
                        </span>
                        <NombreDuelo lado={p.visitante} res={p.resultado_visitante} derecha />
                        <span style={{ color: S.MUTED_3, fontSize: 13 }}>›</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Panel>
      )}

      {/* Todas las divisiones y quién está en cada una */}
      {divs && divs.length > 0 && (
        <Panel style={{ padding: 14, gap: 10 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>Divisiones</span>
          {divs.map((d) => (
            <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 12, border: `1px solid ${d.id === info.division?.id ? 'rgba(61,220,132,0.5)' : S.CARD_BORDER}`, background: d.id === info.division?.id ? 'rgba(61,220,132,0.06)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 14.5, color: S.TEXT }}>
                  {d.nivel === 1 ? '🥇 ' : d.nivel === 2 ? '🥈 ' : d.nivel === 3 ? '🥉 ' : ''}
                  {d.nombre}
                  <span style={{ fontWeight: 600, fontSize: 12, color: S.MUTED_2 }}> · {d.miembros.length} jugadores{d.id === info.division?.id ? ' · la tuya' : ''}</span>
                </span>
                <button type="button" onClick={() => verDivision(d.id)} style={{ width: 'auto', padding: '5px 10px', borderRadius: 8, border: `1px solid ${S.BORDER}`, background: 'transparent', color: S.ACCENT, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                  Ver
                </button>
              </div>
              <span style={{ fontSize: 12.5, color: S.MUTED, lineHeight: 1.6 }}>
                {d.miembros.map((m, i) => (
                  <span key={m.id} style={{ color: m.soy_yo ? VERDE : S.MUTED, fontWeight: m.soy_yo ? 800 : 500 }}>
                    {m.nombre}
                    {i < d.miembros.length - 1 ? ' · ' : ''}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

function MiDuelo({ r }: { r: Ronda }) {
  const descanso = !r.rival_id;
  const abierta = r.estado === 'pendiente' && !!r.cierre;
  return (
    <div style={{ background: 'linear-gradient(160deg, #15241C 0%, #111614 70%)', border: '1px solid rgba(61,220,132,0.4)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: r.tipo === 'champions' ? '#7FB2FF' : VERDE }}>
          {r.tipo === 'champions' ? '⭐ Jornada extra · ' : ''}
          {jornadaBonita(r.competicion)}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: r.estado === 'en_juego' ? VERDE : S.MUTED_2 }}>{r.estado === 'en_juego' ? '● En juego' : r.cierre ? `Cierra ${fecha(r.cierre)}` : 'Sin publicar todavía'}</span>
      </div>

      {descanso ? (
        <div style={{ textAlign: 'center', padding: '6px 0' }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 24, color: S.TEXT }}>😴 Esta jornada descansas</span>
          <div style={{ fontSize: 12.5, color: S.MUTED_2, marginTop: 2 }}>Te llevas los 3 puntos sin jugar.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8 }}>
          <Lado nombre="Tú" total={r.mio} equipo={r.tengo_equipo} mostrar={r.estado !== 'pendiente'} destacado />
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.MUTED_3 }}>VS</span>
          <Lado nombre={r.rival_nombre ?? 'Alguien'} total={r.rival} equipo={r.rival_tiene_equipo} mostrar={r.estado !== 'pendiente'} />
        </div>
      )}

      {!descanso && abierta && (
        <Link
          href={`/v2/liga/${r.ronda_id}/equipo`}
          style={{ ...S.primaryButton, textDecoration: 'none', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {r.tengo_equipo ? '✏️ Cambiar mi equipo' : (
            <>
              Hacer mi equipo · 1 <IconoCredito size={16} oscuro />
            </>
          )}
        </Link>
      )}
      {!descanso && r.estado === 'pendiente' && !r.cierre && <span style={{ fontSize: 12, color: S.MUTED_2, textAlign: 'center' }}>En cuanto se publique la jornada podrás hacer tu equipo.</span>}
    </div>
  );
}

function Lado({ nombre, total, equipo, mostrar, destacado = false }: { nombre: string; total: number | null; equipo: boolean; mostrar: boolean; destacado?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
      <span style={{ maxWidth: '100%', fontWeight: 800, fontSize: 15, color: destacado ? VERDE : S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre}</span>
      {mostrar ? (
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 34, lineHeight: 1, color: S.TEXT }}>{equipo ? pts(total) : '–'}</span>
      ) : (
        <span style={{ fontSize: 11.5, fontWeight: 700, color: equipo ? VERDE : S.MUTED_3 }}>{equipo ? '✓ Equipo hecho' : 'Sin equipo'}</span>
      )}
      {mostrar && !equipo && <span style={{ fontSize: 10.5, color: ROJO }}>sin equipo</span>}
    </div>
  );
}

function NombreDuelo({ lado, res, derecha = false }: { lado: LadoJ; res: 'G' | 'E' | 'P' | null; derecha?: boolean }) {
  const color = res === 'G' ? VERDE : res === 'P' ? S.MUTED_2 : S.TEXT;
  return (
    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: derecha ? 'flex-end' : 'flex-start' }}>
      <span style={{ maxWidth: '100%', fontWeight: res === 'G' || lado?.soy_yo ? 800 : 600, fontSize: 13.5, color: lado?.soy_yo ? VERDE : color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lado ? lado.nombre : 'Descanso'}</span>
      {lado && !lado.equipo && <span style={{ fontSize: 10, color: S.MUTED_3 }}>sin equipo</span>}
    </span>
  );
}
