'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { LIGAS_VALOR_FUTBOL } from '@/lib/valorFutbolClave';

// ============================================================================
// ADMIN — VALOR DE LOS JUGADORES DE FÚTBOL (03/11, Iñi)
// ============================================================================
// Lo que hacen solos los procesos de cada noche (plantillas) y de cada lunes
// (valor Drafters), con API-Football. Ver lib/server/valorFutbol.ts y SQL 92.
//  · Resumen por liga: jugadores, cuántos casados con API-Football, nuevos
//    pendientes de revisar.
//  · Últimos cambios: altas, bajas, traspasos y subidas/bajadas de valor.
//  · Tabla de jugadores con su valor de partida y el de ahora (y, para los
//    nuevos con valor estimado, una caja para ponerles el valor a mano).
//  · Botones para hacerlo ahora sin esperar a la noche / al lunes.

type Fila = { id: string; liga: string; nombre: string; equipo_real: string | null; posicion: string | null; valor_base: number | null; valor: number | null; apif_id: number | null; activo: boolean; nuevo: boolean; ultimo_cambio: number | null; fecha_base: string };
type Evento = { id: number; liga: string; fecha: string; tipo: string; jugador: string | null; detalle: string | null };
type Estado = { clave: string; valor: Record<string, unknown> | null; actualizado_en: string };

const COLOR_TIPO: Record<string, string> = { alta: '#3DDC84', baja: '#FF6B6B', traspaso: '#5CC8FF', valor: '#F0B94D', aviso: '#AAB4AE' };
const POS: Record<string, string> = { portero: 'POR', defensa: 'DEF', centrocampista: 'MED', delantero: 'DEL' };
const eur = (x: number | null) => (x === null || x === undefined ? '—' : `${Math.round(Number(x)).toLocaleString('es-ES')} €`);
const fechaHora = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

export default function AdminValoresFutbol() {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState(false);
  const [liga, setLiga] = useState(LIGAS_VALOR_FUTBOL[0].prefijo);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [estados, setEstados] = useState<Estado[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [buscar, setBuscar] = useState('');
  const [soloNuevos, setSoloNuevos] = useState(false);
  const [soloSinCasar, setSoloSinCasar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState<Record<string, string>>({});
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

  const cargar = useCallback(async () => {
    const todas: Fila[] = [];
    for (let d = 0; ; d += 1000) {
      const { data, error } = await supabase.from('futbol_valor').select('id,liga,nombre,equipo_real,posicion,valor_base,valor,apif_id,activo,nuevo,ultimo_cambio,fecha_base').eq('liga', liga).order('valor', { ascending: false, nullsFirst: false }).range(d, d + 999);
      if (error) {
        setFalta(true);
        setFilas([]);
        return;
      }
      const lote = (data as Fila[]) ?? [];
      todas.push(...lote);
      if (lote.length < 1000) break;
    }
    setFalta(false);
    setFilas(todas);
    const [{ data: ev }, { data: es }, { count }] = await Promise.all([
      supabase.from('futbol_valor_eventos').select('*').eq('liga', liga).order('fecha', { ascending: false }).limit(80),
      supabase.from('futbol_valor_estado').select('*'),
      supabase.from('futbol_valor_cola').select('id', { count: 'exact', head: true }).eq('hecho', false),
    ]);
    setEventos((ev as Evento[]) ?? []);
    setEstados((es as Estado[]) ?? []);
    setPendientes(count ?? 0);
  }, [liga]);

  useEffect(() => {
    if (autorizado) void cargar();
  }, [autorizado, cargar]);

  async function llamar(accion: string, extra: Record<string, unknown> = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sin sesión');
    const r = await fetch('/api/admin/valores-futbol', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accion, ...extra }) });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error ?? 'Error');
    return json;
  }

  async function hacerAhora(accion: 'plantillas' | 'valores') {
    setOcupado(true);
    setAviso(accion === 'plantillas' ? 'Repasando plantillas…' : 'Bajando estadísticas…');
    try {
      const r = await llamar(accion);
      setAviso(`${r.equipos} equipos en cola. Procesando…`);
      for (let i = 0; i < 60; i++) {
        const p = await llamar('procesar');
        setAviso(`Procesando… quedan ${p.pendientes} consultas.`);
        if (p.pendientes === 0) break;
      }
      setAviso('Hecho.');
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(false);
      void cargar();
    }
  }

  // 04/11: quitar de la plantilla a un jugador que ya no está en su equipo.
  async function quitar(f: Fila) {
    if (!window.confirm(`¿Quitar a ${f.nombre} (${f.equipo_real ?? 'sin equipo'}) de la plantilla? Dejará de salir en las próximas jornadas.`)) return;
    const { error } = await supabase.from('futbol_valor').update({ activo: false, actualizado_en: new Date().toISOString() }).eq('id', f.id);
    if (error) return setAviso(error.message);
    void cargar();
  }

  // 06/11 (Iñi): casar a mano con API-Football (sale con otro nombre allí).
  const [casando, setCasando] = useState<{ id: string; cargando: boolean; error: string | null; jugadores: { id: number; nombre: string; dorsal: number | null; posicion: string | null; casadoCon: string | null }[] } | null>(null);
  async function abrirCasar(f: Fila) {
    if (casando?.id === f.id) return setCasando(null);
    setCasando({ id: f.id, cargando: true, error: null, jugadores: [] });
    try {
      const r = await llamar('squad', { id: f.id });
      setCasando({ id: f.id, cargando: false, error: null, jugadores: r.jugadores ?? [] });
    } catch (e) {
      setCasando({ id: f.id, cargando: false, error: (e as Error).message, jugadores: [] });
    }
  }
  async function casar(f: Fila, apifId: number, nombreApif: string) {
    if (!window.confirm(`¿Casar a ${f.nombre} con "${nombreApif}" de API-Football?`)) return;
    try {
      await llamar('casar', { id: f.id, apif_id: apifId });
      setCasando(null);
      setAviso(`${f.nombre} casado con "${nombreApif}".`);
      void cargar();
    } catch (e) {
      setCasando((c) => (c ? { ...c, error: (e as Error).message } : c));
    }
  }

  async function fijar(f: Fila) {
    const v = Number((editando[f.id] ?? '').replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return setAviso('Valor no válido.');
    const { error } = await supabase.rpc('futbol_valor_fijar', { p_id: f.id, p_valor: v });
    if (error) return setAviso(error.message);
    setEditando((e) => ({ ...e, [f.id]: '' }));
    void cargar();
  }

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (filas ?? []).filter((f) => f.activo && (!soloNuevos || f.nuevo) && (!soloSinCasar || !f.apif_id) && (!q || `${f.nombre} ${f.equipo_real ?? ''}`.toLowerCase().includes(q)));
  }, [filas, buscar, soloNuevos, soloSinCasar]);

  if (!autorizado) return null;
  const activos = (filas ?? []).filter((f) => f.activo);
  const casados = activos.filter((f) => f.apif_id).length;
  const nuevos = activos.filter((f) => f.nuevo).length;
  const est = (k: string) => estados.find((e) => e.clave === k);
  const boton = { ...S.secondaryLinkButton, width: 'auto', padding: '9px 14px', fontSize: 13, marginTop: 0 } as const;

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader sinVolver />
        <div style={{ ...S.accountSection, gap: 12 }}>
          <Link href="/admin" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>← Panel de administración</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Valor de los jugadores (fútbol)</h1>
          <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0, lineHeight: 1.5 }}>
            Cada noche se repasan las plantillas con API-Football (fichajes, salidas, cambios de equipo). Cada lunes el valor se ajusta por sus últimos 5 partidos: como mucho un 5 % por semana (sin jugar, como mucho −2 %) y nunca más de un 30 % respecto al valor cargado. Para volver a empezar desde unos valores nuevos, pégalos en Mesas Drafters → Valor de mercado de fútbol.
          </p>
          {falta && <p style={S.errorText}>Falta ejecutar el SQL 92 en Supabase.</p>}

          <div style={{ display: 'flex', gap: 6 }}>
            {LIGAS_VALOR_FUTBOL.map((l) => (
              <button key={l.prefijo} type="button" onClick={() => setLiga(l.prefijo)} style={S.pill(liga === l.prefijo)}>
                {l.nombre}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              ['Jugadores', activos.length],
              ['Casados con API-Football', casados],
              ['Nuevos por revisar', nuevos],
            ].map(([t, n]) => (
              <div key={String(t)} style={{ ...S.card, padding: 12, gap: 2, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 24, color: S.TEXT }}>{n}</span>
                <span style={{ fontSize: 11, color: S.MUTED_2 }}>{t}</span>
              </div>
            ))}
          </div>
          <span style={{ fontSize: 12, color: S.MUTED_2 }}>
            Último repaso de plantillas: {fechaHora((est('plantilla_lote')?.valor?.fin as string) ?? null)} · Última actualización de valores: {fechaHora((est('stats_lote')?.valor?.fin as string) ?? null)}
            {pendientes > 0 ? ` · ${pendientes} consultas en cola` : ''}
          </span>
          {/* 04/11: para ver que el cálculo automático de niveles funciona. */}
          {(() => {
            const xp = est('cron:xp_procesar');
            if (!xp) return null;
            const v = (xp.valor ?? {}) as { error?: string | null; resultado?: number | null };
            return (
              <span style={{ fontSize: 12, color: v.error ? '#FF6B6B' : S.MUTED_2 }}>
                Último cálculo automático de niveles: {fechaHora(xp.actualizado_en)}
                {v.error ? ` · ERROR: ${v.error}` : ` · ${v.resultado ?? 0} partidas calculadas`}
              </span>
            );
          })()}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" disabled={ocupado} onClick={() => void hacerAhora('plantillas')} style={boton}>
              Repasar plantillas ahora
            </button>
            <button type="button" disabled={ocupado} onClick={() => void hacerAhora('valores')} style={boton}>
              Actualizar valores ahora
            </button>
            <button
              type="button"
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                setAviso('Buscando lesionados, sancionados y dudas…');
                try {
                  const r = (await llamar('bajas')) as Record<string, { lesiones?: number; marcados?: number; equipos?: number; equiposConLista?: number; deUltimoPartido?: number; sinCasar?: string[]; error?: string }>;
                  const partes = Object.entries(r).map(([c, v]) => {
                    if (typeof v !== 'object' || !v) return `${c}: ${String(v)}`;
                    if (v.error) return `${c}: error (${v.error})`;
                    let t = `${c}: ${v.marcados ?? 0} jugadores marcados (${v.lesiones ?? 0} bajas de API-Football en ${v.equiposConLista ?? 0} de ${v.equipos ?? 0} equipos`;
                    if (v.deUltimoPartido) t += `; ${v.deUltimoPartido} sacadas del último partido del equipo`;
                    t += ')';
                    if (v.sinCasar?.length) t += `. Sin casar: ${v.sinCasar.join(', ')}`;
                    return t;
                  });
                  setAviso(partes.length ? partes.join(' · ') : 'No hay jornadas abiertas ahora mismo.');
                } catch (e) {
                  setAviso((e as Error).message);
                } finally {
                  setOcupado(false);
                }
              }}
              style={boton}
            >
              Actualizar bajas ahora
            </button>
          </div>
          {aviso && <span style={{ fontSize: 12.5, color: '#F0B94D' }}>{aviso}</span>}

          <span style={S.sectionLabel}>Últimos cambios</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
            {eventos.length === 0 && <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>Todavía nada.</span>}
            {eventos.map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'baseline' }}>
                <span style={{ flexShrink: 0, width: 74, color: S.MUTED_3 }}>{fechaHora(e.fecha)}</span>
                <span style={{ flexShrink: 0, width: 62, fontWeight: 800, color: COLOR_TIPO[e.tipo] ?? S.MUTED, textTransform: 'uppercase', fontSize: 10.5 }}>{e.tipo}</span>
                <span style={{ color: S.TEXT }}>
                  {e.jugador ? <b>{e.jugador} </b> : null}
                  <span style={{ color: S.MUTED }}>{e.detalle}</span>
                </span>
              </div>
            ))}
          </div>

          <span style={S.sectionLabel}>Jugadores</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar jugador o equipo…" style={{ ...S.input, flex: 1, minWidth: 180, fontSize: 14, padding: '9px 12px' }} />
            <label style={{ fontSize: 12.5, color: S.MUTED, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={soloNuevos} onChange={(e) => setSoloNuevos(e.target.checked)} /> Solo nuevos
            </label>
            <label style={{ fontSize: 12.5, color: S.MUTED, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={soloSinCasar} onChange={(e) => setSoloSinCasar(e.target.checked)} /> Solo sin casar
            </label>
          </div>
          {filas === null ? (
            <span style={{ fontSize: 12.5, color: S.MUTED_3 }}>Cargando…</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 34px 92px 92px 52px', gap: 6, fontSize: 10.5, fontWeight: 700, color: S.MUTED_3, textTransform: 'uppercase', padding: '4px 0' }}>
                <span>Jugador</span>
                <span>Pos</span>
                <span style={{ textAlign: 'right' }}>Cargado</span>
                <span style={{ textAlign: 'right' }}>Ahora</span>
                <span style={{ textAlign: 'right' }}>Semana</span>
              </div>
              {visibles.slice(0, 400).map((f) => {
                const total = f.valor && f.valor_base ? (f.valor / f.valor_base - 1) * 100 : 0;
                return (
                  <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 34px 92px 92px 52px', gap: 6, alignItems: 'center', fontSize: 12.5, padding: '7px 0', borderTop: `1px solid ${S.CARD_BORDER}` }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ color: S.TEXT, fontWeight: 700 }}>{f.nombre}</span>
                      {f.nuevo && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#3DDC84' }}>NUEVO</span>}
                      {!f.apif_id && (
                        <>
                          <span style={{ marginLeft: 6, fontSize: 10, color: S.MUTED_3 }}>sin casar</span>
                          <span style={{ display: 'inline-flex', gap: 6, marginLeft: 6, verticalAlign: 'middle' }}>
                            <button type="button" onClick={() => void abrirCasar(f)} style={{ width: 'auto', fontSize: 10.5, fontWeight: 700, color: '#3DDC84', background: 'none', border: '1px solid rgba(61,220,132,0.45)', borderRadius: 6, padding: '1px 6px', cursor: 'pointer' }}>
                              Casar
                            </button>
                            <button type="button" onClick={() => void quitar(f)} style={{ width: 'auto', fontSize: 10.5, fontWeight: 700, color: '#FF6B6B', background: 'none', border: '1px solid rgba(255,107,107,0.45)', borderRadius: 6, padding: '1px 6px', cursor: 'pointer' }}>
                              Quitar
                            </button>
                          </span>
                        </>
                      )}
                      {casando?.id === f.id && (
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '6px 0', padding: 8, borderRadius: 8, border: `1px solid ${S.CARD_BORDER}`, background: 'rgba(255,255,255,0.02)' }}>
                          <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>¿Quién es en la plantilla de API-Football? Toca su nombre.</span>
                          {casando.cargando && <span style={{ fontSize: 12, color: S.MUTED_3 }}>Cargando plantilla…</span>}
                          {casando.error && <span style={{ fontSize: 12, color: '#FF6B6B' }}>{casando.error}</span>}
                          {casando.jugadores.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              disabled={!!p.casadoCon}
                              onClick={() => void casar(f, p.id, p.nombre)}
                              style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, textAlign: 'left', fontSize: 12.5, padding: '5px 6px', borderRadius: 6, border: 'none', cursor: p.casadoCon ? 'default' : 'pointer', background: p.casadoCon ? 'transparent' : 'rgba(61,220,132,0.06)', color: p.casadoCon ? S.MUTED_3 : S.TEXT }}
                            >
                              <span>
                                {p.dorsal ? `${p.dorsal} · ` : ''}
                                <b>{p.nombre}</b> {p.posicion ? <span style={{ color: S.MUTED_3 }}>({p.posicion})</span> : null}
                              </span>
                              <span style={{ fontSize: 11, color: S.MUTED_3 }}>{p.casadoCon ? `ya es ${p.casadoCon}` : 'Este'}</span>
                            </button>
                          ))}
                        </span>
                      )}
                      <br />
                      <span style={{ color: S.MUTED_2, fontSize: 11.5 }}>{f.equipo_real}</span>
                      {f.nuevo && (
                        <span style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <input value={editando[f.id] ?? ''} onChange={(e) => setEditando((x) => ({ ...x, [f.id]: e.target.value }))} placeholder="Valor en €" inputMode="numeric" style={{ ...S.input, fontSize: 13, padding: '5px 8px', width: 120 }} />
                          <button type="button" onClick={() => void fijar(f)} style={{ ...boton, padding: '5px 10px', fontSize: 12 }}>
                            Guardar
                          </button>
                        </span>
                      )}
                    </span>
                    <span style={{ color: S.MUTED }}>{POS[f.posicion ?? ''] ?? '—'}</span>
                    <span style={{ textAlign: 'right', color: S.MUTED }}>{eur(f.valor_base)}</span>
                    <span style={{ textAlign: 'right', color: S.TEXT, fontWeight: 700 }}>
                      {eur(f.valor)}
                      {Math.abs(total) >= 0.05 && <span style={{ display: 'block', fontSize: 10.5, color: total > 0 ? '#3DDC84' : '#FF6B6B' }}>{total > 0 ? '+' : ''}{total.toFixed(1).replace('.', ',')} %</span>}
                    </span>
                    <span style={{ textAlign: 'right', color: (f.ultimo_cambio ?? 0) > 0 ? '#3DDC84' : (f.ultimo_cambio ?? 0) < 0 ? '#FF6B6B' : S.MUTED_3 }}>
                      {f.ultimo_cambio ? `${f.ultimo_cambio > 0 ? '+' : ''}${String(f.ultimo_cambio).replace('.', ',')} %` : '—'}
                    </span>
                  </div>
                );
              })}
              {visibles.length > 400 && <span style={{ fontSize: 12, color: S.MUTED_3, paddingTop: 6 }}>Mostrando 400 de {visibles.length}. Usa el buscador.</span>}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
