'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

// ============================================================================
// ADMIN — PROBAR API-FOOTBALL (01/11, Iñi)
// ============================================================================
// Ver con un partido real qué estadísticas por jugador trae API-Football antes
// de pagar. Ver app/api/admin/probar-api-football/route.ts.

const ETIQUETA: Record<string, string> = {
  'games.minutes': 'Minutos',
  'games.position': 'Posición',
  'games.rating': 'Nota (0-10)',
  'games.substitute': 'Suplente',
  'games.captain': 'Capitán',
  offsides: 'Fueras de juego',
  'shots.total': 'Tiros',
  'shots.on': 'Tiros a puerta',
  'goals.total': 'Goles',
  'goals.conceded': 'Goles encajados',
  'goals.assists': 'Asistencias',
  'goals.saves': 'Paradas',
  'passes.total': 'Pases',
  'passes.key': 'Pases clave',
  'passes.accuracy': 'Pases buenos',
  'tackles.total': 'Entradas',
  'tackles.blocks': 'Tiros bloqueados',
  'tackles.interceptions': 'Intercepciones',
  'duels.total': 'Duelos',
  'duels.won': 'Duelos ganados',
  'dribbles.attempts': 'Regates intentados',
  'dribbles.success': 'Regates buenos',
  'dribbles.past': 'Le regatean',
  'fouls.drawn': 'Faltas recibidas',
  'fouls.committed': 'Faltas cometidas',
  'cards.yellow': 'Amarillas',
  'cards.red': 'Rojas',
  'penalty.won': 'Penaltis provocados',
  'penalty.commited': 'Penaltis cometidos',
  'penalty.scored': 'Penaltis marcados',
  'penalty.missed': 'Penaltis fallados',
  'penalty.saved': 'Penaltis parados',
};
const COLUMNAS = ['games.minutes', 'games.rating', 'tackles.total', 'tackles.interceptions', 'duels.won', 'duels.total', 'dribbles.success', 'passes.key', 'fouls.drawn'];

type Partido = { id: number; fecha: string; estado: string; minuto: number | null; local: string; visitante: string; marcador: string };
type Jugadores = { errores: string[]; total_jugadores: number; cobertura: Record<string, number>; jugadores: Record<string, unknown>[] };

function ayer(): string {
  const d = new Date(Date.now() - 86400000);
  return d.toISOString().slice(0, 10);
}

export default function AdminApiFootball() {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState(false);
  const [estado, setEstado] = useState<Record<string, unknown> | null>(null);
  const [liga, setLiga] = useState<'laliga' | 'champions'>('laliga');
  const [fecha, setFecha] = useState(ayer());
  const [jornada, setJornada] = useState('35');
  const [porJornada, setPorJornada] = useState(false);
  const [temporada, setTemporada] = useState(String(new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1));
  const [partidos, setPartidos] = useState<Partido[] | null>(null);
  const [res, setRes] = useState<Jugadores | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [verCrudo, setVerCrudo] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push('/login');
      const { data } = await supabase.from('perfiles').select('rol').eq('id', session.user.id).single();
      if (!data || data.rol !== 'admin') return router.push('/cuenta');
      setAutorizado(true);
    })();
  }, [router]);

  async function llamar(cuerpo: Record<string, string>) {
    setCargando(true);
    setAviso(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sin sesión');
      const r = await fetch('/api/admin/probar-api-football', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? 'Error');
      if (json.errores?.length) setAviso(`API-Football dice: ${json.errores.join(' · ')}`);
      return json;
    } catch (e) {
      setAviso((e as Error).message);
      return null;
    } finally {
      setCargando(false);
    }
  }

  if (!autorizado) return null;
  const boton = { ...S.secondaryLinkButton, width: 'auto', padding: '9px 14px', fontSize: 13, marginTop: 0 } as const;

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader sinVolver />
        <div style={{ ...S.accountSection, gap: 12 }}>
          <Link href="/admin" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>← Panel de administración</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Probar API-Football</h1>
          <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
            Para ver qué estadísticas por jugador trae antes de pagar. El plan gratuito tiene 100 consultas al día: cada &quot;Buscar partidos&quot; y cada partido abierto gasta 1; &quot;Comprobar clave&quot; no gasta.
          </p>

          {/* 1. Clave */}
          <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <span style={{ fontWeight: 800, color: S.TEXT }}>1 · Comprobar la clave</span>
            <button type="button" disabled={cargando} onClick={async () => setEstado(await llamar({ accion: 'estado' }))} style={boton}>
              Comprobar clave
            </button>
            {estado && (
              <span style={{ fontSize: 13, color: estado.ok ? '#3DDC84' : '#FF8A8A', lineHeight: 1.5 }}>
                {estado.ok ? `✓ Funciona · plan ${String(estado.plan)} · consultas hoy ${String(estado.consultas_hoy)} de ${String(estado.limite_dia)}` : '✗ La clave no funciona (mira el aviso de abajo)'}
              </span>
            )}
          </div>

          {/* 2. Partidos */}
          <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <span style={{ fontWeight: 800, color: S.TEXT }}>2 · Buscar un partido ya jugado</span>
            <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.45 }}>Con el plan gratuito: LaLiga, temporada 2024 y &quot;Por jornada&quot; (de la 1 a la 38). La búsqueda por fecha solo vale para ayer, hoy y mañana.</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['laliga', 'champions'] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLiga(l)} style={{ ...S.pill(liga === l), width: 'auto' }}>
                  {l === 'laliga' ? 'LaLiga' : 'Champions'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setPorJornada(true)} style={{ ...S.pill(porJornada), width: 'auto' }}>Por jornada</button>
              <button type="button" onClick={() => setPorJornada(false)} style={{ ...S.pill(!porJornada), width: 'auto' }}>Por fecha</button>
              {porJornada ? (
                <label style={{ fontSize: 12, color: S.MUTED_2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  Jornada
                  <input value={jornada} onChange={(e) => setJornada(e.target.value)} style={{ ...S.input, width: 60 }} />
                </label>
              ) : (
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ ...S.input, width: 'auto', colorScheme: 'dark' }} />
              )}
              <label style={{ fontSize: 12, color: S.MUTED_2, display: 'flex', alignItems: 'center', gap: 6 }}>
                Temporada
                <input value={temporada} onChange={(e) => setTemporada(e.target.value)} style={{ ...S.input, width: 70 }} />
              </label>
            </div>
            <button
              type="button"
              disabled={cargando}
              onClick={async () => {
                setRes(null);
                const j = await llamar(porJornada ? { accion: 'partidos', liga, temporada, jornada } : { accion: 'partidos', liga, fecha, temporada });
                setPartidos(j?.partidos ?? []);
              }}
              style={boton}
            >
              Buscar partidos (1 consulta)
            </button>
            {partidos?.length === 0 && <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>No hay partidos ese día (o el plan no deja esa temporada: mira el aviso).</span>}
            {partidos?.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={cargando}
                onClick={async () => setRes(await llamar({ accion: 'jugadores', partido: String(p.id) }))}
                style={{ ...boton, width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: 8 }}
              >
                <span>
                  {p.local} {p.marcador} {p.visitante}
                </span>
                <span style={{ color: S.MUTED_2 }}>{p.estado}{p.minuto ? ` ${p.minuto}'` : ''}</span>
              </button>
            ))}
          </div>

          {aviso && <p style={{ ...S.errorText, lineHeight: 1.5 }}>{aviso}</p>}
          {cargando && <span style={{ fontSize: 12.5, color: S.MUTED_2 }}>Consultando…</span>}

          {/* 3. Resultado */}
          {res && (
            <div style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <span style={{ fontWeight: 800, color: S.TEXT }}>3 · Qué estadísticas trae ({res.total_jugadores} jugadores)</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(res.cobertura)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => (
                    <span key={k} style={{ fontSize: 11.5, padding: '4px 8px', borderRadius: 999, background: n > 0 ? 'rgba(61,220,132,0.12)' : 'rgba(255,138,138,0.12)', color: n > 0 ? '#3DDC84' : '#FF8A8A' }}>
                      {ETIQUETA[k] ?? k}: {n > 0 ? `${n} jug.` : 'vacío'}
                    </span>
                  ))}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11.5, color: S.TEXT, minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '4px 6px', color: S.MUTED_2 }}>Jugador</th>
                      {COLUMNAS.map((c) => (
                        <th key={c} style={{ padding: '4px 6px', color: S.MUTED_2, fontWeight: 700 }}>{ETIQUETA[c]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {res.jugadores.map((j, i) => (
                      <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{String(j.jugador)}</td>
                        {COLUMNAS.map((c) => (
                          <td key={c} style={{ padding: '4px 6px', textAlign: 'center', color: j[c] === null || j[c] === undefined ? S.MUTED_3 : S.TEXT }}>
                            {j[c] === null || j[c] === undefined ? '–' : String(j[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={() => setVerCrudo(!verCrudo)} style={{ ...boton, alignSelf: 'flex-start' }}>
                {verCrudo ? 'Ocultar' : 'Ver'} la respuesta completa (para Claude)
              </button>
              {verCrudo && <textarea readOnly value={JSON.stringify(res, null, 2)} style={{ ...S.input, minHeight: 260, fontFamily: 'monospace', fontSize: 11 }} />}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
