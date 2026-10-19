'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import MarcoPocha, { ORO, useAccesoPocha } from '@/components/pocha/MarcoPocha';
import { IconoCartas } from '@/components/v2/IconosV2';
import { MAX_JUGADORES, MIN_JUGADORES, cartasMaximas, generarManos, manoCompleta, manoVacia, totales, type PartidaPocha } from '@/lib/pocha';

// ============================================================================
// POCHA (19/10, Iñi): crear partida y lista de partidas
// ============================================================================
// Nº de jugadores, sus nombres en el orden de la mesa (reparte primero el de
// arriba y va pasando), y qué manos especiales hay: subastadas y/o a ciegas
// (cada una añade otra vuelta de manos con todas las cartas).

const caja = { background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 12 };
const etiqueta = { fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: S.MUTED_2 };

function botonRedondo(activo: boolean) {
  return { width: 38, height: 38, borderRadius: 10, border: `1px solid ${S.BORDER}`, background: S.PANEL, color: S.TEXT, fontSize: 20, fontWeight: 800, cursor: activo ? 'pointer' : 'default', opacity: activo ? 1 : 0.35, padding: 0 } as const;
}

export default function PaginaPocha() {
  const router = useRouter();
  const { perfil, estado } = useAccesoPocha();
  const [partidas, setPartidas] = useState<PartidaPocha[] | null>(null);
  const [num, setNum] = useState(4);
  const [nombres, setNombres] = useState<string[]>(['', '', '', '', '', '', '', '']);
  const [nombre, setNombre] = useState('');
  const [subastadas, setSubastadas] = useState(false);
  const [ciegas, setCiegas] = useState(false);
  const [reparte, setReparte] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [borrar, setBorrar] = useState<string | null>(null);

  useEffect(() => {
    if (estado !== 'ok') return;
    void supabase
      .from('pocha_partidas')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(30)
      .then(({ data }) => setPartidas((data as PartidaPocha[]) ?? []));
  }, [estado]);

  const manos = useMemo(() => generarManos(num, { subastadas, ciegas }), [num, subastadas, ciegas]);
  const max = cartasMaximas(num);

  function mover(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= num) return;
    setNombres((prev) => {
      const r = [...prev];
      [r[i], r[j]] = [r[j], r[i]];
      return r;
    });
    // El que reparte sigue siendo la misma persona aunque cambie de sitio.
    setReparte((r) => (r === i ? j : r === j ? i : r));
  }

  async function crear() {
    setError(null);
    const jugadores = nombres.slice(0, num).map((x) => x.trim());
    if (jugadores.some((x) => !x)) return setError('Pon el nombre de todos los jugadores.');
    if (new Set(jugadores.map((x) => x.toLowerCase())).size !== jugadores.length) return setError('Hay dos jugadores con el mismo nombre.');
    setCreando(true);
    const { data, error: e } = await supabase
      .from('pocha_partidas')
      .insert({ nombre: nombre.trim() || 'Pocha', jugadores, subastadas, ciegas, reparte_primero: Math.min(reparte, num - 1), manos: manos.map(() => manoVacia(num)) })
      .select('id')
      .single();
    setCreando(false);
    if (e || !data) return setError('No se ha podido crear la partida. Inténtalo de nuevo.');
    router.push(`/pocha/${(data as { id: string }).id}`);
  }

  async function borrarPartida(id: string) {
    await supabase.from('pocha_partidas').delete().eq('id', id);
    setPartidas((p) => (p ?? []).filter((x) => x.id !== id));
    setBorrar(null);
  }

  return (
    <MarcoPocha perfil={perfil} estado={estado}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconoCartas size={34} />
        <h1 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 30, color: S.TEXT }}>Pocha</h1>
      </div>

      {partidas && partidas.length > 0 && (
        <div style={caja}>
          <span style={etiqueta}>Tus partidas</span>
          {partidas.map((p) => {
            const n = p.jugadores.length;
            const hechas = p.manos.filter((m) => manoCompleta(m, n)).length;
            const t = totales(p.manos, n);
            const mejor = Math.max(...t);
            const lider = p.jugadores[t.indexOf(mejor)];
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: `1px solid ${S.BORDER}` }}>
                <Link href={`/pocha/${p.id}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, textDecoration: 'none' }}>
                  <span style={{ fontWeight: 800, fontSize: 15, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nombre || 'Pocha'}</span>
                  <span style={{ fontSize: 12, color: S.MUTED_2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.jugadores.join(' · ')}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: p.terminada ? ORO : S.ACCENT }}>
                    {p.terminada ? `🏆 Terminada · gana ${lider} (${mejor})` : hechas === 0 ? 'Sin empezar' : `Mano ${hechas} de ${p.manos.length} · va ganando ${lider} (${mejor})`}
                  </span>
                </Link>
                {borrar === p.id ? (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => void borrarPartida(p.id)} style={{ width: 'auto', padding: '6px 10px', borderRadius: 8, border: 'none', background: '#FF5C5C', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                      Borrar
                    </button>
                    <button type="button" onClick={() => setBorrar(null)} style={{ width: 'auto', padding: '6px 10px', borderRadius: 8, border: `1px solid ${S.BORDER}`, background: 'transparent', color: S.MUTED, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" aria-label="Borrar partida" onClick={() => setBorrar(p.id)} style={{ width: 'auto', background: 'transparent', border: 'none', color: S.MUTED_3, fontSize: 18, cursor: 'pointer', padding: 4 }}>
                    🗑
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={caja}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: S.TEXT }}>Nueva partida</span>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={etiqueta}>Nombre (opcional)</span>
          <input value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Pocha del viernes" style={S.input} />
        </label>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={etiqueta}>¿Cuántos jugáis?</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" disabled={num <= MIN_JUGADORES} onClick={() => setNum(num - 1)} style={botonRedondo(num > MIN_JUGADORES)}>
              −
            </button>
            <span style={{ minWidth: 24, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 28, color: S.ACCENT }}>{num}</span>
            <button type="button" disabled={num >= MAX_JUGADORES} onClick={() => setNum(num + 1)} style={botonRedondo(num < MAX_JUGADORES)}>
              +
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={etiqueta}>Jugadores, en el orden de la mesa</span>
          <span style={{ fontSize: 12, color: S.MUTED_3, marginTop: -4 }}>Ponlos en el orden en que estáis sentados: el reparto y el turno de pedir van pasando en este orden. Con las flechas lo cambias.</span>
          {Array.from({ length: num }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 22, textAlign: 'center', fontWeight: 800, fontSize: 14, color: S.MUTED_3 }}>{i + 1}</span>
              <input
                value={nombres[i]}
                maxLength={16}
                onChange={(e) => setNombres((prev) => prev.map((x, k) => (k === i ? e.target.value : x)))}
                placeholder={`Jugador ${i + 1}`}
                style={{ ...S.input, flex: 1, minWidth: 0 }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)} style={{ width: 30, height: 20, padding: 0, borderRadius: 6, border: `1px solid ${S.BORDER}`, background: 'transparent', color: S.TEXT, fontSize: 10, cursor: 'pointer', opacity: i === 0 ? 0.3 : 1 }}>
                  ▲
                </button>
                <button type="button" aria-label="Bajar" disabled={i === num - 1} onClick={() => mover(i, 1)} style={{ width: 30, height: 20, padding: 0, borderRadius: 6, border: `1px solid ${S.BORDER}`, background: 'transparent', color: S.TEXT, fontSize: 10, cursor: 'pointer', opacity: i === num - 1 ? 0.3 : 1 }}>
                  ▼
                </button>
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={etiqueta}>¿Quién reparte la primera mano?</span>
          <span style={{ fontSize: 12, color: S.MUTED_3, marginTop: -4 }}>Pide primero el siguiente al que reparte.</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Array.from({ length: num }).map((_, i) => (
              <button key={i} type="button" onClick={() => setReparte(i)} style={{ ...S.pill(Math.min(reparte, num - 1) === i), width: 'auto' }}>
                {Math.min(reparte, num - 1) === i ? '🃏 ' : ''}
                {nombres[i].trim() || `Jugador ${i + 1}`}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={etiqueta}>Tipo de partida</span>
          {[
            { k: 'clasica', t: 'Clásica', d: `Se sube de 1 en 1 hasta ${max} cartas (una vuelta de ${max} por jugador) y se baja.`, on: true, fijo: true, set: () => {} },
            { k: 'subastadas', t: 'Manos subastadas', d: `Otra vuelta de ${num} manos de ${max} cartas, subastadas.`, on: subastadas, fijo: false, set: () => setSubastadas(!subastadas) },
            { k: 'ciegas', t: 'Manos a ciegas', d: `Otra vuelta de ${num} manos de ${max} cartas, a ciegas.`, on: ciegas, fijo: false, set: () => setCiegas(!ciegas) },
          ].map((o) => (
            <label key={o.k} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 12, border: `1px solid ${o.on ? 'rgba(61,220,132,0.45)' : S.BORDER}`, background: o.on ? 'rgba(61,220,132,0.07)' : 'transparent', cursor: o.fijo ? 'default' : 'pointer' }}>
              <input type="checkbox" checked={o.on} disabled={o.fijo} onChange={o.set} style={{ width: 20, height: 20, marginTop: 1, accentColor: '#3DDC84', flexShrink: 0 }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: S.TEXT }}>{o.t}</span>
                <span style={{ fontSize: 12, color: S.MUTED_2, lineHeight: 1.4 }}>{o.d}</span>
              </span>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: S.TEXT }}>
            {manos.length} manos · hasta {max} cartas
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {manos.map((m, i) => (
              <span key={i} style={{ minWidth: 20, height: 22, padding: '0 3px', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, background: m.tipo === 'subastada' ? 'rgba(240,185,77,0.2)' : m.tipo === 'ciega' ? 'rgba(167,139,250,0.22)' : '#1A211D', color: m.tipo === 'subastada' ? ORO : m.tipo === 'ciega' ? '#A78BFA' : S.MUTED }}>
                {m.cartas}
              </span>
            ))}
          </div>
          {(subastadas || ciegas) && (
            <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>
              {subastadas && <span style={{ color: ORO }}>■ subastadas </span>}
              {ciegas && <span style={{ color: '#A78BFA' }}>■ a ciegas</span>}
            </span>
          )}
        </div>

        {error && <p style={S.errorText}>{error}</p>}
        <button type="button" disabled={creando} onClick={() => void crear()} style={{ ...S.primaryButton, opacity: creando ? 0.6 : 1 }}>
          {creando ? 'Creando…' : '🃏 Empezar partida'}
        </button>
      </div>
    </MarcoPocha>
  );
}
