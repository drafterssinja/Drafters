'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import type { LineaDesglose } from '@/lib/futbolPuntuacion';

// ============================================================================
// ADMIN — COMPARAR ESPN Y API-FOOTBALL (20/11, Iñi)
// ============================================================================
// "Empiézalo para la jornada que empieza hoy; el martes miramos si ha
// funcionado bien y lo cambiamos para la Champions."
// Modo prueba: en cada partido se calculan los puntos de cada jugador DOS
// veces, con las estadísticas de ESPN (las que cuentan) y solo con las de
// API-Football (futbol_puntos_apif, SQL 110). Aquí se comparan y, cuando
// cuadre, se cambia la fuente de los puntos con el interruptor (por liga). Si
// a un jugador no se le encuentra en API-Football, sigue puntuando con ESPN.

type Fila = {
  jugador_id: string;
  competicion: string;
  partido_estado: string;
  casado_por: string | null;
  puntos_espn: number;
  minutos_espn: number;
  desglose_espn: LineaDesglose[] | null;
  puntos_apif: number;
  minutos_apif: number;
  desglose_apif: LineaDesglose[] | null;
  actualizado_en: string;
  jugadores: { nombre: string; equipo_real: string | null; posicion: string | null } | null;
};

const LIGAS = ['La Liga', 'Champions League'];
const n1 = (x: number) => (Math.round(Number(x) * 10) / 10).toString().replace('.', ',');

export default function AdminCompararFuentes() {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState(false);
  const [competiciones, setCompeticiones] = useState<string[]>([]);
  const [comp, setComp] = useState<string | null>(null);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [soloDiferentes, setSoloDiferentes] = useState(true);
  const [fuentes, setFuentes] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [falta, setFalta] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push('/login');
      const { data } = await supabase.from('perfiles').select('rol').eq('id', session.user.id).single();
      if (!data || data.rol !== 'admin') return router.push('/cuenta');
      setAutorizado(true);
    })();
  }, [router]);

  const cargarFuentes = useCallback(async () => {
    const { data } = await supabase.from('futbol_valor_estado').select('valor').eq('clave', 'config:fuente_puntos_futbol').maybeSingle();
    setFuentes(((data as { valor: { ligas?: Record<string, string> } | null } | null)?.valor?.ligas) ?? {});
  }, []);

  useEffect(() => {
    if (!autorizado) return;
    void cargarFuentes();
    void supabase
      .from('futbol_puntos_apif')
      .select('competicion,actualizado_en')
      .order('actualizado_en', { ascending: false })
      .limit(1000)
      .then(({ data, error }) => {
        if (error) return setFalta(true);
        const lista = Array.from(new Set(((data as { competicion: string }[]) ?? []).map((d) => d.competicion)));
        setCompeticiones(lista);
        setComp((c) => c ?? lista[0] ?? null);
      });
  }, [autorizado, cargarFuentes]);

  useEffect(() => {
    if (!comp) return;
    setFilas(null);
    void supabase
      .from('futbol_puntos_apif')
      .select('*, jugadores(nombre,equipo_real,posicion)')
      .eq('competicion', comp)
      .limit(2000)
      .then(({ data }) => setFilas((data as Fila[]) ?? []));
  }, [comp]);

  const res = useMemo(() => {
    const f = filas ?? [];
    const dif = (x: Fila) => Number(x.puntos_apif) - Number(x.puntos_espn);
    const iguales = f.filter((x) => Math.abs(dif(x)) < 0.05).length;
    const sinApif = f.filter((x) => x.minutos_espn > 0 && x.minutos_apif === 0).length;
    const sinEspn = f.filter((x) => x.minutos_apif > 0 && x.minutos_espn === 0).length;
    const sumaDif = f.reduce((s, x) => s + Math.abs(dif(x)), 0);
    const lista = [...f].filter((x) => !soloDiferentes || Math.abs(dif(x)) >= 0.05).sort((a, b) => Math.abs(dif(b)) - Math.abs(dif(a)));
    return { total: f.length, iguales, sinApif, sinEspn, sumaDif, lista, dif };
  }, [filas, soloDiferentes]);

  async function cambiarFuente(liga: string, fuente: 'espn' | 'apif') {
    if (fuente === 'apif' && !window.confirm(`¿Puntuar ${liga} con API-Football a partir de ahora? (Si a alguien no se le encuentra allí, sigue con ESPN.)`)) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const r = await fetch('/api/admin/valores-futbol', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'fuente', liga, fuente }) });
    const json = await r.json();
    setAviso(r.ok ? `${liga}: los puntos salen ahora de ${fuente === 'apif' ? 'API-Football' : 'ESPN'}.` : json.error ?? 'Error');
    void cargarFuentes();
  }

  if (!autorizado) return null;
  const pill = (activo: boolean) => ({ ...S.pill(activo), padding: '6px 12px', fontSize: 12.5 });

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader sinVolver />
        <div style={{ ...S.accountSection, gap: 12 }}>
          <Link href="/admin" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>← Panel de administración</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Comparar ESPN y API-Football</h1>
          <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
            Modo prueba: en cada partido se calculan los puntos de cada jugador con ESPN (los que cuentan) y, aparte, solo con API-Football. Cuando cuadren, cambia la fuente con el interruptor de abajo. Si a alguien no se le encuentra en API-Football, sigue puntuando con ESPN.
          </p>

          {falta && <span style={{ fontSize: 12.5, color: '#FF6B6B' }}>Falta ejecutar el SQL 110 en Supabase.</span>}

          <span style={S.sectionLabel}>De dónde salen los puntos</span>
          {LIGAS.map((l) => {
            const f = fuentes[l] === 'apif' ? 'apif' : 'espn';
            return (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ minWidth: 130, fontSize: 13, fontWeight: 700, color: S.TEXT }}>{l}</span>
                <button type="button" onClick={() => void cambiarFuente(l, 'espn')} style={pill(f === 'espn')}>ESPN</button>
                <button type="button" onClick={() => void cambiarFuente(l, 'apif')} style={pill(f === 'apif')}>API-Football</button>
              </div>
            );
          })}
          {aviso && <span style={{ fontSize: 12.5, color: '#F0B94D' }}>{aviso}</span>}

          <span style={S.sectionLabel}>Jornada</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {competiciones.length === 0 && !falta && <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>Todavía no hay datos: se llenan cuando empiezan los partidos.</span>}
            {competiciones.map((c) => (
              <button key={c} type="button" onClick={() => setComp(c)} style={pill(c === comp)}>
                {c}
              </button>
            ))}
          </div>

          {filas && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                {[
                  { v: res.total, t: 'jugadores que han jugado' },
                  { v: res.total ? `${Math.round((res.iguales / res.total) * 100)} %` : '—', t: 'con los mismos puntos' },
                  { v: res.total - res.iguales, t: 'con puntos distintos' },
                  { v: n1(res.sumaDif), t: 'puntos de diferencia en total' },
                  { v: res.sinApif, t: 'no encontrados en API-Football' },
                  { v: res.sinEspn, t: 'solo en API-Football' },
                ].map((k) => (
                  <div key={k.t} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${S.CARD_BORDER}`, background: S.PANEL }}>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT }}>{k.v}</div>
                    <div style={{ fontSize: 11.5, color: S.MUTED_2 }}>{k.t}</div>
                  </div>
                ))}
              </div>

              <label style={{ fontSize: 12.5, color: S.MUTED, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={soloDiferentes} onChange={(e) => setSoloDiferentes(e.target.checked)} /> Solo los que no cuadran
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 46px 46px 46px 70px', gap: 6, fontSize: 10.5, fontWeight: 700, color: S.MUTED_3, textTransform: 'uppercase' }}>
                <span>Jugador</span>
                <span style={{ textAlign: 'right' }}>ESPN</span>
                <span style={{ textAlign: 'right' }}>API</span>
                <span style={{ textAlign: 'right' }}>Dif.</span>
                <span style={{ textAlign: 'right' }}>Min E/A</span>
              </div>
              {res.lista.length === 0 && <span style={{ fontSize: 12.5, color: '#3DDC84' }}>Todo cuadra.</span>}
              {res.lista.slice(0, 400).map((x) => {
                const d = res.dif(x);
                const k = x.jugador_id;
                return (
                  <div key={k} style={{ borderTop: `1px solid ${S.CARD_BORDER}` }}>
                    <button
                      type="button"
                      onClick={() => setAbierto(abierto === k ? null : k)}
                      style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 46px 46px 46px 70px', gap: 6, alignItems: 'center', padding: '7px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12.5, color: S.TEXT }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <b>{x.jugadores?.nombre ?? '?'}</b>
                        <span style={{ display: 'block', fontSize: 11, color: S.MUTED_3 }}>
                          {x.jugadores?.equipo_real ?? ''} · {x.casado_por ? `casado por ${x.casado_por === 'id' ? 'id' : x.casado_por === 'espn' ? 'ESPN' : 'nombre'}` : 'no encontrado en API-Football'}
                        </span>
                      </span>
                      <span style={{ textAlign: 'right' }}>{n1(x.puntos_espn)}</span>
                      <span style={{ textAlign: 'right' }}>{n1(x.puntos_apif)}</span>
                      <span style={{ textAlign: 'right', fontWeight: 800, color: Math.abs(d) < 0.05 ? S.MUTED_3 : d > 0 ? '#3DDC84' : '#FF6B6B' }}>{d > 0 ? '+' : ''}{n1(d)}</span>
                      <span style={{ textAlign: 'right', color: x.minutos_espn !== x.minutos_apif ? '#F0B94D' : S.MUTED_2 }}>
                        {x.minutos_espn}&apos;/{x.minutos_apif}&apos;
                      </span>
                    </button>
                    {abierto === k && <Desglose espn={x.desglose_espn ?? []} apif={x.desglose_apif ?? []} />}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Desglose({ espn, apif }: { espn: LineaDesglose[]; apif: LineaDesglose[] }) {
  const claves = Array.from(new Set([...espn.map((l) => l.clave), ...apif.map((l) => l.clave)]));
  const de = (lista: LineaDesglose[], c: string) => lista.find((l) => l.clave === c);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 0 10px 8px', fontSize: 12 }}>
      {claves.map((c) => {
        const e = de(espn, c);
        const a = de(apif, c);
        const igual = (e?.puntos ?? 0) === (a?.puntos ?? 0);
        return (
          <div key={c} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px', gap: 6, color: igual ? S.MUTED_2 : S.TEXT }}>
            <span>{(e ?? a)?.etiqueta ?? c}</span>
            <span style={{ textAlign: 'right' }}>{e ? `${e.cantidad}× ${n1(e.puntos)}` : '—'}</span>
            <span style={{ textAlign: 'right', fontWeight: igual ? 400 : 800 }}>{a ? `${a.cantidad}× ${n1(a.puntos)}` : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}
