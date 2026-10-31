'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { Panel } from '@/components/v2/MarcoV2';
import Cargando from '@/components/Cargando';
import { IconoCredito } from '@/components/v2/IconosV2';
import { mensajeError } from '@/lib/v2';
import { UsuarioConNivel, useNiveles } from '@/components/v2/Nivel';

// ============================================================================
// LIGA DRAFTERS DE FÚTBOL — DUELOS 1 CONTRA 1 POR DIVISIONES (26/10, Iñi)
// ============================================================================
// Temporada = una vuelta de LaLiga. En tu división te enfrentas una vez a cada
// uno (rival sorteado al publicarse cada jornada, 27/10), con equipo con presupuesto: ganar 3, empatar 1,
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
  temporada: { id: string; nombre: string; estado: 'inscripcion' | 'en_juego' | 'terminada'; desde: number; hasta: number; tam: number; ascensos: number; descensos: number; jornadas: number; primera_cierre: string | null; sin_fin?: boolean; num_rondas?: number | null } | null;
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

export function jornadaBonita(c: string, deporte = 'futbol'): string {
  if (deporte !== 'futbol') return c.replace(/^(ATP|WTA)\s*·\s*/i, '').replace(/\s+\d{4}$/, '');
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

// 28/10 (Iñi): la misma liga en golf (y tenis cuando se active): 19 torneos por
// temporada, un torneo por semana (el más importante). SQL 69.
export default function LigaDuelos({ deporte = 'futbol' }: { deporte?: 'futbol' | 'golf' | 'tenis' } = {}) {
  const esFutbol = deporte === 'futbol';
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [divVista, setDivVista] = useState<string | null>(null);
  const [tabla, setTabla] = useState<Fila[] | null>(null);
  const [jornadas, setJornadas] = useState<JornadaDiv[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [divs, setDivs] = useState<DivMiembros[] | null>(null);
  // 31/10 (Iñi): el nivel delante de cada nombre; al pulsarlo, su ficha y el cara a cara.
  const niveles = useNiveles((tabla ?? []).map((f) => f.usuario_id));
  const miIdTabla = tabla?.find((f) => f.soy_yo)?.usuario_id;

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('duelos_mi_liga', { p_deporte: deporte });
    if (e) return setError(mensajeError(e));
    const i = data as Info;
    setInfo(i);
    setDivVista((d) => d ?? i.division?.id ?? i.divisiones[0]?.id ?? null);
  }, [deporte]);

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
    const { error: e } = await supabase.rpc(si ? 'duelos_apuntarse' : 'duelos_desapuntarse', { p_deporte: deporte });
    setOcupado(false);
    if (e) return setError(mensajeError(e));
    void cargar();
  }

  if (!info) return error ? <p style={S.errorText}>{error}</p> : <Cargando compacto />;

  const t = info.temporada;
  const enJuego = t?.estado === 'en_juego';
  const juego = !!info.division && enJuego;

  // 27/10 (Iñi): arriba del todo la clasificación; debajo, todas las jornadas
  // (la más reciente arriba) con todos los enfrentamientos, el tuyo resaltado.
  const totalLiga = t ? t.hasta - t.desde + 1 : 0;
  const ligaTerminadas = (jornadas ?? []).filter((j) => j.tipo === 'liga' && j.estado === 'terminada').length;
  const faltan = Math.max(0, totalLiga - ligaTerminadas);
  const hayPendiente = (jornadas ?? []).some((j) => j.estado === 'pendiente');
  // 28/10 (Iñi): "Hacer mi equipo" arriba del todo, solo si todavía no lo has hecho.
  const sinEquipo = juego ? [...info.calendario].sort((a, b) => a.orden - b.orden).find((r) => r.estado === 'pendiente' && !!r.cierre && !!r.rival_id && !r.tengo_equipo && new Date(r.cierre).getTime() > Date.now()) : undefined;

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

      {/* Apuntarse / explicación */}
      {!juego && (
        <Panel style={{ gap: 12 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>Así funciona</span>
          {[
            ['⚔️', 'Cada jornada, un duelo 1 contra 1 con un rival de tu división.'],
            ['📋', 'Equipo con presupuesto de 100.000 €, como siempre.'],
            ...(esFutbol
              ? [
                  ['🔁', 'Tu rival se sortea en cuanto se publica cada jornada. En una temporada (una vuelta de LaLiga) no repites rival.'],
                  ['⭐', 'Las jornadas de Champions son jornadas extra, con rival sorteado.'],
                ]
              : [
                  ['🏆', `Cada semana cuenta un torneo: el más importante de la semana. Una temporada son ${t?.num_rondas ?? 19} torneos.`],
                  ['🔁', 'Tu rival se sortea en cuanto se publica cada torneo. En una temporada no repites rival.'],
                ]),
            ['3️⃣', 'Ganar 3 puntos · empatar 1 · perder 0. Si no haces equipo, pierdes.'],
            ['⬆️', `Al final de la temporada suben y bajan los ${t?.ascensos && t.tam >= 20 ? t.ascensos : 5} primeros y últimos de cada división.`],
          ].map(([i, x]) => (
            <div key={x} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 17, lineHeight: 1.2 }}>{i}</span>
              <span style={{ fontSize: 13, color: S.MUTED, lineHeight: 1.45 }}>{x}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: S.MUTED }}>
            <IconoCredito size={16} /> Cada {esFutbol ? 'jornada' : 'torneo'} cuesta 1 crédito de {esFutbol ? 'fútbol' : deporte} (al hacer tu equipo).
          </div>
          {info.apuntado ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 12, background: 'rgba(61,220,132,0.08)', border: '1px solid rgba(61,220,132,0.4)' }}>
              <span style={{ fontWeight: 800, color: VERDE }}>✓ Estás apuntado</span>
              <span style={{ fontSize: 12.5, color: S.MUTED_2, lineHeight: 1.45 }}>
                {t && t.estado === 'inscripcion'
                  ? `Empiezas en la ${t.nombre}${t.primera_cierre ? ` (${fecha(t.primera_cierre)})` : ''}. Las divisiones se forman al empezar.`
                  : enJuego
                    ? t.sin_fin
                      ? 'Entras en la liga con la próxima jornada que se publique (empiezas con 0 puntos).'
                      : 'La temporada ya está en marcha: entras en la próxima.'
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

      {/* Hacer mi equipo (solo si falta) */}
      {sinEquipo && (
        <Link href={`/v2/liga/${sinEquipo.ronda_id}/equipo`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px', borderRadius: 16, background: 'linear-gradient(135deg, rgba(61,220,132,0.22) 0%, rgba(61,220,132,0.06) 100%)', border: '1px solid rgba(61,220,132,0.5)' }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: VERDE }}>
              Jornada {sinEquipo.orden} · {etiquetaReal(sinEquipo.competicion, deporte)}
            </span>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 21, color: S.TEXT, lineHeight: 1.1 }}>Haz tu equipo contra {sinEquipo.rival_nombre ?? 'tu rival'}</span>
            <span style={{ fontSize: 12, color: S.MUTED_2 }}>Hasta {fecha(sinEquipo.cierre)}</span>
          </span>
          <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderRadius: 12, background: VERDE, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, textTransform: 'uppercase' }}>
            Hacer · 1 <IconoCredito size={15} oscuro />
          </span>
        </Link>
      )}

      {/* 28/10: elegir división (cambia la clasificación y las jornadas) */}
      {t && info.divisiones.length > 1 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {info.divisiones.map((d) => (
            <button key={d.id} type="button" onClick={() => setDivVista(d.id)} style={{ ...S.pill(divVista === d.id), width: 'auto', flexShrink: 0 }}>
              {d.nivel === 1 ? '🥇 ' : d.nivel === 2 ? '🥈 ' : d.nivel === 3 ? '🥉 ' : ''}
              {d.nombre}
              {info.division?.id === d.id ? ' · tú' : ''}
            </button>
          ))}
        </div>
      )}

      {/* Clasificación */}
      {t && info.divisiones.length > 0 && (
        <Panel style={{ padding: 14, scrollMarginTop: 12 }}>
          <div id="clasificacion-liga" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>Clasificación</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: S.MUTED_2 }}>{info.divisiones.find((x) => x.id === divVista)?.nombre} división</span>
          </div>
          {tabla === null ? (
            <Cargando compacto />
          ) : (
            (() => {
              const d = info.divisiones.find((x) => x.id === divVista);
              const n = tabla.length;
              const mov = movimientos(n, t.tam, t.ascensos);
              const ultimo = Math.max(...info.divisiones.map((x) => x.nivel));
              const cols = '18px minmax(0,1fr) 24px 30px 40px 40px 42px';
              const num = { textAlign: 'right' as const, fontSize: 12, color: S.MUTED, fontVariantNumeric: 'tabular-nums' as const };
              return (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 3, padding: '4px 4px', fontSize: 10, fontWeight: 800, color: S.MUTED_3, textTransform: 'uppercase' }}>
                    <span>#</span>
                    <span>Equipo</span>
                    <span style={{ textAlign: 'right' }}>PJ</span>
                    <span style={{ textAlign: 'right' }}>Pts</span>
                    <span style={{ textAlign: 'right' }}>PF</span>
                    <span style={{ textAlign: 'right' }}>PC</span>
                    <span style={{ textAlign: 'right' }}>Dif</span>
                  </div>
                  {tabla.map((f, i) => {
                    const sube = d && d.nivel > 1 && i < mov;
                    const baja = d && d.nivel < ultimo && i >= n - mov;
                    const dif = Math.round((Number(f.a_favor) - Number(f.en_contra)) * 10) / 10;
                    return (
                      <div
                        key={f.usuario_id}
                        style={{ display: 'grid', gridTemplateColumns: cols, gap: 3, alignItems: 'center', padding: '8px 4px', borderTop: '1px solid #1A221E', background: f.soy_yo ? 'rgba(61,220,132,0.08)' : 'transparent', borderLeft: `3px solid ${sube ? VERDE : baja ? ROJO : 'transparent'}` }}
                      >
                        <span style={{ fontWeight: 800, fontSize: 12.5, color: i === 0 && d?.nivel === 1 ? ORO : S.MUTED }}>{i + 1}</span>
                        <span style={{ minWidth: 0, fontWeight: 800, fontSize: 13, color: f.soy_yo ? VERDE : S.TEXT }}>
                          <UsuarioConNivel id={f.usuario_id} nombre={f.nombre} nivel={niveles.get(f.usuario_id)} miId={miIdTabla} sinArroba modo="popover" />
                        </span>
                        <span style={num}>{f.pj}</span>
                        <span style={{ textAlign: 'right', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: S.TEXT }}>{f.pts}</span>
                        <span style={num}>{pts(f.a_favor)}</span>
                        <span style={num}>{pts(f.en_contra)}</span>
                        <span style={{ ...num, fontWeight: 700, color: dif > 0 ? VERDE : dif < 0 ? ROJO : S.MUTED }}>{dif > 0 ? '+' : ''}{pts(dif)}</span>
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: S.MUTED_2 }}>
                    <span>PF: puntos a favor · PC: en contra · Dif: diferencia (desempata)</span>
                    {mov > 0 && d && d.nivel > 1 && (
                      <span>
                        <span style={{ color: VERDE }}>■</span> Suben {mov}
                      </span>
                    )}
                    {mov > 0 && d && d.nivel < ultimo && (
                      <span>
                        <span style={{ color: ROJO }}>■</span> Bajan {mov}
                      </span>
                    )}
                  </div>
                </div>
              );
            })()
          )}
        </Panel>
      )}

      {/* Jornadas: la más reciente arriba, con todos los enfrentamientos */}
      {t && info.divisiones.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, color: S.TEXT }}>Jornadas</span>
          {enJuego && jornadas && !hayPendiente && (
            <span style={{ fontSize: 12.5, color: S.MUTED_2, lineHeight: 1.45 }}>
              {faltan > 0 || t.sin_fin ? 'La próxima jornada todavía no está publicada. En cuanto se publique, se sortean los duelos y ya puedes hacer tu equipo.' : ''}
            </span>
          )}
          {jornadas === null ? (
            <Cargando compacto />
          ) : jornadas.length === 0 ? (
            <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>Todavía no hay jornadas publicadas.</span>
          ) : (
            [...jornadas].sort((a, b) => b.orden - a.orden).map((j) => {
              const miRonda = info.calendario.find((r) => r.ronda_id === j.ronda_id);
              const puedoHacer = !!miRonda && j.estado === 'pendiente' && !!j.cierre && !!miRonda.rival_id;
              return (
                <Panel key={j.ronda_id} style={{ padding: 12, gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 800, color: j.tipo === 'champions' ? '#7FB2FF' : S.TEXT }}>
                      {j.tipo === 'champions' ? '⭐ ' : ''}Jornada {j.orden}{' '}
                      <span style={{ fontWeight: 600, fontSize: 12.5, color: S.MUTED_2 }}>({etiquetaReal(j.competicion, deporte)})</span>
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: j.estado === 'en_juego' ? VERDE : S.MUTED_3, whiteSpace: 'nowrap' }}>{j.estado === 'en_juego' ? '● En juego' : j.estado === 'terminada' ? `${dia(j.cierre)} · Terminada` : dia(j.cierre)}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 12, background: '#0E1311', border: '1px solid #1A221E', overflow: 'hidden' }}>
                    {j.partidos.map((p, i) => (
                      <TarjetaDuelo key={p.id} p={p} estado={j.estado} primera={i === 0} />
                    ))}
                  </div>
                  {/* El botón grande de hacer el equipo va arriba del todo; aquí, solo cambiarlo. */}
                  {puedoHacer && miRonda?.tengo_equipo && (
                    <Link href={`/v2/liga/${j.ronda_id}/equipo`} style={{ alignSelf: 'center', fontSize: 12, fontWeight: 700, color: VERDE, textDecoration: 'none', padding: '2px 0' }}>
                      ✏️ Cambiar mi equipo (hasta {fecha(j.cierre)})
                    </Link>
                  )}
                  {miRonda && !miRonda.rival_id && j.estado !== 'terminada' && <span style={{ fontSize: 12, color: S.MUTED_2, textAlign: 'center' }}>😴 Esta jornada descansas: te llevas los 3 puntos.</span>}
                </Panel>
              );
            })
          )}
        </div>
      )}

      {/* Información de la temporada */}
      {t && t.estado !== 'inscripcion' && (
        <Panel style={{ padding: 14, gap: 6 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, color: S.TEXT }}>Temporada</span>
          <span style={{ fontSize: 13, color: S.MUTED, lineHeight: 1.5 }}>
            {!esFutbol ? (
              t.sin_fin ? (
                <>Liga de pruebas: de momento no tiene final. Cada semana cuenta el torneo más importante. Si alguien se apunta, entra en el siguiente torneo con 0 puntos.</>
              ) : (
                <>
                  {t.num_rondas ?? 19} torneos (uno por semana, el más importante).
                  {t.estado === 'en_juego' ? ` Quedan ${Math.max(0, (t.num_rondas ?? 19) - (jornadas ?? []).filter((j) => j.estado === 'terminada').length)}.` : ' Terminada.'}
                </>
              )
            ) : t.sin_fin ? (
              <>Liga de pruebas: empieza en la jornada {t.desde} de LaLiga y de momento no tiene final. Si alguien se apunta, entra en la siguiente jornada con 0 puntos.</>
            ) : (
              <>
                De la jornada {t.desde} a la {t.hasta} de LaLiga (más las de Champions que caen entre medias).
                {t.estado === 'en_juego' ? ` Quedan ${faltan} ${faltan === 1 ? 'jornada' : 'jornadas'} de LaLiga.` : ' Terminada.'}
              </>
            )}
          </span>
          <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.5 }}>Ganar 3 · empatar 1 · perder 0. Si no haces equipo, pierdes; si descansas, ganas. Con empate a puntos, desempata la diferencia de puntos.</span>
        </Panel>
      )}

      {/* Todas las divisiones y quién está en cada una */}
      {divs && divs.length > 1 && (
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

/** "J9 LaLiga" / "J4 Champions"; en golf y tenis, el nombre del torneo. */
function etiquetaReal(c: string, deporte = 'futbol'): string {
  if (deporte !== 'futbol') return c.replace(/^(ATP|WTA)\s*·\s*/i, '').replace(/\s+\d{4}$/, '');
  const n = c.match(/Jornada\s*(\d+)/i)?.[1] ?? '';
  return /champions/i.test(c) ? `J${n} Champions` : `J${n} LaLiga`;
}
function dia(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' }).format(new Date(iso));
}

// 28/10 (Iñi): diseño "A" — cada duelo en una fila de la lista: círculo de
// color con la inicial, nombre en letra fina, marcador pequeño en el centro
// (ganador en verde, perdedor apagado, empate en dorado). Tu fila con fondo
// verde suave y una línea verde a la izquierda.
type PartidoJ = JornadaDiv['partidos'][number];
const COLORES_AVATAR = ['#2F6B4F', '#3B5B8C', '#7A4E8C', '#8C5A3B', '#2E7476', '#7C6A2E', '#8C3B4E', '#4E5A6B'];
function colorDe(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return COLORES_AVATAR[h % COLORES_AVATAR.length];
}
const LETRA = "'Barlow Condensed', sans-serif";

function TarjetaDuelo({ p, estado, primera }: { p: PartidoJ; estado: JornadaDiv['estado']; primera: boolean }) {
  const mio = !!(p.local?.soy_yo || p.visitante?.soy_yo);
  const mostrar = estado !== 'pendiente';
  const vivo = estado === 'en_juego';
  return (
    <Link
      href={`/v2/liga/duelo/${p.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
        alignItems: 'center',
        columnGap: 10,
        padding: '10px 12px',
        background: mio ? 'rgba(61,220,132,0.07)' : 'transparent',
        borderTop: primera ? 'none' : '1px solid rgba(255,255,255,0.045)',
        boxShadow: mio ? `inset 2px 0 0 ${VERDE}` : 'none',
        textDecoration: 'none',
      }}
    >
      <Nombre lado={p.local} res={vivo ? null : p.resultado_local} mostrar={mostrar} />
      {mostrar ? (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 7px',
            borderRadius: 7,
            background: 'rgba(255,255,255,0.04)',
            boxShadow: vivo ? 'inset 0 0 0 1px rgba(61,220,132,0.3)' : 'none',
            fontFamily: LETRA,
            fontWeight: 700,
            fontSize: 15,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <Num lado={p.local} res={vivo ? null : p.resultado_local} />
          <i style={{ fontStyle: 'normal', color: '#45524C', fontWeight: 500, fontSize: 12 }}>–</i>
          <Num lado={p.visitante} res={vivo ? null : p.resultado_visitante} />
        </span>
      ) : (
        <span style={{ fontFamily: LETRA, fontWeight: 500, fontSize: 11.5, letterSpacing: '0.12em', color: '#56625C', padding: '0 8px' }}>vs</span>
      )}
      <Nombre lado={p.visitante} res={vivo ? null : p.resultado_visitante} mostrar={mostrar} derecha />
    </Link>
  );
}

function Nombre({ lado, res, mostrar, derecha = false }: { lado: LadoJ; res: 'G' | 'E' | 'P' | null; mostrar: boolean; derecha?: boolean }) {
  if (!lado) {
    return (
      <span style={{ minWidth: 0, display: 'flex', justifyContent: derecha ? 'flex-end' : 'flex-start' }}>
        <span style={{ fontSize: 12.5, color: '#56625C', fontStyle: 'italic' }}>descansa</span>
      </span>
    );
  }
  const gana = res === 'G';
  const pierde = res === 'P';
  const avatar = (
    <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colorDe(lado.nombre), color: '#EAF2EE', fontSize: 10.5, fontWeight: 700, opacity: pierde ? 0.45 : 1 }}>
      {lado.nombre.slice(0, 1).toUpperCase()}
    </span>
  );
  const nombre = (
    <span
      style={{
        minWidth: 0,
        fontSize: 13,
        fontWeight: gana || lado.soy_yo ? 700 : 500,
        letterSpacing: '-0.005em',
        color: lado.soy_yo ? VERDE : gana ? '#FFFFFF' : pierde ? '#6F7D76' : '#C9D3CE',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {lado.nombre.charAt(0).toUpperCase() + lado.nombre.slice(1)}
    </span>
  );
  const check = !mostrar && lado.equipo ? <span title="Equipo hecho" style={{ flexShrink: 0, color: VERDE, fontSize: 10 }}>✓</span> : null;
  return (
    <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, justifyContent: derecha ? 'flex-end' : 'flex-start' }}>
      {derecha ? (
        <>
          {check}
          {nombre}
          {avatar}
        </>
      ) : (
        <>
          {avatar}
          {nombre}
          {check}
        </>
      )}
    </span>
  );
}

function Num({ lado, res }: { lado: LadoJ; res: 'G' | 'E' | 'P' | null }) {
  const texto = !lado ? '·' : lado.equipo ? pts(lado.total ?? 0) : '–';
  const color = res === 'G' ? VERDE : res === 'E' ? ORO : res === 'P' ? '#56625C' : S.TEXT;
  return <span style={{ minWidth: 20, textAlign: 'center', color }}>{texto}</span>;
}
